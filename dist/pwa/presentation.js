(function () {
  const {
    HORIZON_YEARS,
    planningPeriod,
    planningHorizonYears,
    scenarios,
    DIVIDEND_ETF_PROFILES,
    DIVIDEND_SCENARIOS,
    coverageTargets,
    INFLATION_AR1,
    INFLATION_FLOOR,
    INFLATION_STRESS_PATHS,
    HISTORICAL_MARKETS,
  } = typeof module !== 'undefined' && module.exports ? require('./simulate.js') : globalThis.RetirementSim;
  const money = (n, compact = false) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard',
    }).format(n);
  const percent = n => `${n.toFixed(1)}%`;
  // 支應目標各自獨立、不必合計 100%；但兩個都啟用且合計超過 100% 時，多半是先前只啟用一個水庫
  // （當時預設 100%）留下的設定。只提醒，不改數字：刻意超額配置也是合法選擇。
  function coverageWarning(plan) {
    const active = id => plan.buckets.some(b => b.id === id && Number(b.amount) > 0);
    if (!active('defense') || !active('income')) return '';
    const targets = coverageTargets(plan);
    const sum = targets.defense + targets.income;
    return sum > 100
      ? `國債梯與現金流 ETF 的生活費支應目標合計 ${sum}%（${targets.defense}% + ${targets.income}%），超過 100%。兩者會各自依比例補水；若是先前只啟用其中一個水庫時留下的設定，請確認。`
      : '';
  }
  // VYM／SCHD 才有配息情境；legacy 方案回傳 null，匯出內容維持原樣。
  function dividendScenarioOf(plan) {
    if (plan.incomeProfile?.kind === 'pbp') return null;
    if (!DIVIDEND_ETF_PROFILES?.[plan.incomeProfile?.kind]) return null;
    return DIVIDEND_SCENARIOS[plan.incomeProfile.dividendScenario] ?? DIVIDEND_SCENARIOS.base;
  }
  const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
    );
  }
  const withdrawalLabels = {
    emergency: '緊急預備金',
    defense: '國債到期現金',
    growth: '核心 ETF',
    income: '現金流 ETF 本金',
  };
  const eventPolicyDescriptions = {
    alpha: '甲：只動用緊急預備金；不足直接列為意外支出缺口。',
    beta: '乙：正報酬年先售核心 ETF；非正報酬年先售現金流 ETF 本金。',
    gamma: '丙：緊急預備金 → 國債到期現金 → 核心 ETF；不售現金流 ETF 本金。',
    custom: '自訂：依下方手動排序支付意外支出。',
  };
  function incomeSchedule(sources, horizonYears = HORIZON_YEARS) {
    const list = sources ?? [];
    if (!list.length) return [];
    const active = (source, year) =>
      year >= source.startYear && (source.endYear === null || source.endYear === undefined || year <= source.endYear);
    const byYear = Array.from({ length: horizonYears }, (_, index) =>
      list.reduce((sum, source) => (active(source, index + 1) ? sum + source.amount : sum), 0),
    );
    const segments = [];
    byYear.forEach((amount, index) => {
      if (!segments.length || segments[segments.length - 1].amount !== amount)
        segments.push({ year: index + 1, amount });
    });
    // 開頭那段是 0 就是橋樑期，不必印「第 1 年起 無」；中途歸零則要印，否則「到第 N 年為止」
    // 這件事會從畫面上消失。
    return segments[0] && segments[0].amount === 0 ? segments.slice(1) : segments;
  }
  function incomeScheduleLabel(sources, horizonYears = HORIZON_YEARS) {
    const segments = incomeSchedule(sources, horizonYears);
    if (!segments.length) return '';
    const shown = segments
      .slice(0, 3)
      .map(segment => `第 ${segment.year} 年起 ${segment.amount > 0 ? money(segment.amount) : '無'}`);
    return `${shown.join(' · ')}${segments.length > 3 ? ' · …' : ''}／年（第 1 年幣值）`;
  }
  function monteCarloSettingsRows(result) {
    const horizonYears = result.horizonYears ?? HORIZON_YEARS;
    const period = result.planningPeriod;
    if (result.profiles)
      return [
        [],
        ['Monte Carlo 方案比較', '數值', '說明'],
        ...(period
          ? [
              ['目前年齡', period.currentAge, '歲'],
              ['目標年齡', period.targetAge, '歲'],
              ['規劃年數', period.years, '年'],
            ]
          : []),
        ['路徑數', result.paths, '所有方案共用核心 ETF 報酬、事件年份與第 1 年基準金額；實際金額依各方案通膨調整'],
        ['隨機種子', result.seed, '相同種子與設定必得相同結果'],
        ...result.profiles.map(profile => [
          '方案耗盡率：' + profile.name,
          profile.result.assetDepletionRate,
          '配對比較結果見方案比較 CSV',
        ]),
      ];
    const historical = result.samplingMode === 'historical';
    const market = historical ? HISTORICAL_MARKETS[result.historicalMarket] : null;
    return [
      [],
      ['Monte Carlo 假設', '數值', '說明'],
      ...(period
        ? [
            ['目前年齡', period.currentAge, '歲'],
            ['目標年齡', period.targetAge, '歲'],
          ]
        : []),
      ['路徑數', result.paths, ''],
      ['隨機種子', result.seed, '相同種子與設定必得相同結果'],
      ...(historical
        ? [
            ['抽樣方式', '歷史區塊抽樣', '合成歷史路徑，非真實歷史回放'],
            ['歷史市場', market.label, market.note],
            [
              '區塊長度',
              result.historicalBlockLength,
              '最大年數；邊界區塊可較短，同一區塊內為連續曆年，同一路徑不重複來源年份',
            ],
            ['年度擾動上限', result.historicalJitter / 100, '同一年度的核心報酬與 CPI 共用同一個擾動'],
            ['歷史年化平均報酬', result.historicalStats.mean / 100, '直接以所選市場年度資料計算'],
            ['歷史年化波動率', result.historicalStats.volatility / 100, '直接以所選市場年度簡單報酬的母體標準差計算'],
            ['通膨模型', '同年歷史 CPI', '與每個來源報酬年度配對；不使用固定、AR(1) 或 CPI 壓力路徑'],
          ]
        : [
            ['期望年化報酬', result.mean / 100, '算術平均；波動會使中位數低於此值'],
            ['年化波動率', result.volatility / 100, '核心 ETF 年度簡單報酬的標準差'],
          ]),
      ['非核心水庫報酬情境', scenarios[result.scenario].label, '緊急金等水庫沿用此情境的固定報酬'],
      ['Monte Carlo 結果', '數值', '說明'],
      ['年度意外支出機率', result.eventProbability / 100, '每年獨立抽樣'],
      ['意外支出基準值', result.eventAmount, '以第 1 年美元計；命中時依年通膨率調整'],
      ...(!historical && INFLATION_STRESS_PATHS?.[result.inflationModel]
        ? [
            [
              '通膨模型',
              `歷史壓力路徑：${INFLATION_STRESS_PATHS[result.inflationModel].label}`,
              `每條路徑相同；${horizonYears} 年平均 ${percent(result.inflationAverage.p50)}；現金報酬取同年 3 個月國庫券平均、新買國債票息取同年 12 月 GS5`,
            ],
          ]
        : []),
      ...(!historical && result.inflationModel === 'ar1'
        ? [
            [
              '通膨模型',
              '隨機（AR(1)）',
              `以方案年通膨為中心；持續性 ${INFLATION_AR1.persistence.toFixed(4)}、年衝擊 ${INFLATION_AR1.shockSd.toFixed(4)} 百分點（${INFLATION_AR1.firstYear}–${INFLATION_AR1.lastYear} 美國 CPI）；下限 ${INFLATION_FLOOR}%`,
            ],
          ]
        : []),
      ...(result.fixedEvent
        ? [
            [
              '確定事件',
              result.fixedEvent.amount,
              `第 ${result.fixedEvent.year} 年；每條路徑都發生；以第 1 年美元計並依年通膨率調整`,
            ],
          ]
        : []),
      ['規劃年數', horizonYears, '年'],
      ['資產耗盡率', result.assetDepletionRate, `${horizonYears} 年內資產歸零的路徑`],
      ['生活費曾缺口率', result.spendShortfallRate, '至少一年未完全支應生活費'],
      ['意外支出曾缺口率', result.eventGapRate ?? 0, `完整 ${horizonYears} 年；耗盡後已排定事件視為未支應`],
      ['累計意外支出缺口 P50', result.cumulativeEventGap?.p50 ?? '', '僅曾有事件缺口路徑；名目金額'],
      ['累計意外支出缺口 P75', result.cumulativeEventGap?.p75 ?? '', '僅曾有事件缺口路徑；名目金額'],
      ['年末資產 P25', result.finalAssets.p25, ''],
      ['年末資產 P50', result.finalAssets.p50, ''],
      ['年末資產 P75', result.finalAssets.p75, ''],
      ['資產未耗盡路徑數', result.survivorPaths, `共 ${result.paths} 條`],
      ['累計實際/原始計畫 P25', result.planSpendRatio.p25, '分母是未經護欄調整的計畫；全部路徑'],
      ['累計實際/原始計畫 P50', result.planSpendRatio.p50, '分母是未經護欄調整的計畫；全部路徑'],
      ...(result.hasGuaranteedIncome
        ? [
            ['其中水庫支應 P25', result.portfolioSpendRatio.p25, '扣掉保證性收入後，四個水庫自己付出的部分'],
            ['其中水庫支應 P50', result.portfolioSpendRatio.p50, '扣掉保證性收入後，四個水庫自己付出的部分'],
          ]
        : []),
      ['最差年度支應比例 P25', result.worstYearRatio.p25, '單一年度相對原始計畫的最低支應比例'],
      ['最差年度支應比例 P50', result.worstYearRatio.p50, '單一年度相對原始計畫的最低支應比例'],
    ];
  }
  function trajectoryCsv(years, bucketById, state, monteCarloResult = null) {
    const horizonYears = monteCarloResult?.horizonYears ?? planningHorizonYears(state);
    const period = planningPeriod(state);
    const historicalSources = Array.isArray(state.historicalSampleSources) ? state.historicalSampleSources : null;
    const headers = [
      '年度',
      '計畫支出',
      '護欄候選支出',
      '必要生活費底線',
      'Floor 是否咬住',
      '必要生活費缺口',
      '原始計畫支出',
      '當年CPI（影響次年支出）',
      '實際生活費支應',
      '保證性收入',
      '水庫應支應生活費',
      '水庫實際支應生活費',
      '生活費未覆蓋缺口',
      '核心ETF凍結',
      '當年無可動用資金',
      '資產耗盡',
      '意外支出',
      '緊急金支應意外支出',
      '國債到期現金支應意外支出',
      '核心ETF支應意外支出',
      '現金流ETF本金支應意外支出',
      '因事件被迫出售核心ETF',
      '核心ETF支應必要生活費',
      '因必要生活費被迫出售核心ETF',
      '意外支出缺口',
      '調整前提領率',
      '護欄動作',
      '調整後提領率',
      '核心報酬',
      '現金流含息總報酬',
      '現金流配息率',
      '現金流配息',
      '現金流 ETF profile',
      '現金流 ETF 年末 units',
      '現金流 ETF 年末 NAV',
      '現金流 ETF 下一年 DPS',
      '現金流 ETF 狀態',
      '國債票息',
      '國債到期本金',
      '國債目標梯長',
      '國債實際梯級數',
      '國債支應生活費',
      '緊急金支應生活費',
      '核心支應生活費',
      '現金流ETF本金支應生活費',
      '緊急金目標',
      '國債到期現金至緊急金',
      '核心至緊急金',
      '國債到期現金至國債梯',
      '核心至國債梯',
      '核心至現金流ETF',
      '防守現金回收至核心',
      `${bucketById.emergency.name}年末值`,
      `${bucketById.defense.name}年末值`,
      `${bucketById.income.name}年末值`,
      `${bucketById.growth.name}年末值`,
      '年末總資產',
      ...(state.incomeProfile?.kind === 'pbp'
        ? ['PBP 假設 ROC 比例', 'PBP 配發中假設 ROC', 'PBP 其餘配發（未分類）', 'PBP 實際每單位配發']
        : []),
      ...(historicalSources ? ['歷史來源年份', '歷史區塊', '區塊內年度', '年度擾動'] : []),
    ];
    const rows = years.map(y => {
      const source = historicalSources?.[y.year - 1];
      return [
        y.year,
        y.spend,
        y.guardrailSpend,
        y.floorSpend,
        y.floorBinding ? '是' : '否',
        y.floorGap,
        // 原始計畫與當年 CPI 都要能單獨對帳：前者看得出護欄砍了多少（計畫支出是調整後的），
        // 後者讓歷史回放可以逐年比對來源資料。兩者在畫面上分別呈現在計畫支出欄與下一年度。
        y.plannedSpend,
        y.inflationRate / 100,
        y.actualSpend,
        y.guaranteedIncome,
        y.portfolioSpend,
        y.portfolioActual,
        y.unmetSpend,
        y.growthFrozen ? '是' : '否',
        y.illiquid ? '是' : '否',
        y.bankrupt ? '是' : '否',
        y.eventSpend,
        y.eventEmergencyTake,
        y.eventDefenseTake,
        y.eventGrowthTake,
        y.eventIncomeTake,
        y.forcedGrowthSale ? '是' : '否',
        y.floorGrowthTake,
        y.forcedFloorGrowthSale ? '是' : '否',
        y.eventUnmet,
        y.proposedRate / 100,
        y.guardrailAction,
        y.withdrawalRate / 100,
        y.returns / 100,
        y.incomeReturn / 100,
        y.distributionRate / 100,
        y.incomeDistributionGross,
        y.incomeProfile,
        y.incomeUnits,
        y.incomeNav,
        y.incomeDps,
        y.incomeLiquidated ? '已清算（現金）' : y.incomeRebuilt ? '清算後重建' : '',
        y.treasuryCoupon,
        y.treasuryMaturity,
        y.treasuryTargetLength ?? state.treasury.length,
        y.treasuryActualRungCount ?? '',
        y.sources.defense || 0,
        y.sources.emergency || 0,
        y.sources.growth || 0,
        y.sources.incomePrincipal || 0,
        y.emergencyTarget,
        y.treasuryCashToEmergency,
        y.emergencyTransfer,
        y.treasuryCashToLadder,
        y.ladderTransfer,
        y.incomeTransfer,
        y.treasuryCashRecovery,
        y.values.emergency,
        y.values.defense,
        y.values.income,
        y.values.growth,
        y.total,
        ...(state.incomeProfile?.kind === 'pbp'
          ? [(state.incomeProfile.rocPercent ?? 0) / 100, y.incomeRoc, y.incomeNonRoc, y.incomePaidPerShare]
          : []),
        ...(historicalSources
          ? [source?.year ?? '', source?.block ?? '', source?.position ?? '', source?.jitter ?? '']
          : []),
      ];
    });
    const settings = [
      ['模擬設定', '數值', '說明'],
      ['目前年齡', period.currentAge, '歲'],
      ['目標年齡', period.targetAge, '歲'],
      ['規劃年數', horizonYears, '年'],
      ['初始總資產', state.buckets.reduce((sum, bucket) => sum + bucket.amount, 0), '四個水庫合計'],
      ['首年全年生活費', state.annualSpend, '第 1 年'],
      ['首年必要生活費（Floor）', state.spendingFloor.annualAmount, '0 表示關閉；啟用時每年隨 CPI 成長'],
      ['年通膨率', state.inflation / 100, '年度支出調整'],
      ['熊市下跌門檻', state.bearThreshold / 100, '低於此核心報酬時停止出售核心 ETF'],
      ['放寬觸發門檻', state.guardrails.lower / 100, '提領率低於此值時放寬支出'],
      ['收緊觸發門檻', state.guardrails.upper / 100, '提領率高於此值時收緊支出'],
      ['放寬幅度', state.guardrails.raise / 100, '放寬時年度成長為 CPI 加上此值'],
      ['收緊幅度', state.guardrails.cut / 100, '收緊時年度成長為 CPI 減去此值'],
      ...state.buckets.map(bucket => [
        `水庫：${bucket.name}`,
        bucket.amount,
        `${bucket.assets}${bucket.id === 'income' ? (DIVIDEND_ETF_PROFILES[state.incomeProfile?.kind] ? `；${state.incomeProfile.kind.toUpperCase()} 模型參考配發率 ${((DIVIDEND_ETF_PROFILES[state.incomeProfile.kind].initialDps / DIVIDEND_ETF_PROFILES[state.incomeProfile.kind].initialNav) * 100).toFixed(2)}%，實際隨模型變化` : `；legacy 配息率 ${bucket.yield.toFixed(1)}%`) : ''}`,
      ]),
      ...(dividendScenarioOf(state)
        ? [['現金流 ETF 配息情境', dividendScenarioOf(state).label, dividendScenarioOf(state).description]]
        : []),
      ...state.guaranteedIncome.map(source => [
        `保證性收入：${source.label || '未命名'}`,
        source.amount,
        `第 1 年幣值；第 ${source.startYear} 年起${source.endYear ? `至第 ${source.endYear} 年` : '終身'}；` +
          `${source.indexation === 'nominal' ? '名目固定' : '隨 CPI'}`,
      ]),
      ['國債梯長度', state.treasury.length, '年'],
      [
        '國債梯自動縮短',
        state.treasury.drawdownYears || 0,
        state.treasury.drawdownYears
          ? `第 ${state.treasury.drawdownYears} 年將補梯目標降至 1 年；既有國債保留至到期`
          : '關閉（維持固定梯長）',
      ],
      ...state.treasury.rungs.map(rung => [
        `國債梯第 ${rung.maturityYear} 年`,
        rung.face,
        `票息 ${rung.coupon.toFixed(1)}%`,
      ]),
      [
        '生活費提款順序',
        state.withdrawalOrders.planned.map(id => withdrawalLabels[id]).join(' → '),
        '配息固定為第一順位',
      ],
      [
        '意外支出策略',
        { alpha: '方案甲', beta: '方案乙', gamma: '方案丙', custom: '自訂' }[state.eventWithdrawalPolicy],
        eventPolicyDescriptions[state.eventWithdrawalPolicy],
      ],
      [
        '意外支出提款順序',
        state.eventWithdrawalPolicy === 'custom'
          ? state.withdrawalOrders.event.map(id => withdrawalLabels[id]).join(' → ')
          : '依選定策略與當年核心報酬決定',
        '',
      ],
      // 隨機結果若不附上假設與 seed 就無法重跑比較；沒跑過就不寫，避免匯出一堆空欄。
      ...(state.representativePathSource
        ? [
            [],
            [
              '代表路徑來源',
              state.representativePathSource.label,
              '以下為套用時的原始 MC 方案與結果，並非目前方案重新計算的結果',
            ],
            ...state.representativePathSource.rows,
          ]
        : monteCarloResult
          ? monteCarloSettingsRows(monteCarloResult)
          : []),
      [],
      [`${horizonYears} 年提領軌跡`],
    ];
    const csv = [...settings, headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    return csv;
  }
  function comparisonCsv(comparison, kind) {
    const baselineName = comparison.profiles[0].name;
    const planRows = plan => {
      const buckets = plan.buckets ?? [];
      const bucket = id => buckets.find(item => item.id === id) ?? {};
      const coreStrategy = plan.growthProfile?.kind === 'bxm' ? '大盤 Covered Call／BXM' : '純大盤';
      const eventPolicy = { alpha: '方案甲', beta: '方案乙', gamma: '方案丙', custom: '自訂' }[
        plan.eventWithdrawalPolicy
      ];
      const rows = [
        ['設定', '首年生活費', plan.annualSpend],
        ['設定', '必要生活費', plan.spendingFloor?.annualAmount ?? 0],
        ['設定', '年通膨率', plan.inflation / 100],
        ['設定', '熊市下跌門檻', plan.bearThreshold / 100],
        ['設定', '核心 ETF 策略', coreStrategy],
        ['水庫', `${bucket('emergency').name}金額`, bucket('emergency').amount],
        ['水庫', `${bucket('emergency').name}標的`, bucket('emergency').assets],
        [
          '水庫',
          `${bucket('emergency').name}年報酬率`,
          scenarios[comparison.scenario ?? 'base'].returns.emergency / 100,
        ],
        ['水庫', `${bucket('defense').name}金額`, bucket('defense').amount],
        ['水庫', `${bucket('defense').name}標的`, bucket('defense').assets],
        ['水庫', `${bucket('income').name}金額`, bucket('income').amount],
        ['水庫', `${bucket('income').name}標的`, bucket('income').assets],
        [
          '水庫',
          `${bucket('income').name}${DIVIDEND_ETF_PROFILES[plan.incomeProfile?.kind] ? '模型參考配發率' : 'legacy 配息率'}`,
          DIVIDEND_ETF_PROFILES[plan.incomeProfile?.kind]
            ? DIVIDEND_ETF_PROFILES[plan.incomeProfile.kind].initialDps /
              DIVIDEND_ETF_PROFILES[plan.incomeProfile.kind].initialNav
            : bucket('income').yield / 100,
        ],
        ...(dividendScenarioOf(plan)
          ? [['水庫', `${bucket('income').name}配息情境`, dividendScenarioOf(plan).label]]
          : []),
        ['水庫', `${bucket('growth').name}金額`, bucket('growth').amount],
        ['水庫', `${bucket('growth').name}標的`, bucket('growth').assets],
        ['護欄', '下限', plan.guardrails.lower / 100],
        ['護欄', '上限', plan.guardrails.upper / 100],
        ['護欄', '上調幅度', plan.guardrails.raise / 100],
        ['護欄', '下調幅度', plan.guardrails.cut / 100],
        [
          '國債梯',
          '策略',
          plan.treasury.drawdownYears
            ? `第 ${plan.treasury.drawdownYears} 年降至 1 年`
            : `固定 ${plan.treasury.length} 年梯`,
        ],
        ['生活費', '提款順序', plan.withdrawalOrders.planned.map(id => withdrawalLabels[id]).join(' → ')],
        ['意外支出', '策略', eventPolicy],
        [
          '意外支出',
          '提款順序',
          plan.eventWithdrawalPolicy === 'custom'
            ? plan.withdrawalOrders.event.map(id => withdrawalLabels[id]).join(' → ')
            : eventPolicyDescriptions[plan.eventWithdrawalPolicy],
        ],
      ];
      plan.treasury.rungs.forEach(rung =>
        rows.push(['國債梯', `第 ${rung.maturityYear} 年`, `${rung.face}，票息 ${rung.coupon / 100}`]),
      );
      if (!plan.guaranteedIncome?.length) rows.push(['保證性收入', '來源', '無']);
      else
        plan.guaranteedIncome.forEach(source =>
          rows.push([
            '保證性收入',
            source.label,
            `${source.amount}；第 ${source.startYear} 年起${source.endYear ? `至第 ${source.endYear} 年` : ''}；${source.indexation}`,
          ]),
        );
      return rows;
    };
    const rows =
      kind === 'summary'
        ? [
            [
              '方案',
              '資產耗盡率',
              `相對${baselineName}耗盡率差`,
              `僅${baselineName}耗盡`,
              '僅此方案耗盡',
              '零支出年路徑率',
              '年末資產P25',
              '年末資產P50',
              '年末資產P75',
              '意外支出曾缺口率',
              '累計意外支出缺口P50（僅缺口路徑）',
              '累計意外支出缺口P75（僅缺口路徑）',
            ],
            ...comparison.profiles.map(profile => {
              const paired = comparison.paired.find(item => item.id === profile.id);
              const r = profile.result;
              return [
                profile.name,
                r.assetDepletionRate,
                paired?.depletionRateDelta ?? 0,
                paired?.onlyBaselineDepleted ?? 0,
                paired?.onlyProfileDepleted ?? 0,
                r.zeroSpendRate,
                r.finalAssets.p25,
                r.finalAssets.p50,
                r.finalAssets.p75,
                r.eventGapRate ?? 0,
                r.cumulativeEventGap?.p50 ?? '',
                r.cumulativeEventGap?.p75 ?? '',
              ];
            }),
            [],
            ['方案設定快照', '類別', '項目', '值'],
            [
              '統計口徑',
              '意外支出缺口',
              '範圍',
              '完整30年已抽定與確定事件；耗盡後未支應；缺口金額為名目值，不轉為負債或追繳',
            ],
            ...comparison.profiles.flatMap(profile =>
              planRows(profile.plan).map(([category, item, value]) => [profile.name, category, item, value]),
            ),
          ]
        : [
            [
              '十分位',
              '核心ETF前5年CAGR下限',
              '核心ETF前5年CAGR上限',
              '路徑數',
              ...comparison.profiles.map(profile => `${profile.name}耗盡率`),
            ],
            ...comparison.deciles.map(decile => [
              decile.label,
              decile.lower,
              decile.upper,
              decile.paths,
              ...comparison.profiles.map(profile => decile.depletionRates[profile.id]),
            ]),
          ];
    return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  const exported = {
    money,
    percent,
    csvCell,
    escapeHtml,
    incomeSchedule,
    incomeScheduleLabel,
    trajectoryCsv,
    monteCarloSettingsRows,
    comparisonCsv,
    withdrawalLabels,
    eventPolicyDescriptions,
    dividendScenarioOf,
    coverageWarning,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else globalThis.RetirementPresentation = exported;
})();
