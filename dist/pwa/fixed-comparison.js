(function () {
  const sim = typeof module !== 'undefined' && module.exports ? require('./simulate.js') : globalThis.RetirementSim;
  // Compare independent plans against a shared annual path without changing saved plans.
  function compareFixedPlans(source, scenario) {
    return source.monteCarloProfiles
      .filter(profile => profile.enabled !== false)
      .map(profile => {
        const plan = sim.monteCarloPlanSnapshot(profile.plan);
        for (const key of ['coreReturns', 'inflationRates', 'emergencyEvents', 'safeRates']) {
          delete plan[key];
          if (source[key]) plan[key] = JSON.parse(JSON.stringify(source[key]));
        }
        plan.coreReturns ??= {};
        plan.emergencyEvents ??= {};
        const result = sim.simulate(plan, scenario);
        const firstCoreSale =
          result.years.find(
            y =>
              (y.sources.growth || 0) +
                y.eventGrowthTake +
                Math.max(0, y.emergencyTransfer) +
                y.ladderTransfer +
                y.incomeTransfer >
              0.01,
          )?.year ?? null;
        return { id: profile.id, name: profile.name, plan, result, firstCoreSale };
      });
  }
  function historicalScenarioPath(config) {
    if (
      !config ||
      !sim.HISTORICAL_MARKETS[config.market] ||
      !Number.isInteger(config.startYear) ||
      !['forward', 'reverse'].includes(config.direction)
    )
      return null;
    const reverse = config.direction === 'reverse';
    const coreReturns = sim.historicalReturnPath(config.market, config.startYear, sim.HORIZON_YEARS, reverse);
    const inflationRates = sim.historicalInflationPath(config.market, config.startYear, sim.HORIZON_YEARS, reverse);
    const safeRates = sim.historicalSafeRates(config.market, config.startYear, sim.HORIZON_YEARS, reverse);
    if (!coreReturns || !inflationRates || (config.market === 'sp500' && !safeRates)) return null;
    return { coreReturns, inflationRates, ...(safeRates ? { safeRates } : {}) };
  }
  function historicalScenarioStarts(market, direction) {
    return Object.keys(sim.HISTORICAL_MARKETS[market]?.returns || {})
      .map(Number)
      .filter(startYear => historicalScenarioPath({ market, direction, startYear }))
      .sort((a, b) => (direction === 'reverse' ? b - a : a - b));
  }
  function compareHistoricalScenarios(sourcePlan, configs) {
    const active = configs.filter(config => config.enabled !== false);
    if (!active.length || active.length > 3) throw new Error('Select one to three scenarios');
    return active.map(config => {
      const path = historicalScenarioPath(config);
      if (!path) throw new Error('Incomplete historical scenario');
      // A fresh plan snapshot removes all fixed/MC overrides and monthly residuals.
      const plan = { ...sim.monteCarloPlanSnapshot(sourcePlan), ...path, emergencyEvents: {} };
      const result = sim.simulate(plan, 'historical');
      let priceIndex = 1;
      let floorGap = result.cumulativeFloorGap;
      const trajectory = [];
      for (let index = 0; index < sim.HORIZON_YEARS; index++) {
        if (index >= result.years.length) floorGap += (plan.spendingFloor?.annualAmount || 0) * priceIndex;
        priceIndex *= 1 + sim.inflationRateForYear(plan, index + 1) / 100;
        if (result.years[index])
          trajectory.push({
            year: index + 1,
            calendarYear: config.startYear + (config.direction === 'reverse' ? -index : index),
            total: result.years[index].total,
            realTotal: result.years[index].total / priceIndex,
          });
      }
      const actualSpend = result.years.reduce((sum, year) => sum + year.actualSpend, 0);
      return {
        config: { ...config },
        plan,
        result,
        trajectory,
        finalRealAssets: result.bankruptYear ? 0 : trajectory.at(-1).realTotal,
        spendRatio: result.plannedSpendTotal ? actualSpend / result.plannedSpendTotal : 1,
        floorGap,
      };
    });
  }
  const api = { compareFixedPlans, historicalScenarioPath, historicalScenarioStarts, compareHistoricalScenarios };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.RetirementFixedComparison = api;
})();
