-- ============================================================
-- Superceptron Recruiter Portal — Database Migration
-- Run this in the Supabase SQL editor (once, in order).
-- ============================================================

-- ── Tables ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organisations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  domain     text        UNIQUE,  -- NULL for generic-domain orgs
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rec_profiles (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id uuid       NOT NULL REFERENCES organisations(id),
  role           text        NOT NULL CHECK (role IN ('recruiter', 'admin')),
  full_name      text,
  status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  is_owner       boolean     NOT NULL DEFAULT false,
  approval_token uuid        DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid        NOT NULL REFERENCES organisations(id),
  title           text,
  location        text,
  seniority       text,
  salary_range    text,
  must_haves      text,
  nice_to_haves   text,
  unlisted_criteria text,
  deadline        date,
  jd_file_path    text,
  status          text        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','in_review','shortlist_ready')),
  notes           text,       -- internal admin notes, never sent to client
  created_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz
);

CREATE TABLE IF NOT EXISTS uploads (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id           uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  file_path         text        NOT NULL,
  original_filename text        NOT NULL,
  file_size         bigint,
  mime_type         text,       -- server-validated extension, not client-supplied
  uploaded_by       uuid        REFERENCES auth.users(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliverables (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id           uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  file_path         text        NOT NULL,
  original_filename text,
  notes             text,
  delivered_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial   PRIMARY KEY,
  user_id    uuid,       -- NULL for system actions
  action     text        NOT NULL,
  role_id    uuid,
  file_path  text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────

CREATE INDEX ON rec_profiles (organisation_id);
CREATE INDEX ON roles (organisation_id, status);
CREATE INDEX ON uploads (role_id);
CREATE INDEX ON deliverables (role_id);
CREATE INDEX ON audit_log (role_id, created_at DESC);


-- ── Helper function ───────────────────────────────────────────
-- Returns the caller's organisation_id, or NULL if pending/not found.
-- NULL propagates through RLS → all policies deny automatically for pending users.

CREATE OR REPLACE FUNCTION my_org_id()
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT organisation_id
  FROM   rec_profiles
  WHERE  user_id = auth.uid()
  AND    status  = 'active'
$$;


-- ── Immutability trigger on rec_profiles ─────────────────────
-- Blocks any non-service-role UPDATE from changing organisation_id, role, or status.
-- Column-level GRANT (below) is the primary defence; this is depth.

CREATE OR REPLACE FUNCTION rec_profiles_immutable_cols()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Service role may change these columns (org transfer, role promotion, approval)
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF OLD.organisation_id IS DISTINCT FROM NEW.organisation_id THEN
    RAISE EXCEPTION 'permission denied: organisation_id is immutable';
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'permission denied: role is immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'permission denied: status is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rec_profiles_immutable_cols_trigger
  BEFORE UPDATE ON rec_profiles
  FOR EACH ROW EXECUTE FUNCTION rec_profiles_immutable_cols();


-- ── Column-level grants — primary defence ────────────────────
-- Authenticated role can update only full_name. Other columns are blocked
-- at the PostgreSQL privilege level regardless of RLS or trigger behaviour.

REVOKE UPDATE ON rec_profiles FROM authenticated;
GRANT  UPDATE (full_name) ON rec_profiles TO authenticated;


-- ── Enable RLS ────────────────────────────────────────────────

ALTER TABLE organisations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log      ENABLE ROW LEVEL SECURITY;


-- ── RLS policies ─────────────────────────────────────────────

-- organisations: read own org
CREATE POLICY "org: member reads own" ON organisations
  FOR SELECT USING (id = my_org_id());

-- rec_profiles: read own row; update own row (trigger + column grant protect immutable cols)
CREATE POLICY "profile: read own" ON rec_profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "profile: update own" ON rec_profiles
  FOR UPDATE
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- roles: SELECT own org; UPDATE draft rows only (both USING and WITH CHECK)
-- No client INSERT or DELETE policy — service role only through API routes.
CREATE POLICY "roles: org reads own" ON roles
  FOR SELECT USING (organisation_id = my_org_id());

CREATE POLICY "roles: org updates drafts only" ON roles
  FOR UPDATE
  USING      (organisation_id = my_org_id() AND status = 'draft')
  WITH CHECK (organisation_id = my_org_id() AND status = 'draft');

-- uploads: SELECT own org's uploads via role chain. No client INSERT/DELETE.
CREATE POLICY "uploads: org reads own" ON uploads
  FOR SELECT USING (
    role_id IN (
      SELECT id FROM roles WHERE organisation_id = my_org_id()
    )
  );

-- deliverables: SELECT only. All writes via service role.
CREATE POLICY "deliverables: org reads own" ON deliverables
  FOR SELECT USING (
    role_id IN (
      SELECT id FROM roles WHERE organisation_id = my_org_id()
    )
  );

-- audit_log: no permissive policies. Service role only.


-- ── Storage RLS ───────────────────────────────────────────────
-- NOTE: Run AFTER creating the buckets in the Supabase dashboard:
--   recruiter-uploads     (private)
--   recruiter-deliverables (private)
--
-- Upload flow uses server-issued signed upload URLs (createSignedUploadUrl via
-- service role), so clients never touch storage directly. These policies are a
-- second layer for any direct-access attempts.

CREATE POLICY "storage uploads: org selects" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'recruiter-uploads'
    AND (storage.foldername(name))[1] = my_org_id()::text
  );

-- No INSERT policy on recruiter-uploads from client — upload-init issues a
-- signed URL (service role), which bypasses RLS. Direct client INSERTs are denied.

CREATE POLICY "storage deliverables: org selects" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'recruiter-deliverables'
    AND (storage.foldername(name))[1] = my_org_id()::text
  );

-- No INSERT/DELETE policies on recruiter-deliverables — service role only.


-- ── Verification queries (run after migration to spot-check) ──
-- SELECT COUNT(*) FROM organisations;          -- should be 0
-- SELECT COUNT(*) FROM rec_profiles;           -- should be 0
-- SELECT proname FROM pg_proc WHERE proname = 'my_org_id';  -- should return row
-- \d rec_profiles                              -- check columns present
