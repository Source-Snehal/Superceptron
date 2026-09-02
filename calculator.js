/* First-pass capacity calculator. Shared by recruiter-tech.html and recruiter-engineering.html. */
(function () {
  'use strict';

  function init() {
    var roles   = document.getElementById('calcRoles');
    var apps    = document.getElementById('calcApps');
    var minutes = document.getElementById('calcMinutes');
    var team    = document.getElementById('calcTeam');
    var salary  = document.getElementById('calcSalary');

    if (!roles || !apps || !minutes || !team) return;

    var rolesOut   = document.getElementById('calcRolesOut');
    var appsOut    = document.getElementById('calcAppsOut');
    var minutesOut = document.getElementById('calcMinutesOut');
    var teamOut    = document.getElementById('calcTeamOut');

    var primaryNum   = document.getElementById('calcPrimaryNum');
    var hoursMonth    = document.getElementById('calcHoursMonth');
    var weeksYear      = document.getElementById('calcWeeksYear');
    var teamWeeks     = document.getElementById('calcTeamWeeks');
    var costStat      = document.getElementById('calcCostStat');
    var costNum       = document.getElementById('calcCostNum');
    var methodology    = document.getElementById('calcMethodology');

    var toggle    = document.getElementById('calcCostToggle');
    var costPanel = document.getElementById('calcCostPanel');
    var costEnabled = false;

    var WEEK_HOURS = 37.5;
    var EMPLOYER_COST_FACTOR = 1.25;
    var ANNUAL_WORKING_HOURS = 1750;

    function fmtInt(n) {
      return Math.round(n).toLocaleString('en-US');
    }

    function fmtCurrency(n) {
      return '$' + Math.round(n).toLocaleString('en-US');
    }

    function recalc() {
      var r = Number(roles.value);
      var a = Number(apps.value);
      var m = Number(minutes.value);
      var t = Number(team.value);

      rolesOut.textContent   = r;
      appsOut.textContent    = a;
      minutesOut.textContent = m;
      teamOut.textContent    = t;

      var monthlyHoursPerRecruiter = (r * a * m) / 60;
      var annualHoursPerRecruiter  = monthlyHoursPerRecruiter * 12;
      var workingWeeksPerRecruiter = annualHoursPerRecruiter / WEEK_HOURS;
      var teamAnnualHours          = annualHoursPerRecruiter * t;
      var teamRecruiterWeeks       = teamAnnualHours / WEEK_HOURS;

      primaryNum.textContent = fmtInt(teamRecruiterWeeks);
      hoursMonth.textContent  = fmtInt(monthlyHoursPerRecruiter);
      weeksYear.textContent    = workingWeeksPerRecruiter.toFixed(1);
      teamWeeks.textContent   = fmtInt(teamRecruiterWeeks);

      if (costEnabled && salary && Number(salary.value) > 0) {
        var s = Number(salary.value);
        var annualCost = (s * EMPLOYER_COST_FACTOR / ANNUAL_WORKING_HOURS) * teamAnnualHours;
        costNum.textContent = fmtCurrency(annualCost);
        costStat.hidden = false;
      } else {
        costStat.hidden = true;
      }

      if (methodology) {
        methodology.textContent =
          'Roles × applications × minutes ÷ 60 = monthly hours per recruiter. ' +
          '× 12 = annual hours. ÷ 37.5 = working weeks. ' +
          '× team size = team annual hours and team recruiter-weeks. ' +
          'Cost, if added: salary × 1.25 (employer costs and overhead) ÷ 1750 (annual working hours) × team annual hours.';
      }
    }

    [roles, apps, minutes, team].forEach(function (el) {
      el.addEventListener('input', recalc);
    });

    if (salary) salary.addEventListener('input', recalc);

    if (toggle && costPanel) {
      toggle.addEventListener('click', function () {
        costEnabled = !costEnabled;
        costPanel.hidden = !costEnabled;
        toggle.setAttribute('aria-expanded', String(costEnabled));
        toggle.textContent = costEnabled ? '− Remove recruiter cost' : '+ Add recruiter cost';
        recalc();
      });
    }

    recalc();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
