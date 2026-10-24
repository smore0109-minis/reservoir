// Monte Carlo v1：重用同一套 simulate() 規則，但退休計畫與固定情境頁分開保存。
(function () {
  const sim = typeof module !== 'undefined' && module.exports ? require('./simulate.js') : globalThis.RetirementSim;
  function random(seed) {
    let value = seed >>> 0;
    return () => {
      value |= 0;
      value = (value + 0x6d2b79f5) | 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(next) {
    const u = Math.max(next(), Number.MIN_VALUE);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  }
  function quantile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const index = (sorted.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }
  // 路徑輸入和退休計畫分開：同一組市場／事件衝擊才能比較兩個計畫，而不是比較兩次
  // 抽樣的雜訊。沒有 BXM 時刻意維持舊版每年 normal()（兩次 next）後再抽事件（一次 next）的
  // 順序，使純大盤單方案與比較的 golden 結果逐位不變。BXM 方案才需要月頻市場與專屬殘差。
  function generateSharedPathInputs(
    settings,
    inflation,
    { includeBxm = false, incomeProfiles = [], horizonYears = sim.HORIZON_YEARS } = {},
  ) {
    // 歷史模式有自己的亂數流與資料組裝；參數式模式的每一次 next() 都必須保持原樣，才能讓
    // 已儲存的種子、比較結果與 regression hash 繼續可重現。
    if (settings.samplingMode === 'historical')
      return generateHistoricalSharedPathInputs(settings, inflation, { includeBxm, incomeProfiles, horizonYears });
    const next = random(settings.seed);
    const realIncomeProfiles = [...new Set(incomeProfiles.filter(kind => sim.DIVIDEND_ETF_PROFILES?.[kind]))];
    const nextPayout = realIncomeProfiles.includes('pbp') ? random((settings.seed ^ 0x70627031) >>> 0) : null;
    const includeMonthly = includeBxm || realIncomeProfiles.length > 0;
    // 隨機通膨用獨立的亂數流：市場與事件的抽樣序列與固定通膨時逐位相同，差異只來自通膨本身。
    const nextInflation = settings.inflationModel === 'ar1' ? random((settings.seed ^ 0x9e3779b9) >>> 0) : null;
    // 壓力路徑不抽亂數：每條路徑套用同一段歷史 CPI。
    const stressRates = sim.stressInflationPath(settings.inflationModel, horizonYears);
    if (sim.INFLATION_STRESS_PATHS[settings.inflationModel] && !stressRates)
      throw new Error(`通膨壓力資料不足，無法涵蓋 ${horizonYears} 年規劃期`);
    const sigma = Math.sqrt(Math.log(1 + Math.pow(settings.volatility / 100 / (1 + settings.mean / 100), 2)));
    const mu = Math.log(1 + settings.mean / 100) - (sigma * sigma) / 2;
    return Array.from({ length: settings.paths }, () => {
      const coreReturns = [];
      const pbpPayoutYields = nextPayout
        ? Object.fromEntries(
            Array.from({ length: horizonYears }, (_, i) => [
              i + 1,
              sim.PBP_PAYOUT_YIELDS[Math.floor(nextPayout() * sim.PBP_PAYOUT_YIELDS.length)],
            ]),
          )
        : null;
      const emergencyEvents = {};
      const bxmMarketReturns = includeBxm ? {} : null;
      const bxmResiduals = includeBxm ? {} : null;
      const incomeMarketReturns = realIncomeProfiles.length ? {} : null;
      const incomeResiduals = realIncomeProfiles.length
        ? Object.fromEntries(realIncomeProfiles.map(kind => [kind, {}]))
        : null;
      const inflationRates = nextInflation
        ? sim.inflationPath(
            inflation,
            Array.from({ length: horizonYears }, () => normal(nextInflation)),
          )
        : stressRates
          ? { ...stressRates }
          : null;
      // 第 N 年的累積物價倍數＝第 1…N−1 年通膨的乘積，與 simulate() 的 cpiFactorByYear 同口徑。
      const cpiFactor = year =>
        inflationRates
          ? Array.from({ length: year - 1 }, (_, index) => 1 + inflationRates[index + 1] / 100).reduce(
              (product, value) => product * value,
              1,
            )
          : Math.pow(1 + inflation / 100, year - 1);
      for (let year = 1; year <= horizonYears; year++) {
        if (includeMonthly) {
          const monthlyMu = mu / 12;
          const monthlySigma = sigma / Math.sqrt(12);
          const marketMonths = Array.from({ length: 12 }, () => Math.exp(monthlyMu + monthlySigma * normal(next)) - 1);
          if (includeBxm) {
            const residuals = Array.from({ length: 12 }, () => normal(next) * sim.BXM_MONTHLY_PROFILE.residualSd);
            bxmMarketReturns[year] = marketMonths;
            bxmResiduals[year] = residuals;
          }
          if (incomeMarketReturns) {
            incomeMarketReturns[year] = marketMonths;
            for (const kind of realIncomeProfiles)
              incomeResiduals[kind][year] = Array.from(
                { length: 12 },
                () => normal(next) * sim.DIVIDEND_ETF_PROFILES[kind].residualSd,
              );
          }
          coreReturns.push((marketMonths.reduce((value, monthlyReturn) => value * (1 + monthlyReturn), 1) - 1) * 100);
        } else coreReturns.push((Math.exp(mu + sigma * normal(next)) - 1) * 100);
        if (next() < settings.eventProbability / 100) emergencyEvents[year] = settings.eventAmount * cpiFactor(year);
      }
      const cagrYears = Math.min(5, coreReturns.length);
      const cagr5 =
        Math.pow(
          coreReturns.slice(0, cagrYears).reduce((value, annualReturn) => value * (1 + annualReturn / 100), 1),
          1 / cagrYears,
        ) - 1;
      return {
        coreReturns,
        emergencyEvents,
        cagr5,
        ...(includeBxm ? { bxmMarketReturns, bxmResiduals } : {}),
        ...(pbpPayoutYields ? { pbpPayoutYields } : {}),
        ...(incomeMarketReturns ? { incomeMarketReturns, incomeResiduals } : {}),
        ...(inflationRates ? { inflationRates } : {}),
      };
    });
  }
  function historicalMarketStats(market) {
    const values = Object.values(market.returns);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      mean,
      volatility: Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length),
    };
  }
  // 每個區塊都是原始資料上連續的曆年，且同一條 30 年路徑不可重複使用來源年。先將所有
  // 舊版成功的 30 年抽樣保留原序列；其餘使用隨機切段與洗牌，保證資料足夠時完成。
  // 不重複年份、不使用重試迴圈。年度擾動只改幅度，報酬與 CPI 共用同一個 u，保留同期關係。
  function generateHistoricalSharedPathInputs(
    settings,
    inflation,
    { includeBxm = false, incomeProfiles = [], horizonYears = sim.HORIZON_YEARS } = {},
  ) {
    const next = random(settings.seed);
    const nextEvent = random((settings.seed ^ 0x65766e74) >>> 0);
    const nextBxm = random((settings.seed ^ 0x62786d31) >>> 0);
    const residualStreams = Object.fromEntries(
      ['vym', 'schd', 'pbp'].map((kind, index) => [kind, random((settings.seed ^ (0x65746631 + index)) >>> 0)]),
    );
    const nextPayout = incomeProfiles.includes('pbp') ? random((settings.seed ^ 0x70627031) >>> 0) : null;
    const market = sim.HISTORICAL_MARKETS[settings.historicalMarket] ?? sim.HISTORICAL_MARKETS.sp500;
    const blockLength = settings.historicalBlockLength ?? 3;
    const jitterBound = (settings.historicalJitter ?? 0) / 100;
    const realIncomeProfiles = [...new Set(incomeProfiles.filter(kind => sim.DIVIDEND_ETF_PROFILES?.[kind]))];
    const includeMonthly = includeBxm || realIncomeProfiles.length > 0;
    const years = Object.keys(market.returns)
      .map(Number)
      .filter(year => Number.isFinite(market.returns[year]) && Number.isFinite(market.cpi[year]))
      .sort((left, right) => left - right);
    if (horizonYears > years.length)
      throw new Error(`歷史資料只有 ${years.length} 年，無法組成不重複的 ${horizonYears} 年區塊路徑`);
    const candidates = years.filter((year, index) =>
      Array.from({ length: blockLength }, (_, offset) => years[index + offset] === year + offset).every(Boolean),
    );
    const blocksPerPath = Math.ceil(horizonYears / blockLength);
    const chooseBlocks = () => {
      const shuffled = [...candidates];
      for (let index = shuffled.length - 1; index > 0; index--) {
        const other = Math.floor(next() * (index + 1));
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
      }
      const used = new Set();
      const selected = [];
      for (const start of shuffled) {
        const blockYears = Array.from({ length: blockLength }, (_, offset) => start + offset);
        if (blockYears.some(year => used.has(year))) continue;
        selected.push(blockYears);
        blockYears.forEach(year => used.add(year));
        if (selected.length === blocksPerPath) break;
      }
      return selected.length === blocksPerPath ? selected : null;
    };
    // Preserve successful legacy 30-year draws. Otherwise partition every source year exactly
    // once, randomize the cut phase, and shuffle ALL blocks (including short boundary blocks).
    // No retries or duplicated years are needed, even when the horizon uses the entire history.
    const chooseYears = () => {
      let blocks = horizonYears === sim.HORIZON_YEARS ? chooseBlocks() : null;
      if (!blocks) {
        blocks = [];
        let block = [];
        let limit = 1 + Math.floor(next() * blockLength);
        for (const year of years) {
          if (block.length && (year !== block.at(-1) + 1 || block.length === limit)) {
            blocks.push(block);
            block = [];
            limit = blockLength;
          }
          block.push(year);
        }
        if (block.length) blocks.push(block);
        for (let index = blocks.length - 1; index > 0; index--) {
          const other = Math.floor(next() * (index + 1));
          [blocks[index], blocks[other]] = [blocks[other], blocks[index]];
        }
      }
      return blocks
        .flatMap((block, index) => block.map((year, position) => ({ year, block: index + 1, position: position + 1 })))
        .slice(0, horizonYears);
    };
    return Array.from({ length: settings.paths }, () => {
      const coreReturns = [];
      const pbpPayoutYields = nextPayout
        ? Object.fromEntries(
            Array.from({ length: horizonYears }, (_, i) => [
              i + 1,
              sim.PBP_PAYOUT_YIELDS[Math.floor(nextPayout() * sim.PBP_PAYOUT_YIELDS.length)],
            ]),
          )
        : null;
      const inflationRates = {};
      const historicalSources = [];
      const emergencyEvents = {};
      const bxmMarketReturns = includeBxm ? {} : null;
      const bxmResiduals = includeBxm ? {} : null;
      const incomeMarketReturns = realIncomeProfiles.length ? {} : null;
      const incomeResiduals = realIncomeProfiles.length
        ? Object.fromEntries(realIncomeProfiles.map(kind => [kind, {}]))
        : null;
      chooseYears().forEach((source, index) => {
        const { year } = source;
        const pathYear = index + 1;
        const jitter = jitterBound ? (next() * 2 - 1) * jitterBound : 0;
        const factor = 1 + jitter;
        const annualReturn = Math.max(-99.999999, market.returns[year] * factor);
        const cpi = market.cpi[year] * factor;
        coreReturns.push(annualReturn);
        inflationRates[pathYear] = cpi;
        historicalSources.push({
          ...source,
          jitter,
        });
        if (includeMonthly) {
          // Synthetic dispersed months preserve annual compounding, not actual historical months.
          const marketMonths = sim.marketMonthsForAnnualReturn(annualReturn);
          if (includeBxm) {
            bxmMarketReturns[pathYear] = marketMonths;
            bxmResiduals[pathYear] = Array.from(
              { length: 12 },
              () => normal(nextBxm) * sim.BXM_MONTHLY_PROFILE.residualSd,
            );
          }
          if (incomeMarketReturns) {
            incomeMarketReturns[pathYear] = marketMonths;
            for (const kind of realIncomeProfiles)
              incomeResiduals[kind][pathYear] = Array.from(
                { length: 12 },
                () => normal(residualStreams[kind]) * sim.DIVIDEND_ETF_PROFILES[kind].residualSd,
              );
          }
        }
        const cpiFactor = Array.from(
          { length: pathYear - 1 },
          (_, earlier) => 1 + inflationRates[earlier + 1] / 100,
        ).reduce((product, value) => product * value, 1);
        if (nextEvent() < settings.eventProbability / 100) emergencyEvents[pathYear] = settings.eventAmount * cpiFactor;
      });
      const cagrYears = Math.min(5, coreReturns.length);
      const cagr5 =
        Math.pow(
          coreReturns.slice(0, cagrYears).reduce((value, annualReturn) => value * (1 + annualReturn / 100), 1),
          1 / cagrYears,
        ) - 1;
      return {
        coreReturns,
        emergencyEvents,
        cagr5,
        inflationRates,
        historicalSources,
        ...(pbpPayoutYields ? { pbpPayoutYields } : {}),
        ...(includeBxm ? { bxmMarketReturns, bxmResiduals } : {}),
        ...(incomeMarketReturns ? { incomeMarketReturns, incomeResiduals } : {}),
      };
    });
  }
  // 確定事件不進 generateSharedPathInputs：抽樣序列不變，比較模式的每個方案也拿到同一筆。
  // 回傳的 amount 已依通膨調整，與抽樣事件同一口徑。
  function inflationFactorAtYear(inflation, inflationRates, year) {
    return inflationRates
      ? Array.from({ length: year - 1 }, (_, index) => 1 + inflationRates[index + 1] / 100).reduce(
          (product, value) => product * value,
          1,
        )
      : Math.pow(1 + inflation / 100, year - 1);
  }
  function inflatedFixedEvent(settings, inflation, inflationRates) {
    const event = sim.clampFixedEvent(settings.fixedEvent);
    if (!event) return null;
    const factor = inflationFactorAtYear(inflation, inflationRates, event.year);
    return { year: event.year, amount: event.amount * factor };
  }
  function withFixedEvent(events, fixedEvent) {
    if (!fixedEvent) return { ...events };
    return { ...events, [fixedEvent.year]: (events[fixedEvent.year] ?? 0) + fixedEvent.amount };
  }
  function sampledMonteCarloSettings(settings) {
    if (settings.samplingMode !== 'historical') return settings;
    const market = sim.HISTORICAL_MARKETS[settings.historicalMarket] ?? sim.HISTORICAL_MARKETS.sp500;
    return { ...settings, historicalStats: historicalMarketStats(market) };
  }
  // Zero is its own category; positive bins are (lower, upper], including the maximum.
  function assetHistogram(values, p75 = quantile(values, 0.75)) {
    const sampleCount = values.length;
    let maximum = 0,
      zeroCount = 0;
    for (const value of values) {
      maximum = Math.max(maximum, value);
      if (value === 0) zeroCount++;
    }
    const overflowThreshold = p75 * 2;
    let overflowCount = 0;
    const upper = Math.min(maximum, overflowThreshold);
    const edges = upper > 0 ? Array.from({ length: 41 }, (_, index) => upper * (index / 40)) : [];
    const counts = edges.length ? Array(40).fill(0) : [];
    for (const value of values) {
      if (value === 0) continue;
      if (value > overflowThreshold) {
        overflowCount++;
        continue;
      }
      // Compare against the returned edges so rounding cannot change boundary ownership.
      let low = 0,
        high = 39;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (value <= edges[middle + 1]) high = middle;
        else low = middle + 1;
      }
      counts[low]++;
    }
    return { sampleCount, zeroCount, edges, counts, overflowCount, overflowThreshold, maximum };
  }
  // Sort once per year and basis. Only percentiles and bin counts leave the Worker.
  function summarizeAnnualAssets(paths, horizonYears = sim.HORIZON_YEARS) {
    const distributions = [];
    const trajectory = Array.from({ length: horizonYears }, (_, index) => {
      const values = paths.map(totals => totals[index]).sort((a, b) => a - b);
      const point = { year: index + 1 };
      for (const percentile of [10, 25, 50, 75, 90]) {
        const position = (values.length - 1) * (percentile / 100);
        const lower = Math.floor(position),
          upper = Math.ceil(position);
        point['p' + percentile] = values.length
          ? values[lower] + (values[upper] - values[lower]) * (position - lower)
          : 0;
      }
      distributions.push({ year: index + 1, ...assetHistogram(values, point.p75) });
      return point;
    });
    return { trajectory, distributions };
  }
  function runMonteCarloForPaths(plan, settings, sharedPaths, { comparison = true } = {}) {
    const horizonYears = sim.planningHorizonYears(plan);
    const scenario = settings.scenario;
    const inflationAverages = [];
    // 通膨壓力路徑同時帶入同期 GS5：現金報酬與新買國債票息跟著歷史利率走，每條路徑相同。
    const safeRates =
      settings.samplingMode === 'historical' ? null : sim.stressSafeRates(settings.inflationModel, horizonYears);
    const floorActive = plan.spendingFloor?.annualAmount > 0;
    const finalAssets = [],
      planSpendRatios = [],
      portfolioSpendRatios = [],
      worstYearRatios = [],
      firstFloorBindingYears = [],
      cumulativeFloorGaps = [],
      cumulativeEventGaps = [],
      sampledPaths = [],
      pathOutcomes = [],
      annualTotals = [],
      annualRealTotals = [];
    let eventsModeled = false;
    let depleted = 0,
      shortfall = 0,
      zeroSpend = 0,
      floorBound = 0,
      floorGap = 0,
      forcedFloorSale = 0,
      hasGuaranteedIncome = false;
    for (const input of sharedPaths) {
      const fixedEvent = inflatedFixedEvent(settings, plan.inflation, input.inflationRates);
      if (input.inflationRates) {
        const rates = Object.values(input.inflationRates);
        inflationAverages.push(
          (Math.pow(
            rates.reduce((product, rate) => product * (1 + rate / 100), 1),
            1 / rates.length,
          ) -
            1) *
            100,
        );
      }
      // simulate 自行複製水庫值與國債持倉；巢狀計畫可共用，但逐年輸入必須獨立，
      // 不能把舊快照的手動報酬、歷史 CPI 或事件帶入抽樣。
      const copy = {
        ...plan,
        coreReturns: Object.fromEntries(input.coreReturns.map((annualReturn, index) => [index + 1, annualReturn])),
        ...(input.bxmMarketReturns
          ? { bxmMonthlyPath: { marketReturns: input.bxmMarketReturns, residuals: input.bxmResiduals } }
          : {}),
        ...(input.incomeMarketReturns && plan.incomeProfile?.kind
          ? {
              incomeMonthlyPath: {
                kind: plan.incomeProfile.kind,
                marketReturns: input.incomeMarketReturns,
                residuals: input.incomeResiduals[plan.incomeProfile.kind],
                ...(plan.incomeProfile.kind === 'pbp' ? { payoutYields: input.pbpPayoutYields } : {}),
              },
            }
          : {}),
        inflationRates: input.inflationRates ? { ...input.inflationRates } : {},
        ...(safeRates ? { safeRates } : {}),
        emergencyEvents: withFixedEvent(input.emergencyEvents, fixedEvent),
      };
      const result = sim.simulate(copy, scenario);
      const eventFunding = sim.eventFundingSummary(result, copy.emergencyEvents);
      if (!eventsModeled) eventsModeled = eventFunding.annual.some(row => row.planned > 0);
      if (eventFunding.hasGap) cumulativeEventGaps.push(eventFunding.total);
      const finalAssetsForPath = result.years.at(-1).total;
      finalAssets.push(finalAssetsForPath);
      // Keep the full population after depletion. Deflate each year-end value before ranking.
      const totals = Array.from({ length: horizonYears }, (_, index) => result.years[index]?.total ?? 0);
      annualTotals.push(totals);
      // Same fallback rule as simulate(): a missing or non-finite year uses the plan rate.
      const inflationSource = { inflationRates: input.inflationRates, inflation: plan.inflation };
      let priceIndex = 1;
      annualRealTotals.push(
        totals.map((total, index) => {
          priceIndex *= 1 + sim.inflationRateForYear(inflationSource, index + 1) / 100;
          return total / priceIndex;
        }),
      );
      sampledPaths.push({
        finalAssets: finalAssetsForPath,
        coreReturns: input.coreReturns,
        // 抽樣事件與確定事件分開存：代表路徑表要能分辨金額來源（O2 的教訓）。
        emergencyEvents: input.emergencyEvents,
        ...(fixedEvent ? { fixedEvent } : {}),
        ...(input.inflationRates ? { inflationRates: input.inflationRates } : {}),
        ...(input.historicalSources ? { historicalSources: input.historicalSources } : {}),
        ...(safeRates ? { safeRates } : {}),
        ...(input.bxmMarketReturns
          ? { bxmMonthlyPath: { marketReturns: input.bxmMarketReturns, residuals: input.bxmResiduals } }
          : {}),
        ...(input.incomeMarketReturns && plan.incomeProfile?.kind
          ? {
              incomeMonthlyPath: {
                kind: plan.incomeProfile.kind,
                marketReturns: input.incomeMarketReturns,
                residuals: input.incomeResiduals[plan.incomeProfile.kind],
                ...(plan.incomeProfile.kind === 'pbp' ? { payoutYields: input.pbpPayoutYields } : {}),
              },
            }
          : {}),
      });
      const bankrupt = Boolean(result.bankruptYear);
      if (bankrupt) depleted++;
      const actualSpendTotal = result.years.reduce((sum, year) => sum + year.actualSpend, 0);
      planSpendRatios.push(result.plannedSpendTotal ? actualSpendTotal / result.plannedSpendTotal : 1);
      portfolioSpendRatios.push(
        result.plannedSpendTotal ? result.cumulativePortfolioActual / result.plannedSpendTotal : 1,
      );
      if (result.cumulativeGuaranteedIncome > 0) hasGuaranteedIncome = true;
      worstYearRatios.push(
        result.years.length < horizonYears
          ? 0
          : Math.min(...result.years.map(year => (year.plannedSpend ? year.actualSpend / year.plannedSpend : 1))),
      );
      if (result.spendShortfall) shortfall++;
      const hasZeroSpend = comparison && result.years.some(year => year.actualSpend === 0 && year.plannedSpend > 0);
      if (hasZeroSpend) zeroSpend++;
      if (result.floorBindingYears > 0) {
        floorBound++;
        firstFloorBindingYears.push(result.firstFloorBindingYear);
      }
      // 歸零仍立即結束模擬。統計以完整規劃期間為準，未到達年份的支應為 0，
      // 因此剩餘 Floor 全額列為缺口，不繼續推演年金或資產復甦。
      let cumulativeFloorGap = result.cumulativeFloorGap;
      if (floorActive && bankrupt) {
        for (let index = result.years.length; index < horizonYears; index++)
          cumulativeFloorGap +=
            plan.spendingFloor.annualAmount * inflationFactorAtYear(plan.inflation, input.inflationRates, index + 1);
      }
      if (cumulativeFloorGap > 1) {
        floorGap++;
        cumulativeFloorGaps.push(cumulativeFloorGap);
      }
      if (result.years.some(year => year.forcedFloorGrowthSale)) forcedFloorSale++;
      if (comparison)
        pathOutcomes.push({
          bankrupt,
          zeroSpend: hasZeroSpend,
        });
    }
    // 分母是實際跑過的路徑，不是設定值：這個函式收的是 sharedPaths，兩者不一致時每個比率都會靜默算錯。
    const pathCount = sharedPaths.length;
    const survivors = pathCount - depleted;
    const finalAssetQuantiles = {
      p25: quantile(finalAssets, 0.25),
      p50: quantile(finalAssets, 0.5),
      p75: quantile(finalAssets, 0.75),
    };
    const closestPath = target =>
      sampledPaths.reduce((closest, candidate) =>
        Math.abs(candidate.finalAssets - target) < Math.abs(closest.finalAssets - target) ? candidate : closest,
      );
    const nominalAssets = summarizeAnnualAssets(annualTotals, horizonYears);
    const realAssets = summarizeAnnualAssets(annualRealTotals, horizonYears);
    return {
      ...settings,
      horizonYears,
      planningPeriod: sim.planningPeriod(plan),
      paths: pathCount,
      scenario,
      floorActive,
      assetDepletionRate: depleted / pathCount,
      spendShortfallRate: shortfall / pathCount,
      floorBindingRate: floorBound / pathCount,
      floorGapRate: floorGap / pathCount,
      // False when no path had any sampled or scheduled event; the UI then omits the event-gap block.
      eventsModeled,
      eventGapRate: cumulativeEventGaps.length / pathCount,
      cumulativeEventGap: cumulativeEventGaps.length
        ? { p50: quantile(cumulativeEventGaps, 0.5), p75: quantile(cumulativeEventGaps, 0.75) }
        : null,
      firstFloorBindingYear: firstFloorBindingYears.length
        ? { p25: quantile(firstFloorBindingYears, 0.25), p50: quantile(firstFloorBindingYears, 0.5) }
        : null,
      cumulativeFloorGap: cumulativeFloorGaps.length
        ? { p50: quantile(cumulativeFloorGaps, 0.5), p75: quantile(cumulativeFloorGaps, 0.75) }
        : null,
      forcedFloorSaleRate: forcedFloorSale / pathCount,
      // 30 年幾何平均通膨的分布；固定通膨時不輸出，結果結構與舊版相同。
      ...(inflationAverages.length
        ? {
            inflationAverage: {
              p10: quantile(inflationAverages, 0.1),
              p50: quantile(inflationAverages, 0.5),
              p90: quantile(inflationAverages, 0.9),
            },
          }
        : {}),
      totalAssetTrajectory: nominalAssets.trajectory,
      realTotalAssetTrajectory: realAssets.trajectory,
      assetDistributions: { nominal: nominalAssets.distributions, real: realAssets.distributions },
      finalAssets: finalAssetQuantiles,
      representativePaths: Object.fromEntries(
        Object.entries(finalAssetQuantiles).map(([label, target]) => [label, closestPath(target)]),
      ),
      survivorPaths: survivors,
      planSpendRatio: { p25: quantile(planSpendRatios, 0.25), p50: quantile(planSpendRatios, 0.5) },
      hasGuaranteedIncome,
      portfolioSpendRatio: { p25: quantile(portfolioSpendRatios, 0.25), p50: quantile(portfolioSpendRatios, 0.5) },
      worstYearRatio: { p25: quantile(worstYearRatios, 0.25), p50: quantile(worstYearRatios, 0.5) },
      ...(comparison
        ? {
            zeroSpendRate: zeroSpend / pathCount,
            pathOutcomes,
          }
        : {}),
    };
  }
  function runMonteCarlo(state, options = {}) {
    // 界線與遷移共用同一份定義：mean = -100 會讓 σ 的分母歸零並把 NaN 灌進每一條路徑（N4）。
    const settings = sampledMonteCarloSettings(
      sim.clampMonteCarlo({ ...sim.DEFAULT.monteCarlo, ...state.monteCarlo, ...options }),
    );
    // 結果是一次執行的快照，不能在 render 時回頭讀目前的 profile。否則更新快照但還沒重跑
    // 時，舊抽樣會被新設定貼錯標籤（年金已以 hasGuaranteedIncome 避開這個洞）。
    const plan = {
      ...(state.monteCarloProfile || state),
      planningPeriod: sim.planningPeriod(state),
    };
    const horizonYears = sim.planningHorizonYears(plan);
    const activeSettings =
      settings.fixedEvent?.year > horizonYears
        ? Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'fixedEvent'))
        : settings;
    return runMonteCarloForPaths(
      plan,
      activeSettings,
      generateSharedPathInputs(activeSettings, plan.inflation, {
        includeBxm: plan.growthProfile?.kind === 'bxm',
        incomeProfiles: [plan.incomeProfile?.kind],
        horizonYears,
      }),
      { comparison: false },
    );
  }
  function runMonteCarloComparison(profiles, state, options = {}) {
    const active = profiles.filter(profile => profile?.plan);
    if (!active.length) throw new Error('比較模式至少需要一個方案');
    const settings = sampledMonteCarloSettings(
      sim.clampMonteCarlo({ ...sim.DEFAULT.monteCarlo, ...state.monteCarlo, ...options }),
    );
    const horizonYears = sim.planningHorizonYears(state);
    const activeSettings =
      settings.fixedEvent?.year > horizonYears
        ? Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'fixedEvent'))
        : settings;
    const inflation = active[0].plan.inflation;
    const pathOptions = {
      includeBxm: active.some(profile => profile.plan.growthProfile?.kind === 'bxm'),
      incomeProfiles: active.map(profile => profile.plan.incomeProfile?.kind),
      horizonYears,
    };
    const sharedPaths = generateSharedPathInputs(activeSettings, inflation, pathOptions);
    // Reusing the seed and strategy set preserves market returns, event years and AR(1)
    // shocks. Each plan indexes spending/events with its own inflation assumption.
    // Historical CPI and stress sequences already specify inflation independently of plans.
    const fixedInflationPath =
      activeSettings.samplingMode === 'historical' || sim.INFLATION_STRESS_PATHS[activeSettings.inflationModel];
    // enabled 只屬於 UI 的比較選擇，不能滲進結果快照；否則即使所有方案都啟用，新增這個
    // 控制欄位也會改變既有比較結果的結構／golden hash。
    const results = active.map(({ enabled, ...profile }) => ({
      ...profile,
      result: runMonteCarloForPaths(
        { ...profile.plan, planningPeriod: sim.planningPeriod(state) },
        activeSettings,
        profile.plan.inflation === inflation || fixedInflationPath
          ? sharedPaths
          : generateSharedPathInputs(activeSettings, profile.plan.inflation, pathOptions),
      ),
    }));
    const baseline = results[0];
    // 依排名切割，不以值域門檻切割：波動率為 0 時所有 CAGR 相同，若用 >= / < 分箱會把
    // 全部路徑塞進 D10。排名仍保證每個十分位的樣本數正確，邊界重複只是如實呈現。
    const rankedPaths = sharedPaths
      .map((path, pathIndex) => ({ path, pathIndex }))
      .sort((left, right) => left.path.cagr5 - right.path.cagr5);
    const deciles = Array.from({ length: 10 }, (_, index) => {
      const start = Math.floor((index * rankedPaths.length) / 10);
      const end = Math.floor(((index + 1) * rankedPaths.length) / 10);
      const members = rankedPaths.slice(start, end);
      const memberIndexes = members.map(({ pathIndex }) => pathIndex);
      return {
        label: `D${index + 1}`,
        lower: members[0]?.path.cagr5 ?? 0,
        upper: members.at(-1)?.path.cagr5 ?? 0,
        paths: memberIndexes.length,
        // 路徑數少於 10 時（界線容許到 1），Math.floor 的切割會產生空 bin，0/0 會把 NaN 送進
        // 圖表與 CSV。空 bin 沒有耗盡率可言，回 null 讓呈現層自己決定顯示「—」。
        depletionRates: Object.fromEntries(
          results.map(profile => [
            profile.id,
            memberIndexes.length
              ? memberIndexes.filter(pathIndex => profile.result.pathOutcomes[pathIndex].bankrupt).length /
                memberIndexes.length
              : null,
          ]),
        ),
      };
    });
    return {
      ...activeSettings,
      horizonYears,
      planningPeriod: sim.planningPeriod(state),
      sharedPaths,
      profiles: results,
      deciles,
      paired: results.slice(1).map(profile => ({
        id: profile.id,
        depletionRateDelta: profile.result.assetDepletionRate - baseline.result.assetDepletionRate,
        onlyBaselineDepleted: baseline.result.pathOutcomes.filter(
          (outcome, index) => outcome.bankrupt && !profile.result.pathOutcomes[index].bankrupt,
        ).length,
        onlyProfileDepleted: profile.result.pathOutcomes.filter(
          (outcome, index) => outcome.bankrupt && !baseline.result.pathOutcomes[index].bankrupt,
        ).length,
      })),
    };
  }
  const exported = {
    assetHistogram,
    quantile,
    generateSharedPathInputs,
    historicalMarketStats,
    runMonteCarloForPaths,
    runMonteCarlo,
    runMonteCarloComparison,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else globalThis.RetirementMonteCarlo = exported;
})();
