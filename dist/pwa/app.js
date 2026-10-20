(function () {
  const {
    DEFAULT,
    hydrateState,
    monteCarloPlanSnapshot,
    clampSetting,
    clampTreasuryDrawdownYears,
    clampIncomeField,
    clampMonteCarlo,
    guardrailError,
    scenarios,
    HISTORICAL_MARKETS,
    historicalReturnPath,
    historicalInflationPath,
    planningPeriod,
    planningHorizonYears,
    MIN_CURRENT_AGE,
    MAX_TARGET_AGE,
    simulate,
    eventFundingSummary,
    coverageTargets,
    DIVIDEND_ETF_PROFILES,
    treasuryLadderLength,
    DIVIDEND_SCENARIOS,
    INFLATION_AR1,
    INFLATION_FLOOR,
    INFLATION_STRESS_PATHS,
    stressInflationPath,
    stressSafeRates,
    historicalSafeRates,
  } = window.RetirementSim;
  const {
    money,
    percent,
    escapeHtml,
    incomeScheduleLabel,
    trajectoryCsv,
    monteCarloSettingsRows,
    comparisonCsv,
    withdrawalLabels,
    eventPolicyDescriptions,
    dividendScenarioOf,
    coverageWarning,
  } = window.RetirementPresentation;
  const monteCarloRunner = window.RetirementWorkerClient.createMonteCarloRunner();
  let monteCarloGeneration = 0;
  let state = load();
  const currentPlanningPeriod = () => planningPeriod(state);
  const currentHorizonYears = () => planningHorizonYears(state);
  const axisYears = (start, end, segments) => [
    ...new Set(
      Array.from({ length: segments + 1 }, (_, index) => Math.round(start + ((end - start) * index) / segments)),
    ),
  ];
  if (!state.monteCarloProfiles?.length)
    state.monteCarloProfiles = [{ id: 'a', name: '方案 A', plan: monteCarloPlanSnapshot(state) }];
  normalizeTreasury();
  let currentScenario = state.scenario;
  let allocationTargetsApplied = state.allocationTargetsApplied === true;
  let allocationSignature = allocationInputsSignature();
  const expandedYears = new Set();
  // 圖例可以關掉個別線條。刻意不進 state：這是「現在想看清楚哪幾條」的暫時視角，跟 expandedYears
  // 一樣重開後回到全開，免得使用者下次打開時少了三條線，卻沒有任何線索說明是自己關的。
  const hiddenSeries = new Set();
  // 比較圖的九條分位線也屬於暫時視角：重跑或重開時全部回復可見，避免把看圖偏好存成方案設定。
  const hiddenComparisonTrajectorySeries = new Set();
  let projectionStart = 0;
  let monteCarloResult = null;
  let resultPlan = null;
  let resultProfileName = null;
  let monteCarloStale = false;
  let previousMonteCarloSeed = null;
  let annualSpendInputMode = 'annual';
  const planSpendInputModes = new Map();
  let selectedPlanId = localStorage.getItem('retirement-selected-plan') || 'a';
  let fixedComparisonYear = 1;
  let fixedComparisonProfile = null;
  let fixedComparisonMetric = 'total';
  let fixedDetailMode = 'year';
  let fixedExpandedYear = null;
  let currentView = 'planner-view';
  const scenarioComparisonConfig = loadScenarioComparison();
  let scenarioComparisonYear = 1;
  let scenarioComparisonDetail = 's1';
  let mcAssetBasis = 'real';
  let mcAssetYear = currentHorizonYears();
  // 圖表線色一律引用目前主題的 CSS token，切換配色不必重畫圖表。
  const seriesColors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
  // 四個固定水庫依 id 對應主題色；其他 id 保留資料中的顏色。
  const bucketColor = bucket =>
    ['emergency', 'defense', 'income', 'growth'].includes(bucket.id) ? `var(--bucket-${bucket.id})` : bucket.color;
  let currentLanguage = localStorage.getItem('retirement-language') === 'en' ? 'en' : 'zh';
  const $ = s => document.querySelector(s);
  let guideReturnFocus = null;
  let guideFocusFrame = null;
  const englishText = {
    入門指南: 'Beginner guide',
    入門與名詞指南: 'Beginner guide',
    關閉指南: 'Close guide',
    關閉: 'Close',
    搜尋指南: 'Search guide',
    '例如：Floor、配息、P50、護欄': 'For example: Floor, distributions, P50, guardrails',
    完整指南目前提供繁體中文內容: 'The complete guide is currently available in Traditional Chinese.',
    指南目錄: 'Guide contents',
    '第一次使用：五步完成': 'First run: five steps',
    設定資產與生活費: 'Set assets and spending',
    設定必要生活費: 'Set essential spending',
    確認四個水庫: 'Review the four reservoirs',
    查看固定情境: 'Review a fixed scenario',
    執行多路徑模擬: 'Run Monte Carlo',
    '找不到相符內容，請換一個關鍵詞。': 'No matching content. Try another search term.',
    '如何解讀結果？': 'How should I read these results?',
    '多路徑模擬怎麼看？': 'How does Monte Carlo work?',
    退休規劃年限: 'Retirement planning horizon',
    目前年齡: 'Current age',
    規劃到: 'Plan through',
    歲: 'years old',
    明細檢視: 'Detail view',
    單一年度: 'Single year',
    完整年度列表: 'Full annual list',
    首次意外支出缺口: 'First unexpected-expense gap',
    意外支出: 'Unexpected expenses',
    意外支出已支應: 'Unexpected expenses paid',
    意外支出缺口: 'Unexpected-expense gap',
    意外支出曾缺口率: 'Unexpected-expense gap rate',
    '累計意外支出缺口 P50 / P75': 'Cumulative unexpected-expense gap P50 / P75',
    '僅計入曾有意外支出缺口的路徑；名目金額。': 'Only paths with unexpected-expense gaps; nominal amounts.',
    '涵蓋完整 30 年已抽定及確定事件；耗盡後事件視為未支應，不延長收支模擬。缺口不轉為負債，也不會事後追繳。':
      'Includes sampled and scheduled events over all 30 years; events after depletion are unpaid, without extending the simulation. Gaps do not become debt or later repayments.',
    '年度列表止於資產耗盡；未模擬年份顯示已停止，不補零。':
      'Annual results stop at depletion; unmodeled years are marked stopped, not zero-filled.',
    耗盡後意外支出缺口: 'Unexpected-expense gaps after depletion',
    耗盡後另有排定意外支出未列入: 'Scheduled unexpected expenses after depletion (not included)',
    情境比較: 'Scenario comparison',
    必要生活費缺口: 'Essential spending gap',
    '固定計畫，比較不同市場的歷史路徑；此頁選擇獨立保存。':
      'Compare historical market paths for one plan. Choices on this page are saved independently.',
    比較使用的計畫: 'Plan for scenario comparison',
    前往方案管理: 'Open plan manager',
    情境資產走勢: 'Assets across scenarios',
    台灣加權: 'Taiwan TAIEX',
    '日經 225': 'Nikkei 225',
    '英國 FTSE 100': 'UK FTSE 100',
    參與情境比較: 'Include this scenario',
    '正放（最早年先）': 'Forward (earliest first)',
    歷史期間: 'Historical period',
    無效年份: 'Invalid year',
    無效市場: 'Invalid market',
    目前計畫摘要: 'Plan summary',
    '同一數值尺度、不處理匯率；金額符號不表示已換匯。結果不是台幣投資海外或跨國退休優劣比較。':
      'Uses the same numerical scale without exchange rates. Currency symbols do not imply conversion. This is not a comparison of overseas investing in TWD or countries for retirement.',
    口徑與限制: 'Assumptions and limitations',
    '各市場使用本國 CPI，實質資產不是同一物價籃子的購買力比較。倒放是合成序列壓力測試，不是真實歷史。':
      'Each market uses its local CPI; real assets do not measure purchasing power against the same basket. Reverse replay is a synthetic sequence stress test, not actual history.',
    '不帶入固定情境逐年覆寫或 MC 事件；其餘配置與規則沿用所選方案。ETF 為策略模型，不是基金歷史績效回放。':
      'Fixed-scenario overrides and MC events are excluded. Other allocations and rules follow the selected plan. ETF strategies are modeled, not actual fund performance replays.',
    '含息總報酬；美國 CPI 為 12 月年增率；安全水庫採同期美國國債利率。':
      'Total returns include dividends; US CPI uses December year-over-year changes; safe buckets use historical US Treasury rates.',
    '價格報酬不含股息；當地 CPI 為全年平均年增率；安全水庫沿用基準假設。':
      'Price returns exclude dividends; local CPI uses annual-average changes; safe buckets retain baseline assumptions.',
    '實際／計畫生活費以完整 30 年原始計畫為分母；護欄放寬時實際支出可能高於原計畫，比例會超過 100%。耗盡後支應按零、必要缺口包含剩餘年份，不推演未來年金。曲線與明細於耗盡時停止。':
      'Actual/planned spending uses the full original 30-year spending plan as the denominator; guardrail raises can push actual spending above plan, so the ratio can exceed 100%. After depletion, support is assumed zero and remaining essential spending is added to the gap; future pensions are not simulated. Curves and details stop at depletion.',
    '請至少啟用一個情境。': 'Enable at least one scenario.',
    '情境缺乏完整 30 年資料，請調整市場、順序或年份；不會自動套用基準路徑。':
      'A scenario lacks complete 30-year data. Adjust its market, order or year; no baseline path is substituted.',
    '情境選擇無法保存；目前仍可比較。': 'Scenario choices could not be saved; comparison still works in this session.',
    '第 30 年實質資產': 'Year 30 real assets',
    '30 年實際／計畫生活費': '30-year actual/planned spending',
    '30 年必要生活費缺口（名目累計）': '30-year essential gap (nominal sum)',
    未耗盡: 'Not depleted',
    情境年度明細: 'Scenario year details',
    '耗盡後沒有模擬收支明細。': 'No simulated cash-flow details after depletion.',
    退休年度與各情境西元年: 'Retirement year and calendar year for each scenario',
    年度資產比較: 'Annual asset comparison',
    情境: 'Scenario',
    合併尾端: 'Combined upper tail',
    配色: 'Theme',
    柔和淺色: 'Soft light',
    彩色深色: 'Color dark',
    經典深綠: 'Classic green',
    選定年份資產分布: 'Asset distribution for selected year',
    零資產: 'Zero assets',
    路徑比例: 'Share of paths',
    資產區間: 'Asset range',
    路徑數: 'Path count',
    查看分箱明細: 'View bin details',
    '色帶代表分位區間，垂直距離表示金額差距，不是機率。帶外仍有結果，不是上下限或未來保證。':
      'Bands show percentile ranges; vertical distance represents amounts, not probabilities. Outcomes also fall outside the bands; these are not bounds or guarantees.',
    '零資產獨立一格；超過當年 P75 兩倍的資產合併為尾端一格，其餘正資產等寬分成 40 格。P75 為零時，所有正資產併入尾端。切換年份或口徑不重新抽樣。':
      'Zero assets have a separate bar. Assets above twice that year’s P75 share one overflow bar; other positive assets use 40 equal-width bins. If P75 is zero, all positive assets go into the overflow bar. Changing year or basis does not resample paths.',
    '長條高度是占全部路徑的比例；虛線為 P25／P75，實線為 P50。點按長條或用 Tab 查閱數值，也可展開分箱明細。':
      'Bar heights show shares of all paths. Dashed lines mark P25/P75 and the solid line marks P50. Select a bar or use Tab to inspect values, or expand the bin details.',
    '區間左端不包含、右端包含；零資產另計。':
      'Intervals exclude the lower bound and include the upper bound; zero assets are counted separately.',
    年度資產百分位帶狀圖: 'Annual asset percentile bands',
    實質資產: 'Real assets',
    名目資產: 'Nominal assets',
    資產顯示口徑: 'Asset value basis',
    查看退休年度: 'Select retirement year',
    退休年度: 'Retirement year',
    '每年跨全部模擬路徑計算百分位；耗盡後年份以零資產納入。P50 中線不是一條實際模擬路徑，也不是既有的 P50 代表路徑。':
      'Percentiles are calculated across all simulated paths each year, including zero assets after depletion. The P50 line is not an actual simulated path or the existing P50 representative path.',
    '深色帶 P25–P75；淺色帶 P10–P90。帶外仍有結果，不是上下限或未來保證。':
      'Dark band: P25–P75. Light band: P10–P90. Outcomes also fall outside the bands; these are not bounds or guarantees.',
    '實質資產以退休起點購買力表示，依每條路徑截至該年年底的累積通膨換算，再計算百分位。':
      'Real assets are expressed in purchasing power at retirement, deflated by each path’s cumulative inflation through that year-end before percentiles are calculated.',
    '固定通膨使用各方案年通膨率。隨機通膨以各方案年通膨率為中心，共用相同 AR(1) 隨機衝擊；生活費、隨通膨收入與事件金額跟著各自通膨調整。歷史抽樣與壓力路徑使用指定 CPI，不使用方案年通膨率。':
      'Fixed inflation uses each plan’s annual rate. Random inflation shares AR(1) shocks around each plan’s own rate; spending, indexed income and expenses follow that plan’s inflation. Historical sampling and stress paths use specified CPI instead of plan inflation.',
    '複製設定：': 'Copy settings:',
    各方案年通膨率: 'Annual inflation by plan',
    '逐年通膨覆寫優先；指定年度不使用方案年通膨。':
      'Annual inflation overrides take precedence; those years do not use the plan’s inflation rate.',
    '修改立即儲存至此方案，固定情境與 MC 共用；各方案保留自己的年通膨率，MC 結果需重新執行。':
      'Edits are saved to this shared plan for Fixed Scenario and MC. Each plan keeps its own annual inflation rate; rerun MC after changes.',
    '方案共用市場報酬、事件年份與第 1 年事件基準金額；實際事件金額依各方案通膨調整。':
      'Plans share market returns, event years and event amounts in Year 1 dollars. Actual event amounts are indexed to each plan’s inflation.',
    '固定通膨採各方案設定；AR(1) 共用隨機衝擊，但各以自己的年通膨率為中心。歷史抽樣與壓力路徑採指定 CPI，不使用方案年通膨率。':
      'Fixed inflation uses each plan’s setting. AR(1) shares random shocks around each plan’s own inflation rate. Historical sampling and stress paths use their specified CPI instead of plan inflation.',
    '未模擬債券市價波動；隨機通膨以各方案年通膨率為中心，共用相同隨機衝擊，不含 70 年代式失控。':
      'Bond price fluctuations are not modeled. Random inflation shares the same shocks around each plan’s own annual rate and excludes 1970s-style instability.',
    未設定生活費: 'No planned spending',
    耗盡後無資產支應: 'No assets available after depletion',
    複製來源: 'Copy source',
    '修改立即儲存至此方案，固定情境與 MC 共用；MC 結果需重新執行。比較模式共用年通膨。':
      'Edits are saved to this shared plan for both Fixed Scenario and MC. Rerun MC after changes. Comparison mode uses shared inflation.',
    '設定完成後執行模擬；使用上方選定的方案。': 'Run the simulation using the plan selected above.',
    '僅套用本次代表路徑至固定情境，不覆寫共用方案；包含逐年報酬、通膨與事件。清除逐年覆寫可恢復情境路徑。':
      'Apply only this representative path to Fixed Scenario without overwriting shared plans. Includes annual returns, inflation and events. Clear annual overrides to restore the scenario path.',

    方案管理: 'Plan Manager',
    使用方式: 'Mode',
    單方案: 'Single Plan',
    多方案比較: 'Compare Plans',
    選擇方案: 'Select Plan',
    參與比較: 'Included Plans',
    目前方案: 'Selected Plan',
    '固定情境與 MC 共用': 'Shared by Fixed Scenario and MC',
    '（複製單選方案）': '(copy selected plan)',
    確認覆寫方案: 'Confirm plan replacement',
    匯入舊固定情境備份: 'Import Legacy Fixed Plan',
    舊固定情境備份: 'Legacy Fixed Plan',
    以單選方案覆寫此方案: 'Replace with Selected Plan',
    '固定情境與 MC 共用這裡的方案；編輯一次，兩邊都使用最新設定。市場路徑與抽樣假設仍各自設定。':
      'Fixed Scenario and MC share these plans. Edit once to update both; market paths and sampling assumptions remain separate.',
    '使用目前選定方案，檢查指定假設下的 30 年資產與生活費。逐年路徑不帶入 MC。':
      'Test the selected plan over 30 years. Year-by-year paths are not used by MC.',
    '使用方案管理中的參與方案，共用固定情境年度路徑與意外支出。單方案模式可編輯逐年路徑。':
      'Uses included plans from Plan Manager with the shared fixed annual path and unexpected expenses. Edit annual paths in single-plan mode.',
    '固定情境與 MC 使用相同的單選方案或參與比較方案。':
      'Fixed Scenario and MC use the same selected plan or included comparison plans.',

    年末總資產: 'Year-end Total Assets',
    共同通膨基準: 'Shared base inflation',
    逐年通膨覆寫優先: 'Annual inflation overrides take precedence',
    已套用逐年市場報酬覆寫: 'Annual market return overrides are applied',
    '比較 A／B／C': 'Compare A/B/C',
    '編輯 A／B／C': 'Edit A/B/C',
    '沿用 MC 方案與參與設定；共用固定情境的年度市場路徑、通膨及意外支出。切回我的計畫可編輯共同路徑。':
      'Uses the MC plans and participation settings with the fixed scenario’s annual market path, inflation and unexpected expenses. Turn comparison off to edit the shared path.',
    '請先建立並啟用至少一個比較方案。': 'Create and enable at least one comparison plan first.',
    '採年度市場路徑；ETF 策略仍依各方案計算。不沿用 MC 代表路徑的月頻殘差。耗盡後停止計算，後續資料不補零。':
      'Uses the annual market path and each plan’s ETF strategy, without monthly residuals from MC representative paths. Calculation stops at depletion; later data is not filled with zeros.',
    '目前只有一個參與方案；可至方案管理新增或啟用其他方案。':
      'Only one plan is included. Add or enable other plans in Plan Manager.',
    方案資產走勢: 'Plan Asset Paths',
    比較方案總資產走勢: 'Comparison Plan Total Asset Paths',
    '首次出售核心 ETF（含補水）': 'First core ETF sale (including replenishment)',
    首次必要生活費缺口: 'First essential-spending shortfall',
    資產耗盡年份: 'Depletion year',
    未發生: 'Not observed',
    年度比較指標: 'Annual comparison metric',
    '點選金額查看該年明細；下方切換方案時保留同一年。':
      'Select an amount to view that year. Switching plans below keeps the selected year.',
    已停止: 'Stopped',
    年度水庫明細: 'Annual Bucket Details',
    '此方案已於較早年度耗盡；本年沒有模擬明細。':
      'This plan was depleted in an earlier year; no simulation details are available for this year.',

    返回固定情境: 'Return to Fixed Scenario',
    新增方案: 'Create Plan',
    '（來源：固定情境）': '(from Fixed Scenario)',
    方案差異摘要: 'Plan Differences',
    項目: 'Item',
    與基準不同: 'Different from baseline',
    自訂收益型: 'Custom Income Strategy',
    '標示與基準不同的值；未比較方案不參與模擬。此表只摘要主要配置，完整規則請展開方案。':
      'Values that differ from the baseline are marked. Excluded plans are not simulated. This table summarizes key allocations; expand each plan for its full rules.',

    退休資產規劃器: 'Retirement Asset Planner',
    還原範例: 'Reset Example',
    儲存設定: 'Save Settings',
    編輯我的計畫: 'Edit My Plan',
    工具分頁: 'Tool Tabs',
    固定情境: 'Fixed Scenario',
    多路徑模擬: 'Monte Carlo',
    情境下的資產續航: 'Portfolio Durability by Scenario',
    '使用我的計畫，檢查指定假設下的30年資產與生活費。固定情境的逐年覆寫不帶入多路徑模擬。':
      'Use my plan to check 30-year assets and spending under selected assumptions. Year-by-year fixed-scenario overrides are not used in Monte Carlo.',
    牛市: 'Bull',
    基準: 'Base',
    回歸歷史平均殖利率: 'Revert to Historical Mean Yield',
    '減配較深（壓力）': 'Deeper Distribution Cuts (Stress)',
    '恢復較慢（壓力）': 'Slower Recovery (Stress)',
    '深減配＋慢恢復（壓力）': 'Deep Cuts + Slow Recovery (Stress)',
    '目標殖利率＝起始殖利率，調整速度 0.59（VYM 估計），單年減配上限 −19%（VYM 2009）。':
      'Target yield equals the starting yield; adjustment speed 0.59 (VYM estimate); single-year distribution cut capped at −19% (VYM 2009).',
    '下跌時配息一次調到目標（跌多少砍多少），單年減配上限放寬到 −40%。非歷史校準。':
      'During declines, distributions move directly to the target (cut by the drawdown), with the single-year cut cap widened to −40%. Not historically calibrated.',
    '減配照基準，回升速度減半（0.29）。非歷史校準。':
      'Cuts follow the base case; recovery speed is halved (0.29). Not historically calibrated.',
    '同時套用「減配較深」與「恢復較慢」。非歷史校準。':
      'Applies both deeper cuts and slower recovery. Not historically calibrated.',
    熊市: 'Bear',
    歷史: 'Historical',
    歷史市場回放: 'Historical Market Replay',
    市場: 'Market',
    順序: 'Order',
    期間: 'Period',
    依時間順序: 'Chronological',
    '倒放（最新年先）': 'Reverse (latest year first)',
    '套用 30 年歷史路徑': 'Apply 30-Year Historical Path',
    '編輯我的計畫 · 配置、收入與提款規則': 'Edit My Plan · Allocation, Income & Withdrawal Rules',
    四層水庫配置: 'Four-Bucket Allocation',
    水庫: 'Bucket',
    配置金額: 'Allocation',
    現金流配息率: 'Cash-Flow Yield',
    配置比例: 'Allocation %',
    '投資標的 / 定位': 'Asset / Role',
    依支應目標預覽初始配置: 'Preview Initial Allocation from Coverage Targets',
    提領與補水規則: 'Withdrawal & Replenishment Rules',
    進階設定: 'Advanced Settings',
    提款順序: 'Withdrawal Order',
    年通膨率: 'Annual Inflation',
    熊市下跌門檻: 'Bear-Market Threshold',
    '放寬觸發門檻（提領率 ＜）': 'Loosening Trigger (withdrawal rate <)',
    '放寬幅度（CPI ＋）': 'Loosening Adjustment (CPI +)',
    '收緊觸發門檻（提領率 ＞）': 'Tightening Trigger (withdrawal rate >)',
    '收緊幅度（CPI －）': 'Tightening Adjustment (CPI −)',
    '防守安全水庫 · 美國國債梯': 'Defense Bucket · U.S. Treasury Ladder',
    '保證性收入 · Social Security 與年金': 'Guaranteed Income · Social Security & Annuities',
    新增來源: 'Add Source',
    '30 年隨機路徑壓力測試': '30-Year Random-Path Stress Test',
    執行模擬: 'Run Simulation',
    測試假設與進階設定: 'Test Assumptions & Advanced Settings',
    查看本次計畫摘要: 'View Current Plan Summary',
    啟用方案比較: 'Enable Plan Comparison',
    產生新種子: 'Generate New Seed',
    抽樣方式: 'Sampling Method',
    年化平均報酬: 'Annualized Mean Return',
    年化波動率: 'Annualized Volatility',
    通膨: 'Inflation',
    '年度擾動說明：歷史區塊抽樣時，在每個保留年度報酬上加入最多 ±X% 的獨立隨機擾動；0% 表示完全使用原始年度資料。它只改變該年度報酬，不改變區塊順序或通膨路徑。':
      'Annual jitter adds an independent random perturbation of up to ±X% to each retained annual return during historical block sampling; 0% uses the original annual data exactly. It changes only that year’s return, not the block order or inflation path.',
    '提領護欄說明：年度支出成長一律以當年通膨為基準。提領率低於放寬觸發門檻時，成長為 CPI 加上放寬幅度；高於收緊觸發門檻時，成長為 CPI 減去收緊幅度；落在兩者之間時剛好跟上 CPI。提領率是當年支出除以年初總資產，低代表資產相對支出寬裕。幅度是實質的，因此同一組設定在任何通膨年代代表同一條規則。調整後不會越過另一個門檻，剛好落在門檻上不動作。':
      'Guardrail explanation: Annual spending growth is based on inflation for that year. When the withdrawal rate is below the loosening trigger, growth is CPI plus the loosening adjustment; above the tightening trigger, growth is CPI minus the tightening adjustment; between the two, it simply follows CPI. The withdrawal rate is that year’s spending divided by opening total assets, so a lower rate means more room relative to spending. The adjustments are real, so the same settings represent the same rule in any inflation era. Adjustments do not cross the opposite trigger; a rate exactly on a trigger does nothing.',
    '年度支出成長一律以當年通膨為基準：提領率 ＜ 放寬門檻 → CPI ＋ 放寬幅度；提領率 ＞ 收緊門檻 → CPI － 收緊幅度；落在中間 → 剛好跟上 CPI。提領率 = 當年支出 ÷ 年初總資產，低代表資產相對支出寬裕。幅度是實質的，同一組設定在任何通膨年代都代表同一條規則。調整後不會越過另一個門檻；剛好落在門檻上不動作。':
      'Annual spending growth is based on that year’s inflation: withdrawal rate < loosening trigger → CPI + loosening adjustment; withdrawal rate > tightening trigger → CPI − tightening adjustment; between them → follows CPI. Withdrawal rate = that year’s spending ÷ opening total assets, so a lower rate means more room relative to spending. The adjustments are real, so the same settings represent the same rule in any inflation era. Adjustments do not cross the opposite trigger; a rate exactly on a trigger does nothing.',
    '通膨說明：固定＝每條路徑每年都用方案的年通膨率。隨機＝每條路徑各自一條通膨路徑，以方案的年通膨率為中心，今年會延續去年的偏離（持續性），參數由 1983 年以後的美國 CPI 估計，代表通膨預期被錨定時代的正常波動，不含 1970 年代式的失控。生活費、隨通膨調整的年金與意外支出金額都跟著該路徑的通膨走。比較模式下所有方案共用同一條。壓力＝每條路徑都套用同一段真實的美國 CPI（1966 年起或 1973 年起），市場報酬仍隨機；緊急預備金跟著同期 3 個月國庫券利率，新買國債票息跟著同期五年期公債殖利率（GS5）。':
      'Inflation: Fixed uses the plan inflation rate on every path and every year. Random gives each path its own inflation series centred on the plan rate, with persistent deviations estimated from U.S. CPI after 1983; spending, inflation-linked income and unexpected expenses follow that path. In comparison mode all plans share one path. Stress applies the same real U.S. CPI sequence from 1966 or 1973 while market returns remain random; emergency cash follows same-period 3-month Treasury rates and new Treasury coupons follow GS5.',
    '固定＝每年都用方案的年通膨率。隨機＝每條路徑各自一條通膨路徑，以方案的年通膨率為中心、今年延續去年的偏離；參數取自 1983 年以後的美國 CPI（錨定時代的正常波動，不含 70 年代式失控）。生活費、隨通膨年金與意外支出都跟著走。比較模式下所有方案共用。壓力＝每條路徑都套用同一段真實美國 CPI（1966 或 1973 年起），市場仍隨機；現金跟著同期國庫券、新買國債跟著同期 GS5。':
      'Fixed uses the plan inflation rate every year. Random gives each path its own inflation series centred on the plan rate, with persistent deviations estimated from U.S. CPI after 1983. Spending, inflation-linked income and unexpected expenses follow it. Comparison plans share the same path. Stress applies the same real U.S. CPI sequence from 1966 or 1973 while markets remain random; cash follows same-period Treasuries and new Treasuries follow GS5.',
    年度意外支出機率: 'Annual Unexpected-Expense Probability',
    相對該年年初的變化: 'Change from that year’s opening values',
    'PBP 配發從淨值扣除；ROC 僅為情境分類、不計稅。固定路徑用歷史平均配發率，MC 抽取歷史年度配發率；非基金實際歷史回放。':
      'PBP distributions are deducted from NAV; ROC is only a scenario classification and is not taxed. Fixed paths use the historical mean distribution rate; MC samples historical annual distribution rates. This is not an actual fund historical replay.',
    'PBP 配發 $0，其中假設 ROC $0，其餘配發 $0；每單位實際配發 $0。ROC 已包含於配發，並非額外收益；不計稅。':
      'PBP distribution $0, including assumed ROC $0 and other distributions $0; actual distribution per unit $0. ROC is included in the distribution, not additional income; it is not taxed.',
    '每個水庫均以「期初 ＋ 報酬 ＋ 流入 − 流出 ＝ 期末」對帳；國債到期本金只是在國債面額與防守現金間轉換。':
      'Each bucket reconciles as “Opening + return + inflows − outflows = ending”; Treasury maturity principal moves between Treasury face value and defense cash.',
    流入: 'Inflows',
    流出: 'Outflows',
    現金流水庫: 'Cash-flow bucket',
    含息總報酬: 'total return',
    實際配息: 'actual distribution',
    到期本金: 'maturity principal',
    年末防守現金: 'year-end defense cash',
    '未動用部分按 MMF 報酬累積': 'unused amounts accrue the MMF return',
    目標梯長: 'Target ladder length',
    實際持有: 'Actual holdings',
    個梯級: 'rungs',
    期初: 'Opening',
    期末: 'Ending',
    意外支出基準值: 'Unexpected-Expense Base Amount',
    '確定事件：第幾年': 'Fixed Event: Year',
    確定事件金額: 'Fixed Event Amount',
    獨立比較方案: 'Independent Comparison Plans',
    'MC 方案 A 設定': 'MC Plan A Settings',
    '僅查看本次計算，不改動 MC 方案或固定情境。資產歸零後停止。':
      'View-only replay of this run; MC plans and Fixed Scenario are unchanged. Stops after assets reach zero.',
    確認更新: 'Confirm Update',
    取消: 'Cancel',
    每年: 'Annual',
    每月: 'Monthly',
    首年預計支出: 'First-Year Planned Spending',
    必要生活費底線: 'Necessary-Spending Floor',
    起始流動資產: 'Initial Liquid Assets',
    現金流覆蓋率: 'Cash-Flow Coverage',
    安全緩衝: 'Safety Buffer',
    尚未套用: 'Not Applied',
    已套用: 'Applied',
    '四層水庫合計；鎖定後固定總額': 'Four-bucket total; fixed after locking',
    '調整總額或其他水庫時，核心增值 ETF 自動重算':
      'The core growth ETF recalculates when the total or another bucket changes',
    '填入 $0 表示關閉': 'Enter $0 to disable',
    '每年隨 CPI 成長；熊市可為此被迫賣股': 'Grows with CPI each year; may force stock sales in a bear market',
    '對照：': 'Reference: ',
    原始計畫: 'Original plan',
    '尚未設定任何保證性收入；四個水庫需要獨力支應全部生活費。':
      'No guaranteed income is configured; the four buckets must fund all spending on their own.',
    極致流動性: 'Maximum liquidity',
    鎖定現金流: 'Locked-in cash flow',
    被動現金流: 'Passive cash flow',
    長期成長: 'Long-term growth',
    突發支出與即時流動性: 'Unexpected expenses & immediate liquidity',
    熊市不賣股票的生活費緩衝: 'Spending buffer that avoids stock sales in bear markets',
    以配息負擔日常開銷: 'Dividends fund everyday spending',
    抗通膨與長期本金續航: 'Inflation protection and long-term principal durability',
    緊急預備金: 'Emergency reserve',
    國債到期現金: 'Treasury maturity cash',
    '核心 ETF': 'Core ETF',
    '現金流 ETF 本金': 'Cash-flow ETF principal',
    生活費提款順序: 'Spending withdrawal order',
    意外支出順序: 'Unexpected-spending order',
    防守安全水庫: 'Defense bucket',
    國債梯: 'Treasury ladder',
    '使用我的計畫，檢查指定假設下的 30 年資產與生活費。固定情境的逐年覆寫不帶入多路徑模擬。':
      'Use My plan to check 30-year assets and spending under selected assumptions. Fixed-scenario year-by-year overrides are not used in Monte Carlo.',
    本情境未耗盡: 'This scenario did not deplete',
    本情境可支應: 'This scenario can cover it',
    '原始計畫包含完整 30 年': 'The original plan covers all 30 years',
    '設定完成後執行模擬。單方案使用 MC 方案 A；固定情境不會自動同步，需明確複製到 A／B／C。':
      'Run the simulation after configuring the settings. Single-plan mode uses MC Plan A; the fixed scenario does not sync automatically. Copy it explicitly to A/B/C when needed.',
    '將我的計畫另存／更新至此方案': 'Save / update My plan to this slot',
    '目前測試：MC 方案 A': 'Current test: MC Plan A',
    '基準情境：長期平均市場環境；以收入水庫和分層提領維持支出。':
      'Base scenario: long-term average market environment; use the income bucket and layered withdrawals to maintain spending.',
    '必要生活費與意外支出可突破熊市提款門檻；可調整生活費受門檻限制。':
      'Necessary spending and unexpected expenses can exceed the bear-market withdrawal threshold; adjustable spending is subject to the threshold.',
    '丙：緊急預備金 → 國債到期現金 → 核心 ETF；不售現金流 ETF 本金。':
      'Gamma: Emergency reserve → Treasury maturity cash → Core ETF; do not sell cash-flow ETF principal.',
    '可逐年設定意外支出與核心報酬；可同時展開多個年末資產查看水庫明細':
      'Set unexpected expenses and core returns by year; expand multiple year-end asset rows to view bucket details.',
    '支應比例只調整未來補水目標。初始金額可直接修改，或預覽後套用目標配置。':
      'Coverage ratios only adjust future replenishment targets. Initial amounts can be edited directly, or previewed and applied as target allocation.',
    '緊急金 + 防守水庫': 'Emergency cash + defense bucket',
    歷史區塊抽樣: 'Historical block sampling',
    當年到期現金流: 'Current-year maturity cash flow',
    '🔓 鎖定': '🔓 Lock',
    完整統計與規則說明: 'Full statistics and rules',
    規則狀態: 'Rule status',
    可持續: 'Sustainable',
    '← 前五年': '← Previous five years',
    '後五年 →': 'Next five years →',
    緊急金優先: 'Emergency cash first',
    '舊版／自訂': 'Legacy / custom',
    純大盤: 'Broad market only',
    '可選方案或改為自訂順序。': 'Choose a preset or switch to a custom order.',
    甲: 'Alpha',
    乙: 'Beta',
    丙: 'Gamma',
    自訂: 'Custom',
    梯長: 'Ladder length',
    自動縮短: 'Shorten automatically',
    '未設定（停用）': 'Not configured (disabled)',
    名稱: 'Name',
    起領年: 'Start year',
    結束年: 'End year',
    非核心資產情境: 'Non-core asset scenario',
    區塊長度: 'Block length',
    不擾動: 'No jitter',
    第: 'Year',
    年: 'year',
    '首年為輸入值，不套Inflation': 'First year uses the input value; inflation is not applied',
    比較基準: 'Comparison baseline',
    方案名稱: 'Plan name',
    首年生活費: 'First-year spending',
    '不必合計 100%；0% 不主動補水。修改比例只改未來補水目標，不重配初始資產；可另外預覽並套用初始配置。配置為 $0 的水庫不補水。修改後兩個比例固定保存，剩餘生活費依提款順序支應。':
      'The total must not exceed 100%; 0% does not replenish proactively. Editing percentages changes only future replenishment targets, not initial assets; preview and apply initial allocation separately. Buckets allocated $0 are not replenished. After editing, the two percentages are saved as fixed targets; remaining spending follows the withdrawal order.',
    '合計不能超過 100%；0% 不主動補水。修改比例只改未來補水目標，不重配初始資產；可另外預覽並套用初始配置。配置為 $0 的水庫不補水。修改後兩個比例固定保存，剩餘生活費依提款順序支應。':
      'The total must not exceed 100%; 0% does not replenish proactively. Editing percentages changes only future replenishment targets, not initial assets; preview and apply initial allocation separately. Buckets allocated $0 are not replenished. After editing, the two percentages are saved as fixed targets; remaining spending follows the withdrawal order.',
    '熊市不賣核心門檻 %': 'Bear-market threshold for not selling Core ETF %',
    '只調整未來補水目標，不移動初始本金；兩個目標不必合計 100%。':
      'Only future replenishment targets change; initial principal does not move. The two targets must not exceed 100% in total.',
    '鎖定目前總額；之後由核心增值 ETF 自動補足差額':
      'Lock the current total; the Core growth ETF fills the difference automatically.',
    鎖定的起始流動資產: 'Locked initial liquid assets',
    生活費輸入週期: 'Spending input period',
    '首年生活費 · 每年': 'First-year spending · Annual',
    '首年生活費 · 每月': 'First-year spending · Monthly',
    '必要生活費 · 每年': 'Essential spending · Annual',
    '必要生活費 · 每月': 'Essential spending · Monthly',
    '首年預計支出 · 每年': 'First-Year Planned Spending · Annual',
    '首年預計支出 · 每月': 'First-Year Planned Spending · Monthly',
    '必要生活費底線 · 每年': 'Necessary-Spending Floor · Annual',
    '必要生活費底線 · 每月': 'Necessary-Spending Floor · Monthly',
    '30 年四個水庫及總資產趨勢': '30-year four-bucket and total-assets trend',
    設定本年核心資產報酬: 'Set this year’s core-asset return',
    查看各水庫年末現值: 'View each bucket’s year-end value',
    '2. 防守安全國債梯年度生活費支應目標百分比':
      '2. Defense Treasury ladder annual-spending coverage target percentage',
    '3. 現金流 ETF年度生活費支應目標百分比': '3. Cash-flow ETF annual-spending coverage target percentage',
    '留空＝不使用': 'Blank = not used',
    不比較此方案: 'Exclude this plan',
    '不比較方案 A': 'Exclude Plan A',
    'Independent Comparison Plans儲存位置': 'Independent comparison plan storage location',
    '核心 ETF 當年報酬低於此值時，停止為可調整生活費出售核心 ETF，該年標記為凍結。必要生活費 Floor 與意外支出不受此門檻保護，仍可被迫出售核心 ETF，並分別標記原因。':
      'When the Core ETF return is below this value, stop selling it for adjustable spending and mark the year as frozen. Necessary spending and unexpected expenses are not protected by this threshold and may still force a Core ETF sale; the reasons are reported separately.',
    '已知一定會發生的一次性支出（例如第 7 年修房子）。每條路徑都在同一年付同一筆錢，看它落在不同市場路徑上的結果分佈。金額以第 1 年美元輸入、依年通膨調整；與抽樣事件同年時相加。比較模式下所有方案共用。留空或金額 0 表示不使用。':
      'A known one-time expense (for example, a home repair in Year 7). Every path pays the same amount in the same year, showing how it falls across market paths. Enter the amount in Year 1 dollars and adjust it by annual inflation; add it to sampled events in the same year. Shared by all plans in comparison mode. Blank or amount 0 means unused.',
    '單次事件以第 1 年美元計的金額。每一年會依累積通膨調整：第 N 年命中時，金額等於基準值 × (1 + 年通膨率)^(N−1)。是否發生則由年度意外支出機率獨立抽樣。':
      'One-time event amount in Year 1 dollars. Each year is adjusted by cumulative inflation: when hit in Year N, the amount equals the base amount × (1 + annual inflation rate)^(N−1). Whether it occurs is sampled independently using the annual unexpected-expense probability.',
    '已知一定會發生的一次性支出，例如第 7 年修房子。每條路徑都在同一年支付同一筆錢，用來看這筆支出落在不同市場路徑上的結果分佈。金額以第 1 年美元輸入並依年通膨調整；與抽樣事件同年時兩者相加。比較模式下所有方案共用。留空或金額 0 表示不使用。':
      'A known one-time expense, such as a home repair in Year 7. Every path pays the same amount in the same year, showing how the expense falls across market paths. Enter the amount in Year 1 dollars and adjust it by annual inflation; add it to sampled events in the same year. Shared by all plans in comparison mode. Blank or amount 0 means unused.',
    '模型抽樣出的核心 ETF 年度簡單報酬標準差。設定 18% 表示報酬相對平均報酬的典型波動幅度約為正負 18 個百分點；它不是保證上下限。':
      'The standard deviation of sampled annual simple returns for the Core ETF. An 18% setting means a typical return variation of about plus or minus 18 percentage points around the mean; it is not a guaranteed range.',
    保證性收入: 'Guaranteed income',
    '年收入 $（第 1 年幣值）': 'Annual income $ (Year 1 dollars)',
    開始年: 'Start year',
    '結束年（留空＝終身）': 'End year (blank = lifetime)',
    調整方式: 'Indexation method',
    隨通膨: 'Inflation-linked',
    固定名目: 'Nominal fixed',
    '生活費本金提款順序（配息優先）': 'Spending principal withdrawal order (dividends first)',
    提款策略: 'Withdrawal strategy',
    方案甲: 'Alpha plan',
    方案乙: 'Beta plan',
    方案丙: 'Gamma plan',
    '自訂：依下方手動排序支付意外支出。': 'Custom: pay unexpected expenses using the manual order below.',
    意外支出自訂提款順序: 'Custom unexpected-spending withdrawal order',
    '核心 ETF 自動補足差額；其他水庫超過總額時，鎖定總額會提高。':
      'Core ETF fills the difference automatically; if other buckets exceed the total, the locked total increases.',
    'VYM／SCHD 使用 DPS／NAV 部分調整模型；legacy 配息率不參與運算。補水使用下一年 DPS。':
      'VYM / SCHD use a partial DPS / NAV adjustment model; the legacy dividend rate is not used in calculations. Replenishment uses next-year DPS.',
    'PBP 配發從淨值扣除；MC 獨立抽取 2008–2025 年度配發率，不保證收益。ROC 是假設分類、不計稅；其餘配發未區分收益與資本利得。補水以歷史平均配發率估算，不預知下一年抽樣。':
      'PBP distributions are deducted from NAV; MC independently samples annual distribution rates from 2008–2025 and does not guarantee income. ROC is an assumed classification and is not taxed; other distributions are not separated into income and capital gains. Replenishment uses the historical mean distribution rate and does not know next year’s sample.',
    '範圍內沒有面額的年度會在正報酬年補買。金額會同步至防守水庫，刪除一階會減少初始資產。':
      'Years without face value within the range are purchased in positive-return years. The amount syncs to the defense bucket; removing a rung reduces initial assets.',
    '計畫或測試設定已變更，請重新執行模擬。': 'The plan or test settings changed; run the simulation again.',
    共用年通膨: 'Shared annual inflation',
    '比較中：方案 A': 'Comparing: Plan A',
    '🔒 已鎖定': '🔒 Locked',
  };
  const englishFragments = [
    [
      '使用我的計畫，檢查指定假設下的 30 年資產與生活費。固定情境的逐年覆寫不帶入多路徑模擬。',
      'Use My plan to check 30-year assets and spending under selected assumptions. Fixed-scenario year-by-year overrides are not used in Monte Carlo.',
    ],
    ['未設定必要生活費', 'Necessary spending not set'],
    ['年度明細、逐年覆寫與匯出', 'Annual details, year-by-year overrides & export'],
    ['第 1–5 年提領軌跡', 'Withdrawal trajectory for years 1–5'],
    ['每年生活費支應目標', 'Annual spending coverage target'],
    ['的年度生活費', 'of annual spending'],
    ['長期平均市場環境', 'long-term average market environment'],
    ['必要生活費與意外支出', 'Necessary spending and unexpected expenses'],
    ['座水庫啟用', 'buckets active'],
    ['參考初始金額', 'Reference initial amount'],
    ['季度股利', 'quarterly dividends'],
    ['可變配發／ROC 情境', 'variable distribution / ROC scenario'],
    ['大盤 Covered Call／BXM', 'broad-market Covered Call / BXM'],
    ['提示：', 'Tip: '],
    [
      '變更金額、預期報酬或收益率後，模擬結果會即時更新。',
      'Simulation results update after changing amounts, expected returns, or yields.',
    ],
    [
      'BXM 是 buy-write 指數策略，不保證防跌或現金流。',
      'BXM is a buy-write index strategy and does not guarantee downside protection or cash flow.',
    ],
    ['放寬幅度', 'Loosening adjustment'],
    ['收緊幅度', 'Tightening adjustment'],
    [
      '現金流 ETF 配息固定優先；其餘來源可調整。',
      'Cash-flow ETF dividends are always used first; other sources can be adjusted.',
    ],
    ['丙：', 'Gamma: '],
    ['甲：', 'Alpha: '],
    ['乙：', 'Beta: '],
    ['面額', 'Face value'],
    ['到期年度', 'Maturity year'],
    ['年度票息', 'Annual coupon'],
    ['金額一律填「第 1 年幣值」：', 'Enter all amounts in Year 1 dollars:'],
    ['隨 CPI', 'CPI-linked'],
    ['名目固定', 'Nominal fixed'],
    ['的購買力永遠等於你填的數字', 'purchasing power always equals the amount entered'],
    ['則從第 1 年就開始貶值', 'starts losing value from Year 1'],
    ['隨機種子', 'Random seed'],
    ['上一個種子', 'Previous seed'],
    ['可選取複製', 'select to copy'],
    ['參數式（平均值＋波動率）', 'Parametric (mean + volatility)'],
    ['壓力：1966 年起美國 CPI（70 年代完整一輪）', 'Stress: U.S. CPI from 1966 (full 1970s cycle)'],
    ['壓力：1973 年起美國 CPI（石油危機起）', 'Stress: U.S. CPI from 1973 (oil crisis start)'],
    ['方案 A（基準）', 'Plan A (Base)'],
    ['方案 B', 'Plan B'],
    ['方案 C', 'Plan C'],
    [
      '完整曆年 Total Return（含股息再投資）；同步套用同年 CPI-U（12 月年增率），緊急預備金與到期現金賺同年 3 個月國庫券利率平均、新買國債票息取同年 12 月五年期公債殖利率（GS5）。共 30 年路徑。',
      'Complete calendar-year Total Return (with dividends reinvested); apply the same-year CPI-U (December year-over-year change), use the same-year 3-month Treasury-bill average for the emergency reserve and maturity cash, and the same-year December five-year Treasury yield (GS5) for new Treasury coupons. 30 paths total.',
    ],
    ['日經 225 價格報酬（不含股息）', 'Nikkei 225 price return (excluding dividends)'],
    ['加權股價指數 價格報酬（不含股息）', 'Taiwan SE Weighted Index price return (excluding dividends)'],
    ['FTSE 100 價格報酬（不含股息）', 'FTSE 100 price return (excluding dividends)'],
    [
      'FTSE 100 自成立以來的完整曆年價格報酬（不含股息）；同步套用同年英國 CPI（全年平均年增率）。指數於 1984 年啟用，未以其他指數回填成立前資料。',
      'FTSE 100 complete calendar-year price returns since inception (excluding dividends), paired with UK CPI (annual-average inflation). The index launched in 1984; no other index is used to backfill pre-launch years.',
    ],
    [
      '加權股價指數完整曆年價格報酬（不含股息，台股殖利率高，低估幅度大於日經）；同步套用同年台灣 CPI（全年平均年增率）。',
      'Taiwan SE Weighted Index complete calendar-year price returns (excluding dividends; Taiwan’s high dividend yield makes the omission more material than for the Nikkei); paired with Taiwan CPI (annual-average year-over-year change).',
    ],
    ['現金 / MMF', 'Cash / MMF'],
    ['現金／MMF', 'Cash / MMF'],
    ['3 年期美債梯', '3-year U.S. Treasury ladder'],
    ['VYM／Vanguard High Dividend Yield ETF', 'VYM / Vanguard High Dividend Yield ETF'],
    ['PBP／Invesco S&P 500 BuyWrite ETF（可變配發）', 'PBP / Invesco S&P 500 BuyWrite ETF (variable distributions)'],
    ['SCHD／Schwab U.S. Dividend Equity ETF', 'SCHD / Schwab U.S. Dividend Equity ETF'],
    ['BXM buy-write 策略指數', 'BXM buy-write index strategy'],
    ['本土泡沫起漲', 'Taiwan bubble begins'],
    ['泡沫破裂', 'Bubble bursts'],
    ['金融海嘯', 'Global financial crisis'],
    ['美國暴力升息', 'Aggressive U.S. rate hikes'],
    ['亞洲金融風暴', 'Asian financial crisis'],
    ['金融危機', 'Financial crisis'],
    ['東日本大震災', 'Great East Japan Earthquake'],
    ['黑色星期一', 'Black Monday'],
    ['COVID-19 疫情', 'COVID-19 pandemic'],
    ['生活費先使用配息', 'Use dividends for spending first'],
    ['意外支出：', 'Unexpected expenses: '],
    ['補水目標：', 'Replenishment target: '],
    ['初始 $0 水庫不主動補水', 'buckets initially at $0 are not replenished proactively'],
    ['首年為輸入值，不套用通膨', 'First year uses the input value; inflation is not applied'],
    [
      '縮短只停止補買到期梯級，不提前出售既有國債。',
      'Shortening only stops purchases for maturing rungs; existing Treasuries are not sold early.',
    ],
    [
      'purchasing power always equals the amount entered（my Social Security\n                    的估算就是今日美元），',
      'purchasing power always equals the amount entered (my Social Security estimates are in today’s dollars),',
    ],
    [
      '這筆錢每年年初進緊急預備金，\n                    生活費照原本的提領鏈支付，年末用不完的走既有補水級聯回核心 ETF。',
      'This money enters the emergency reserve at the start of each year; spending follows the normal withdrawal chain, and any year-end surplus follows the existing replenishment cascade back to the core ETF.',
    ],
    ['通膨調整', 'Inflation adjustment'],
    ['MC 方案', 'MC Plan'],
    ['Inflation Fixed', 'Fixed inflation'],
    ['年化平均報酬', 'Annualized mean return'],
    ['年化波動率', 'Annualized volatility'],
    ['放寬幅度（CPI ＋）', 'Loosening adjustment (CPI +)'],
    ['收緊幅度（CPI －）', 'Tightening adjustment (CPI −)'],
    ['年將補梯', 'will reduce the ladder'],
    ['水庫', 'bucket'],
    ['生活費', 'spending'],
    ['支出', 'spending'],
    ['現金', 'cash'],
    ['支應', 'fund'],
    ['路徑', 'paths'],
    ['價格報酬', 'price return'],
    ['股息', 'dividends'],
    ['市場', 'market'],
    ['調整', 'adjustment'],
    ['緊急預備金', 'Emergency reserve'],
    ['核心 ETF', 'Core ETF'],
    ['現金流 ETF', 'Cash-flow ETF'],
    ['現金流', 'Cash flow'],
    ['防守安全國債梯', 'Defense Treasury ladder'],
    ['必要', 'necessary'],
    ['門檻', 'threshold'],
    ['限制', 'limits'],
    ['其餘按', 'the remainder uses'],
    ['可突破', 'can exceed'],
    ['可調整', 'adjustable'],
    ['維持', 'maintain'],
    ['和', 'and'],
    ['內', 'within'],
    ['配置', 'allocation'],
    ['目標', 'target'],
    ['套用', 'apply'],
    ['預覽', 'preview'],
    ['修改', 'edit'],
    ['直接', 'directly'],
    ['初始', 'initial'],
    ['金額', 'amount'],
    ['未來補水', 'future replenishment'],
    ['支應比例', 'coverage ratio'],
    ['未來補水目標', 'future replenishment targets'],
    ['歷史', 'Historical'],
    ['意外支出基準值', 'Unexpected-expense base amount'],
    ['的估算就是今日美元', 'estimates are in today’s dollars'],
    ['稅務特性', 'tax characteristics'],
    ['或', 'or'],
    ['目前補水目標：', 'Current replenishment targets: '],
    ['國債', 'Treasury'],
    ['年梯', '-year ladder'],
    ['完整曆年', 'complete calendar-year'],
    ['含股息再投資', 'with dividends reinvested'],
    ['含股息', 'with dividends'],
    ['不含股息', 'excluding dividends'],
    ['同步套用同年', 'apply the same-year'],
    ['緊急預備金與到期現金賺同年', 'the emergency reserve and maturity cash earn the same-year'],
    ['新買國債票息取同年', 'new Treasury coupons use the same-year'],
    ['國庫券利率', 'Treasury-bill rate'],
    ['五年期公債殖利率', 'five-year Treasury yield'],
    ['石油危機', 'Oil crisis'],
    ['網路泡沫', 'Dot-com bubble'],
    ['次貸風暴', 'Subprime crisis'],
    ['暴力升息', 'Aggressive rate hikes'],
    ['基準情境', 'Base scenario'],
    ['收入水庫', 'income bucket'],
    ['分層提領', 'layered withdrawals'],
    ['生活費皆有來源', 'all spending is funded'],
    ['支出連續下調', 'spending cuts continued'],
    ['未觸發護欄', 'guardrails not triggered'],
    ['調整前', 'Before adjustment'],
    ['依情境', 'By scenario'],
    ['依前年 CPI', 'Adjusted by prior-year CPI'],
    ['預估年配息', 'Estimated annual dividends'],
    ['現金流ETF', 'Cash-flow ETF'],
    ['防守安全國債梯', 'Defense Treasury ladder'],
    ['核心增值ETF', 'Core growth ETF'],
    ['年度生活費支應目標', 'Annual spending coverage target'],
    ['設定會保存在這台電腦。', 'Settings are saved on this computer.'],
    ['BXM 模型以月頻市場校準與 Monte Carlo', 'The BXM model uses monthly market calibration and Monte Carlo'],
    ['專屬殘差估計總報酬', 'dedicated residuals to estimate total return'],
    [
      '未納入稅、交易成本、基金費用差異、實際基金追蹤誤差',
      'does not include taxes, trading costs, fund-fee differences, or actual fund tracking error',
    ],
    [
      '單方案使用我的計畫；比較方案為獨立存檔，修改主計畫不會覆寫舊 A／B／C。',
      'Single-plan mode uses My plan; comparison plans are independent saved copies, and changing the main plan does not overwrite A/B/C.',
    ],
    ['通膨', 'Inflation'],
    ['固定', 'Fixed'],
    ['條', 'paths'],
    ['展開可查看及修改全部假設', 'expand to view and edit all assumptions'],
    ['年化', 'Annualized'],
    ['報酬', 'return'],
    ['年度支出', 'annual spending'],
    ['本金', 'principal'],
    ['年金額（第 1 年幣值）', 'Annual amount (Year 1 dollars)'],
    ['將補梯目標降至', 'will reduce the ladder replenishment target to'],
    ['首年預計支出', 'First-year planned spending'],
    ['必要生活費底線', 'Necessary-spending floor'],
    ['起始流動資產', 'Initial liquid assets'],
    ['總資產', 'Total assets'],
    ['每年生活費', 'Annual spending'],
    ['必要生活費', 'Necessary spending'],
    ['資產耗盡', 'Asset depletion'],
    ['執行模擬', 'Run simulation'],
    ['結果尚未更新', 'Results are out of date'],
    ['設定完成後執行模擬', 'Run the simulation after configuring the settings'],
    ['代表路徑', 'Representative path'],
    ['年度金額', 'Annual amount'],
    ['年度', 'Year'],
    ['生活費目標', 'Spending target'],
    ['實際生活費', 'Actual spending'],
    ['生活費缺口', 'Spending shortfall'],
    ['年通膨', 'Annual inflation'],
    ['啟用水庫', 'Active buckets'],
    ['保證性收入', 'Guaranteed income'],
    ['固定情境', 'Fixed Scenario'],
    ['多路徑模擬', 'Monte Carlo'],
    ['我的計畫', 'My plan'],
    ['獨立比較方案', 'Independent Comparison Plans'],
    ['新增來源', 'Add Source'],
    ['設定會保存在這台電腦', 'Settings are saved on this computer'],
    ['尚未套用', 'Not applied'],
    ['已套用', 'Applied'],
    ['規劃 30 年', '30-year plan'],
    ['目前補水目標', 'Current replenishment targets'],
    ['國債到期', 'Treasury maturities'],
    ['配息', 'dividends'],
    ['年度生活費', 'annual spending'],
    ['生活費依護欄調整', 'Spending adjusts by guardrails'],
    ['詳細門檻與提款順序可在主計畫展開查看', 'Expand the main plan to view detailed thresholds and withdrawal order'],
    ['資產能否維持 30 年', 'Can assets last 30 years'],
    ['累計實際／原始生活費計畫', 'Actual / original spending plan'],
    ['必要開銷能否支付', 'Can necessary expenses be covered'],
    ['未設定必要生活費', 'Necessary spending not set'],
    ['30 年後預估資產', 'Projected assets after 30 years'],
    ['對比起始資產', 'vs. starting assets'],
    ['第一年支出來源', 'First-year spending sources'],
    ['由其他水庫支援', 'funded by other buckets'],
    ['30 年資產趨勢', '30-year asset trend'],
    ['年度明細、逐年覆寫與匯出', 'Annual details, year-by-year overrides & export'],
    ['第 1–5 年提領軌跡', 'Withdrawal trajectory for years 1–5'],
    ['匯出 CSV', 'Export CSV'],
    ['計畫支出', 'Planned spending'],
    ['資金來源', 'Funding sources'],
    ['核心報酬', 'Core return'],
    ['年末資產', 'Year-end assets'],
    ['年度擾動', 'Annual jitter'],
    ['年度意外支出機率', 'Annual unexpected-expense probability'],
    ['年通膨率', 'Annual inflation rate'],
    ['固定（方案年通膨率）', 'Fixed (plan inflation rate)'],
    ['隨機（持續性，1983 年後校準）', 'Random (persistent; calibrated after 1983)'],
    ['獨立比較方案 · 保留舊 A／B／C', 'Independent comparison plans · keep legacy A/B/C'],
    [
      '目前使用 MC 方案 A；固定情境不會自動同步',
      'Currently using MC Plan A; the fixed scenario does not sync automatically',
    ],
    ['設定完成後執行模擬', 'Run the simulation after configuring the settings'],
    ['參數式', 'Parametric'],
    ['平均', 'mean'],
    ['波動', 'volatility'],
    ['種子', 'seed'],
    ['保留舊 A／B／C', 'keep legacy A/B/C'],
    ['方案設定', 'Plan settings'],
    ['查看完整設定摘要', 'View full settings summary'],
    ['核心 ETF 策略', 'Core ETF strategy'],
    ['護欄（年提領率）', 'Guardrails (annual withdrawal rate)'],
    ['護欄下限', 'Guardrail lower bound'],
    ['護欄上限', 'Guardrail upper bound'],
    ['護欄上調', 'Guardrail raise'],
    ['護欄下調', 'Guardrail cut'],
    ['第一年支出來源', 'First-year spending sources'],
    ['第 1 年生活費', 'Year 1 spending'],
    ['目前配置 $0', 'currently allocated $0'],
    ['正核心報酬年度', 'In years with positive core returns'],
    ['不售現金流 ETF 本金', 'do not sell cash-flow ETF principal'],
    ['突發支出與即時流動性', 'Unexpected expenses & immediate liquidity'],
    ['基準情境：', 'Base scenario: '],
    [
      '必要生活費與意外支出可突破熊市提款門檻；可調整生活費受門檻限制。',
      'Necessary spending and unexpected expenses can exceed the bear-market withdrawal threshold; adjustable spending is subject to the threshold.',
    ],
    ['生活費先使用配息，其餘按', 'Use dividends for spending first; the remainder uses '],
    ['到期現金', 'maturity cash'],
    ['提款', 'withdrawal'],
    ['熊市', 'bear market'],
    ['受門檻限制', 'is subject to the threshold'],
    [
      '可逐年設定意外支出與核心報酬；可同時展開多個年末資產查看水庫明細',
      'Set unexpected expenses and core returns by year; expand multiple year-end asset rows to view bucket details.',
    ],
    ['年末資產', 'year-end assets'],
    ['查看水庫明細', 'view bucket details'],
    ['展開多個', 'expand multiple'],
    ['支出連續下調', 'spending cuts continued'],
    ['首年為輸入值，不套用通膨', 'First year uses the input value; inflation is not applied'],
    ['緊急金 + 防守水庫', 'Emergency cash + defense bucket'],
    [
      '支應比例只調整未來補水目標。初始金額可直接修改，或預覽後套用目標配置。',
      'Coverage ratios only adjust future replenishment targets. Initial amounts can be edited directly, or previewed and applied as target allocation.',
    ],
    ['通膨率', 'inflation rate'],
    ['追蹤誤差', 'tracking error'],
    ['option-income 的', 'option-income '],
    ['當年到期現金流', 'Current-year maturity cash flow'],
    ['歷史區塊抽樣', 'Historical block sampling'],
    ['意外支出基準值', 'Unexpected-expense base amount'],
    ['確定事件金額', 'Fixed event amount'],
    ['🔓 鎖定', '🔓 Lock'],
    ['原始計畫', 'Original plan'],
    ['完整統計與規則說明', 'Full statistics and rules'],
    ['規則狀態', 'Rule status'],
    ['可持續', 'Sustainable'],
    ['前五年', 'Previous five years'],
    ['後五年', 'Next five years'],
    ['緊急金優先', 'Emergency cash first'],
    ['舊版／自訂', 'Legacy / custom'],
    ['純大盤', 'Broad market only'],
    ['進階設定', 'Advanced settings'],
    ['可選方案或改為自訂順序。', 'Choose a preset or switch to a custom order.'],
    ['甲', 'Alpha'],
    ['乙', 'Beta'],
    ['丙', 'Gamma'],
    ['自訂', 'Custom'],
    ['梯長', 'Ladder length'],
    ['自動縮短', 'Shorten automatically'],
    ['未設定（停用）', 'Not configured (disabled)'],
    ['名稱', 'Name'],
    ['起領年', 'Start year'],
    ['結束年', 'End year'],
    ['非核心資產情境', 'Non-core asset scenario'],
    ['區塊長度', 'Block length'],
    ['不擾動', 'No jitter'],
    ['paths數', 'path count'],
    ['bear market下跌threshold', 'bear-market threshold'],
    ['放寬觸發threshold（提領率 ＜）', 'Loosening trigger threshold (withdrawal rate <)'],
    ['收緊觸發threshold（提領率 ＞）', 'Tightening trigger threshold (withdrawal rate >)'],
    ['比較基準', 'Comparison baseline'],
    ['方案 A', 'Plan A'],
    ['方案名稱', 'Plan name'],
    ['首年生活費', 'First-year spending'],
    ['核心 ETF 策略', 'Core ETF strategy'],
    ['ETF 策略與提款門檻', 'Core ETF strategy and withdrawal threshold'],
    ['合計不能超過 100%；', 'The total must not exceed 100%; '],
    ['國債梯明細', 'Treasury ladder details'],
    ['縮梯至', 'Shorten ladder to'],
    ['目前', 'Current'],
    ['階', 'rungs'],
    ['補梯範圍', 'replenishment range'],
    ['最遠到期年', 'farthest maturity year'],
    ['範圍', 'range'],
    ['沒有', 'without'],
    ['正return年', 'positive-return years'],
    ['同步至', 'syncs to'],
    ['刪除一階', 'Remove one rung'],
    ['到期年', 'Maturity year'],
    ['票息', 'Coupon'],
    ['刪除', 'Delete'],
    ['新增一階', 'Add rung'],
    ['延長至', 'extends to'],
    ['新增收入', 'Add income'],
    ['收入', 'income'],
    ['spendingprincipalwithdrawal順序', 'spending principal withdrawal order'],
    ['第 1 順位', 'Priority 1'],
    ['第 2 順位', 'Priority 2'],
    ['第 3 順位', 'Priority 3'],
    ['第 4 順位', 'Priority 4'],
    ['withdrawal策略', 'withdrawal strategy'],
    ['方案Alpha', 'Alpha plan'],
    ['方案Beta', 'Beta plan'],
    ['方案Gamma', 'Gamma plan'],
    ['bear market不賣核心threshold %', 'Bear-market threshold for not selling Core ETF %'],
    ['非Planned spending策略', 'Unexpected-expense strategy'],
    ['Custom收益型／legacy', 'Custom income / legacy'],
    ['Legacy 基準dividends率 %', 'Legacy baseline dividend rate %'],
    ['PBP（可變配發）', 'PBP (variable distributions)'],
    [
      '鎖定目前總額以比較allocation；解鎖可比較不同資產規模。',
      'Lock the current total to compare allocations; unlock to compare different asset sizes.',
    ],
    ['縮梯至 1 years的年數（0＝關閉）', 'Years to shorten the ladder to 1 year (0 = off)'],
    [
      '目前 3 階，補梯範圍 3 years（最遠到期年）；範圍within沒有Face value的Year會在正return年補買。amount會同步至防守bucket，刪除一階會減少initial資產。',
      'Currently 3 rungs; replenishment range is 3 years (farthest maturity year). Within the range, Years without face value are purchased in positive-return years. The amount syncs to the defense bucket; removing a rung reduces initial assets.',
    ],
    ['新增一階（initialFace value $0，延長至Year 4）', 'Add rung (initial face value $0; extends to Year 4)'],
    [
      '-15.0%（低於此Core return時，不為adjustablespending出售Core ETF）',
      '-15.0% (below this Core return, do not sell Core ETF for adjustable spending)',
    ],
    ['10.0%／年（legacy 基準）', '10.0% / year (legacy baseline)'],
    ['無', 'None'],
    [
      '變更立即儲存至該方案，不修改水庫頁或其他方案；結果需重新執行。',
      'Changes are saved immediately to this plan; the bucket page and other plans are not edited. Results must be rerun.',
    ],
    ['市場分布', 'market distribution'],
    ['非核心情境', 'non-core scenario'],
    ['事件機率', 'event probability'],
    ['年通膨亦為共用', 'annual inflation is shared as well'],
    ['計畫或測試設定已變更，請重新執行模擬。', 'The plan or test settings changed; run the simulation again.'],
    ['共用年通膨', 'Shared annual inflation'],
    ['比較中：', 'Comparing: '],
    ['🔒 已鎖定', '🔒 Locked'],
    ['不修改水庫頁或其他方案', 'the bucket page and other plans are not edited'],
    ['結果需重新執行', 'Results must be rerun'],
    ['Annual inflation亦為共用', 'annual inflation is shared as well'],
    ['market分布', 'market distribution'],
    ['非核心情境及事件機率使用共用測試假設', 'non-core scenario and event probability use shared test assumptions'],
    ['editbucket頁or其他方案', 'the bucket page or other plans'],
    ['Run simulation', 'run the simulation'],
    ['本次結果：', 'This result: '],
    ['本次模擬', 'This simulation'],
    ['非未來發生機率保證', 'not a forecast probability guarantee'],
    ['必要開銷曾有缺口', 'Necessary expenses had a shortfall'],
    ['完整統計、假設與代表路徑', 'Full statistics, assumptions & representative paths'],
    ['資產耗盡率', 'Asset depletion rate'],
    ['資產歸零的路徑', 'paths reaching zero assets'],
    ['生活費曾缺口率', 'Spending shortfall rate'],
    ['至少一年未完全支應生活費', 'spending was not fully funded for at least one year'],
    ['年末資產 P25 / P50 / P75', 'Year-end assets P25 / P50 / P75'],
    ['總資產分位數', 'total-asset percentiles'],
    ['累計實際 / 原始計畫 P25 / P50', 'Actual / original plan P25 / P50'],
    ['終身總共花到計畫的幾成；全部', 'Share of the plan spent over the lifetime; all'],
    ['最差年度支應比例 P25 / P50', 'Worst-year coverage ratio P25 / P50'],
    ['最難熬的那一年只拿到計畫的幾成', 'share of the plan funded in the hardest year'],
    ['波動率', 'volatility'],
    ['基準值', 'base amount'],
    ['第 1 年美元', 'Year 1 dollars'],
    ['複利拖累', 'compound-return drag'],
    ['固定報酬', 'fixed return'],
    ['以外的水庫報酬沿用', 'bucket returns outside it use'],
    [
      '支應比例的分母一律是未經護欄調整的原始計畫',
      'Coverage ratios always use the original plan before guardrail adjustments',
    ],
    ['P25／P50／P75 附近的代表路徑', 'Representative paths near P25 / P50 / P75'],
    [
      '各欄從本次實際路徑中挑選年末資產最接近該分位數者。',
      'Each column selects the actual path whose year-end assets are closest to that percentile.',
    ],
    [
      '複製會覆蓋水庫模擬頁的配置、支出與規則，並帶入選定路徑的',
      'Copying replaces the bucket simulation page allocation, spending and rules, and brings in the selected path’s',
    ],
    ['月頻市場與專屬殘差以確保可重播。', 'monthly market path and dedicated residuals for exact replay.'],
    ['查看', 'View'],
    ['套用', 'Apply'],
    ['至', 'to'],
    ['明細', 'details'],
    ['意外', 'Unexpected'],
    ['全部路徑的', 'Across all paths, '],
    ['條路徑', ' paths'],
    ['平均報酬', 'mean return'],
    ['每年另以', 'Each year also has an independent '],
    ['獨立機率發生', 'chance of'],
    ['中位數不等於', 'the median does not equal'],
    ['核心 ETF 以外的水庫報酬沿用', 'Bucket returns outside the Core ETF use'],
    ['護欄砍出來的節省不算成功', 'savings from guardrail cuts do not count as success'],
    ['30 年核心報酬', '30-year core returns'],
    ['意外支出', 'unexpected expenses'],
    ['BXM 路徑另帶', 'BXM paths also include'],
    ['月頻市場', 'monthly market'],
    ['水庫模擬頁', 'bucket simulation page'],
    ['提領軌跡表上方的', 'above the withdrawal trajectory table'],
    ['清除逐年報酬', 'Clear per-year returns'],
    ['可整批還原為依情境', 'can be restored to scenario values'],
    ['的chance of', 'chance of '],
    ['其後依年', 'then adjusted by annual '],
    ['volatility會造成', 'Volatility causes '],
    ['return的結果', 'return result'],
    ['結果', 'result'],
    ['假設', 'assumptions'],
    ['意外支出與非核心情境', 'unexpected expenses and the non-core scenario'],
    [
      '另帶月頻市場與專屬殘差以確保可重播',
      'also includes monthly market data and dedicated residuals for exact replay',
    ],
    [
      '水庫模擬頁提領軌跡表上方的「清除逐年報酬」可整批還原為依情境。',
      'The “Clear per-year returns” control above the bucket simulation page withdrawal trajectory table restores all values to their scenario defaults.',
    ],
  ];
  // Translate complete messages before legacy fragments; whitespace in HTML is insignificant.
  const reviewedEnglish = {
    情境下的資產續航: 'Portfolio Longevity by Scenario',
    牛市: 'Bull Market',
    熊市: 'Bear Market',
    'S&P 500 完整曆年 Total Return（含股息再投資）；同步套用同年 CPI-U（12 月年增率），緊急預備金與到期現金賺同年 3 個月國庫券利率平均、新買國債票息取同年 12 月五年期公債殖利率（GS5）。共 30 年路徑。':
      'S&P 500 calendar-year total returns, including reinvested dividends, paired with CPI-U (December year-over-year inflation). Cash earns the same-year average 3-month Treasury bill rate; new Treasury coupons use the same-year December 5-year Treasury yield (GS5). One 30-year path.',
    'S&P 500 Total Return（含股息）': 'S&P 500 total return (including dividends)',
    '累計實際／原始生活費計畫': 'Cumulative actual / planned spending',
    曾有缺口: 'Shortfall occurred',
    投資組合耗盡: 'Portfolio depleted',
    累計支應: 'Cumulative spending coverage',
    清除逐年覆寫: 'Clear annual overrides',
    現金流覆蓋率: 'Income Coverage Ratio',
    現金流配息率: 'Distribution Yield',
    鎖定現金流: 'Scheduled cash flow',
    以配息負擔日常開銷: 'Distributions fund everyday expenses',
    抗通膨與長期本金續航: 'Inflation protection and long-term capital growth',
    '大盤 Covered Call／BXM': 'Broad-market covered-call strategy / BXM',
    'BXM 是 buy-write 指數策略，不保證防跌或現金流。BXM 模型以月頻市場校準與 Monte Carlo 專屬殘差估計總報酬；未納入稅、交易成本、基金費用差異、實際基金追蹤誤差或 option-income 的稅務特性。':
      'BXM is a buy-write index strategy; it does not guarantee downside protection or income. The model estimates total returns using monthly market calibration and sampled strategy-specific residuals. Taxes, trading costs, fund expense differences, tracking error, and the tax treatment of option income are not modeled.',
    '放寬觸發門檻（提領率 ＜）': 'Spending increase trigger (withdrawal rate <)',
    '放寬幅度（CPI ＋）': 'Real spending increase (CPI +)',
    '收緊觸發門檻（提領率 ＞）': 'Spending cut trigger (withdrawal rate >)',
    '收緊幅度（CPI －）': 'Real spending cut (CPI −)',
    '年將補梯目標降至 1 年': ' : reduce the replenishment target to a 1-year ladder',
    年度票息: 'Annual Coupon Income',
    '的購買力永遠等於你填的數字（my Social Security 的估算就是今日美元），':
      ' keeps the purchasing power of the amount entered (my Social Security estimates are in today’s dollars); ',
    名目固定: 'Fixed nominal amount',
    '則從第 1 年就開始貶值。這筆錢每年年初進緊急預備金， 生活費照原本的提領鏈支付，年末用不完的走既有補水級聯回核心 ETF。':
      ' does not adjust for inflation. Income is deposited into the emergency reserve at the start of each year. Spending follows the withdrawal order, and year-end surpluses follow the replenishment rules back to the core ETF.',
    '單方案使用我的計畫；比較方案為獨立存檔，修改主計畫不會覆寫舊 A／B／C。':
      'Single-plan mode uses independent MC Plan A. Changes to the fixed scenario do not update MC plans automatically; use the explicit copy action to update A, B, or C.',
    年化平均報酬: 'Mean Annual Return',
    歷史市場: 'Historical Market',
    年化波動率: 'Annual Return Volatility',
    '確定事件：第幾年': 'Scheduled One-Time Expense: Year',
    確定事件金額: 'Scheduled Expense Amount',
    '修改立即儲存至此方案，固定情境與 MC 共用；MC 結果需重新執行。比較模式共用年通膨。':
      'Edits are saved to this shared plan for both Fixed Scenario and MC. Rerun MC after changes. Comparison mode uses shared inflation.',
    護欄下限: 'Lower withdrawal-rate guardrail',
    護欄上限: 'Upper withdrawal-rate guardrail',
    護欄上調: 'Real spending increase',
    護欄下調: 'Real spending cut',
    '國債到期支應 %': 'Spending covered by Treasury maturities (%)',
    '現金流配息支應 %': 'Spending covered by distributions (%)',
    'Legacy 基準配息率 %': 'Custom distribution yield (%)',
    '熊市不賣核心門檻 %': 'Core ETF sale restriction threshold (%)',
    '縮梯至 1 年的年數（0＝關閉）': 'Year to reduce the ladder to 1 year (0 = off)',
    '票息 %': 'Coupon rate (%)',
    調整方式: 'Inflation Adjustment',
    固定名目: 'Fixed nominal amount',
    '生活費本金提款順序（配息優先）': 'Withdrawal order after distributions',
    '月頻校準＋BXM 專屬殘差；非保證防跌／現金流，未納入稅、費用、交易成本與追蹤誤差。':
      'Monthly calibration with BXM-specific residuals; no guaranteed downside protection or income. Taxes, fees, transaction costs, and tracking error are not modeled.',
    緊急預備金報酬: 'Emergency reserve return',
    '現金流 ETF 配息': 'Income ETF distributions',
    四個水庫與總資產的模擬走勢: 'Projected balances of the four buckets and the total portfolio',
    設定本年度核心資產報酬: 'Override this year’s core ETF return',
    水庫名稱: 'Bucket name',
    '只調整未來補水目標，不移動初始本金；兩個目標合計不能超過 100%。':
      'Changes only future replenishment targets; initial balances stay unchanged. The two targets must total no more than 100%.',
    '核心增值 ETF 策略': 'Core growth ETF strategy',
    '熊市下跌門檻說明：核心 ETF 當年報酬低於此值時，停止為可調整生活費出售核心 ETF，該年度標記為凍結。必要生活費 Floor 與意外支出不受此門檻保護，仍可被迫出售核心 ETF，並分別標記原因。':
      'Bear-market sale restriction: When the core ETF annual return falls below this threshold, sales for discretionary spending are suspended. Essential spending and unexpected expenses can still require core ETF sales; the reason is shown separately.',
    '核心 ETF 當年報酬低於此值時，停止為可調整生活費出售核心 ETF，該年標記為「凍結」——避免在低點賣出而把虧損鎖死。必要生活費 Floor 與意外支出無法調降，仍可突破門檻出售核心 ETF，並分別標記原因。':
      'When the core ETF annual return is below this threshold, sales for discretionary spending are suspended to avoid realizing losses at depressed prices. Essential spending and unexpected expenses can still require core ETF sales; the reason is shown separately.',
    終身: 'Lifetime',
    '歷史區塊抽樣時，在每個保留年度報酬上加入最多 ±X% 的獨立隨機擾動；0% 表示完全使用原始年度資料。它只改變該年度報酬，不改變區塊順序或通膨路徑。':
      'Historical block sampling adds independent random variation of up to ±X percentage points to each sampled annual return. At 0, returns are unchanged. Block order and inflation paths are unaffected.',
    '年化波動率說明：模型抽樣出的核心 ETF 年度簡單報酬標準差。設定 18% 表示報酬相對平均報酬的典型波動幅度約為正負 18 個百分點；它不是保證上下限。':
      'Annual return volatility: the standard deviation of the sampled core ETF annual simple returns. An 18% setting represents a typical deviation of about 18 percentage points from the mean, not a guaranteed range.',
    '意外支出基準值說明：單次事件以第 1 年美元計的金額。每一年會依累積通膨調整：第 N 年命中時，金額等於基準值乘上 (1 + 年通膨率) 的 N−1 次方。是否發生則由年度意外支出機率獨立抽樣。':
      'Unexpected expense amount in Year 1 dollars. Amounts are adjusted by cumulative inflation up to the expense year. With constant annual inflation i, the amount in Year N is the base amount × (1 + i)^(N−1). Occurrence is sampled independently each year.',
    '單次事件以第 1 年美元計的金額。每一年會依累積通膨調整：第 N 年命中時，金額等於基準值 × (1 + 年通膨率)^(N−1)。是否發生則由年度意外支出機率獨立抽樣。':
      'Unexpected expense amount in Year 1 dollars. Amounts are adjusted by cumulative inflation up to the expense year. With constant annual inflation i, the amount in Year N is the base amount × (1 + i)^(N−1). Occurrence is sampled independently each year.',
    '確定事件說明：已知一定會發生的一次性支出，例如第 7 年修房子。每條路徑都在同一年支付同一筆錢，用來看這筆支出落在不同市場路徑上的結果分佈。金額以第 1 年美元輸入並依年通膨調整；與抽樣事件同年時兩者相加。比較模式下所有方案共用。留空或金額 0 表示不使用。':
      'A scheduled one-time expense, such as a home repair in Year 7. Every path includes it in the same year. Enter the amount in Year 1 dollars; the payment follows that path’s cumulative inflation. It is added to any random expense in the same year. Comparison plans share this assumption. Leave blank or enter 0 to disable.',
    '已知一定會發生的一次性支出（例如第 7 年修房子）。每條路徑都在同一年付同一筆錢，看它落在不同市場路徑上的結果分佈。金額以第 1 年美元輸入、依年通膨調整；與抽樣事件同年時相加。比較模式下所有方案共用。留空或金額 0 表示不使用。':
      'A scheduled one-time expense, such as a home repair in Year 7. Every path includes it in the same year. Enter the amount in Year 1 dollars; the payment follows that path’s cumulative inflation. It is added to any random expense in the same year. Comparison plans share this assumption. Leave blank or enter 0 to disable.',
    獨立比較方案儲存位置: 'Destination MC plan',
    '牛市：回放 1996–1999 網路泡沫吹起的四年實際報酬，其後回到長期平均。':
      'Bull market: replay the actual 1996–1999 dot-com boom returns, then revert to the long-term average.',
    '每個水庫均以「期初 ＋ 報酬 ＋ 流入 − 流出 ＝ 期末」對帳；國債到期本金只是在國債面額與防守現金間轉換。':
      'Each bucket reconciles as opening balance + investment return + inflows − outflows = closing balance. Treasury principal received at maturity moves from bond face value to cash within the Treasury bucket.',
    '熊市門檻擋的是可調整生活費；必要生活費與意外支出無法調降，兩者都可突破門檻出售核心 ETF，並分別標記原因。':
      'The bear-market restriction applies to discretionary spending. Essential spending and unexpected expenses can still require core ETF sales; each reason is shown separately.',
    '熊市：回放 2000–2002 泡沫破裂與 2003–2004 的實際反彈，其後回到長期平均；核心資產避免在低點出售。':
      'Bear market: replay the 2000–2002 decline and the 2003–2004 recovery, then revert to the long-term average. The core ETF sale restriction limits sales at depressed prices.',
    '歷史回放：核心報酬與 CPI 依所選市場的完整歷史年度回放；其餘水庫沿用基準假設。':
      'Historical replay: core returns and inflation use full calendar-year data from the selected market. Other buckets use the base-case assumptions.',
    '加權股價指數完整曆年價格報酬（不含股息，台股殖利率高，低估幅度大於日經）；同步套用同年台灣 CPI（全年平均年增率）。共 30 年路徑。':
      'Taiwan SE Weighted Index calendar-year price returns (excluding dividends), paired with Taiwan CPI (annual-average inflation). Omitting dividends understates total returns, more materially than for the Nikkei given Taiwan’s higher dividend yield. One 30-year path.',
    '依首年生活費與參考配發率估算，未來配息不保證達標。套用後的初始配置：':
      'Estimated from first-year spending and the reference distribution rate; future distributions are not guaranteed. Proposed initial allocation:',
    套用初始配置: 'Apply Initial Allocation',
    '甲：只動用緊急預備金；不足直接列為意外支出缺口。':
      'Alpha: use only the emergency reserve; any remaining expense is recorded as an unexpected-expense shortfall.',
    '乙：正報酬年先售核心 ETF；非正報酬年先售現金流 ETF 本金。':
      'Beta: sell the core ETF first in positive-return years; otherwise sell income ETF holdings first.',
    意外支出提款順序: 'Unexpected-expense withdrawal order',
    '模擬中…可繼續操作，修改方案或抽樣設定會取消本次計算。':
      'Simulation running… You can continue using the app. Editing an MC plan or sampling assumptions cancels this run.',
    '本次模擬路徑數，非未來發生機率保證': 'Counts from this simulation, not guaranteed future probabilities',
    必要開銷曾有缺口: 'Paths with an essential-spending shortfall',
    '其中水庫支應 P25 / P50': 'Portfolio-funded spending ratio P25 / P50',
    '扣掉保證性收入後，四個水庫自己付出的部分': 'The share funded by the four buckets after guaranteed income',
    'Floor 曾咬住的路徑': 'Paths where the spending floor binds',
    護欄想低於必要生活費而被擋住: 'The floor prevents guardrails from reducing spending below essential expenses',
    '首次 Floor 咬住年 P25 / P50': 'First year the floor binds P25 / P50',
    '僅計入曾被 Floor 限制的路徑': 'Only paths where the spending floor binds',
    必要生活費曾缺口率: 'Essential-spending shortfall rate',
    '至少一年連 Floor 也無法全額支付': 'At least one year with insufficient funds to meet the spending floor',
    '累計外部收入需求 P50 / P75': 'Cumulative additional income needed P50 / P75',
    僅計入曾有必要生活費缺口的路徑: 'Only paths with an essential-spending shortfall',
    '必要生活費被迫賣核心 ETF': 'Forced core ETF sales for essential spending',
    '熊市門檻下仍需支付 Floor 的路徑':
      'Paths requiring core ETF sales below the bear-market threshold to meet the spending floor',
    '本次 BXM 路徑以 12 個月市場報酬套用月頻 OLS，並抽樣 BXM 專屬殘差；它不是保證防跌或保證現金流，且未納入稅、費用、交易成本與實際追蹤誤差。':
      'This run applies monthly ordinary least squares (OLS) calibration to 12 monthly market returns and samples BXM-specific residuals. It does not guarantee downside protection or income. Taxes, fees, transaction costs, and tracking error are not modeled.',
    '各欄從本次實際路徑中挑選年末資產最接近該分位數者。':
      'Each column shows an actual simulated path whose final portfolio value is closest to the stated percentile.',
    '複製會覆蓋水庫模擬頁的配置、支出與規則，並帶入選定路徑的 30 年核心報酬、意外支出與非核心情境；BXM 路徑另帶月頻市場與專屬殘差以確保可重播。水庫模擬頁提領軌跡表上方的「清除逐年報酬」可整批還原為依情境。':
      'Applying a path replaces the fixed scenario’s allocation, spending, and rules, and imports 30 years of core returns, unexpected expenses, and non-core assumptions. BXM paths also include monthly market returns and strategy-specific residuals for replay. Use “Clear annual overrides” above the withdrawal table to restore scenario-based assumptions.',
    '這是此模型下的比較，不是完整的股債市場比較。':
      'This comparison reflects the model’s assumptions; it is not a comprehensive stock-and-bond market simulation.',
    零支出年: 'Paths with a zero-spending year',
    十分位: 'Decile',
    '——「前 5 年市場報酬落在該十分位的路徑，最後有多少比例資產耗盡」，不是因果歸因。它衡量的是序列風險：同一條市場路徑對不同配置是不同的投資組合經驗，橫軸只描述市場。另外目前的抽樣':
      ' — the share of paths in each first-five-year market-return decile that eventually deplete the portfolio. This describes sequence-of-returns risk, not causal attribution: identical market returns can affect different allocations differently. The x-axis describes market returns only. The current sampling also ',
    不含隨機通膨: 'excludes random inflation ',
    '（每條路徑共用同一個通膨率），所以這張圖不能當成完整的失敗原因分析。':
      ' (all paths use the same inflation rate), so this chart is not a complete explanation of why a plan fails.',
    '每條線都是該方案全部 Monte Carlo 路徑在各年度的總資產分位數；破產後的年度計為 $0。':
      'Each line shows a percentile of annual total portfolio values across all simulated paths for that plan. Values after depletion are set to $0.',
    代表路徑年度明細: 'Annual Details of Representative Paths',
    方案比較圖表: 'Plan comparison charts',
    '核心 ETF 前五年 CAGR 十分位與各方案資產耗盡率':
      'Core ETF first-five-year CAGR deciles and portfolio depletion rates by plan',
    方案折線圖例: 'Plan chart legend',
    '方案 A、B、C 各 P25、P50、P75 的三十年總資產軌跡':
      '30-year portfolio value percentiles (P25, P50, P75) for Plans A, B, and C',
    配息情境: 'Distribution Scenario',
    '模型的參考配發率；實際配發依持倉與模型計算，legacy 輸入不適用。':
      'Reference distribution rate for the model. Actual distributions depend on holdings and the model; the custom yield input is not used.',
    '現金流 ETF 配息情境': 'Income ETF distribution scenario',
    本情境未耗盡: 'Portfolio lasts the full horizon',
    本情境可支應: 'Essential expenses fully funded',
    'Floor 已咬住': 'Spending floor is binding',
    '配發中假設 ROC 比例 %': 'Assumed return-of-capital (ROC) share (%)',
    'PBP 假設 ROC 比例': 'PBP assumed return-of-capital (ROC) share',
    '現金流 ETF 配息固定優先；其餘來源可調整。':
      'Income ETF distributions are used first; the remaining withdrawal sources can be reordered.',
    '壓力：1966 年起美國 CPI（70 年代完整一輪）': 'Stress: U.S. CPI from 1966 (full 1970s cycle)',
    '壓力：1973 年起美國 CPI（石油危機起）': 'Stress: U.S. CPI from 1973 (oil crisis onward)',
    意外支出策略: 'Unexpected-expense strategy',
    意外支出順序: 'Unexpected-expense withdrawal order',
    意外支出自訂提款順序: 'Custom unexpected-expense withdrawal order',
    '年收入 $（第 1 年幣值）': 'Annual income $ (Year 1 dollars)',
    '年金額（第 1 年幣值）': 'Annual amount (Year 1 dollars)',
    隨機: 'Random',
    壓力: 'Stress',
    模擬已取消: 'Simulation canceled',
    '無法執行模擬，請重試。': 'Unable to run the simulation. Please try again.',
    '無法讀取模擬結果，請重試。': 'Unable to read simulation results. Please try again.',
    請至少保留一個方案參與比較: 'Include at least one plan in the comparison.',
    已儲存: 'Saved',
    取消模擬: 'Cancel Simulation',
    'YOUR RESERVOIRS': 'YOUR BUCKETS',
    必要生活費: 'Essential Spending',
    年通膨率: 'Annual Inflation Rate',
    生活費曾缺口率: 'Spending shortfall rate',
    '解除鎖定；核心增值 ETF 可自行編輯': 'Unlock to edit the core growth ETF balance directly.',
    '起始流動資產已鎖定；核心增值 ETF 會自動補足其餘金額。':
      'Initial liquid assets are locked; the core growth ETF receives the remaining allocation.',
    '總資產已鎖定；核心 ETF 自動補足差額': 'Total assets are locked; the core ETF receives the remaining allocation.',
    加入: 'Include',
    加入比較: 'Include in comparison',
    '（未比較）': '(excluded)',
    '起始資產為 $0，無從比較': 'Initial assets are $0; percentage comparison is unavailable.',
    '投資組合已耗盡，模擬停止': 'The portfolio is depleted; the simulation stops.',
    '緊急金初始配置為 $0，已停用補水。': 'The emergency reserve starts at $0; replenishment is disabled.',
    '必要生活費高於原始計畫；護欄無法收緊，請確認這是刻意設定。':
      'Essential spending exceeds the original plan. The floor prevents further spending cuts; review this setting.',
    '正報酬：核心 ETF': 'Positive returns: core ETF',
    '非正報酬：現金流 ETF 本金': 'Zero or negative returns: income ETF holdings',
    '現金流 ETF 已清算（淨值歸零），目前無持倉；待核心報酬回正的補水年依支應目標重新買進。':
      'The income ETF has been liquidated after NAV reached zero; no shares remain. The position will be rebuilt to its coverage target in a replenishment year with positive core returns.',
    '歷史資料不足，無法組成不重複的 30 年區塊路徑':
      'Insufficient historical data for a 30-year block-sampled path without repeated source years.',
    比較模式至少需要一個方案: 'Include at least one plan in the comparison.',
    '比較模式 v1 要求所有方案使用相同通膨率，才能共用意外支出金額':
      'Comparison plans must use the same inflation rate to share unexpected-expense amounts. Set the shared inflation rate before running the comparison.',
    '日經 225 完整曆年價格報酬（不含股息）；同步套用同年日本 CPI（全年平均年增率）。':
      'Nikkei 225 calendar-year price returns (excluding dividends), paired with Japanese CPI (annual-average inflation). ',
    'S&P 500 完整曆年 Total Return（含股息再投資）；同步套用同年 CPI-U（12 月年增率），緊急預備金與到期現金賺同年 3 個月國庫券利率平均、新買國債票息取同年 12 月五年期公債殖利率（GS5）。':
      'S&P 500 calendar-year total returns (including reinvested dividends), paired with CPI-U (December year-over-year inflation). Cash earns the same-year average 3-month Treasury bill rate; new Treasury coupons use the same-year December 5-year Treasury yield (GS5). ',
    '倒放會同時反轉報酬、CPI 與（美國）利率的年度順序；這是合成序列風險壓力測試，不是真實歷史。':
      'Reverse replay reverses the annual order of returns, CPI, and U.S. interest rates together. This is a synthetic sequence-of-returns stress scenario, not actual history. ',
    'Floor 未限制護欄': 'The spending floor did not constrain guardrail adjustments',
    需調整: 'Plan needs adjustment',
    '現金流 ETF 清算轉入': 'Proceeds from income ETF liquidation',
    清算轉出至緊急預備金: 'Liquidation proceeds transferred to the emergency reserve',
    '清算轉出至核心 ETF': 'Liquidation proceeds transferred to the core ETF',
    本金支應生活費: 'Holdings sold to fund spending',
    '意外支出（本金）': 'Holdings sold for unexpected expenses',
    到期現金補緊急金: 'Maturity proceeds replenish the emergency reserve',
    防守現金回收至核心: 'Treasury bucket surplus transferred to the core ETF',
    防守現金回收: 'Treasury bucket surplus',
    '核心 ETF 補水': 'Transfer from the core ETF',
    '核心 ETF 補入': 'Transfer from the core ETF',
    '回收至核心 ETF': 'Surplus transferred to the core ETF',
    補緊急預備金: 'Replenish the emergency reserve',
    緊急金回收: 'Emergency reserve surplus',
    '防守安全水庫 · 美國國債梯': 'Treasury Bucket · U.S. Treasury Ladder',
    配息支應生活費: 'Distributions fund spending',
    '（超過原鎖定總額，總額將提高）': '(exceeds the locked total; the total will increase)',
    '自訂：依下方手動排序支付意外支出。': 'Custom: fund unexpected expenses in the order below.',
    '單方案使用 MC 方案 A；固定情境不會自動同步，需明確複製到 A／B／C。':
      'Single-plan mode uses independent MC Plan A. Changes to the fixed scenario do not update MC plans automatically; use the explicit copy action to update A, B, or C.',
    '目前使用 MC ': 'Currently using MC ',
    '；固定情境不會自動同步': '; the fixed scenario does not sync automatically',
    ' 本金': ' holdings',
    ' 國債到期支應 %': ' Spending covered by Treasury maturities (%)',
    年度擾動: 'Annual Return Perturbation',
    未設定必要生活費: 'Essential spending not set',
    這張圖是: 'This chart shows ',
    '減配較深（壓力）': 'Deeper Distribution Cuts (Stress)',
    '恢復較慢（壓力）': 'Slower Recovery (Stress)',
    '目前使用 MC': 'Currently using MC',
    '以我的計畫取代「': 'Replace “',
    '」的設定？其他比較方案保持原樣。': '” with the fixed-scenario plan? Other comparison plans stay unchanged.',
    'P25 年度明細': 'P25 Annual Details',
    'P50 年度明細': 'P50 Annual Details',
    'P75 年度明細': 'P75 Annual Details',
    放寬觸發門檻: 'Spending increase trigger',
    收緊觸發門檻: 'Spending cut trigger',
    放寬幅度: 'Real spending increase',
    收緊幅度: 'Real spending cut',
  };
  Object.assign(reviewedEnglish, {
    '（基準）': '(baseline)',
    配息: 'Distributions',
    本金: 'Principal',
    '參與比較的方案使用相同的市場報酬、事件發生年份與事件金額；':
      'Plans share market returns, expense timing, and expense amounts; ',
    '為基準。v1 要求所有方案使用相同通膨率，避免事件金額混入方案差異。':
      'is the baseline. Plans use the same inflation assumptions so inflation-adjusted expenses remain comparable. ',
  });
  const completeEnglish = Object.fromEntries(
    [...Object.entries(englishText), ...Object.entries(reviewedEnglish)].map(([zh, en]) => [
      zh.replace(/\s+/g, ' ').trim(),
      en,
    ]),
  );
  const reviewedPhrases = Object.entries(completeEnglish)
    .filter(([zh]) => zh.length > 8)
    .sort((a, b) => b[0].length - a[0].length);
  function translateDynamicEnglish(source) {
    return source
      .replace(
        /從 (\d+) 歲規劃到 (\d+) 歲，共 (\d+) 年；固定情境、歷史回放與多路徑模擬共用。/g,
        'Plan from age $1 through age $2 ($3 years). Fixed scenarios, historical replay, and Monte Carlo share this horizon.',
      )
      .replace(
        /使用目前選定方案，檢查從 (\d+) 歲到 (\d+) 歲的 (\d+) 年資產與生活費。逐年路徑不帶入 MC。/g,
        'Use the selected plan to evaluate assets and spending from age $1 through age $2 ($3 years). Annual fixed-scenario overrides do not carry into Monte Carlo.',
      )
      .replace(/(\d+) → (\d+) 歲 · (\d+) 年隨機路徑壓力測試/g, 'Ages $1–$2 · $3-year random-path stress test')
      .replace(/套用 (\d+) 年歷史路徑/g, 'Apply $1-year historical path')
      .replace(/資料僅 (\d+) 年/g, 'Only $1 years of data')
      .replace(
        /(.+?)只有 (\d+) 年完整資料，無法涵蓋 (\d+) 年規劃期；請縮短年限或改選其他市場。/g,
        '$1 has only $2 complete years of data and cannot cover a $3-year horizon. Shorten the horizon or choose another market.',
      )
      .replace(/第 (\d+) 年（(\d+) 歲）停止時資產/g, 'Portfolio value at the Year $1 stop (age $2)')
      .replace(/(\d+) 歲時預估資產/g, 'Projected assets at age $1')
      .replace(/資產能否維持到 (\d+) 歲/g, 'Can assets last through age $1?')
      .replace(/(\d+) → (\d+) 歲（(\d+) 年）/g, 'ages $1–$2 ($3 years)')
      .replace(/^方案 ([ABC])（基準）$/, 'Plan $1 (baseline)')
      .replace(
        /目標殖利率改為該檔樣本平均：VYM ([\d.]+%)（高於起始 ([\d.]+%)）、SCHD ([\d.]+%)（低於起始 ([\d.]+%)）。/g,
        'Target yield uses each fund’s historical sample mean: VYM $1 (above its starting yield of $2) and SCHD $3 (below its starting yield of $4).',
      )
      .replace(
        /收緊觸發門檻需高於放寬觸發門檻至少 ([\d.]+) 個百分點（目前 ([\d.−-]+)%–([\d.−-]+)%）。/g,
        'The spending cut trigger must exceed the spending increase trigger by at least $1 percentage points (currently $2%–$3%).',
      )
      .replace(
        /(放寬觸發門檻|收緊觸發門檻|放寬幅度|收緊幅度)必須是數字。/g,
        (_, label) => `${translateEnglish(label)} must be a number.`,
      )
      .replace(
        /(放寬觸發門檻|收緊觸發門檻|放寬幅度|收緊幅度)不能是負數（目前 ([\d.−-]+)%）。/g,
        (_, label, value) => `${translateEnglish(label)} cannot be negative (currently ${value}%).`,
      )
      .replace(/現金流 ETF 已清算（淨值歸零）/g, 'The income ETF was liquidated after NAV reached zero')
      .replace(/，剩餘 (\$[\d,]+) 轉入(緊急預備金|核心 ETF)/g, ', with $1 of remaining cash transferred to $2')
      .replace(
        /，剩餘 (\$[\d,]+) 無處可轉，以零利息現金保留/g,
        ', retaining $1 as non-interest-bearing cash because no transfer destination is available',
      )
      .replace(
        /，目前無持倉；待核心報酬回正的補水年依支應目標重新買進。/g,
        '; no shares remain. Rebuild the position to its coverage target in a replenishment year with positive core returns. ',
      )
      .replace(
        /；待核心報酬回正的補水年依支應目標重新買進。/g,
        '. Rebuild the position to its coverage target in a replenishment year with positive core returns. ',
      )
      .replace(/以保留的現金 (\$[\d,]+) 重新買進同類 ETF/g, 'Reinvest $1 of retained cash in the same ETF strategy')
      .replace(/重新建立同類 ETF 部位/g, 'Rebuild the position in the same ETF strategy')
      .replace(/，恢復配息與補水。/g, ', resuming distributions and replenishment. ')
      .replace(
        /為支付必要生活費，被迫出售核心 ETF (\$[\d,]+)/g,
        'Forced sale of $1 of core ETF holdings to fund essential spending',
      )
      .replace(/第 (\d+)[–-](\d+) 年提領軌跡/g, 'Withdrawals in Years $1–$2')
      .replace(/約為流動資產的 —/g, 'share of liquid assets unavailable')
      .replace(/加入比較 (.+)/g, 'Include $1 in comparison')
      .replace(/（未比較）/g, '(excluded)')
      .replace(/（超過原鎖定總額，總額將提高）/g, '(exceeds the locked total; the total will increase)')
      .replace(
        /當年無可動用資金：資產 (\$[\d,]+) 仍在，但核心 ETF 被熊市門檻凍結/g,
        'No funds available this year: $1 remains, but core ETF sales are restricted by the bear-market threshold',
      )
      .replace(
        /當年無可動用資金：資產 (\$[\d,]+) 仍在，但國債尚未到期/g,
        'No funds available this year: $1 remains, but the Treasuries have not matured',
      )
      .replace(/（另有 (\$[\d,.KM]+) 轉入資產）/g, '(an additional $1 was retained in the portfolio)')
      .replace(
        /必要生活費 (\$[\d,]+)（護欄候選 (\$[\d,]+)，底線咬住）/g,
        'Essential spending $1 (guardrails proposed $2; spending floor applied)',
      )
      .replace(/必要生活費缺口 (\$[\d,]+)/g, 'Essential-spending shortfall $1')
      .replace(/；尚缺 (\$[\d,]+)/g, '; shortfall $1')
      .replace(
        /國債梯與現金流 ETF 的生活費支應目標合計 ([\d.]+)%（([\d.]+)% \+ ([\d.]+)%），超過 100%。兩者會各自依比例補水；若是先前只啟用其中一個水庫時留下的設定，請確認。/g,
        'Treasury and income ETF spending coverage targets total $1% ($2% + $3%), exceeding 100%. Each bucket is replenished to its own target. Review these settings, especially if they were saved when only one bucket was active.',
      )
      .replace(/自訂：依下方手動排序支付意外支出。/g, 'Custom: fund unexpected expenses in the order below. ')
      .replace(/減配較深（壓力）/g, 'Deeper Distribution Cuts (Stress)')
      .replace(/恢復較慢（壓力）/g, 'Slower Recovery (Stress)')
      .replace(
        /國債到期現金轉入 (\$[\d,]+) 至緊急金。/g,
        'Transfer $1 of Treasury maturity proceeds to the emergency reserve. ',
      )
      .replace(
        /核心 ETF 補入 (\$[\d,]+) 至緊急金目標 (\$[\d,]+)。/g,
        'Transfer $1 from the core ETF toward the emergency reserve target of $2. ',
      )
      .replace(
        /緊急金回收 (\$[\d,]+) 至核心 ETF，保留目標 (\$[\d,]+)。/g,
        'Transfer $1 of emergency reserve surplus to the core ETF, retaining the $2 target. ',
      )
      .replace(/防守現金回收 (\$[\d,]+) 至核心 ETF。/g, 'Transfer $1 of Treasury bucket surplus to the core ETF. ')
      .replace(
        /核心 ETF 補入 (\$[\d,]+)，將現金流 ETF 補至 (\$[\d,]+)，使其配息約覆蓋下年度支出的 ([\d.]+%)。/g,
        'Transfer $1 from the core ETF to bring the income ETF to $2, targeting distributions that cover about $3 of next-year spending. ',
      )
      .replace(
        /，補足目標 (\d+) 年梯範圍內所有空期的國債面額；每期目標為預計支出的 ([\d.]+%)。新債面額向上取整至 \$1,000，既有債券不調整。/g,
        ', filling missing maturities within the $1-year target ladder. Each rung targets $2 of planned spending. New face values are rounded up to $$1,000; existing bonds are unchanged. ',
      )
      .replace(/第 (\d+) 年首度缺口；累計 (\$[\d,]+)/g, 'First spending shortfall in Year $1; cumulative shortfall $2')
      .replace(/支出連續下調 (\d+) 年(?!，其中)/g, 'Spending reduced for $1 years')
      .replace(/現金流本金 (?=\$)/g, 'Income ETF holdings ')
      .replace(
        /目前使用 MC (.+?)；固定情境不會自動同步/g,
        'Currently using MC $1; the fixed scenario does not sync automatically',
      )
      .replace(/通膨 隨機/g, 'Inflation: Random')
      .replace(/通膨 固定/g, 'Inflation: Fixed')
      .replace(
        /生活費先使用配息，其餘按 (.+?) 支應。/g,
        'Distributions fund spending first; the remainder follows this withdrawal order: $1. ',
      )
      .replace(
        /必要生活費與意外支出可突破熊市提款門檻；可調整生活費受門檻限制。/g,
        'Essential spending and unexpected expenses can require core ETF sales below the bear-market threshold; discretionary spending remains subject to the restriction. ',
      )
      .replace(
        /([\d,]+) 條路徑；平均報酬 ([+−-]?[\d.]+%)、波動率 ([\d.]+%)、種子 (\d+)。/g,
        '$1 simulated paths; mean annual return $2, annual return volatility $3, random seed $4. ',
      )
      .replace(
        /([\d,]+) 條合成歷史路徑，非真實歷史回放；/g,
        '$1 synthetic paths sampled from historical data, not actual historical sequences. ',
      )
      .replace(
        /市場為「(.+?)」，直接採其年度資料（平均 ([+−-]?[\d.]+%)、波動率 ([\d.]+%)），/g,
        'Market: $1, using its annual data (mean $2; standard deviation $3). ',
      )
      .replace(
        /ETF 使用保留年度複利的合成分層月路徑，非真實歷史月資料；每段 (\d+) 年、不重複來源年份，年度擾動 ±([\d.]+)%；種子 (\d+)。/g,
        'ETF models use synthetic monthly paths that preserve annual compounded returns, not actual historical monthly observations. Blocks contain $1 years, without repeated source years; annual return perturbation ±$2 percentage points; seed $3. ',
      )
      .replace(
        /每年另以 ([\d.]+%) 的獨立機率發生意外支出；基準值 (\$[\d,]+)（第 1 年美元），其後依年通膨調整。/g,
        'Each year independently has a $1 probability of an unexpected expense of $2 in Year 1 dollars, adjusted by cumulative inflation. ',
      )
      .replace(
        /波動會造成複利拖累，因此中位數不等於固定 ([+−-]?[\d.]+%) 報酬的結果。/g,
        'Volatility drag means the median outcome differs from earning a constant annual return of $1. ',
      )
      .replace(
        /核心 ETF 以外的水庫報酬沿用「(.+?)」的假設。/g,
        'Returns for the other buckets follow the $1 assumptions. ',
      )
      .replace(
        /支應比例的分母一律是未經護欄調整的原始計畫——護欄砍出來的節省不算成功。/g,
        'Spending coverage uses the original plan before guardrail adjustments as the denominator; spending cuts do not count as funded spending.',
      )
      .replace(
        /到期本金 (\$[\d,]+)：國債面額轉為防守現金，不改變本水庫總額。/g,
        'Principal repaid at maturity: $1. Bond face value converts to Treasury bucket cash without changing the bucket total.',
      )
      .replace(
        /現金流水庫：含息總報酬 ([+−-]?[\d.]+%)，實際配息 ([\d.]+%)/g,
        'Income bucket: total return $1; realized distribution rate $2',
      )
      .replace(
        /參與比較的方案使用相同的市場報酬、事件發生年份與事件金額；(.+?) 為基準。v1 要求所有方案使用相同通膨率，避免事件金額混入方案差異。/g,
        'Plans share market returns, expense timing, and expense amounts; $1 is the baseline. All plans use the same inflation assumptions so inflation-adjusted expenses remain comparable. ',
      )
      .replace(
        /目前補水目標：國債到期 (.*?)%、配息 (.*?)% 的年度生活費；國債 (\d+) 年梯。生活費依護欄調整，詳細門檻與提款順序可在主計畫展開查看。/g,
        'Replenishment targets: Treasury maturities cover $1% and distributions cover $2% of annual spending, with a $3-year Treasury ladder. Spending follows the guardrails; expand the plan editor for thresholds and withdrawal order.',
      )
      .replace(
        /第 (\d+) 年四個水庫已耗盡，模擬停止；累計缺口 (\$[\d,]+)（截至停止年）/g,
        'All four buckets are depleted in Year $1 and the simulation stops. Cumulative shortfall through that year: $2',
      )
      .replace(
        /第 (\d+) 年必要生活費短少 (\$[\d,]+)（累計）/g,
        'Essential-spending shortfall by Year $1: $2 (cumulative)',
      )
      .replace(/第 (\d+) 年停止時資產/g, 'Portfolio value when the simulation stops in Year $1')
      .replace(/第 (\d+) 年耗盡/g, 'Depleted in Year $1')
      .replace(
        /其中水庫 ([\d.]+%)；保證性收入支應 (\$[\d,.KM]+)/g,
        'Portfolio-funded share: $1; guaranteed income contributed $2',
      )
      .replace(/(\d+) 年資產趨勢（第 (\d+) 年停止）/g, '$1-year portfolio projection (stops in Year $2)')
      .replace(/(\d+) 年四個水庫及總資產趨勢/g, '$1-year projection of the four buckets and total portfolio')
      .replace(
        /核心 ETF 凍結[（(]報酬 ([+−-]?[\d.]+%) [＜<] 門檻 ([+−-]?[\d.]+%)[）)]/g,
        'Core ETF sales restricted (return $1 < threshold $2)',
      )
      .replace(
        /原始計畫 (\$[\d,]+)（護欄累計 ([+−-]?[\d.]+%)）/g,
        'Original plan $1 (cumulative guardrail adjustment: $2)',
      )
      .replace(
        /調整前 ([\d.]+%) → 收緊 ([\d.]+)%（實質） → 調整後 ([\d.]+%)/g,
        'Withdrawal rate $1 → real spending cut of $2% → withdrawal rate $3',
      )
      .replace(
        /調整前 ([\d.]+%) → 放寬 ([\d.]+)%（實質） → 調整後 ([\d.]+%)/g,
        'Withdrawal rate $1 → real spending increase of $2% → withdrawal rate $3',
      )
      .replace(/調整前 ([\d.]+%) → 未觸發護欄/g, 'Withdrawal rate $1 → no guardrail adjustment')
      .replace(/依前年 CPI ([+−-]?[\d.]+%) 調整/g, 'Adjusted for prior-year inflation: $1')
      .replace(/第 (\d+) 年起/g, 'From Year $1:')
      .replace(
        /目前 (\d+) 階，補梯範圍 (\d+) 年（最遠到期年）；範圍內沒有面額的年度會在正報酬年補買。金額會同步至防守水庫，刪除一階會減少初始資產。/g,
        'Currently $1 rungs, with maturities up to Year $2. In positive-return years, missing maturities within this range are replenished. Changes update the Treasury bucket balance; removing a rung reduces initial assets.',
      )
      .replace(
        /新增一階（初始面額 \$0，(填補|延長)至第 ([\d—]+) 年）/g,
        (_, action, year) =>
          `Add rung ($0 initial face value; ${action === '填補' ? 'fill gap in' : 'extend to'} Year ${year})`,
      )
      .replace(
        /自動縮短：第 (\d+) 年將補梯目標降至 1 年（既有國債保留至到期）/g,
        'Reduce the replenishment target to a 1-year ladder in Year $1; hold existing Treasuries to maturity',
      )
      .replace(/目標梯長 (\d+) 年 · 實際持有 (\d+) 個梯級/g, 'Target ladder: $1 years · Current holdings: $2 rungs')
      .replace(/隱藏(.+?)走勢/g, 'Hide $1 series')
      .replace(/顯示(.+?)走勢/g, 'Show $1 series')
      .replace(/(.+?)年度生活費支應目標百分比/g, '$1 annual spending coverage target (%)')
      .replace(/共 (\d+) 年路徑。/g, 'One $1-year path.')
      .replace(/約第 (\d+) \/ (\d+) 年/g, 'Approximately Year $1 / $2')
      .replace(/第 (\d+) 年總資產分位數/g, 'Portfolio value percentiles in Year $1')
      .replace(/(\d+) 年內資產耗盡/g, 'Portfolio depletion within $1 years')
      .replace(
        /終身總共花到計畫的幾成；全部 ([\d,]+) 條路徑/g,
        'Share of cumulative planned spending funded over the projection horizon; all $1 paths',
      )
      .replace(/(\d+) 年資產軌跡/g, '$1-year portfolio trajectories')
      .replace(
        /(VYM|SCHD)：DPS／NAV 部分調整模型，起始殖利率 ([\d.]+%)；配息情境「(.+?)」/g,
        (_match, kind, yieldText, scenario) =>
          `${kind}: partial-adjustment model of dividends per share (DPS) and net asset value (NAV); initial yield ${yieldText}; distribution scenario: ${translateText(scenario)}`,
      )
      .replace(
        /PBP：可變配發，平均參考率 ([\d.]+%)；假設 ROC ([\d.]+%)（不計稅）/g,
        'PBP: variable distributions; reference distribution rate $1; assumed return of capital $2 (taxes are not modeled)',
      )
      .replace(
        /PBP 配發 (\$[\d,]+)，其中假設 ROC (\$[\d,]+)、其餘配發 (\$[\d,]+)；每單位實際配發 (\$[\d,]+)。ROC 已包含於配發，並非額外收益；不計稅。/g,
        'PBP distribution $1, including assumed return of capital $2 and other distributions $3; distribution per share $4. Return of capital is included in the distribution, not additional income. Taxes are not modeled.',
      )
      .replace(
        /支出連續下調 (\d+) 年，其中 (\d+) 年砍到上限仍壓不回區間/g,
        'Spending reduced for $1 consecutive years; in $2 years the maximum cut still left the withdrawal rate outside the guardrails',
      )
      .replace(
        /Floor 自第 (\d+) 年咬住，共 (\d+) 年，護欄無法再收緊/g,
        'The spending floor binds from Year $1 for $2 years, preventing further guardrail cuts',
      )
      .replace(
        /以我的計畫取代「(.+?)」的設定？其他比較方案保持原樣。/g,
        'Replace “$1” with the fixed-scenario plan? Other comparison plans stay unchanged.',
      )
      .replace(
        /每條路徑另在第 (\d+) 年支付一筆確定支出 (\$[\d,]+)（第 1 年美元，依年通膨調整；代表路徑表標為「確定」）。/g,
        'Each path also includes a scheduled expense of $2 in Year $1, entered in Year 1 dollars and adjusted for that path’s inflation. It is labeled “Scheduled” in the representative-path table. ',
      )
      .replace(
        /通膨每條路徑隨機：以方案年通膨為中心，持續性 ([\d.]+)、年衝擊 ([\d.]+) 個百分點（(\d+)–(\d+) 美國 CPI 估計，下限 ([−-]?[\d.]+)%；不含 70 年代式失控）/g,
        'Each path has random inflation centered on the plan rate, with persistence $1 and annual shock standard deviation $2 percentage points (estimated from U.S. CPI, $3–$4; minimum $5%). This excludes 1970s-style inflation instability',
      )
      .replace(
        /(\d+) 年平均通膨 P10／P50／P90 為 ([\d.−-]+%)／([\d.−-]+%)／([\d.−-]+%)。/g,
        '$1-year average inflation P10 / P50 / P90: $2 / $3 / $4. ',
      )
      .replace(
        /通膨採歷史壓力路徑：(.+?)，(\d+)–(\d+) 實際 12 月年增率，(\d+) 年平均 ([\d.]+%)、最高 ([\d.]+%)；每條路徑相同，市場報酬仍隨機。/g,
        'Historical inflation stress scenario: $1, using actual December year-over-year CPI changes for $2–$3. The $4-year average is $5 and the maximum is $6. All paths share this inflation sequence; market returns remain random. ',
      )
      .replace(
        /緊急預備金與到期現金改賺同年 3 個月國庫券平均（([\d.]+%)–([\d.]+%)），補梯新買的國債票息取同年 12 月五年期公債殖利率（GS5）。/g,
        'The emergency reserve and cash from maturities earn same-year average 3-month Treasury bill rates ($1–$2). Newly purchased Treasuries use the same-year December 5-year Treasury yield (GS5) as their coupon rate. ',
      )
      .replace(/(\d+) 年起美國 CPI（70 年代完整一輪）/g, 'U.S. CPI from $1 (full 1970s cycle)')
      .replace(/(\d+) 年起美國 CPI（石油危機起）/g, 'U.S. CPI from $1 (oil crisis onward)')
      .replace(/(\d+) 年壓力路徑/g, 'Stress scenario from $1')
      .replace(/確定 (?=\$)/g, 'Scheduled ')
      .replace(/指定 (?=[+−-]?\d)/g, 'Override ')
      .replace(/緊急金 (?=\$)/g, 'Emergency reserve ')
      .replace(/核心 (?=\$)/g, 'Core ETF ')
      .replace(/事件缺口 (?=\$)/g, 'Unexpected-expense shortfall ')
      .replace(/總額：/g, 'Total: ')
      .replace(/不比較 /g, 'Exclude ')
      .replace(/熊市被迫出售/g, 'forced sale below the bear-market threshold')
      .replace(/意外支出曾有缺口/g, 'An unexpected-expense shortfall occurred')
      .replace(/意外支出/g, 'Unexpected expenses')
      .replace(/（第 1 年幣值）/g, '(Year 1 dollars)')
      .replace(
        /VYM／SCHD 使用 DPS／NAV 部分調整模型；legacy 配息率不參與運算。補水使用下一年 DPS。/g,
        'VYM/SCHD use a partial-adjustment model of dividends per share (DPS) and net asset value (NAV). The custom distribution yield is not used. Replenishment uses next-year DPS. ',
      )
      .replace(
        /核心 ETF 與現金流 ETF 共用市場路徑；BXM／VYM／SCHD 另抽各自的月頻殘差。國債梯與緊急預備金採設定利率、無隨機利率波動，/g,
        'The core and income ETFs share market paths; BXM/VYM/SCHD also sample strategy-specific monthly residuals. Treasury and cash rates follow the selected assumptions rather than a stochastic interest-rate model. ',
      )
      .replace(
        /未模擬債券市價波動；通膨採固定設定，不含隨機通膨。因此配置差距須在這些假設下解讀。/g,
        'Bond price fluctuations are not modeled. Inflation is fixed. Interpret allocation differences in the context of these assumptions. ',
      )
      .replace(
        /未模擬債券市價波動；通膨為隨機路徑（錨定時代校準，所有方案共用同一條），不含 70 年代式的通膨失控。因此配置差距須在這些假設下解讀。/g,
        'Bond price fluctuations are not modeled. Plans share a random inflation path calibrated to the era of anchored inflation expectations, excluding 1970s-style instability. Interpret allocation differences in this context. ',
      )
      .replace(
        /未模擬債券市價波動；通膨採歷史壓力路徑（(.+?)，所有方案相同），國債票息跟隨同期 GS5、現金報酬跟隨同期 3 個月國庫券。因此配置差距須在這些假設下解讀。/g,
        'Bond price fluctuations are not modeled. All plans use the historical inflation stress sequence ($1); Treasury coupons follow the same-period GS5 rate and cash follows 3-month Treasury bill rates. Interpret allocation differences in this context. ',
      )
      .replace(
        /——「前 5 年市場報酬落在該十分位的路徑，最後有多少比例資產耗盡」，不是因果歸因。它衡量的是序列風險：同一條市場路徑對不同配置是不同的投資組合經驗，橫軸只描述市場。/g,
        ' — the share of paths in each first-five-year return decile that eventually deplete the portfolio. This describes sequence-of-returns risk, not causal attribution. Identical market paths can affect allocations differently; the x-axis describes market returns only. ',
      )
      .replace(
        /所有路徑套用同一段歷史通膨，差異只來自市場報酬，所以這張圖不能當成完整的失敗原因分析。/g,
        'Every path uses the same historical inflation sequence. Grouping only by market returns does not provide a complete explanation of plan failure.',
      )
      .replace(
        /通膨雖為隨機路徑，但橫軸只依市場報酬分組，所以這張圖不能當成完整的失敗原因分析。/g,
        'Inflation is random, but paths are grouped only by market returns. This chart is not a complete explanation of plan failure.',
      );
  }
  function polishEnglish(text) {
    return text
      .replace(/Necessary-Spending Floor|Necessary-spending floor/g, 'Essential Spending Floor')
      .replace(/Necessary spending|necessary spending/g, 'essential spending')
      .replace(/necessary expenses/gi, 'essential expenses')
      .replace(/adjustable spending/g, 'discretionary spending')
      .replace(/Cash-flow ETF|Cash flow ETF/g, 'Income ETF')
      .replace(/cash-flow ETF/g, 'income ETF')
      .replace(/Defense Treasury ladder/g, 'Treasury ladder')
      .replace(/Defense bucket|defense bucket|Defense Bucket/g, 'Treasury bucket')
      .replace(/defense cash/g, 'Treasury bucket cash')
      .replace(/Nominal fixed/g, 'Fixed nominal amount')
      .replace(/Annualized mean return|Annualized Mean Return/g, 'Mean Annual Return')
      .replace(/Annualized volatility|Annualized Volatility/g, 'Annual Return Volatility')
      .replace(/Loosening [Tt]rigger(?: threshold)?/g, 'Spending increase trigger')
      .replace(/Tightening [Tt]rigger(?: threshold)?/g, 'Spending cut trigger')
      .replace(/loosening trigger/g, 'spending increase trigger')
      .replace(/tightening trigger/g, 'spending cut trigger')
      .replace(/loosening adjustment/gi, 'real spending increase')
      .replace(/tightening adjustment/gi, 'real spending cut')
      .replace(/compound-return drag/g, 'volatility drag')
      .replace(/sequence risk/g, 'sequence-of-returns risk')
      .replace(/it is not taxed|is not taxed/g, 'taxes are not modeled')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\b1 paths\b/g, '1 path')
      .replace(/Cash-flow bucket/g, 'Income bucket')
      .replace(/\bNecessary spending\b/g, 'Essential spending')
      .replace(/\bannual Inflation adjustment\b/g, 'cumulative inflation')
      .replace(/Estimated annual dividends/g, 'Estimated annual distributions')
      .replace(/ETF dividends/g, 'ETF distributions')
      .replace(/\bdividends(?= fund spending)/g, 'Distributions')
      .replace(/\bprincipal fund\./g, 'holdings.')
      .replace(/same real U\.S\. CPI/g, 'same historical U.S. CPI')
      .replace(/centred/g, 'centered')
      .replace(/First 5 years CAGR|first 5 years CAGR/g, 'first-five-year CAGR')
      .replace(/30 paths total/g, 'One 30-year path')
      .replace(/Treasury maturitiesfund %/g, 'Spending covered by Treasury maturities (%)')
      .replace(/Cash flowdividendsfund %/g, 'Spending covered by distributions (%)')
      .replace(/Historicalmarket/g, 'Historical market')
      .replace(/Comparison baselineTotal assets/g, 'Comparison baseline · Total assets')
      .replace(/Representative pathYeardetails/g, 'Annual Details of Representative Paths')
      .replace(/Year details/g, 'Annual Details')
      .replace(/\b1 years\b/g, '1 year')
      .replace(/，|、/g, ', ')
      .replace(/；/g, '; ')
      .replace(/。/g, '. ')
      .replace(/：/g, ': ')
      .replace(/（/g, ' (')
      .replace(/）/g, ') ')
      .replace(/「|」/g, '"')
      .replace(/／/g, ' / ')
      .replace(/＋/g, '+')
      .replace(/＝/g, '=')
      .replace(/([^\s(])\(/g, '$1 (')
      .replace(/\)\s+([,.;])/g, ')$1')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const englishCache = new Map();
  const sortedEnglishFragments = [...englishFragments].sort((a, b) => b[0].length - a[0].length);
  function translateText(source) {
    if (currentLanguage !== 'en') return source;
    if (englishCache.has(source)) return englishCache.get(source);
    const normalized = source.replace(/\s+/g, ' ').trim();
    const prepared = reviewedPhrases.reduce(
      (text, [zh, en]) => text.replaceAll(zh, en),
      translateDynamicEnglish(normalized),
    );
    const translated = source.trim()
      ? source.match(/^\s*/)[0] +
        polishEnglish(completeEnglish[normalized] ?? translateEnglish(prepared)) +
        source.match(/\s*$/)[0]
      : source;
    // Year-by-year results can produce many distinct amounts across repeated runs.
    if (englishCache.size >= 10000) englishCache.clear();
    englishCache.set(source, translated);
    return translated;
  }
  function translateEnglish(source) {
    if (currentLanguage !== 'en') return source;
    if (englishText[source]) return englishText[source];
    const representativeAction = source.match(/^查看 (?:(方案) ([A-Z]) )?(P25|P50|P75) 年度明細$/);
    if (representativeAction)
      return `View ${representativeAction[1] ? `Plan ${representativeAction[2]} ` : ''}${representativeAction[3]} Year details`;
    const copyAction = source.match(/^套用 (P25|P50|P75) 至固定情境$/);
    if (copyAction) return `Apply ${copyAction[1]} to Fixed Scenario`;
    const detailTitle = source.match(/^第 (\d+) 年末水庫明細\s*$/);
    if (detailTitle) return `Year ${detailTitle[1]} year-end bucket details`;
    let translated = source.replace(/(\d+)\s*年梯/g, '$1-year Treasury ladder');
    translated = sortedEnglishFragments.reduce((text, [zh, en]) => text.replaceAll(zh, en), translated);
    translated = translated
      .replaceAll('的chance of', 'chance of ')
      .replaceAll('volatility會造成', 'Volatility causes ')
      .replaceAll('return的結果', 'return result')
      .replaceAll('return的result', 'return result')
      .replaceAll('因此', 'therefore ')
      .replaceAll('equalFixed', 'equal the fixed ')
      .replaceAll('意外支出', 'unexpected expenses')
      .replaceAll('的假設', 'assumptions')
      .replaceAll('的assumptions', 'assumptions')
      .replaceAll('護欄', 'guardrails')
      .replaceAll('Historical抽樣', 'Historical sampling')
      .replaceAll('區塊', 'block')
      .replaceAll('擾動', 'jitter')
      .replaceAll('配對方案比較', 'Paired plan comparison')
      .replaceAll('參與比較的方案使用相同的', 'Compared plans use the same ')
      .replaceAll('事件發生年份與事件金額', 'event years and amounts')
      .replaceAll('為基準', 'is the baseline')
      .replaceAll('要求所有方案使用相同', 'requires all plans to use the same ')
      .replaceAll('避免事件金額混入方案差異', 'to keep event amounts out of plan differences')
      .replaceAll(
        '這是此模型下的比較，不是完整的股債市場比較',
        'This is a comparison under this model, not a full stock/bond market comparison',
      )
      .replaceAll('與', 'and')
      .replaceAll('共用', 'share')
      .replaceAll('另抽各自的月頻殘差', 'sample their own monthly residuals')
      .replaceAll('國債梯', 'Treasury ladder')
      .replaceAll('採設定利率', 'use configured rates')
      .replaceAll('無隨機利率volatility', 'with no random rate volatility')
      .replaceAll('未模擬債券市價volatility', 'bond-price volatility is not modeled')
      .replaceAll('採Fixed設定', 'use fixed settings')
      .replaceAll('不含隨機Inflation', 'without random inflation')
      .replaceAll(
        '因此配置差距須在這些assumptions下解讀',
        'therefore interpret allocation differences under these assumptions',
      )
      .replaceAll('方案', 'Plan')
      .replaceAll('耗盡率', 'depletion rate')
      .replaceAll('相對', 'Relative to')
      .replaceAll('僅', 'Only ')
      .replaceAll('此方案', 'this plan')
      .replaceAll('零spending年', 'zero-spending years')
      .replaceAll('前 5 years', 'First 5 years')
      .replaceAll('十分位', 'deciles')
      .replaceAll('資產軌跡', 'asset trajectory')
      .replaceAll('這張圖是', 'This chart shows ')
      .replaceAll('paths件耗盡率', 'conditional depletion rate')
      .replaceAll('同一pathsmarketpaths', 'the same market path')
      .replaceAll('不同allocation', 'different allocations')
      .replaceAll('投資組合經驗', 'portfolio experiences')
      .replaceAll('橫軸只描述market', 'the x-axis describes only the market')
      .replaceAll('另外Current的抽樣', 'Also, current sampling')
      .replaceAll('每 paths共用同一個inflation rate', 'every path shares one inflation rate')
      .replaceAll('這張圖不能當成完整的失敗原因分析', 'this chart is not a complete failure-cause analysis')
      .replaceAll('每paths線都是', 'Each line is ')
      .replaceAll('該方案全部 Monte Carlo paths', 'all Monte Carlo paths for that plan')
      .replaceAll('各Year的', 'each year’s ')
      .replaceAll('破產後的Year計為', 'years after bankruptcy are counted as ')
      .replaceAll('匯出比較摘要 CSV', 'Export comparison summary CSV')
      .replaceAll('匯出 CAGR 十分位 CSV', 'Export CAGR deciles CSV');
    translated = translated
      .replaceAll('事件發生年份', 'event years')
      .replaceAll('事件amount', 'event amounts')
      .replaceAll('避免事件amount混入Plan差異', 'to keep event amounts out of Plan differences')
      .replaceAll(
        '這是此模型下的比較，不是完整的股債market比較',
        'This is a comparison under this model, not a full stock/bond market comparison',
      )
      .replaceAll('andCash-flow', 'and Cash-flow')
      .replaceAll('sharemarketpaths', 'share market paths')
      .replaceAll('Treasury梯', 'Treasury ladder')
      .replaceAll('Emergency reserveuse', 'Emergency reserve use')
      .replaceAll('None隨機利率volatility', 'with no random rate volatility')
      .replaceAll('Inflationuse fixed settings', 'Inflation uses fixed settings')
      .replaceAll('allocation差距須在這些assumptions下解讀', 'interpret allocation differences under these assumptions')
      .replaceAll('Only 此Plan耗盡', 'Only this plan depletes')
      .replaceAll('前 5 years CAGR deciles', 'First 5 years CAGR deciles')
      .replaceAll('Core ETF 前 5 years', 'Core ETF first 5 years')
      .replaceAll('paths件depletion rate', 'conditional depletion rate')
      .replaceAll(
        '前 5 yearsmarketreturn落在該deciles的paths，最後有多少比例Asset depletion',
        'paths whose first 5-year market returns fall in that decile, and the share that ultimately depletes assets',
      )
      .replaceAll('不是因果歸因', 'not causal attribution')
      .replaceAll('對different allocations', 'for different allocations')
      .replaceAll('每 pathsshare同一個inflation rate', 'every path shares the same inflation rate')
      .replaceAll('所以this chart', 'so this chart')
      .replaceAll('30 yearsTotal assets軌跡', '30-year total asset trajectory')
      .replaceAll(
        '該Plan全部 Monte Carlo paths在each year’s total-asset percentiles',
        'all Monte Carlo paths for that plan at each year’s total-asset percentiles',
      )
      .replaceAll('匯出 CAGR deciles CSV', 'Export CAGR deciles CSV')
      .replaceAll('來源', 'Source')
      .replaceAll('合成歷史路徑', 'synthetic historical paths')
      .replaceAll('非真實歷史回放', 'not an actual historical replay')
      .replaceAll('市場為', 'Market: ')
      .replaceAll('直接採其年度資料', 'use its annual data directly')
      .replaceAll('年度資料', 'annual data')
      .replaceAll('不重複來源年份', 'no repeated source years')
      .replaceAll('每段', 'each block')
      .replaceAll('年、不重複', '-year blocks, no repeated')
      .replaceAll(
        'ETF 使用保留年度複利的合成分層月路徑',
        'ETF uses synthetic layered monthly paths preserving annual compounding',
      )
      .replaceAll('非真實歷史月資料', 'not actual historical monthly data');
    translated = translated
      .replaceAll('marketreturn', 'market return')
      .replaceAll('event yearsandevent amounts', 'event years and event amounts')
      .replaceAll('避免event amounts混入Plan差異', 'to keep event amounts out of Plan differences')
      .replaceAll('耗盡', 'depletion')
      .replaceAll('前 5 years CAGR deciles', 'First 5 years CAGR deciles')
      .replaceAll('Core ETF 前 5 years', 'Core ETF first 5 years')
      .replaceAll(
        '前 5 yearsmarket return落在該deciles的paths，最後有多少比例Asset depletion',
        'paths whose first 5-year market returns fall in that decile, and the share that ultimately depletes assets',
      )
      .replaceAll(
        '前 5 yearsmarketreturn落在該deciles的paths，最後有多少比例Asset depletion',
        'paths whose first 5-year market returns fall in that decile, and the share that ultimately depletes assets',
      )
      .replaceAll(
        'the same market pathfor different allocations是不同的portfolio experiences',
        'the same market path for different allocations creates different portfolio experiences',
      )
      .replaceAll('30 yearsTotal assets軌跡', '30-year total asset trajectory')
      .replaceAll('因果歸因', 'causal attribution')
      .replaceAll('它衡量的是序列風險', 'It measures sequence risk')
      .replaceAll('合成Historicalpaths', 'synthetic historical paths')
      .replaceAll('非真實Historical回放', 'not an actual historical replay')
      .replaceAll('market為', 'Market: ')
      .replaceAll('directly採其Year資料', 'use its annual data directly')
      .replaceAll(
        'ETF 使用保留Year複利的合成分層月paths',
        'ETF uses synthetic layered monthly paths preserving annual compounding',
      )
      .replaceAll('非真實Historical月資料', 'not actual historical monthly data')
      .replaceAll('each block 3 -year blocks', 'each 3-year block')
      .replaceAll('no repeatedSource年份', 'no repeated source years')
      .replaceAll(
        'Inflationandreturn逐年配對取自同一筆Historical資料',
        'Inflation and returns are paired year by year from the same historical data',
      )
      .replaceAll(
        '非核心bucket仍使用所選情境的fixed return',
        'Non-core buckets use the selected scenario’s fixed returns',
      );
    translated = translated.replace(/約為流動資產的\s*([\d,.]+%)/g, 'about $1 of liquid assets');
    translated = translated.replace(/第\s*(\d+)\s*[–-]\s*(\d+)\s*年/g, 'Years $1–$2');
    translated = translated.replace(/第\s*(\d+)\s*年/g, 'Year $1');
    translated = translated.replace(/(\d+)\s*年/g, '$1 years');
    translated = translated.replace(/年will/g, 'will');
    translated = translated.replace(/年(?=will)/g, '');
    translated = translated.replace(/(\d+) yearswithin/g, 'Within $1 years, ');
    translated = translated.replace(/Treasury maturitiescash/g, 'Treasury maturity cash');
    translated = translated.replace(/Cash-flow ETFdividends/g, 'Cash-flow ETF dividends');
    translated = translated.replace(/Active buckets：/g, 'Active buckets: ');
    translated = translated.replace(/yields\.Settings/g, 'yields. Settings');
    translated = translated.replace(
      /首年為輸入值，不套Inflation/g,
      'First year uses the input value; inflation is not applied',
    );
    translated = translated.replace(/bear market下跌threshold/g, 'bear-market threshold');
    translated = translated.replace(
      /放寬觸發threshold（提領率 ＜）/g,
      'Loosening trigger threshold (withdrawal rate <)',
    );
    translated = translated.replace(
      /收緊觸發threshold（提領率 ＞）/g,
      'Tightening trigger threshold (withdrawal rate >)',
    );
    translated = translated.replace(/paths數/g, 'path count');
    translated = translated.replace(/確定事件：第幾年/g, 'Fixed event: year');
    translated = translated.replace(/比較基準(?=Total assets)/g, 'Comparison baseline ');
    translated = translated.replace(/方案Name/g, 'Plan name');
    translated = translated.replace(/首年spending/g, 'First-year spending');
    translated = translated.replace(
      /鎖定目前總額以比較allocation；解鎖可比較不同資產規模。/g,
      'Lock the current total to compare allocations; unlock to compare different asset sizes.',
    );
    translated = translated.replace(/不必合計 100%；/g, 'The total must not exceed 100%; ');
    translated = translated.replace(
      /edit比例只改future replenishment targets，不重配initial資產；可另外preview並applyinitialallocation。allocation為 \$0 的bucket不補水。edit後兩個比例Fixed保存，剩餘spending依withdrawal順序fund。/g,
      'editing percentages changes only future replenishment targets, not initial assets; preview and apply initial allocation separately. Buckets allocated $0 are not replenished. After editing, the two percentages are saved as fixed targets; remaining spending follows the withdrawal order.',
    );
    translated = translated.replace(/ETF 策略與withdrawalthreshold/g, 'Core ETF strategy and withdrawal threshold');
    translated = translated.replace(/Custom收益型／legacy/g, 'Custom income / legacy');
    translated = translated.replace(/PBP（可變配發）/g, 'PBP (variable distributions)');
    translated = translated.replace(/Legacy 基準dividends率/g, 'Legacy baseline dividend rate');
    translated = translated.replace(/bear market不賣核心threshold/g, 'Bear-market threshold for not selling Core ETF');
    translated = translated.replace(/Treasury梯明細/g, 'Treasury ladder details');
    translated = translated.replace(
      /縮梯至 1 years的年數（0＝關閉）/g,
      'Years to shorten the ladder to 1 year (0 = off)',
    );
    translated = translated.replace(/第\s*(\d+)\s*順位/g, 'Priority $1');
    translated = translated.replace(/非Planned spending策略/g, 'Unexpected-expense strategy');
    translated = translated.replace(/方案(Alpha|Beta|Gamma)/g, '$1 plan');
    translated = translated.replace(/／年/g, ' / year');
    translated = translated.replace(
      /鎖定Current總額以比較allocation；解鎖可比較不同資產規模。/g,
      'Lock the current total to compare allocations; unlock to compare different asset sizes.',
    );
    translated = translated.replace(
      /Shorten ladder to 1 years的年數（0＝關閉）/g,
      'Years to shorten the ladder to 1 year (0 = off)',
    );
    translated = translated.replace(
      /Current 3 rungs，replenishment range 3 years（farthest maturity year）；rangewithinwithoutFace value的Year會在正return年補買。amount會syncs to防守bucket，Remove one rung會減少initial資產。/g,
      'Currently 3 rungs; replenishment range is 3 years (farthest maturity year). Within the range, Years without face value are purchased in positive-return years. The amount syncs to the defense bucket; removing a rung reduces initial assets.',
    );
    translated = translated.replace(
      /spendingprincipalwithdrawal順序（dividends優先）/g,
      'Spending principal withdrawal order (dividends first)',
    );
    translated = translated.replace(/withdrawal策略/g, 'Withdrawal strategy');
    translated = translated.replace(
      /-15\.0%（低於此Core return時，不為adjustablespending出售Core ETF）/g,
      '-15.0% (below this Core return, do not sell Core ETF for adjustable spending)',
    );
    translated = translated.replace(/Annual inflation亦為共用/g, 'annual inflation is shared as well');
    translated = translated.replace(/market分布/g, 'market distribution');
    translated = translated.replace(/editbucket頁or其他方案/g, 'the bucket page or other plans');
    translated = translated.replace(/比較中：方案 A/g, 'Comparing: Plan A');
    if (translated === '第') translated = 'Year';
    translated = translated.replace(/^\s*第\s*$/, 'Year');
    translated = translated.replace(/、/g, ', ');
    translated = translated.replace(/(MC Plan [A-Z])Total assets/g, '$1 · Total assets');
    translated = translated
      .replaceAll('前 5 years CAGR deciles', 'First 5 years CAGR deciles')
      .replaceAll('Core ETF 前 5 years', 'Core ETF first 5 years')
      .replaceAll(
        '前 5 yearsmarket return落在該deciles的paths，最後有多少比例Asset depletion',
        'paths whose first 5-year market returns fall in that decile, and the share that ultimately depletes assets',
      )
      .replaceAll('30 yearsTotal assets軌跡', '30-year total asset trajectory')
      .replaceAll('Cash flowbucket', 'Cash-flow bucket')
      .replaceAll('含息總return', 'total return')
      .replaceAll('實際dividends', 'actual distributions')
      .replaceAll('到期principal', 'maturity principal')
      .replaceAll('年末防守cash', 'year-end defense cash')
      .replaceAll('（未動用部分按 MMF return累積）', '(unused amounts accrue the MMF return)')
      .replaceAll('緊急金區間', 'Emergency reserve range')
      .replaceAll('緊急金回收', 'Emergency reserve recovery')
      .replaceAll('保留target', 'retaining target')
      .replaceAll('toCore ETF', 'to Core ETF')
      .replaceAll('Treasury maturity cash補入', 'Treasury maturity cash added')
      .replaceAll('Core ETF 補入', 'Core ETF adds')
      .replaceAll('補足target', 'to complete the target')
      .replaceAll('rangewithin所有空期的TreasuryFace value', 'range, filling every empty Treasury face-value year')
      .replaceAll('每期target為預計spending的', 'each target covers')
      .replaceAll('新債Face value向上取整to', 'new Treasury face values round up to')
      .replaceAll('既有債券不adjustment', 'existing bonds are not adjusted')
      .replaceAll('將Cash-flow ETF 補to', 'tops up the Cash-flow ETF to')
      .replaceAll('使其dividends約覆蓋下annual spending的', 'so its dividends cover about')
      .replaceAll('cash／MMF return', 'cash / MMF return')
      .replaceAll('回收to Core ETF', 'recovery to Core ETF')
      .replaceAll('Core ETF 補Treasury ladder', 'Core ETF funds the Treasury ladder')
      .replaceAll('spendingfund', 'funds spending')
      .replaceAll('dividendsfundspending', 'dividends fund spending')
      .replaceAll('核心資產return', 'Core-asset return')
      .replaceAll('補Treasury ladder', 'funds the Treasury ladder')
      .replaceAll('補Cash-flow ETF', 'funds the Cash-flow ETF')
      .replaceAll('期初 ', 'Opening ')
      .replaceAll('流入 ', 'inflows ')
      .replaceAll('流出 ', 'outflows ')
      .replaceAll('Treasury ladderrange', 'Treasury ladder range')
      .replaceAll('TreasuryFace value', 'Treasury face value')
      .replaceAll('轉為防守cash', 'converts to defense cash')
      .replaceAll('不改變本bucket總額', 'does not change this bucket total');
    translated = translated
      .replace(
        /Core ETF 凍結\((?:報酬|return)\s*([+−-]?\d+(?:\.\d+)?%)\s*<\s*(?:門檻|threshold)\s*([+−-]?\d+(?:\.\d+)?%)\)/,
        'Core ETF frozen (return $1 < threshold $2)',
      )
      .replace(
        /為支付Necessary spending，被迫出售Core ETF\s*(\$[\d,]+)/,
        'Forced sale of Core ETF $1 to fund necessary spending',
      )
      .replace(
        /Core ETF adds\s*(\$[\d,]+)\s*至緊急金target\s*(\$[\d,]+)/,
        'Core ETF adds $1 to the emergency-reserve target of $2',
      )
      .replace(
        /Fixedpaths用Historicalmean配發率，MC抽取HistoricalYear配發率；非基金實際Historical回放。/,
        'Fixed paths use the historical mean distribution rate; MC samples historical annual distribution rates. This is not an actual fund historical replay.',
      )
      .replace(
        /PBP 配發\s*(\$[\d,]+)，其中(?:assumptions|假設) ROC\s*(\$[\d,]+)、其餘配發\s*(\$[\d,]+)；每單位實際配發\s*(\$[\d,]+)。ROC 已包含於配發，並非額外收益；不計稅。/,
        'PBP distribution $1, including assumed ROC $2 and other distributions $3; actual distribution per unit $4. ROC is included in the distribution, not additional income; it is not taxed.',
      )
      .replace(
        /PBP 配發\s*(\$[\d,]+)[，,]\s*其中assumptions ROC\s*(\$[\d,]+)[，,]\s*其餘配發\s*(\$[\d,]+)[；;]\s*每單位實際配發\s*(\$[\d,]+)。ROC 已包含於配發，並非額外收益[；;]不計稅。/,
        'PBP distribution $1, including assumed ROC $2 and other distributions $3; actual distribution per unit $4. ROC is included in the distribution, not additional income; it is not taxed.',
      )
      .replace('ROC Only 為情境分類，不計稅。', 'ROC is only a scenario classification and is not taxed.')
      .replace('配發中assumptions ROC', 'assumed ROC share of distributions');
    return translated;
  }
  // User-authored names are content, not translation keys. Only built-in labels are localized.
  function isBuiltInName(name) {
    return (
      DEFAULT.buckets.some(bucket => [bucket.name, bucket.name + '配息', bucket.name + '本金'].includes(name)) ||
      /^方案 [ABC]$/.test(name) ||
      ['總資產', 'MC 方案'].includes(name)
    );
  }
  function nameHtml(name) {
    return isBuiltInName(name) ? escapeHtml(name) : '<span translate="no">' + escapeHtml(name) + '</span>';
  }
  // root 只縮小掃描範圍（例如滑桿讀數）；翻譯規則與原文保存方式和整頁相同。
  function applyLanguage(root = null) {
    if (typeof document === 'undefined' || !document.body) return;
    root ??= document.body;
    document.documentElement.lang = currentLanguage === 'en' ? 'en' : 'zh-Hant';
    document.title = currentLanguage === 'en' ? 'Retirement Asset Planner' : '退休資產規劃器';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) continue;
      if (node.parentElement?.closest('#language-toggle, [translate="no"]')) continue;
      if (node.__zhText === undefined || node.nodeValue !== node.__localizedText) node.__zhText = node.nodeValue;
      const translated = translateText(node.__zhText);
      if (node.nodeValue !== translated) node.nodeValue = translated;
      node.__localizedText = translated;
    }
    // Scoped calls must include the root itself: an attribute mutation targets that element.
    const withinRoot = selector => [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    withinRoot('[aria-label], [title], [placeholder], [data-tooltip]').forEach(element => {
      for (const attribute of ['aria-label', 'title', 'placeholder', 'data-tooltip']) {
        if (!element.hasAttribute(attribute)) continue;
        element.__zhAttributes ??= {};
        element.__localizedAttributes ??= {};
        if (
          element.__zhAttributes[attribute] === undefined ||
          element.getAttribute(attribute) !== element.__localizedAttributes[attribute]
        )
          element.__zhAttributes[attribute] = element.getAttribute(attribute);
        const userLabel = element.dataset.userLabel;
        const protectLabel = userLabel && !isBuiltInName(userLabel);
        const source = element.__zhAttributes[attribute];
        const translated = protectLabel
          ? translateText(source.replaceAll(userLabel, '\uE000')).replaceAll('\uE000', userLabel)
          : translateText(source);
        if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
        element.__localizedAttributes[attribute] = translated;
      }
    });
    // Asset labels are editable input values, not text nodes, so the normal
    // translation walker cannot reach them. Keep the original value separate
    // so toggling languages never overwrites a user-edited label.
    withinRoot('input.assets, input.bucket-title, input[data-plan-name]').forEach(input => {
      input.__zhValue ??= input.value;
      if (input.__userEdited || (input.__localizedValue !== undefined && input.value !== input.__localizedValue))
        return;
      const knownLabel =
        (input.hasAttribute('data-plan-name') && /^方案 [ABC]$/.test(input.__zhValue)) ||
        DEFAULT.buckets.some(bucket => [bucket.assets, bucket.name].includes(input.__zhValue)) ||
        Object.values(DIVIDEND_ETF_PROFILES).some(profile => profile.label === input.__zhValue) ||
        input.__zhValue === 'BXM buy-write 策略指數';
      const translated = knownLabel ? translateText(input.__zhValue) : input.__zhValue;
      if (input.value !== translated) input.value = translated;
      input.__localizedValue = translated;
    });
    const languageToggle = $('#language-toggle');
    if (languageToggle && languageToggle.textContent !== (currentLanguage === 'en' ? '中文' : 'English'))
      languageToggle.textContent = currentLanguage === 'en' ? '中文' : 'English';
    const guideLanguageNote = $('#guide-language-note');
    if (guideLanguageNote) guideLanguageNote.hidden = currentLanguage !== 'en';
  }

  function initializeGuide() {
    const guide = window.RetirementGuide;
    if (!guide?.html || !Array.isArray(guide.sections)) return;
    $('#guide-content').innerHTML = guide.html;
    $('#guide-toc').innerHTML = guide.sections
      .map(
        section =>
          `<button type="button" data-guide-topic="${escapeHtml(section.id)}">${escapeHtml(section.title)}</button>`,
      )
      .join('');
  }

  function filterGuide(query = '') {
    const normalized = query.trim().toLocaleLowerCase('zh-Hant');
    let matches = 0;
    document.querySelectorAll('[data-guide-section]').forEach(section => {
      const visible = !normalized || section.textContent.toLocaleLowerCase('zh-Hant').includes(normalized);
      section.hidden = !visible;
      if (visible) matches += 1;
      const tocButton = $(`#guide-toc [data-guide-topic="${section.id}"]`);
      if (tocButton) tocButton.hidden = !visible;
    });
    $('#guide-empty').hidden = matches > 0;
  }

  function openGuide(topic = null, opener = document.activeElement) {
    const drawer = $('#guide-drawer');
    const backdrop = $('#guide-backdrop');
    if (!drawer || !backdrop) return;
    if (drawer.hidden) guideReturnFocus = opener instanceof HTMLElement ? opener : null;
    drawer.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('guide-open');
    localStorage.setItem('retirement-guide-seen', 'true');
    if (topic) {
      $('#guide-search').value = '';
      filterGuide();
      guideFocusFrame = requestAnimationFrame(() => {
        guideFocusFrame = null;
        document.getElementById(topic)?.scrollIntoView?.({ block: 'start' });
        drawer.focus({ preventScroll: true });
      });
    } else
      guideFocusFrame = requestAnimationFrame(() => {
        guideFocusFrame = null;
        $('#guide-search').focus();
      });
  }

  function closeGuide({ restoreFocus = true } = {}) {
    if (guideFocusFrame !== null) cancelAnimationFrame(guideFocusFrame);
    guideFocusFrame = null;
    $('#guide-drawer').hidden = true;
    $('#guide-backdrop').hidden = true;
    document.body.classList.remove('guide-open');
    if (restoreFocus) guideReturnFocus?.focus?.();
    guideReturnFocus = null;
  }

  function openGuideStep(button) {
    const view = button.dataset.guideView;
    closeGuide({ restoreFocus: false });
    setActiveView(view);
    if (view === 'plans-view') {
      const card = document.querySelector(`[data-plan-card="${selectedPlanId}"]`);
      if (card) card.open = true;
      const target =
        button.dataset.guideTarget === 'buckets'
          ? document.querySelector(`[data-plan-bucket][data-profile="${selectedPlanId}"]`)
          : document.querySelector(
              `[data-plan-field="${button.dataset.guideTarget}"][data-profile="${selectedPlanId}"]`,
            );
      target?.scrollIntoView?.({ block: 'center' });
      target?.focus?.();
    } else document.querySelector(`#${view}`)?.scrollIntoView?.({ block: 'start' });
  }
  // 切換情境要同時動四件事：模組變數、持久化狀態、頁籤樣式、歷史面板顯示。原本散在五個呼叫點
  // 各自處理，於是「重開後固定回到 base」這種漏掉其中一項的組合沒有人發現。集中成單一入口。
  function setScenario(next) {
    currentScenario = next;
    state.scenario = next;
    document.querySelectorAll('#scenario-tabs button').forEach(button => {
      button.classList.toggle('selected', button.dataset.scenario === next);
    });
    const panel = $('#historical-path');
    if (panel) panel.hidden = next !== 'historical';
  }
  // HTML 模板字串無法被 Prettier 折行，改以片段拼接，讓每一段都停在可閱讀的長度內（J1）。
  const html = (...parts) => parts.join('');
  function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  function load() {
    try {
      return hydrateState(JSON.parse(localStorage.getItem('retirement-reservoir')));
    } catch {
      return cloneDefault();
    }
  }
  function persist() {
    renderPlanningPeriod();
    renderPlanContext();
    localStorage.setItem('retirement-reservoir', JSON.stringify(state));
  }
  function total() {
    return state.buckets.reduce((sum, b) => sum + (+b.amount || 0), 0);
  }
  function annualIncome() {
    const b = state.buckets.find(b => b.id === 'income');
    const profile = DIVIDEND_ETF_PROFILES[state.incomeProfile?.kind];
    return b.amount * (profile ? profile.initialDps / profile.initialNav : b.yield / 100);
  }
  function downloadCsv(csv, filename) {
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function normalizeTreasury() {
    const defense = state.buckets.find(b => b.id === 'defense');
    if (!state.treasury?.rungs?.length)
      state.treasury = {
        length: 3,
        rungs: Array.from({ length: 3 }, (_, index) => ({
          maturityYear: index + 1,
          face: defense.amount / 3,
          coupon: 4,
        })),
      };
    state.treasury.length = treasuryLadderLength(state.treasury.rungs);
    const drawdownYears = clampTreasuryDrawdownYears(state.treasury.drawdownYears, 0);
    if (drawdownYears) state.treasury.drawdownYears = drawdownYears;
    else delete state.treasury.drawdownYears;
  }
  function setTreasuryLength(length, totalFace) {
    state.treasury = {
      length,
      drawdownYears: state.treasury.drawdownYears,
      rungs: Array.from({ length }, (_, index) => ({ maturityYear: index + 1, face: totalFace / length, coupon: 4 })),
    };
  }
  function syncDefenseAmount() {
    state.buckets.find(b => b.id === 'defense').amount = state.treasury.rungs.reduce(
      (sum, rung) => sum + (+rung.face || 0),
      0,
    );
  }
  function syncGrowthToLockedTotal(plan = state) {
    if (!Number.isFinite(plan.lockedInitialAssets)) return;
    const growth = plan.buckets.find(bucket => bucket.id === 'growth');
    const otherAssets = plan.buckets
      .filter(bucket => bucket.id !== 'growth')
      .reduce((sum, bucket) => sum + Math.max(0, Number(bucket.amount) || 0), 0);
    plan.lockedInitialAssets = Math.max(otherAssets, plan.lockedInitialAssets);
    growth.amount = plan.lockedInitialAssets - otherAssets;
  }
  function setBucketAmount(bucket, amount, plan = state) {
    // Materialize legacy defaults before changing which buckets have a balance.
    plan.coverageTargets = coverageTargets(plan);
    bucket.amount = Math.max(0, Number(amount) || 0);
    // Editing an amount preserves each rung's maturity and coupon in every editor.
    if (bucket.id === 'defense') {
      const rungs = plan.treasury.rungs;
      rungs.forEach(rung => (rung.face = bucket.amount / rungs.length));
    }
    syncGrowthToLockedTotal(plan);
  }
  function coverageTargetAmount(bucket, plan = state) {
    const coverage = coverageTargets(plan)[bucket.id] / 100;
    if (bucket.id === 'defense') return Math.ceil((plan.annualSpend * coverage * plan.treasury.length) / 1000) * 1000;
    const profile = DIVIDEND_ETF_PROFILES[plan.incomeProfile?.kind];
    const yieldRate = profile ? profile.initialDps / profile.initialNav : bucket.yield / 100;
    return yieldRate > 0 ? Math.round((plan.annualSpend * coverage) / yieldRate) : 0;
  }
  function allocationInputsSignature() {
    return JSON.stringify({
      annualSpend: state.annualSpend,
      targets: coverageTargets(state),
      treasury: state.treasury,
      incomeProfile: state.incomeProfile,
      buckets: state.buckets.map(({ id, amount, yield: yieldRate }) => ({ id, amount, yieldRate })),
    });
  }
  function allocationPreview(plan, host, apply) {
    const draft = JSON.parse(JSON.stringify(plan));
    // Freeze both targets before a zero starting amount changes the default active-bucket split.
    draft.coverageTargets = coverageTargets(plan);
    for (const id of ['defense', 'income']) {
      const bucket = draft.buckets.find(item => item.id === id);
      setBucketAmount(bucket, coverageTargetAmount(bucket, draft), draft);
    }
    host.hidden = false;
    host.innerHTML =
      '<p>依首年生活費與參考配發率估算，未來配息不保證達標。套用後的初始配置：</p>' +
      draft.buckets
        .map(
          bucket =>
            '<p>' +
            nameHtml(bucket.name) +
            '：' +
            money(plan.buckets.find(b => b.id === bucket.id).amount) +
            ' → <b>' +
            money(bucket.amount) +
            '</b></p>',
        )
        .join('') +
      '<p>總額：' +
      money(draft.buckets.reduce((sum, b) => sum + b.amount, 0)) +
      (draft.lockedInitialAssets > plan.lockedInitialAssets ? '（超過原鎖定總額，總額將提高）' : '') +
      '</p>' +
      '<button type="button" class="primary" data-apply-allocation>套用初始配置</button> <button type="button" class="ghost" data-cancel-allocation>取消</button>';
    host.querySelector('[data-apply-allocation]').onclick = () => {
      allocationTargetsApplied = true;
      state.allocationTargetsApplied = true;
      allocationSignature = allocationInputsSignature();
      apply(draft);
      host.hidden = true;
    };
    host.querySelector('[data-cancel-allocation]').onclick = () => {
      host.hidden = true;
    };
  }
  function selectedProfile() {
    const profile = state.monteCarloProfiles.find(item => item.id === selectedPlanId) || state.monteCarloProfiles[0];
    selectedPlanId = profile.id;
    return profile;
  }
  function fixedSinglePlan() {
    const plan = {
      ...monteCarloPlanSnapshot(selectedProfile().plan),
      planningPeriod: currentPlanningPeriod(),
    };
    for (const key of ['coreReturns', 'inflationRates', 'emergencyEvents', 'safeRates', 'bxmMonthlyPath']) {
      delete plan[key];
      if (state[key]) plan[key] = JSON.parse(JSON.stringify(state[key]));
    }
    // Income ETF residuals are calibrated independently. A VYM representative path must not be
    // reinterpreted as SCHD or PBP after the user switches the shared plan selector.
    delete plan.incomeMonthlyPath;
    if (state.incomeMonthlyPath && state.incomeMonthlyPath.kind === plan.incomeProfile?.kind)
      plan.incomeMonthlyPath = JSON.parse(JSON.stringify(state.incomeMonthlyPath));
    plan.coreReturns ??= {};
    plan.emergencyEvents ??= {};
    return plan;
  }
  function renderSharedPlanSelector() {
    $('.shared-plan-selector').hidden = currentView === 'scenario-comparison-view';
    const selected = selectedProfile();
    $('#shared-plan-mode').value = state.monteCarloComparisonEnabled ? 'comparison' : 'single';
    $('#single-plan-selector').hidden = state.monteCarloComparisonEnabled;
    $('#single-plan-options').innerHTML = state.monteCarloProfiles
      .map(
        profile =>
          `<label><input type="radio" name="selected-plan" value="${profile.id}" ${profile.id === selected.id ? 'checked' : ''}/>${nameHtml(profile.name)}</label>`,
      )
      .join('');
    $('#shared-plan-summary').innerHTML =
      (state.monteCarloComparisonEnabled
        ? '<span>參與比較</span> ' +
          state.monteCarloProfiles
            .filter(profile => profile.enabled !== false)
            .map(profile => nameHtml(profile.name))
            .join(' / ')
        : '<span>目前方案</span> ' + nameHtml(selected.name)) + ' · <span>固定情境與 MC 共用</span>';
    $('#single-plan-options')
      .querySelectorAll('input')
      .forEach(input => {
        input.onchange = () => {
          selectedPlanId = input.value;
          localStorage.setItem('retirement-selected-plan', selectedPlanId);
          invalidateMonteCarlo();
          renderMonteCarloProfile();
          renderMonteCarlo();
          renderScenario();
        };
      });
  }
  function renderPlanContext() {
    const node = $('#plan-context-summary');
    if (!node) return;
    const planContext = node.closest('.plan-context');
    if (planContext) planContext.hidden = true;
    $('#plan-rule-summary').hidden = true;
    node.textContent =
      '我的計畫 · 總資產 ' +
      money(total()) +
      ' · 每年生活費 ' +
      money(state.annualSpend) +
      ' · 必要生活費 ' +
      money(state.spendingFloor.annualAmount) +
      ` · ${currentPlanningPeriod().currentAge} → ${currentPlanningPeriod().targetAge} 歲（${currentHorizonYears()} 年）`;
    $('#main-plan-editor-label').textContent = '編輯我的計畫 · 配置、收入與提款規則';
    const targets = coverageTargets(state);
    $('#plan-rule-summary').textContent =
      `目前補水目標：國債到期 ${targets.defense}%、配息 ${targets.income}% 的年度生活費；國債 ${state.treasury.length} 年梯。生活費依護欄調整，詳細門檻與提款順序可在主計畫展開查看。`;
    const settings = state.monteCarlo;
    $('#mc-assumptions-summary').textContent =
      (settings.samplingMode === 'historical'
        ? '歷史抽樣 · ' +
          HISTORICAL_MARKETS[settings.historicalMarket ?? 'sp500'].label +
          ' · 區塊 ' +
          (settings.historicalBlockLength ?? 3) +
          ' 年 · 擾動 ±' +
          (settings.historicalJitter ?? 0) +
          '%'
        : '參數式 · 平均 ' +
          percent(settings.mean) +
          ' · 波動 ' +
          percent(settings.volatility) +
          ' · 通膨 ' +
          { fixed: '固定', ar1: '隨機', us1966: '1966 年壓力路徑', us1973: '1973 年壓力路徑' }[
            settings.inflationModel ?? 'fixed'
          ]) +
      ' · ' +
      settings.paths.toLocaleString() +
      ' 條 · 種子 ' +
      settings.seed +
      '（展開可查看及修改全部假設）';
  }
  function renderPlanningPeriod() {
    const currentInput = $('#planning-current-age');
    const targetInput = $('#planning-target-age');
    if (!currentInput || !targetInput) return;
    const period = currentPlanningPeriod();
    currentInput.value = period.currentAge;
    currentInput.min = MIN_CURRENT_AGE;
    currentInput.max = period.targetAge - 1;
    targetInput.value = period.targetAge;
    targetInput.min = period.currentAge + 1;
    targetInput.max = Math.min(MAX_TARGET_AGE, period.currentAge + 60);
    $('#planning-period-summary').textContent =
      `從 ${period.currentAge} 歲規劃到 ${period.targetAge} 歲，共 ${period.years} 年；固定情境、歷史回放與多路徑模擬共用。`;
  }

  function renderInputs() {
    $('#inflation').value = state.inflation;
    $('#bear-threshold').value = state.bearThreshold;
    $('#guardrail-lower').value = state.guardrails.lower;
    $('#guardrail-upper').value = state.guardrails.upper;
    $('#guardrail-raise').value = state.guardrails.raise;
    $('#guardrail-cut').value = state.guardrails.cut;
    ['inflation', 'bear-threshold'].forEach(
      id =>
        ($('#' + id).oninput = e => {
          const key = {
            inflation: 'inflation',
            'bear-threshold': 'bearThreshold',
          }[id];
          // 這組數值欄位共用 simulate.js 的界線表，不在這裡逐一 if：漏掉一個就是下一個負通膨。
          state[key] = clampSetting(key, e.target.value);
          renderAll();
        }),
    );
    // 夾住的值要寫回欄位，否則畫面留著 -100 而模型在用 0。只能在失焦時做——
    // 放在 oninput 會讓使用者打「-15」在第一個字元就被改成 0。
    ['inflation', 'bear-threshold'].forEach(
      id =>
        ($('#' + id).onblur = e => {
          const key = {
            inflation: 'inflation',
            'bear-threshold': 'bearThreshold',
          }[id];
          e.target.value = state[key];
        }),
    );
    ['guardrail-lower', 'guardrail-upper', 'guardrail-raise', 'guardrail-cut'].forEach(
      id =>
        ($('#' + id).oninput = e => {
          const key = {
            'guardrail-lower': 'lower',
            'guardrail-upper': 'upper',
            'guardrail-raise': 'raise',
            'guardrail-cut': 'cut',
          }[id];
          const next = { ...state.guardrails, [key]: +e.target.value || 0 };
          // 區間不合法時顯示錯誤但不提交：讓使用者看見自己打的值，模擬仍跑上一組合法設定。
          const error = guardrailError(next);
          showGuardrailError(error);
          if (error) return;
          state.guardrails = next;
          renderAll();
        }),
    );
    showGuardrailError('');
    // 市場選單由 HISTORICAL_MARKETS 生成。原本寫死在 index.html，而說明文字是
    // market === 'sp500' ? A : B 的三元式——加第三個市場時，台股會靜默拿到日本的說明。
    $('#historical-market').innerHTML = Object.entries(HISTORICAL_MARKETS)
      .map(([id, { label }]) => `<option value="${id}">${label}</option>`)
      .join('');
    $('#monte-carlo-historical-market').innerHTML = Object.entries(HISTORICAL_MARKETS)
      .map(([id, { label }]) => `<option value="${id}">${label}</option>`)
      .join('');
    if (state.historicalReplay) {
      $('#historical-market').value = state.historicalReplay.market;
      $('#historical-direction').value = state.historicalReplay.direction ?? 'forward';
    }
    const renderHistoricalPeriods = () => {
      const horizonYears = currentHorizonYears();
      const market = $('#historical-market').value;
      const { returns, events } = HISTORICAL_MARKETS[market];
      const years = Object.keys(returns).map(Number);
      const firstStart = Math.min(...years);
      const lastStart = Math.max(...years) - horizonYears + 1;
      const reverse = $('#historical-direction').value === 'reverse';
      $('#apply-historical-path').textContent = `套用 ${horizonYears} 年歷史路徑`;
      if (lastStart < firstStart) {
        $('#historical-start').innerHTML = `<option>資料僅 ${years.length} 年</option>`;
        $('#historical-start').disabled = true;
        $('#apply-historical-path').disabled = true;
        $('#historical-path-note').textContent =
          `${HISTORICAL_MARKETS[market].label}只有 ${years.length} 年完整資料，無法涵蓋 ${horizonYears} 年規劃期；請縮短年限或改選其他市場。`;
        return;
      }
      $('#historical-start').disabled = false;
      $('#apply-historical-path').disabled = false;
      const starts = reverse
        ? Array.from({ length: lastStart - firstStart + 1 }, (_, index) => Math.max(...years) - index)
        : Array.from({ length: lastStart - firstStart + 1 }, (_, index) => firstStart + index);
      $('#historical-start').innerHTML = starts
        .map(start => {
          const end = start + (reverse ? -(horizonYears - 1) : horizonYears - 1);
          // 序列風險的重點不是「有沒有碰到危機」，而是「危機落在退休第幾年」——第 3 年遇上
          // 次貸和第 25 年遇上，對同一份計畫是兩件完全不同的事。把落點直接寫進選項，才能
          // 一眼挑出要看的那一條路徑，而不必先套用再回頭數格子。
          const landings = Object.entries(events)
            .filter(([year]) => +year >= Math.min(start, end) && +year <= Math.max(start, end))
            .map(([year, label]) => `${label} 第 ${reverse ? start - +year + 1 : +year - start + 1} 年`)
            .join(' · ');
          // 預設選最後一個窗口：它是唯一同時涵蓋 2000、2008 與 2022 的區間，也是最多人想先看的。
          const selected = start === (reverse ? Math.max(...years) : lastStart) ? ' selected' : '';
          return `<option value="${start}"${selected}>${start}${reverse ? ' → ' : '–'}${end}${landings ? `　│　${landings}` : ''}</option>`;
        })
        .join('');
      $('#historical-path-note').textContent = reverse
        ? `${HISTORICAL_MARKETS[market].note}倒放會同時反轉報酬、CPI 與（美國）利率的年度順序；這是合成序列風險壓力測試，不是真實歷史。共 ${horizonYears} 年路徑。`
        : `${HISTORICAL_MARKETS[market].note}共 ${horizonYears} 年路徑。`;
    };
    renderHistoricalPeriods();
    if (state.historicalReplay) $('#historical-start').value = state.historicalReplay.startYear;
    // 重新載入後頁籤與面板要反映已儲存的情境，而不是 HTML 裡寫死的「基準」。
    setScenario(currentScenario);
    $('#historical-market').onchange = renderHistoricalPeriods;
    $('#historical-direction').onchange = renderHistoricalPeriods;
    const rerenderProjection = () => {
      expandedYears.clear();
      projectionStart = 0;
      document.querySelectorAll('#scenario-tabs button').forEach(button => {
        button.classList.toggle('selected', button.dataset.scenario === currentScenario);
      });
      renderAll();
    };
    $('#apply-historical-path').onclick = () => {
      // 不完整的窗口會回 null。目前兩個序列的年份範圍相同所以選不到，但把 null 寫進
      // state.coreReturns 會讓下一次渲染整頁炸掉，不值得賭下一個市場也剛好對齊。
      const reverse = $('#historical-direction').value === 'reverse';
      const horizonYears = currentHorizonYears();
      const path = historicalReturnPath(
        $('#historical-market').value,
        +$('#historical-start').value,
        horizonYears,
        reverse,
      );
      if (!path) return;
      const market = $('#historical-market').value;
      // 報酬與 CPI 同源同窗口，缺一不可；取不到 CPI 時寧可整個不套用，也不留下半套回放。
      const inflationRates = historicalInflationPath(market, +$('#historical-start').value, horizonYears, reverse);
      if (!inflationRates) return;
      delete state.bxmMonthlyPath;
      delete state.incomeMonthlyPath;
      delete state.historicalSampleSources;
      delete state.representativePathSource;
      state.coreReturns = path;
      state.inflationRates = inflationRates;
      // 美國回放一併帶入同期 GS5 利率；其他市場沒有對應資料，維持固定利率。
      const safeRates = historicalSafeRates(market, +$('#historical-start').value, horizonYears, reverse);
      if (safeRates) state.safeRates = safeRates;
      else delete state.safeRates;
      // 報酬與 CPI 被歷史值取代之後，那條 Monte Carlo 路徑已經不存在了；它的隨機事件不該
      // 繼續掛在一條標示為「歷史回放」的路徑上。
      dropPathSourcedEvents();
      state.historicalReplay = {
        market,
        startYear: +$('#historical-start').value,
        ...(reverse ? { direction: 'reverse' } : {}),
      };
      setScenario('historical');
      rerenderProjection();
    };
    renderWithdrawalOrders();
    renderMonteCarloInputs();
  }
  function eventPolicyOrderForDisplay(policy) {
    if (policy === 'alpha') return ['emergency'];
    if (policy === 'gamma') return ['emergency', 'defense', 'growth'];
    if (policy === 'beta') return ['emergency', 'defense', '正報酬：核心 ETF', '非正報酬：現金流 ETF 本金'];
    return state.withdrawalOrders.event;
  }
  function renderWithdrawalOrders() {
    for (const [kind, rootId] of [
      ['planned', 'planned-withdrawal-order'],
      ['event', 'event-withdrawal-order'],
    ]) {
      const policyDrivenEvent = kind === 'event' && state.eventWithdrawalPolicy !== 'custom';
      const order = policyDrivenEvent
        ? eventPolicyOrderForDisplay(state.eventWithdrawalPolicy)
        : state.withdrawalOrders[kind];
      const root = $('#' + rootId);
      root.innerHTML = order
        .map(
          (id, index) =>
            `<li><span>${withdrawalLabels[id] || id}</span>${
              policyDrivenEvent
                ? ''
                : `<button data-order-kind="${kind}" data-order-index="${index}" data-direction="-1" ${index ? '' : 'disabled'}>↑</button><button data-order-kind="${kind}" data-order-index="${index}" data-direction="1" ${index + 1 < order.length ? '' : 'disabled'}>↓</button>`
            }</li>`,
        )
        .join('');
    }
    $('#event-policy-description').textContent = eventPolicyDescriptions[state.eventWithdrawalPolicy];
    document.querySelectorAll('[data-event-policy]').forEach(button => {
      button.classList.toggle('selected', button.dataset.eventPolicy === state.eventWithdrawalPolicy);
      button.onclick = () => {
        state.eventWithdrawalPolicy = button.dataset.eventPolicy;
        renderWithdrawalOrders();
        renderAll();
      };
    });
    document.querySelectorAll('[data-order-kind]').forEach(button => {
      button.onclick = () => {
        if (button.dataset.orderKind === 'event') state.eventWithdrawalPolicy = 'custom';
        const order = state.withdrawalOrders[button.dataset.orderKind];
        const index = +button.dataset.orderIndex;
        const next = index + +button.dataset.direction;
        [order[index], order[next]] = [order[next], order[index]];
        renderWithdrawalOrders();
        renderAll();
      };
    });
  }
  function setActiveView(viewId) {
    cancelProfileCopy();
    currentView = viewId;
    renderPlanContext();
    $('#summary').hidden = true;
    renderSharedPlanSelector();
    $('#main-plan-editor').hidden = true;
    document.querySelectorAll('.app-view').forEach(view => {
      view.hidden = view.id !== viewId;
    });
    document.querySelectorAll('[data-view]').forEach(button => {
      const active = button.dataset.view === viewId;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (viewId === 'monte-carlo-view' || viewId === 'plans-view') {
      renderMonteCarloInputs();
      renderMonteCarloProfile();
    }
    if (viewId === 'planner-view') renderScenario();
    if (viewId === 'scenario-comparison-view') renderScenarioComparison();
    if (viewId === 'monte-carlo-view' && monteCarloResult && !monteCarloResult.profiles)
      renderMonteCarloAssetFan(monteCarloResult);
    applyLanguage();
  }
  function showGuardrailError(message) {
    const node = $('#guardrail-error');
    node.textContent = message;
    node.hidden = !message;
  }
  function renderBuckets() {
    const warning = $('#coverage-warning');
    warning.textContent = coverageWarning(state);
    warning.hidden = !warning.textContent;
    $('#allocation-preview').hidden = true;
    const root = $('#buckets');
    root.innerHTML = '';
    const template = $('#bucket-template');
    const sum = total();
    state.buckets.forEach(b => {
      const row = template.content.cloneNode(true);
      const tr = row.querySelector('tr');
      tr.querySelector('i').style.background = bucketColor(b);
      const title = tr.querySelector('.bucket-title');
      title.value = b.name;
      title.oninput = () => {
        title.__userEdited = true;
      };
      title.onchange = () => {
        b.name = title.value.trim() || b.name;
        title.__zhValue = b.name;
        title.__userEdited = true;
        renderAll();
      };
      tr.querySelector('.bucket-name small').textContent = b.short;
      if (b.id === 'defense' || b.id === 'income') {
        const label = document.createElement('label');
        label.className = 'coverage-target';
        label.append('年度生活費支應目標 ');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '100';
        input.step = '1';
        input.value = coverageTargets(state)[b.id];
        input.setAttribute('aria-label', `${b.name}年度生活費支應目標百分比`);
        input.dataset.userLabel = b.name;
        input.title = '只調整未來補水目標，不移動初始本金；兩個目標合計不能超過 100%。';
        input.onchange = () => {
          const targets = coverageTargets(state);
          const number = input.value === '' ? NaN : Number(input.value);
          state.coverageTargets = {
            ...targets,
            [b.id]: Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : targets[b.id],
          };
          allocationTargetsApplied = false;
          state.allocationTargetsApplied = false;
          $('#allocation-preview').hidden = true;
          renderAll();
        };
        const calculated = document.createElement('small');
        const targetAmount = coverageTargetAmount(b);
        const applied = allocationTargetsApplied;
        calculated.className = 'coverage-target-note';
        calculated.textContent = `參考初始金額 ${money(targetAmount)}（${applied ? '已套用' : '尚未套用'}）`;
        const targetLabel = document.createElement('span');
        targetLabel.textContent = '年度生活費支應目標';
        label.replaceChildren(targetLabel, input, '%', calculated);
        tr.querySelector('.bucket-name').append(label);
      }
      const amount = tr.querySelector('.amount');
      amount.value = b.amount;
      if (b.id === 'growth' && Number.isFinite(state.lockedInitialAssets)) {
        amount.disabled = true;
        amount.title = '起始流動資產已鎖定；核心增值 ETF 會自動補足其餘金額。';
      }
      const commitAmount = () => {
        allocationTargetsApplied = false;
        state.allocationTargetsApplied = false;
        setBucketAmount(b, amount.value);
        syncGrowthToLockedTotal();
        renderAll();
      };
      amount.onchange = commitAmount;
      amount.onkeydown = event => {
        if (event.key === 'Enter') amount.blur();
      };
      const yieldInput = tr.querySelector('.yield');
      if (b.id === 'income') {
        yieldInput.value = b.yield;
        yieldInput.onchange = () => {
          b.yield = +yieldInput.value || 0;
          renderAll();
        };
        yieldInput.onkeydown = event => {
          if (event.key === 'Enter') yieldInput.blur();
        };
        const profile = document.createElement('select');
        profile.className = 'income-profile';
        profile.setAttribute('aria-label', '現金流 ETF profile');
        profile.innerHTML =
          '<option value="legacy">舊版／自訂</option><option value="vym">VYM（季度股利）</option><option value="schd">SCHD（季度股利）</option><option value="pbp">PBP（可變配發／ROC 情境）</option>';
        profile.value = state.incomeProfile?.kind ?? 'legacy';
        profile.onchange = () => {
          if (profile.value === 'legacy') delete state.incomeProfile;
          else {
            // VYM↔SCHD 切換時保留配息情境，只換標的。
            const { dividendScenario } = state.incomeProfile ?? {};
            state.incomeProfile = {
              kind: profile.value,
              ...(profile.value === 'pbp' ? { rocPercent: 0 } : dividendScenario ? { dividendScenario } : {}),
            };
            b.assets = DIVIDEND_ETF_PROFILES[profile.value].label;
          }
          renderAll();
        };
        if (DIVIDEND_ETF_PROFILES[state.incomeProfile?.kind]) {
          const modeledYield = DIVIDEND_ETF_PROFILES[state.incomeProfile.kind].targetYield * 100;
          yieldInput.value = modeledYield.toFixed(2);
          yieldInput.disabled = true;
          yieldInput.title = '模型的參考配發率；實際配發依持倉與模型計算，legacy 輸入不適用。';
        }
        tr.querySelector('.assets').closest('td').append(profile);
        if (state.incomeProfile?.kind === 'pbp') {
          const label = document.createElement('label');
          label.textContent = '配發中假設 ROC 比例 %';
          const roc = document.createElement('input');
          Object.assign(roc, {
            type: 'number',
            min: '0',
            max: '100',
            step: '1',
            value: state.incomeProfile.rocPercent ?? 0,
          });
          roc.className = 'pbp-roc';
          roc.setAttribute('aria-label', 'PBP 假設 ROC 比例');
          roc.onchange = () => {
            state.incomeProfile.rocPercent = Math.min(100, Math.max(0, Number(roc.value) || 0));
            renderAll();
          };
          label.append(roc);
          const note = document.createElement('small');
          note.textContent =
            'PBP 配發從淨值扣除；ROC 僅為情境分類、不計稅。固定路徑用歷史平均配發率，MC 抽取歷史年度配發率；非基金實際歷史回放。';
          tr.querySelector('.assets').closest('td').append(label, note);
        }
        if (state.incomeProfile?.kind === 'vym' || state.incomeProfile?.kind === 'schd') {
          const scenario = document.createElement('select');
          scenario.className = 'dividend-scenario';
          scenario.setAttribute('aria-label', '現金流 ETF 配息情境');
          scenario.innerHTML = Object.entries(DIVIDEND_SCENARIOS)
            .map(([id, { label }]) => `<option value="${id}">${escapeHtml(label)}</option>`)
            .join('');
          scenario.value = state.incomeProfile.dividendScenario ?? 'base';
          scenario.title = dividendScenarioOf(state).description;
          scenario.onchange = () => {
            state.incomeProfile = { kind: state.incomeProfile.kind };
            if (scenario.value !== 'base') state.incomeProfile.dividendScenario = scenario.value;
            renderAll();
          };
          const note = document.createElement('small');
          note.className = 'dividend-scenario-note';
          note.textContent = dividendScenarioOf(state).description;
          tr.querySelector('.assets').closest('td').append(scenario, note);
        }
      } else {
        yieldInput.closest('.yield-cell').textContent = '—';
      }
      tr.querySelector('.ratio').textContent = sum ? percent((b.amount / sum) * 100) : '—';
      const assets = tr.querySelector('.assets');
      if (b.id === 'growth') {
        const profile = document.createElement('select');
        profile.className = 'growth-profile';
        profile.setAttribute('aria-label', '核心增值 ETF 策略');
        profile.innerHTML = '<option value="market">純大盤</option><option value="bxm">大盤 Covered Call／BXM</option>';
        profile.value = state.growthProfile?.kind ?? 'market';
        profile.onchange = () => {
          if (profile.value === 'bxm') {
            state.growthProfile = { kind: 'bxm' };
            b.assets = 'BXM buy-write 策略指數';
          } else {
            delete state.growthProfile;
            b.assets = DEFAULT.buckets.find(bucket => bucket.id === 'growth').assets;
          }
          renderAll();
        };
        assets.closest('td').append(profile);
      }
      assets.value = b.assets;
      assets.oninput = () => {
        assets.__userEdited = true;
      };
      assets.onchange = () => {
        b.assets = assets.value;
        assets.__zhValue = assets.value;
        assets.__userEdited = true;
        persist();
      };
      tr.querySelector('.purpose').textContent = b.purpose;
      root.append(row);
    });
    const activeCount = state.buckets.filter(b => (+b.amount || 0) > 0).length;
    const bucketCount = state.buckets.length;
    $('#allocation-status').textContent = `${money(sum)} 總資產 · ${activeCount}/${bucketCount} 座水庫啟用`;
    $('#allocation-status').className = activeCount === bucketCount ? 'pill good' : 'pill';
    $('#bxm-model-note').hidden = state.growthProfile?.kind !== 'bxm';
  }
  function renderLadderRow(rung, index) {
    const faceInput = html(
      `<input class="rung-face" data-index="${index}" type="number"`,
      ` min="0" step="1000" value="${rung.face}" />`,
    );
    const couponInput = html(
      `<input class="rung-coupon" data-index="${index}" type="number"`,
      ` min="0" step="0.1" value="${rung.coupon}" />`,
    );
    return html(
      `<tr><td>第 ${rung.maturityYear} 年</td>`,
      `<td><div class="money-input"><span>$</span>${faceInput}</div></td>`,
      `<td><div class="input-suffix compact">${couponInput}<span>%</span></div></td>`,
      `<td>${money(rung.face * (1 + rung.coupon / 100))}</td></tr>`,
    );
  }
  function renderTreasury() {
    const root = $('#ladder-rungs');
    const totalFace = state.treasury.rungs.reduce((sum, rung) => sum + (+rung.face || 0), 0);
    $('#ladder-total').textContent = `${money(totalFace)} 面額`;
    // MC may create custom ladder lengths; replay must keep them selectable.
    $('#ladder-length').innerHTML = Array.from(
      { length: currentHorizonYears() },
      (_, i) => `<option value="${i + 1}">${i + 1} 年</option>`,
    ).join('');
    $('#ladder-length').value = state.treasury.length;
    $('#ladder-length').onchange = event => {
      setTreasuryLength(+event.target.value, totalFace);
      syncDefenseAmount();
      syncGrowthToLockedTotal();
      renderAll();
    };
    const drawdownEnabled = $('#ladder-drawdown-enabled');
    const drawdownConfig = $('#ladder-drawdown-config');
    const drawdownYears = $('#ladder-drawdown-years');
    drawdownEnabled.checked = state.treasury.drawdownYears > 0;
    drawdownConfig.hidden = !drawdownEnabled.checked;
    drawdownYears.value = state.treasury.drawdownYears || 10;
    drawdownEnabled.onchange = () => {
      state.treasury.drawdownYears = drawdownEnabled.checked
        ? clampTreasuryDrawdownYears(drawdownYears.value, 10) || 10
        : 0;
      renderAll();
    };
    drawdownYears.onchange = () => {
      state.treasury.drawdownYears = clampTreasuryDrawdownYears(drawdownYears.value, 10) || 1;
      drawdownYears.value = state.treasury.drawdownYears;
      renderAll();
    };
    root.innerHTML = state.treasury.rungs.map(renderLadderRow).join('');
    root.querySelectorAll('.rung-face, .rung-coupon').forEach(input => {
      input.onchange = () => {
        const rung = state.treasury.rungs[+input.dataset.index];
        if (input.classList.contains('rung-face')) rung.face = +input.value || 0;
        else rung.coupon = +input.value || 0;
        syncDefenseAmount();
        syncGrowthToLockedTotal();
        renderAll();
      };
      input.onkeydown = event => {
        if (event.key === 'Enter') input.blur();
      };
    });
  }
  // 「合計」不能把不重疊的來源相加。計劃書裁示一建議用「A 筆到第 N−1 年、B 筆第 N 年起打折」
  // 表達給付調降，那兩筆永遠不會同時發放：實測顯示 $122,400／年，而實際是第 1–12 年 $72,000、
  // 第 13 年起 $50,400——那個合計在任何一年都不會發生。改成逐年結算再把金額相同的年份併成一段。
  //
  // 水庫頁與 Monte Carlo 快照摘要共用這一個函式。兩處原本各算各的，於是只有水庫頁補上了起領年
  // （註解寫著「橋樑期的計畫第 1 年還沒開始領」），快照那行沒有——同一個問題在隔壁分頁重新出現。
  // 收成一個函式之後，兩邊的文案在結構上就不可能再分歧。
  function renderIncomeRow(source, index) {
    const cell = (cls, value, extra) =>
      `<input class="${cls}" data-index="${index}" type="number" ${extra} value="${value}" />`;
    const options = [
      ['full', '隨 CPI'],
      ['nominal', '名目固定'],
    ]
      .map(([id, label]) => `<option value="${id}" ${source.indexation === id ? 'selected' : ''}>${label}</option>`)
      .join('');
    return html(
      '<tr>',
      `<td><input class="income-label" data-index="${index}" type="text" value="${escapeHtml(source.label)}" placeholder="Social Security" /></td>`,
      `<td><div class="money-input"><span>$</span>${cell('income-amount', source.amount, 'min="0" step="1000"')}</div></td>`,
      `<td>${cell('income-start', source.startYear, `min="1" max="${currentHorizonYears()}" step="1"`)}</td>`,
      // 空白 = 終身給付。兼職與定期年金才需要結束年，而終身給付是多數情況，不該逼使用者填 30。
      `<td>${cell('income-end', source.endYear ?? '', `min="1" max="${currentHorizonYears()}" step="1" placeholder="終身"`)}</td>`,
      `<td><select class="income-indexation" data-index="${index}">${options}</select></td>`,
      `<td><button class="page-button income-remove" data-index="${index}" type="button">刪除</button></td>`,
      '</tr>',
    );
  }
  function renderIncomeSources() {
    const root = $('#income-sources');
    // 標「第 1 年幣值」而不是「第 1 年」：橋樑期的計畫第 1 年根本還沒開始領，寫「第 1 年 $0」
    // 會讓人以為剛輸入的金額沒吃進去。金額與起領年由 incomeScheduleLabel 一起給。
    $('#income-total').textContent = incomeScheduleLabel(state.guaranteedIncome) || '未設定（停用）';
    root.innerHTML = state.guaranteedIncome.length
      ? state.guaranteedIncome.map(renderIncomeRow).join('')
      : '<tr><td colspan="6" class="income-empty">尚未設定任何保證性收入；四個水庫需要獨力支應全部生活費。</td></tr>';
    root.querySelectorAll('.income-remove').forEach(button => {
      button.onclick = () => {
        state.guaranteedIncome.splice(+button.dataset.index, 1);
        renderAll();
        renderIncomeSources();
      };
    });
    root
      .querySelectorAll('.income-label, .income-amount, .income-start, .income-end, .income-indexation')
      .forEach(input => {
        input.onchange = () => {
          const source = state.guaranteedIncome[+input.dataset.index];
          // 界線與遷移共用同一張表（K2）：載入路徑夾過的值，即時輸入不能放行。
          if (input.classList.contains('income-label')) source.label = input.value;
          else if (input.classList.contains('income-indexation')) source.indexation = input.value;
          else if (input.classList.contains('income-amount'))
            source.amount = clampIncomeField('amount', input.value, 0);
          else if (input.classList.contains('income-start'))
            source.startYear = clampIncomeField('startYear', input.value, 1);
          else
            source.endYear =
              input.value === '' ? null : clampIncomeField('endYear', input.value, currentHorizonYears());
          // 起訖顛倒的來源一年也付不出來；就地修正比留著一列永遠是 0 的設定好解釋。
          if (source.endYear !== null && source.endYear < source.startYear) source.endYear = source.startYear;
          renderAll();
          renderIncomeSources();
        };
        input.onkeydown = event => {
          if (event.key === 'Enter') input.blur();
        };
      });
  }
  function metricCard(label, value, note) {
    return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
  }
  function initialAssetsCard(sum) {
    const locked = Number.isFinite(state.lockedInitialAssets);
    const value = locked ? state.lockedInitialAssets : sum;
    return html(
      '<article class="metric initial-assets-metric">',
      '<span class="metric-label-row">起始流動資產 ',
      `<button id="lock-initial-assets" class="lock-button${locked ? ' locked' : ''}" type="button" aria-pressed="${locked}" title="${locked ? '解除鎖定；核心增值 ETF 可自行編輯' : '鎖定目前總額；之後由核心增值 ETF 自動補足差額'}">${locked ? '🔒 已鎖定' : '🔓 鎖定'}</button>`,
      '</span>',
      '<strong><div class="money-input"><span>$</span>',
      `<input id="initial-assets" type="number" min="0" step="1000" value="${value}" ${locked ? '' : 'disabled'} aria-label="鎖定的起始流動資產" />`,
      '</div></strong>',
      `<small>${locked ? '調整總額或其他水庫時，核心增值 ETF 自動重算' : '四層水庫合計；鎖定後固定總額'}</small>`,
      '</article>',
    );
  }
  function editableMoneyCard(label, id, value, note, extra = '') {
    return html(
      `<article class="metric editable-plan-metric"><label for="${id}">${label}</label>`,
      '<div class="money-input plan-money-input"><span>$</span>',
      `<input id="${id}" type="number" min="0" step="1000" value="${value}" />`,
      '</div>',
      extra,
      `<small>${note}</small></article>`,
    );
  }
  function annualSpendCard(sum) {
    const monthly = annualSpendInputMode === 'monthly';
    const displayedValue = monthly ? state.annualSpend / 12 : state.annualSpend;
    const share = sum > 0 ? percent((state.annualSpend / sum) * 100) : '—';
    return html(
      '<article class="metric editable-plan-metric">',
      '<div class="metric-label-row annual-spend-label">',
      `<label for="annual-spend">首年預計支出 · ${monthly ? '每月' : '每年'}</label>`,
      '<select id="annual-spend-period" aria-label="生活費輸入週期">',
      `<option value="annual"${monthly ? '' : ' selected'}>每年</option>`,
      `<option value="monthly"${monthly ? ' selected' : ''}>每月</option>`,
      '</select>',
      '</div>',
      '<div class="money-input plan-money-input"><span>$</span>',
      `<input id="annual-spend" type="number" min="0" step="${monthly ? 100 : 1000}" value="${displayedValue}" />`,
      '</div>',
      `<small>年度金額 ${money(state.annualSpend)} · 約為流動資產的 ${share}</small>`,
      '</article>',
    );
  }
  function renderSummary() {
    const sum = total(),
      coverage = (annualIncome() / state.annualSpend) * 100;
    const bufferYears = (state.buckets[0].amount + state.buckets[1].amount) / state.annualSpend;
    $('#summary').innerHTML = [
      '',
      initialAssetsCard(sum),
      annualSpendCard(sum),
      editableMoneyCard(
        `必要生活費底線 · ${annualSpendInputMode === 'monthly' ? '每月' : '每年'}`,
        'spending-floor',
        annualSpendInputMode === 'monthly' ? state.spendingFloor.annualAmount / 12 : state.spendingFloor.annualAmount,
        state.spendingFloor.annualAmount
          ? `年度金額 ${money(state.spendingFloor.annualAmount)} · 每年隨 CPI 成長；熊市可為此被迫賣股`
          : '填入 $0 表示關閉',
        '<small class="floor-presets">對照：<button type="button" data-floor-percent="50">50%</button><button type="button" data-floor-percent="60">60%</button><button type="button" data-floor-percent="70">70%</button><button type="button" data-floor-percent="80">80%</button> 原始計畫</small><small class="floor-input-warning" id="floor-input-warning" hidden></small>',
      ),
    ].join('\n    ');
    $('#reservoir-metrics').innerHTML = [
      metricCard(
        '現金流覆蓋率',
        Number.isFinite(coverage) ? percent(coverage) : '未設定生活費',
        `預估年配息 ${money(annualIncome())}`,
      ),
      metricCard(
        '安全緩衝',
        Number.isFinite(bufferYears) ? `${bufferYears.toFixed(1)} 年` : '未設定生活費',
        '緊急金 + 防守水庫',
      ),
    ].join('\n    ');
    $('#annual-spend-period').onchange = event => {
      annualSpendInputMode = event.target.value === 'monthly' ? 'monthly' : 'annual';
      renderAll();
    };
    ['annual-spend', 'spending-floor'].forEach(id => {
      const input = $('#' + id);
      input.onchange = event => {
        const key = id === 'spending-floor' ? 'spendingFloorAmount' : 'annualSpend';
        if (key === 'spendingFloorAmount') {
          const entered = Number(event.target.value);
          state.spendingFloor.annualAmount = clampSetting(
            key,
            annualSpendInputMode === 'monthly' ? entered * 12 : entered,
          );
        } else {
          const entered = Number(event.target.value);
          state[key] = clampSetting(key, annualSpendInputMode === 'monthly' ? entered * 12 : entered);
        }
        renderAll();
      };
      input.onblur = event => {
        event.target.value =
          id === 'spending-floor'
            ? annualSpendInputMode === 'monthly'
              ? state.spendingFloor.annualAmount / 12
              : state.spendingFloor.annualAmount
            : annualSpendInputMode === 'monthly'
              ? state.annualSpend / 12
              : state.annualSpend;
      };
    });
    const floorInputWarning = $('#floor-input-warning');
    const floorExceedsPlan = state.spendingFloor.annualAmount > state.annualSpend;
    floorInputWarning.hidden = !floorExceedsPlan;
    floorInputWarning.textContent = floorExceedsPlan
      ? '必要生活費高於原始計畫；護欄無法收緊，請確認這是刻意設定。'
      : '';
    document.querySelectorAll('[data-floor-percent]').forEach(button => {
      button.onclick = () => {
        state.spendingFloor.annualAmount = state.annualSpend * (+button.dataset.floorPercent / 100);
        renderAll();
      };
    });
    $('#lock-initial-assets').onclick = () => {
      if (Number.isFinite(state.lockedInitialAssets)) delete state.lockedInitialAssets;
      else {
        state.lockedInitialAssets = total();
        syncGrowthToLockedTotal();
      }
      renderAll();
    };
    $('#initial-assets').onchange = event => {
      const entered = Number(event.target.value);
      if (!Number.isFinite(entered)) return;
      state.lockedInitialAssets = entered;
      syncGrowthToLockedTotal();
      renderAll();
    };
  }
  // 熊市門檻仍保護可調整生活費；事件與必要帳單都有突破門檻的理由。年度明細必須說明是哪一條
  // 資金鏈賣了核心 ETF，否則使用者會把「守住必要帳單」誤讀成規則偷偷失效。
  const THRESHOLD_ASYMMETRY_NOTE = html(
    '熊市門檻擋的是可調整生活費；必要生活費與意外支出無法調降，',
    '兩者都可突破門檻出售核心 ETF，並分別標記原因。',
  );
  function renderReturnOptions(year) {
    const presets = [-15, -12, -10, -7, -5, -3, 3, 5, 7, 10, 12, 15];
    const selectedReturn = state.coreReturns[year];
    const replay = state.historicalReplay;
    const historicalReturn = replay
      ? historicalReturnPath(replay.market, replay.startYear, undefined, replay.direction === 'reverse')?.[year]
      : undefined;
    // Keep the original historical value available after an edit, including after reload.
    const customOption = [...new Set([historicalReturn, selectedReturn])]
      .filter(value => Number.isFinite(value) && !presets.includes(value))
      .map(
        value =>
          `<option value="${value}" ${selectedReturn === value ? 'selected' : ''}>指定 ${value >= 0 ? '+' : ''}${percent(value)}</option>`,
      )
      .join('');
    return (
      customOption +
      presets
        .map(value => {
          const selected = selectedReturn === value ? 'selected' : '';
          return `<option value="${value}" ${selected}>${value > 0 ? '+' : ''}${value}%</option>`;
        })
        .join('')
    );
  }
  function yearReplenishNotes(y, bucketById, plan = state) {
    const emergencyNote = html(
      y.treasuryCashToEmergency ? `國債到期現金轉入 ${money(y.treasuryCashToEmergency)} 至緊急金。` : '',
      y.returns > 0 && y.emergencyTransfer !== 0
        ? y.emergencyTransfer > 0
          ? `核心 ETF 補入 ${money(y.emergencyTransfer)} 至緊急金目標 ${money(y.emergencyTarget)}。`
          : `緊急金回收 ${money(Math.abs(y.emergencyTransfer))} 至核心 ETF，保留目標 ${money(y.emergencyTarget)}。`
        : '',
    );
    const ladderNote =
      y.treasuryCashToLadder || y.ladderTransfer
        ? html(
            y.treasuryCashToLadder ? `國債到期現金補入 ${money(y.treasuryCashToLadder)}` : '',
            y.treasuryCashToLadder && y.ladderTransfer ? '；' : '',
            y.ladderTransfer ? `核心 ETF 補入 ${money(y.ladderTransfer)}` : '',
            `，補足目標 ${y.treasuryTargetLength ?? plan.treasury.length} 年梯範圍內所有空期的國債面額；`,
            `每期目標為預計支出的 ${percent(y.treasuryCoverage * 100)}。`,
            '新債面額向上取整至 $1,000，既有債券不調整。',
          )
        : '';
    const treasuryRecoveryNote = y.treasuryCashRecovery
      ? `防守現金回收 ${money(y.treasuryCashRecovery)} 至核心 ETF。`
      : '';
    const liquidationTarget = { emergency: '緊急預備金', growth: '核心 ETF' }[y.incomeLiquidationTarget];
    const incomeNote = html(
      y.incomeLiquidated
        ? `現金流 ETF 已清算（淨值歸零）${
            y.incomeLiquidationTransfer
              ? `，剩餘 ${money(y.incomeLiquidationTransfer)} 轉入${liquidationTarget}`
              : y.incomeCash > 0
                ? `，剩餘 ${money(y.incomeCash)} 無處可轉，以零利息現金保留`
                : '，目前無持倉'
          }；待核心報酬回正的補水年依支應目標重新買進。`
        : '',
      y.incomeRebuilt
        ? `${y.incomeRebuildCash > 0 ? `以保留的現金 ${money(y.incomeRebuildCash)} 重新買進同類 ETF` : '重新建立同類 ETF 部位'}，恢復配息與補水。`
        : '',
      y.incomeTransfer
        ? html(
            `核心 ETF 補入 ${money(y.incomeTransfer)}，將現金流 ETF 補至 ${money(y.incomeTarget)}，`,
            `使其配息約覆蓋下年度支出的 ${percent(y.incomeCoverage * 100)}。`,
          )
        : '',
    );
    const emergencyRule =
      bucketById.emergency.amount > 0
        ? `緊急金區間 ${money(y.emergencyMinimum)}–${money(y.emergencyTarget)}；目標 ${money(y.emergencyTarget)}。`
        : '緊急金初始配置為 $0，已停用補水。';
    return { emergencyNote, ladderNote, incomeNote, treasuryRecoveryNote, emergencyRule };
  }
  function yearEventNote(y) {
    if (!y.eventSpend) return '';
    return html(
      `意外支出 ${money(y.eventSpend)}：緊急預備金 ${money(y.eventEmergencyTake)}`,
      y.eventDefenseTake ? `；國債到期現金 ${money(y.eventDefenseTake)}` : '',
      y.eventGrowthTake ? `；核心 ETF ${money(y.eventGrowthTake)}` : '',
      y.eventIncomeTake ? `；現金流 ETF 本金 ${money(y.eventIncomeTake)}` : '',
      y.forcedGrowthSale ? '（熊市被迫出售）' : '',
      y.eventUnmet ? `；事件缺口 ${money(y.eventUnmet)}` : '。',
    );
  }
  function yearEventStatus(y) {
    if (!y.eventSpend) return '緊急金優先';
    return html(
      `緊急金 ${money(y.eventEmergencyTake, true)}`,
      y.eventDefenseTake ? ` · 國債 ${money(y.eventDefenseTake, true)}` : '',
      y.eventGrowthTake ? ` · 核心 ${money(y.eventGrowthTake, true)}` : '',
      y.eventIncomeTake ? ` · 現金流本金 ${money(y.eventIncomeTake, true)}` : '',
      y.forcedGrowthSale ? ' · 熊市被迫出售' : '',
      y.eventUnmet ? ` · 事件缺口 ${money(y.eventUnmet, true)}` : '',
    );
  }
  function yearSourcesCell(y, sourceName, plan = state) {
    // 年金入帳單獨列一行，不混進緊急金那一格：錢確實是先進那個桶再花出去，但把它算成
    // 「緊急金支應」會讓使用者看不出哪一塊生活費不是水庫出的。
    const guaranteed = y.guaranteedIncome
      ? `<span class="guaranteed-source">保證性收入 ${money(y.guaranteedIncome, true)}</span>`
      : '';
    const use = Object.entries(y.sources)
      .filter(([, v]) => v > 0)
      .map(([id, v]) => `<span>${sourceName[id]} ${money(v, true)}</span>`)
      .join('');
    const frozenNote = y.growthFrozen
      ? html(
          `<b>核心 ETF 凍結（報酬 ${y.returns >= 0 ? '+' : ''}${percent(y.returns)}`,
          ` ＜ 門檻 ${percent(plan.bearThreshold)}）</b>`,
        )
      : '';
    const floorForcedNote = y.forcedFloorGrowthSale
      ? `<b>為支付必要生活費，被迫出售核心 ETF ${money(y.floorGrowthTake)}</b>`
      : '';
    const floorGapNote = y.floorGap ? `<b>必要生活費缺口 ${money(y.floorGap)}</b>` : '';
    const shortfallNote = y.unmetSpend ? `<b>生活費缺口 ${money(y.unmetSpend)}</b>` : '';
    const illiquidReason = y.growthFrozen ? '，但核心 ETF 被熊市門檻凍結' : '，但國債尚未到期';
    const illiquidNote = y.illiquid ? `<b>當年無可動用資金：資產 ${money(y.total)} 仍在${illiquidReason}</b>` : '';
    const bankruptcyNote = y.bankrupt ? '<b>投資組合已耗盡，模擬停止</b>' : '';
    const body = html(
      guaranteed,
      use || (guaranteed ? '' : '<span>—</span>'),
      frozenNote,
      floorForcedNote,
      floorGapNote,
      shortfallNote,
      illiquidNote,
      bankruptcyNote,
    );
    return `<td><div class="sources">${body}</div></td>`;
  }
  function ledgerMoney(value) {
    const amount = Math.abs(Number(value) || 0);
    return `${value >= 0 ? '+' : '−'}${money(amount)}`;
  }
  function yearBucketLedger(y, bucket) {
    const id = bucket.id;
    const opening = Number(y.opening[id]) || 0;
    const ending = Number(y.values[id]) || 0;
    const inflows = [];
    const outflows = [];
    const add = (items, label, amount) => {
      if (Math.abs(Number(amount) || 0) > 0.01) items.push({ label, amount: Math.abs(amount) });
    };
    const planned = Number(y.sources?.[id]) || 0;
    // 清算轉出不是投資損益；不列出來的話會被下方的殘差算進報酬。
    if (y.incomeLiquidationTarget === id) add(inflows, '現金流 ETF 清算轉入', y.incomeLiquidationTransfer);
    if (id === 'income')
      add(
        outflows,
        `清算轉出至${{ emergency: '緊急預備金', growth: '核心 ETF' }[y.incomeLiquidationTarget] ?? ''}`,
        y.incomeLiquidationTransfer,
      );
    if (id === 'emergency') {
      add(inflows, '國債到期現金補入', y.treasuryCashToEmergency);
      add(inflows, '核心 ETF 補水', Math.max(0, y.emergencyTransfer));
      add(outflows, '生活費支應', planned);
      add(outflows, '意外支出', y.eventEmergencyTake);
      add(outflows, '回收至核心 ETF', Math.max(0, -y.emergencyTransfer));
    } else if (id === 'defense') {
      add(inflows, '核心 ETF 補國債梯', y.ladderTransfer);
      add(outflows, '生活費支應', planned);
      add(outflows, '意外支出', y.eventDefenseTake);
      add(outflows, '到期現金補緊急金', y.treasuryCashToEmergency);
      add(outflows, '防守現金回收至核心', y.treasuryCashRecovery);
    } else if (id === 'income') {
      add(inflows, '核心 ETF 補入', y.incomeTransfer);
      add(outflows, '配息支應生活費', y.sources?.income);
      add(outflows, '本金支應生活費', y.sources?.incomePrincipal);
      add(outflows, '意外支出（本金）', y.eventIncomeTake);
    } else if (id === 'growth') {
      add(inflows, '防守現金回收', y.treasuryCashRecovery);
      add(inflows, '緊急金回收', Math.max(0, -y.emergencyTransfer));
      add(outflows, '生活費支應', planned);
      add(outflows, '意外支出', y.eventGrowthTake);
      add(outflows, '補緊急預備金', Math.max(0, y.emergencyTransfer));
      add(outflows, '補國債梯', y.ladderTransfer);
      add(outflows, '補現金流 ETF', y.incomeTransfer);
    }
    const inflowTotal = inflows.reduce((sum, item) => sum + item.amount, 0);
    const outflowTotal = outflows.reduce((sum, item) => sum + item.amount, 0);
    const investmentReturn = ending - opening - inflowTotal + outflowTotal;
    const returnLabel =
      id === 'growth'
        ? `核心資產報酬（${y.returns >= 0 ? '+' : ''}${percent(y.returns)}）`
        : id === 'income'
          ? `含息總報酬（${y.incomeReturn >= 0 ? '+' : ''}${percent(y.incomeReturn)}）`
          : id === 'defense'
            ? `票息 ${money(y.treasuryCoupon)} ＋ MMF 報酬`
            : '現金／MMF 報酬';
    const returnClass = investmentReturn >= 0 ? 'up' : 'down';
    const flowRows = (items, kind) =>
      items.length
        ? items
            .map(
              item =>
                `<span class="ledger-flow ${kind}"><em>${escapeHtml(item.label)}</em><b>${kind === 'in' ? '+' : '−'}${money(item.amount)}</b></span>`,
            )
            .join('')
        : `<span class="ledger-flow ${kind} empty"><em>${kind === 'in' ? '流入' : '流出'}</em><b>—</b></span>`;
    const neutralNote =
      id === 'defense' && y.treasuryMaturity
        ? `<small class="ledger-neutral">到期本金 ${money(y.treasuryMaturity)}：國債面額轉為防守現金，不改變本水庫總額。</small>`
        : '';
    return html(
      '<article class="reservoir-value reservoir-ledger">',
      `<span><i style="background:${escapeHtml(bucketColor(bucket))}"></i>${nameHtml(bucket.name)}</span>`,
      `<strong>${money(ending)}</strong>`,
      `<small class="ledger-opening">期初 ${money(opening)}</small>`,
      `<span class="ledger-return ${returnClass}"><em>${returnLabel}</em><b>${ledgerMoney(investmentReturn)}</b></span>`,
      flowRows(inflows, 'in'),
      flowRows(outflows, 'out'),
      `<small class="ledger-total">期初 ${money(opening)} ＋ 報酬 ${ledgerMoney(investmentReturn)} ＋ 流入 ${money(inflowTotal)} − 流出 ${money(outflowTotal)} ＝ ${money(ending)}</small>`,
      neutralNote,
      '</article>',
    );
  }
  // colspan 由呼叫端依所在表格欄數指定；預設 6 是逐年軌跡表的欄數。
  function yearDetailRow(y, bucketById, plan = state, colspan = 6) {
    const details = plan.buckets.map(bucket => yearBucketLedger(y, bucket)).join('');
    const { emergencyNote, ladderNote, incomeNote, treasuryRecoveryNote, emergencyRule } = yearReplenishNotes(
      y,
      bucketById,
      plan,
    );
    const eventNote = yearEventNote(y);
    const replenish = [emergencyNote, ladderNote, incomeNote, treasuryRecoveryNote]
      .filter(Boolean)
      .map(note => `<small class="replenish-note">${note}</small>`)
      .join('');
    const thresholdNote =
      y.growthFrozen || y.forcedGrowthSale || y.forcedFloorGrowthSale
        ? `<small class="threshold-note">${THRESHOLD_ASYMMETRY_NOTE}</small>`
        : '';
    return html(
      `<tr class="detail-row"><td colspan="${colspan}"><div class="reservoir-details">`,
      `<div class="detail-title">第 ${y.year} 年末水庫明細 <small>相對該年年初的變化</small>`,
      '<small class="ledger-intro">每個水庫均以「期初 ＋ 報酬 ＋ 流入 − 流出 ＝ 期末」對帳；國債到期本金只是在國債面額與防守現金間轉換。</small>',
      `<small class="income-model-note">現金流水庫：含息總報酬 ${y.incomeReturn >= 0 ? '+' : ''}${percent(y.incomeReturn)}，`,
      `實際配息 ${percent(y.distributionRate)}</small>`,
      y.incomeProfile === 'PBP'
        ? `<small class="pbp-distribution-note">PBP 配發 ${money(y.incomeDistributionGross)}，其中假設 ROC ${money(y.incomeRoc)}、其餘配發 ${money(y.incomeNonRoc)}；每單位實際配發 ${money(y.incomePaidPerShare)}。ROC 已包含於配發，並非額外收益；不計稅。</small>`
        : '',
      `<small class="treasury-note">國債梯：票息 ${money(y.treasuryCoupon)}`,
      ` · 到期本金 ${money(y.treasuryMaturity)} · 年末防守現金 ${money(y.treasuryCash)}（未動用部分按 MMF 報酬累積）</small>`,
      y.treasuryTargetLength !== undefined
        ? `<small class="treasury-note">目標梯長 ${y.treasuryTargetLength} 年 · 實際持有 ${y.treasuryActualRungCount} 個梯級</small>`
        : '',
      `<small class="emergency-rule-note">${emergencyRule}</small>`,
      thresholdNote,
      eventNote ? `<small class="event-note ${y.eventUnmet ? 'down' : ''}">${eventNote}</small>` : '',
      replenish,
      `</div><div class="reservoir-grid">${details}</div></div></td></tr>`,
    );
  }
  function fixedYearLabel(year) {
    const replay = state.historicalReplay;
    if (!replay || currentScenario !== 'historical') return String(year);
    const calendarYear = replay.startYear + (replay.direction === 'reverse' ? -1 : 1) * (year - 1);
    return `${year} (${calendarYear})`;
  }
  function renderProjectionRow(y, sourceName, bucketById, years, plan = state) {
    const expanded = expandedYears.has(y.year);
    const spendRule = y.noOpeningAssets
      ? ''
      : y.guardrailAction === '未觸發護欄'
        ? `調整前 ${percent(y.proposedRate)} → 未觸發護欄`
        : `調整前 ${percent(y.proposedRate)} → ${y.guardrailAction} → 調整後 ${percent(y.withdrawalRate)}`;
    const configuredEvent = Number(state.emergencyEvents?.[y.year]);
    const eventInputValue = Number.isFinite(configuredEvent) && configuredEvent > 0 ? configuredEvent : '';
    const eventInput = html(
      `<input class="event-spend" data-event-year="${y.year}" type="number" min="0" step="1000"`,
      ` value="${eventInputValue}" placeholder="0" />`,
    );
    const eventCell = html(
      `<td><div class="money-input event-input"><span>$</span>${eventInput}</div>`,
      `<small class="event-status ${y.eventUnmet ? 'down' : ''}">${yearEventStatus(y)}</small></td>`,
    );
    // 通膨原本擠在核心報酬欄那行小字的第三順位，等於藏在「報酬」底下——而它作用的地方是
    // 支出。改放到計畫支出欄，並且顯示**實際套用的那一年**：第 N 年的預算依第 N−1 年的 CPI
    // 調整，所以這裡標「依前年 CPI」而不是當年的，否則對不上手算的數字。
    const appliedInflation = y.year === 1 ? null : years[y.year - 2]?.inflationRate;
    const spendNotes = html(
      appliedInflation === null || appliedInflation === undefined
        ? '<small class="spend-basis">首年為輸入值，不套通膨</small>'
        : `<small class="spend-basis">依前年 CPI ${appliedInflation >= 0 ? '+' : ''}${percent(appliedInflation)} 調整</small>`,
      // 大字是「護欄調整後」的計畫支出，原始計畫是純通膨軌道——護欄碰不到它。兩者的差距是
      // 歷年護欄動作累積出來的，不是當年那一次造成的，所以標成「累計」。
      //
      // 原本寫「實得 108%」，但「實得」是「實際拿到多少」的意思（那是缺口的概念，看的是
      // actualSpend），而這裡 108% 代表護欄讓你比原計畫多花了 8%——方向完全相反。
      Math.abs(y.spend - y.plannedSpend) > 1
        ? html(
            `<small class="spend-basis">原始計畫 ${money(y.plannedSpend)}`,
            `（護欄累計 ${y.spend >= y.plannedSpend ? '+' : '−'}${percent(Math.abs(y.spend / y.plannedSpend - 1) * 100)}）`,
            '</small>',
          )
        : '',
      y.floorSpend > 0
        ? html(
            `<small class="spend-basis">必要生活費 ${money(y.floorSpend)}`,
            y.floorBinding ? `（護欄候選 ${money(y.guardrailSpend)}，底線咬住）` : '',
            y.floorGap ? `；尚缺 ${money(y.floorGap)}` : '',
            '</small>',
          )
        : '',
    );
    const scenarioSign = y.scenarioCoreReturn >= 0 ? '+' : '';
    const returnCell = html(
      `<td><select class="year-return ${y.returns >= 0 ? 'up' : 'down'}" data-return-year="${y.year}"`,
      ' title="設定本年度核心資產報酬">',
      `<option value="">依情境 ${scenarioSign}${percent(y.scenarioCoreReturn)}</option>`,
      `${renderReturnOptions(y.year)}</select></td>`,
    );
    const totalCell = html(
      `<td><button class="end-total ${expanded ? 'active' : ''}" data-year="${y.year}"`,
      ` title="查看各水庫年末現值">${money(y.total)} <span>${expanded ? '⌃' : '⌄'}</span></button></td>`,
    );
    return html(
      `<tr><td>${fixedYearLabel(y.year)}</td>`,
      `<td>${money(y.spend)}${spendNotes}${spendRule ? `<small class="spend-rule">${spendRule}</small>` : ''}</td>`,
      eventCell,
      yearSourcesCell(y, sourceName, plan),
      returnCell,
      totalCell,
      '</tr>',
      expanded ? yearDetailRow(y, bucketById, plan) : '',
    );
  }
  // 逐年報酬是整批寫入的（歷史回放、Monte Carlo 代表路徑複製），清除入口因此要跟著資料走。
  // 它原本待在只有「歷史」情境才顯示的面板裡，於是複製代表路徑之後就看不到了——而那正是
  // 這顆按鈕存在的兩個理由之一。改掛在軌跡表上方，有覆寫時才出現。
  // 只清「來自複製路徑」的事件，使用者自己輸入的留著。判斷依據是 eventsFromPath，而不是
  // 「現在發生了什麼操作」——用操作推論資料歸屬，正是 P2 那次把使用者手動編輯清掉的原因。
  function dropPathSourcedEvents() {
    if (!state.eventsFromPath) return;
    state.emergencyEvents = {};
    state.eventsFromPath = false;
  }
  function clearPerYearOverrides() {
    state.coreReturns = {};
    delete state.bxmMonthlyPath;
    delete state.incomeMonthlyPath;
    state.inflationRates = {};
    delete state.safeRates;
    state.historicalReplay = null;
    // 這顆按鈕是明示操作，清除範圍包含使用者自己輸入的事件——與自動清除不同。
    state.emergencyEvents = {};
    state.eventsFromPath = false;
    delete state.historicalSampleSources;
    delete state.representativePathSource;
    // 歷史情境少了路徑就只是另一條 7% 平線，頁籤與內容會對不上；一併回到基準。
    if (currentScenario === 'historical') setScenario('base');
    expandedYears.clear();
    projectionStart = 0;
    renderAll();
  }
  function loadScenarioComparison() {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem('retirement-scenario-comparison'));
    } catch {
      /* Use initial choices for malformed storage. */
    }
    return {
      planId: typeof stored?.planId === 'string' ? stored.planId : selectedPlanId,
      basis: stored?.basis === 'nominal' ? 'nominal' : 'real',
      scenarios: ['sp500', 'taiwan', 'nikkei'].map((market, index) => {
        const saved = stored?.scenarios?.[index];
        return {
          id: 's' + (index + 1),
          market: typeof saved?.market === 'string' ? saved.market : market,
          direction: saved?.direction === 'reverse' ? 'reverse' : 'forward',
          startYear: saved?.startYear === undefined ? 1990 : Number(saved.startYear),
          enabled: saved?.enabled !== false,
        };
      }),
    };
  }
  function renderScenarioComparison() {
    const root = $('#scenario-comparison-content');
    if (!root) return;
    const focusedId = root.contains(document.activeElement) ? document.activeElement.id : '';
    const api = window.RetirementFixedComparison;
    const config = scenarioComparisonConfig;
    const profile = state.monteCarloProfiles.find(item => item.id === config.planId) || state.monteCarloProfiles[0];
    config.planId = profile.id;
    const plan = profile.plan;
    const horizonYears = currentHorizonYears();
    scenarioComparisonYear = Math.min(scenarioComparisonYear, horizonYears);
    const names = { sp500: 'S&P 500', taiwan: '台灣加權', nikkei: '日經 225', ftse: '英國 FTSE 100' };
    // 三張卡可以選到完全相同的市場／年份／方向，編號讓圖例、表頭與明細仍能對應。
    const tag = item => '<span>情境</span> ' + item.id.slice(1) + ' · ';
    const label = item =>
      tag(item) +
      '<span>' +
      (names[item.market] || '無效市場') +
      '</span> · ' +
      item.startYear +
      ' → ' +
      (item.startYear + (item.direction === 'reverse' ? -1 : 1) * (horizonYears - 1));
    const save = () => {
      try {
        localStorage.setItem('retirement-scenario-comparison', JSON.stringify(config));
      } catch {
        $('#scenario-save-status').textContent = '情境選擇無法保存；目前仍可比較。';
        applyLanguage(root);
      }
    };
    const marketOptions = selected =>
      Object.keys(names)
        .map(
          key => '<option value="' + key + '"' + (selected === key ? ' selected' : '') + '>' + names[key] + '</option>',
        )
        .join('');
    root.innerHTML = html(
      '<div class="scenario-compare-controls"><label>比較使用的計畫 <select id="scenario-compare-plan">' +
        state.monteCarloProfiles
          .map(
            item =>
              '<option value="' +
              item.id +
              '"' +
              (item.id === profile.id ? ' selected' : '') +
              (isBuiltInName(item.name) ? '' : ' translate="no"') +
              '>' +
              escapeHtml(item.name) +
              '</option>',
          )
          .join('') +
        '</select></label><button type="button" id="scenario-edit-plan" class="ghost">前往方案管理</button></div>',
      '<p class="scenario-plan-summary">' +
        nameHtml(profile.name) +
        ' · <span>總資產</span> ' +
        money(plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0)) +
        ' · <span>每年生活費</span> ' +
        money(plan.annualSpend) +
        ' · <span>必要生活費</span> ' +
        money(plan.spendingFloor?.annualAmount || 0) +
        '</p>',
      '<details class="settings-fold"><summary>目前計畫摘要</summary><div class="scenario-plan-buckets">' +
        plan.buckets.map(bucket => '<span>' + nameHtml(bucket.name) + ' ' + money(bucket.amount) + '</span>').join('') +
        '</div></details>',
      '<p class="hint">同一數值尺度、不處理匯率；金額符號不表示已換匯。結果不是台幣投資海外或跨國退休優劣比較。</p>',
      '<div class="scenario-comparison-cards">' +
        config.scenarios
          .map(item => {
            const starts = api.historicalScenarioStarts(item.market, item.direction, horizonYears);
            return (
              '<article><h3>' +
              label(item) +
              '</h3><label><input type="checkbox" id="scenario-enabled-' +
              item.id +
              '" data-scenario-field="enabled" data-scenario-id="' +
              item.id +
              '"' +
              (item.enabled ? ' checked' : '') +
              '/>參與情境比較</label>' +
              '<label>市場<select id="scenario-market-' +
              item.id +
              '" data-scenario-field="market" data-scenario-id="' +
              item.id +
              '">' +
              (names[item.market] ? '' : '<option value="' + escapeHtml(item.market) + '" selected>無效市場</option>') +
              marketOptions(item.market) +
              '</select></label>' +
              '<label>順序<select id="scenario-direction-' +
              item.id +
              '" data-scenario-field="direction" data-scenario-id="' +
              item.id +
              '"><option value="forward"' +
              (item.direction === 'forward' ? ' selected' : '') +
              '>正放（最早年先）</option><option value="reverse"' +
              (item.direction === 'reverse' ? ' selected' : '') +
              '>倒放（最新年先）</option></select></label>' +
              '<label>歷史期間<select id="scenario-start-' +
              item.id +
              '" data-scenario-field="startYear" data-scenario-id="' +
              item.id +
              '">' +
              (starts.includes(item.startYear) ? '' : '<option value="" selected>無效年份</option>') +
              starts
                .map(
                  year =>
                    '<option value="' +
                    year +
                    '"' +
                    (year === item.startYear ? ' selected' : '') +
                    '>' +
                    year +
                    ' → ' +
                    (year + (item.direction === 'reverse' ? -(horizonYears - 1) : horizonYears - 1)) +
                    '</option>',
                )
                .join('') +
              '</select></label>' +
              '<p class="hint">' +
              (item.market === 'sp500'
                ? '含息總報酬；美國 CPI 為 12 月年增率；安全水庫採同期美國國債利率。'
                : '價格報酬不含股息；當地 CPI 為全年平均年增率；安全水庫沿用基準假設。') +
              '</p></article>'
            );
          })
          .join('') +
        '</div>',
      '<p id="scenario-save-status" role="status"></p>',
      `<details class="settings-fold"><summary>口徑與限制</summary><p>各市場使用本國 CPI，實質資產不是同一物價籃子的購買力比較。倒放是合成序列壓力測試，不是真實歷史。</p><p>不帶入固定情境逐年覆寫或 MC 事件；其餘配置與規則沿用所選方案。ETF 為策略模型，不是基金歷史績效回放。</p><p>實際／計畫生活費以完整 ${horizonYears} 年原始計畫為分母；護欄放寬時實際支出可能高於原計畫，比例會超過 100%。耗盡後支應按零、必要缺口包含剩餘年份，不推演未來年金。曲線與明細於耗盡時停止。</p></details>`,
      '<div id="scenario-comparison-results"></div>',
    );
    $('#scenario-edit-plan').onclick = () => setActiveView('plans-view');
    $('#scenario-compare-plan').onchange = event => {
      config.planId = event.target.value;
      renderScenarioComparison();
      save();
    };
    root.querySelectorAll('[data-scenario-field]').forEach(input => {
      input.onchange = () => {
        const item = config.scenarios.find(choice => choice.id === input.dataset.scenarioId);
        const key = input.dataset.scenarioField;
        if (key === 'direction' && item.direction !== input.value)
          item.startYear += input.value === 'reverse' ? horizonYears - 1 : -(horizonYears - 1);
        item[key] = key === 'enabled' ? input.checked : key === 'startYear' ? Number(input.value) : input.value;
        if (key === 'market' || key === 'direction') {
          const starts = api.historicalScenarioStarts(item.market, item.direction, horizonYears);
          if (starts.length && !starts.includes(item.startYear))
            item.startYear = starts.reduce((closest, year) =>
              Math.abs(year - item.startYear) < Math.abs(closest - item.startYear) ? year : closest,
            );
        }
        renderScenarioComparison();
        save();
      };
    });
    const host = $('#scenario-comparison-results');
    let results;
    try {
      results = api.compareHistoricalScenarios({ ...plan, planningPeriod: currentPlanningPeriod() }, config.scenarios);
    } catch {
      host.innerHTML =
        '<p role="alert" class="scenario-comparison-error">' +
        (config.scenarios.some(item => item.enabled)
          ? `情境缺乏完整 ${horizonYears} 年資料，請調整市場、順序或年份；不會自動套用基準路徑。`
          : '請至少啟用一個情境。') +
        '</p>';
      applyLanguage(root);
      if (focusedId) document.getElementById(focusedId)?.focus();
      return;
    }
    if (!results.some(item => item.config.id === scenarioComparisonDetail))
      scenarioComparisonDetail = results[0].config.id;
    const initial = plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
    const value = point => (config.basis === 'real' ? point.realTotal : point.total);
    const colors = seriesColors;
    const width = Math.max(260, Math.min(1000, root.clientWidth ? root.clientWidth - 42 : 1000));
    const left = width < 600 ? 64 : 90,
      right = 24,
      height = 300,
      bottom = 54;
    const maximum = Math.max(1, initial, ...results.flatMap(item => item.trajectory.map(value))) * 1.04;
    const x = year => left + (year / horizonYears) * (width - left - right);
    const y = total => 22 + (1 - total / maximum) * (height - bottom - 22);
    host.innerHTML = html(
      `<div class="table-wrap scenario-metrics"><table><thead><tr><th>情境</th><th>第 ${horizonYears} 年實質資產</th><th>資產耗盡年份</th><th>${horizonYears} 年實際／計畫生活費</th><th>${horizonYears} 年必要生活費缺口（名目累計）</th></tr></thead><tbody>` +
        results
          .map(
            item =>
              '<tr><th>' +
              label(item.config) +
              '</th><td>' +
              money(item.finalRealAssets) +
              '</td><td>' +
              (item.result.bankruptYear
                ? item.result.bankruptYear +
                  ' (' +
                  (item.config.startYear +
                    (item.config.direction === 'reverse' ? -1 : 1) * (item.result.bankruptYear - 1)) +
                  ')'
                : '未耗盡') +
              '</td><td>' +
              percent(item.spendRatio * 100) +
              '</td><td>' +
              (item.plan.spendingFloor?.annualAmount > 0 ? money(item.floorGap) : '未設定必要生活費') +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div>',
      '<section class="asset-chart scenario-asset-chart"><div class="chart-heading"><h3>情境資產走勢</h3><label>資產顯示口徑 <select id="scenario-asset-basis"><option value="real"' +
        (config.basis === 'real' ? ' selected' : '') +
        '>實質資產</option><option value="nominal"' +
        (config.basis === 'nominal' ? ' selected' : '') +
        '>名目資產</option></select></label></div>',
      '<div class="chart-legend">' +
        results
          .map(
            (item, index) => '<span><i style="background:' + colors[index] + '"></i>' + label(item.config) + '</span>',
          )
          .join('') +
        '</div>',
      '<svg id="scenario-compare-svg" viewBox="0 0 ' +
        width +
        ' ' +
        height +
        '" role="img" aria-label="情境資產走勢"><g class="chart-grid">' +
        [0, 0.5, 1]
          .map(
            ratio =>
              '<line x1="' +
              left +
              '" x2="' +
              (width - right) +
              '" y1="' +
              y(maximum * ratio) +
              '" y2="' +
              y(maximum * ratio) +
              '"/><text x="' +
              (left - 8) +
              '" y="' +
              (y(maximum * ratio) + 4) +
              '" text-anchor="end">' +
              money(maximum * ratio, true) +
              '</text>',
          )
          .join('') +
        '</g>',
      results
        .map(
          (item, index) =>
            '<polyline fill="none" stroke-width="3" style="stroke:' +
            colors[index] +
            '" points="' +
            [[0, initial], ...item.trajectory.map(point => [point.year, value(point)])]
              .map(([year, total]) => x(year) + ',' + y(total))
              .join(' ') +
            '"/>',
        )
        .join(''),
      '<line id="scenario-chart-guide" class="chart-guide" y1="22" y2="' +
        (height - bottom) +
        '"/><g class="chart-axis">' +
        axisYears(0, horizonYears, 3)
          .map(year => '<text x="' + x(year) + '" y="' + (height - 30) + '" text-anchor="middle">' + year + '</text>')
          .join('') +
        '<text x="' +
        width / 2 +
        '" y="' +
        (height - 6) +
        '" text-anchor="middle">退休年度</text></g></svg>',
      '<label class="mc-fan-year">查看退休年度<input id="scenario-compare-year" type="range" min="1" max="' +
        horizonYears +
        '" value="' +
        scenarioComparisonYear +
        '"/></label><div id="scenario-chart-readout" class="scenario-chart-readout" role="status" aria-live="polite"></div></section>',
      '<details class="settings-fold"><summary>年度資產比較</summary><p class="hint">退休年度與各情境西元年</p><div class="table-wrap"><table class="scenario-year-table"><thead><tr><th>退休年度</th>' +
        results.map(item => '<th>' + label(item.config) + '</th>').join('') +
        '</tr></thead><tbody>' +
        Array.from(
          { length: horizonYears },
          (_, index) =>
            '<tr data-scenario-year-row="' +
            (index + 1) +
            '"><th>' +
            (index + 1) +
            '</th>' +
            results
              .map(
                item =>
                  '<td><small>' +
                  (item.config.startYear + (item.config.direction === 'reverse' ? -index : index)) +
                  '</small><button type="button" class="ghost" data-scenario-jump="' +
                  (index + 1) +
                  '" data-scenario-detail="' +
                  item.config.id +
                  '">' +
                  (item.trajectory[index] ? money(value(item.trajectory[index])) : '已停止') +
                  '</button></td>',
              )
              .join('') +
            '</tr>',
        ).join('') +
        '</tbody></table></div></details>',
      '<section id="scenario-year-detail"></section>',
    );
    const renderYear = () => {
      $('#scenario-compare-year').value = scenarioComparisonYear;
      $('#scenario-chart-guide').setAttribute('x1', x(scenarioComparisonYear));
      $('#scenario-chart-guide').setAttribute('x2', x(scenarioComparisonYear));
      $('#scenario-chart-readout').innerHTML =
        '<strong>第 ' +
        scenarioComparisonYear +
        ' 年</strong>' +
        results
          .map(item => {
            const point = item.trajectory[scenarioComparisonYear - 1];
            return (
              '<span>' +
              tag(item.config) +
              '<span>' +
              names[item.config.market] +
              '</span> · ' +
              (item.config.startYear + (item.config.direction === 'reverse' ? -1 : 1) * (scenarioComparisonYear - 1)) +
              ' · ' +
              (point ? money(value(point)) : '已停止') +
              '</span>'
            );
          })
          .join('');
      root
        .querySelectorAll('[data-scenario-year-row]')
        .forEach(row =>
          row.classList.toggle('selected', Number(row.dataset.scenarioYearRow) === scenarioComparisonYear),
        );
      const item = results.find(candidate => candidate.config.id === scenarioComparisonDetail);
      const year = item.result.years[scenarioComparisonYear - 1];
      const detail = $('#scenario-year-detail');
      detail.innerHTML =
        '<h3>情境年度明細</h3><div class="scenario-detail-controls">' +
        results
          .map(
            candidate =>
              '<button type="button" class="ghost" id="scenario-detail-' +
              candidate.config.id +
              '" data-detail-scenario="' +
              candidate.config.id +
              '" aria-pressed="' +
              (candidate === item) +
              '">' +
              label(candidate.config) +
              '</button>',
          )
          .join('') +
        '<label>年度<select id="scenario-detail-year">' +
        Array.from(
          { length: horizonYears },
          (_, i) =>
            '<option value="' +
            (i + 1) +
            '"' +
            (i + 1 === scenarioComparisonYear ? ' selected' : '') +
            '>' +
            (i + 1) +
            ' (' +
            (item.config.startYear + (item.config.direction === 'reverse' ? -i : i)) +
            ')</option>',
        ).join('') +
        '</select></label></div>' +
        '<p>' +
        tag(item.config) +
        '<span>' +
        names[item.config.market] +
        '</span> · ' +
        scenarioComparisonYear +
        ' (' +
        (item.config.startYear + (item.config.direction === 'reverse' ? -1 : 1) * (scenarioComparisonYear - 1)) +
        ')</p>' +
        (year
          ? '<div class="scenario-detail-totals"><span>實際生活費</span> ' +
            money(year.actualSpend) +
            ' · <span>生活費缺口</span> ' +
            money(year.unmetSpend) +
            ' · <span>必要生活費缺口</span> ' +
            money(year.floorGap) +
            '</div><div class="table-wrap"><table><tbody>' +
            yearDetailRow(year, Object.fromEntries(item.plan.buckets.map(bucket => [bucket.id, bucket])), item.plan) +
            '</tbody></table></div>'
          : '<p>耗盡後沒有模擬收支明細。</p>');
      detail.querySelectorAll('[data-detail-scenario]').forEach(button => {
        button.onclick = () => {
          scenarioComparisonDetail = button.dataset.detailScenario;
          renderYear();
          document.getElementById(button.id)?.focus();
        };
      });
      $('#scenario-detail-year').onchange = event => {
        scenarioComparisonYear = Number(event.target.value);
        renderYear();
        $('#scenario-detail-year').focus();
      };
      // 只翻譯這次改寫的讀數與明細；年度表與卡片已在整體重畫時翻譯過。
      applyLanguage($('#scenario-chart-readout'));
      applyLanguage(detail);
    };
    $('#scenario-compare-year').oninput = event => {
      scenarioComparisonYear = Number(event.target.value);
      renderYear();
    };
    $('#scenario-asset-basis').onchange = event => {
      config.basis = event.target.value;
      renderScenarioComparison();
      save();
    };
    root.querySelectorAll('[data-scenario-jump]').forEach(button => {
      button.onclick = () => {
        scenarioComparisonYear = Number(button.dataset.scenarioJump);
        scenarioComparisonDetail = button.dataset.scenarioDetail;
        renderYear();
        $('#scenario-year-detail').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      };
    });
    const selectYear = event => {
      const box = $('#scenario-compare-svg').getBoundingClientRect();
      if (!box.width) return;
      const year = Math.max(
        1,
        Math.min(
          horizonYears,
          Math.round(
            ((((event.clientX - box.left) / box.width) * width - left) / (width - left - right)) * horizonYears,
          ),
        ),
      );
      if (year !== scenarioComparisonYear) {
        scenarioComparisonYear = year;
        renderYear();
      }
    };
    $('#scenario-compare-svg').onpointermove = event => {
      if (event.pointerType === 'mouse') selectYear(event);
    };
    $('#scenario-compare-svg').onpointerdown = selectYear;
    renderYear();
    applyLanguage(root);
    if (focusedId) document.getElementById(focusedId)?.focus();
  }
  // 固定情境止於耗盡年份，里程碑只看已模擬年份；MC 則把耗盡後的排定事件列為未支應。
  // 兩者不一致時在卡片上明示金額，避免誤以為沒有意外支出缺口。
  function eventsAfterDepletionNote(profile) {
    if (!profile.result.bankruptYear) return '';
    const after = eventFundingSummary(profile.result, profile.plan.emergencyEvents)
      .annual.filter(row => row.stopped)
      .reduce((sum, row) => sum + row.planned, 0);
    return after > 1
      ? `<small class="fixed-milestone-note"><span>耗盡後另有排定意外支出未列入</span> ${money(after)}</small>`
      : '';
  }
  function comparisonEventGapTable(comparison) {
    if (comparison.profiles.every(profile => profile.result.eventsModeled === false)) return '';
    return (
      '<div class="table-wrap comparison-event-gaps"><table><thead><tr><th>方案</th><th>意外支出曾缺口率</th><th>累計意外支出缺口 P50 / P75</th></tr></thead><tbody>' +
      comparison.profiles
        .map(
          profile =>
            '<tr><th>' +
            nameHtml(profile.name) +
            '</th><td>' +
            percent((profile.result.eventGapRate ?? 0) * 100) +
            '</td><td>' +
            (profile.result.cumulativeEventGap
              ? money(profile.result.cumulativeEventGap.p50) + ' / ' + money(profile.result.cumulativeEventGap.p75)
              : '—') +
            '</td></tr>',
        )
        .join('') +
      `</tbody></table></div><p class="hint">僅計入曾有意外支出缺口的路徑；名目金額。</p><p class="hint">涵蓋完整 ${comparison.horizonYears ?? currentHorizonYears()} 年已抽定及確定事件；耗盡後事件視為未支應，不延長收支模擬。缺口不轉為負債，也不會事後追繳。</p>`
    );
  }
  function eventGapMetrics(result) {
    // 沒有任何路徑出現意外支出（機率或金額為 0、也沒有指定事件）時，0% 與「—」只會佔用摘要版面。
    if (result.eventsModeled === false) return '';
    return (
      '<div class="monte-carlo-metrics event-gap-metrics"><div><small>意外支出曾缺口率</small><strong>' +
      percent((result.eventGapRate ?? 0) * 100) +
      '</strong></div><div><small>累計意外支出缺口 P50 / P75</small><strong>' +
      (result.cumulativeEventGap
        ? money(result.cumulativeEventGap.p50) + ' / ' + money(result.cumulativeEventGap.p75)
        : '—') +
      `</strong><span>僅計入曾有意外支出缺口的路徑；名目金額。</span></div></div><p class="hint">涵蓋完整 ${result.horizonYears ?? currentHorizonYears()} 年已抽定及確定事件；耗盡後事件視為未支應，不延長收支模擬。缺口不轉為負債，也不會事後追繳。</p>`
    );
  }
  function renderFixedAnnualList(profile) {
    const buckets = Object.fromEntries(profile.plan.buckets.map(bucket => [bucket.id, bucket]));
    return (
      '<p class="hint">年度列表止於資產耗盡；未模擬年份顯示已停止，不補零。</p><div class="table-wrap fixed-plan-annual"><table><thead><tr>' +
      [
        '年度',
        '生活費目標',
        '實際生活費',
        '生活費缺口',
        '必要生活費缺口',
        '意外支出',
        '意外支出已支應',
        '意外支出缺口',
        '年末總資產',
      ]
        .map(label => '<th>' + label + '</th>')
        .join('') +
      '</tr></thead><tbody>' +
      Array.from({ length: profile.result.horizonYears ?? currentHorizonYears() }, (_, index) => {
        const year = profile.result.years[index];
        if (!year) return '<tr><th>' + fixedYearLabel(index + 1) + '</th><td colspan="8">已停止</td></tr>';
        return (
          '<tr><th><button type="button" class="ghost" data-fixed-expand="' +
          year.year +
          '" aria-expanded="' +
          (fixedExpandedYear === year.year) +
          '">' +
          fixedYearLabel(year.year) +
          '</button></th>' +
          [
            year.spend,
            year.actualSpend,
            year.unmetSpend,
            year.floorGap,
            year.eventSpend,
            year.eventSpend - year.eventUnmet,
            year.eventUnmet,
            year.total,
          ]
            .map(value => '<td>' + money(value) + '</td>')
            .join('') +
          '</tr>' +
          (fixedExpandedYear === year.year ? yearDetailRow(year, buckets, profile.plan, 9) : '')
        );
      }).join('') +
      '</tbody></table></div>'
    );
  }
  function renderFixedComparison() {
    const profiles = window.RetirementFixedComparison.compareFixedPlans(state, currentScenario);
    const root = $('#scenario-content');
    root.onclick = null;
    if (!profiles.length) {
      root.innerHTML = '<p>請先建立並啟用至少一個比較方案。</p>';
      applyLanguage();
      return;
    }
    if (!profiles.some(profile => profile.id === fixedComparisonProfile)) fixedComparisonProfile = profiles[0].id;
    const horizonYears = profiles[0].result.horizonYears;
    fixedComparisonYear = Math.min(fixedComparisonYear, horizonYears);
    const metrics = {
      total: '年末總資產',
      actualSpend: '實際生活費',
      unmetSpend: '生活費缺口',
      eventUnmet: '意外支出缺口',
    };
    const colors = seriesColors;
    const maximum = Math.max(
      1,
      ...profiles.flatMap(profile => [
        profile.plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0),
        ...profile.result.years.map(y => y.total),
      ]),
    );
    const x = year => 80 + (year / horizonYears) * 890;
    const y = value => 240 - (value / maximum) * 210;
    const chart =
      '<section class="asset-chart"><h3>方案資產走勢</h3><div class="chart-legend">' +
      profiles
        .map(
          (profile, index) =>
            `<span><i style="background:${colors[index % colors.length]}"></i>${nameHtml(profile.name)}</span>`,
        )
        .join('') +
      '</div><svg viewBox="0 0 1000 280" role="img" aria-label="比較方案總資產走勢">' +
      '<g class="chart-grid">' +
      [0, 0.25, 0.5, 0.75, 1]
        .map(
          ratio =>
            `<line x1="80" x2="970" y1="${y(maximum * ratio)}" y2="${y(maximum * ratio)}"/><text x="70" y="${y(maximum * ratio) + 4}" text-anchor="end">${money(maximum * ratio, true)}</text>`,
        )
        .join('') +
      '</g>' +
      '<g class="chart-axis">' +
      axisYears(0, horizonYears, 6)
        .map(year => `<text x="${x(year)}" y="270" text-anchor="middle">${year}</text>`)
        .join('') +
      '</g>' +
      profiles
        .map((profile, index) => {
          const points = [
            [0, profile.plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0)],
            ...profile.result.years.map(year => [year.year, year.total]),
          ];
          const d = points.map(([year, value], i) => `${i ? 'L' : 'M'}${x(year)},${y(value)}`).join(' ');
          return `<path class="asset-line" style="stroke:${colors[index % colors.length]}" d="${d}"/>`;
        })
        .join('') +
      '</svg></section>';
    const milestone = (profile, label, year) =>
      `<div><span>${label}</span> ${year ? `<button type="button" class="ghost" data-fixed-jump="${year}" data-fixed-profile="${profile.id}">${year}</button>` : '<span>未發生</span>'}</div>`;
    root.innerHTML = html(
      `<p class="hint"><span>各方案年通膨率</span> · ${profiles.map(profile => `${nameHtml(profile.name)} ${percent(profile.plan.inflation)}`).join(' / ')}${Object.keys(state.inflationRates ?? {}).length ? ' · <span>逐年通膨覆寫優先；指定年度不使用方案年通膨。</span>' : ''}${Object.values(state.coreReturns ?? {}).some(value => Number.isFinite(value)) ? ' · <span>已套用逐年市場報酬覆寫</span>' : ''}</p>`,
      '<p class="hint">採年度市場路徑；ETF 策略仍依各方案計算。不沿用 MC 代表路徑的月頻殘差。耗盡後停止計算，後續資料不補零。</p>',
      profiles.length < 2 ? '<p class="hint">目前只有一個參與方案；可至方案管理新增或啟用其他方案。</p>' : '',
      '<div class="fixed-milestones">',
      profiles
        .map(
          profile =>
            `<article><strong>${nameHtml(profile.name)}</strong>${milestone(profile, '首次出售核心 ETF（含補水）', profile.firstCoreSale)}${milestone(profile, '首次必要生活費缺口', profile.result.firstFloorGapYear)}${milestone(profile, '首次意外支出缺口', profile.result.firstEventShortfallYear)}${milestone(profile, '資產耗盡年份', profile.result.bankruptYear)}${eventsAfterDepletionNote(profile)}</article>`,
        )
        .join(''),
      '</div>',
      chart,
      '<label class="fixed-metric-label">年度比較指標 <select id="fixed-comparison-metric">',
      Object.entries(metrics)
        .map(
          ([key, label]) =>
            `<option value="${key}" ${key === fixedComparisonMetric ? 'selected' : ''}>${label}</option>`,
        )
        .join(''),
      '</select></label><p class="hint">點選金額查看該年明細；下方切換方案時保留同一年。</p>',
      '<div class="table-wrap fixed-year-table"><table><thead><tr><th>年度</th>',
      profiles.map(profile => `<th>${nameHtml(profile.name)}</th>`).join(''),
      '</tr></thead><tbody>',
      Array.from(
        { length: horizonYears },
        (_, i) =>
          `<tr><th>${fixedYearLabel(i + 1)}</th>${profiles
            .map(profile => {
              const year = profile.result.years[i];
              return `<td><button type="button" class="ghost" data-fixed-jump="${i + 1}" data-fixed-profile="${profile.id}">${year ? money(year[fixedComparisonMetric]) : '<span>已停止</span>'}</button></td>`;
            })
            .join('')}</tr>`,
      ).join(''),
      '</tbody></table></div><section id="fixed-year-detail" class="fixed-year-detail"></section>',
    );
    function renderDetail() {
      const profile = profiles.find(item => item.id === fixedComparisonProfile);
      const year = profile.result.years.find(item => item.year === fixedComparisonYear);
      const host = $('#fixed-year-detail');
      host.innerHTML = html(
        '<h3>年度水庫明細</h3><div class="fixed-detail-controls">',
        `<label><span>明細檢視</span><select id="fixed-detail-mode"><option value="year" ${fixedDetailMode === 'year' ? 'selected' : ''}>單一年度</option><option value="all" ${fixedDetailMode === 'all' ? 'selected' : ''}>完整年度列表</option></select></label>`,
        `<label ${fixedDetailMode === 'all' ? 'hidden' : ''}>年度 <select id="fixed-detail-year">`,
        Array.from(
          { length: horizonYears },
          (_, i) =>
            `<option value="${i + 1}" ${i + 1 === fixedComparisonYear ? 'selected' : ''}>${fixedYearLabel(i + 1)}</option>`,
        ).join(''),
        '</select></label>',
        profiles
          .map(
            item =>
              `<button type="button" class="ghost" data-fixed-detail-profile="${item.id}" aria-pressed="${item.id === profile.id}">${nameHtml(item.name)}</button>`,
          )
          .join(''),
        '</div>',
        fixedDetailMode === 'all'
          ? renderFixedAnnualList(profile)
          : year
            ? `<div class="fixed-detail-totals"><span>生活費目標 ${money(year.spend)}</span><span>實際生活費 ${money(year.actualSpend)}</span><span>生活費缺口 ${money(year.unmetSpend)}</span><span>必要生活費缺口 ${money(year.floorGap)}</span><span>保證性收入 ${money(year.guaranteedIncome)}</span><span><span>意外支出缺口</span> ${money(year.eventUnmet)}</span></div><div class="table-wrap"><table><tbody>${yearDetailRow(year, Object.fromEntries(profile.plan.buckets.map(bucket => [bucket.id, bucket])), profile.plan)}</tbody></table></div>`
            : '<p>此方案已於較早年度耗盡；本年沒有模擬明細。</p>',
      );
      $('#fixed-detail-mode').onchange = event => {
        fixedDetailMode = event.target.value;
        renderDetail();
      };
      host.querySelectorAll('[data-fixed-expand]').forEach(button => {
        button.onclick = () => {
          const selected = Number(button.dataset.fixedExpand);
          fixedExpandedYear = fixedExpandedYear === selected ? null : selected;
          renderDetail();
          host.querySelector(`[data-fixed-expand="${selected}"]`)?.focus();
        };
      });
      $('#fixed-detail-year').onchange = event => {
        fixedComparisonYear = Number(event.target.value);
        renderDetail();
      };
      host.querySelectorAll('[data-fixed-detail-profile]').forEach(button => {
        button.onclick = () => {
          fixedComparisonProfile = button.dataset.fixedDetailProfile;
          renderDetail();
        };
      });
      applyLanguage();
    }
    $('#fixed-comparison-metric').onchange = event => {
      fixedComparisonMetric = event.target.value;
      renderFixedComparison();
    };
    root.querySelectorAll('[data-fixed-jump]').forEach(button => {
      button.onclick = () => {
        fixedDetailMode = 'year';
        fixedComparisonYear = Number(button.dataset.fixedJump);
        fixedComparisonProfile = button.dataset.fixedProfile;
        renderDetail();
        $('#fixed-year-detail').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      };
    });
    renderDetail();
  }
  function renderScenario() {
    const period = currentPlanningPeriod();
    $('#fixed-single-description').textContent =
      `使用目前選定方案，檢查從 ${period.currentAge} 歲到 ${period.targetAge} 歲的 ${period.years} 年資產與生活費。逐年路徑不帶入 MC。`;
    $('#fixed-comparison-enabled').checked = state.monteCarloComparisonEnabled;
    $('#fixed-comparison-help').hidden = !state.monteCarloComparisonEnabled;
    $('#fixed-single-description').hidden = state.monteCarloComparisonEnabled;
    $('#edit-comparison-plans').hidden = !state.monteCarloComparisonEnabled;
    $('#summary').hidden = true;
    $('#main-plan-editor').hidden = true;
    if (state.monteCarloComparisonEnabled) {
      renderFixedComparison();
      return;
    }
    const plan = fixedSinglePlan();
    const {
      years,
      spendShortfall,
      eventShortfall,
      firstShortfallYear,
      cumulativeUnmet,
      cumulativePortfolioActual,
      cumulativeGuaranteedIncome,
      cumulativeGuaranteedIncomeUsed,
      plannedSpendTotal,
      guardrailSaturatedYears,
      guardrailCutYears,
      firstFloorBindingYear,
      floorBindingYears,
      firstFloorGapYear,
      cumulativeFloorGap,
      bankruptYear,
      horizonYears,
    } = simulate(plan, currentScenario);
    const first = years[0],
      last = years[years.length - 1],
      scenario = scenarios[currentScenario];
    const bucketById = Object.fromEntries(plan.buckets.map(b => [b.id, b]));
    const sourceName = {
      income: `${nameHtml(bucketById.income.name)} 配息`,
      incomePrincipal: `${nameHtml(bucketById.income.name)} 本金`,
      emergency: nameHtml(bucketById.emergency.name),
      defense: nameHtml(bucketById.defense.name),
      growth: nameHtml(bucketById.growth.name),
    };
    const initial = plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
    const change = initial > 1 ? (last.total / initial - 1) * 100 : null;
    const chartSeries = [
      { id: 'emergency', name: bucketById.emergency.name, color: bucketColor(bucketById.emergency) },
      { id: 'defense', name: bucketById.defense.name, color: bucketColor(bucketById.defense) },
      { id: 'income', name: bucketById.income.name, color: bucketColor(bucketById.income) },
      { id: 'growth', name: bucketById.growth.name, color: bucketColor(bucketById.growth) },
      { id: 'total', name: '總資產', color: 'var(--chart-total)' },
    ];
    const startValues = Object.fromEntries(plan.buckets.map(b => [b.id, +b.amount]));
    startValues.total = initial;
    const visibleSeries = chartSeries.filter(s => !hiddenSeries.has(s.id));
    // 縱軸只看留下的線：關掉總資產正是為了把四個水庫撐開來看，沿用原本的上限等於這個功能只做了
    // 一半。全部關掉時退回完整刻度——空圖再配上一整排 $0 格線，看起來會像壞了而不是空的。
    const scaleSeries = visibleSeries.length ? visibleSeries : chartSeries;
    // 起始與年末都為零時仍保留一張有效的平線圖；否則 chartY() 的分母為 0，SVG 會收到 NaN。
    const maxChartValue = Math.max(
      1,
      ...scaleSeries.flatMap(s => [
        startValues[s.id],
        ...years.map(y => (s.id === 'total' ? y.total : y.values[s.id])),
      ]),
    );
    const horizon = years.length,
      chartWidth = 1000,
      chartHeight = 285,
      chartLeft = 72,
      chartRight = 24,
      chartTop = 20,
      chartBottom = 42;
    const chartX = year => chartLeft + (year / years.length) * (chartWidth - chartLeft - chartRight);
    const chartY = value =>
      chartTop + ((maxChartValue - value) / maxChartValue) * (chartHeight - chartTop - chartBottom);
    const chartPath = id =>
      [[0, startValues[id]], ...years.map(y => [y.year, id === 'total' ? y.total : y.values[id]])]
        .map(([year, value], index) => `${index ? 'L' : 'M'}${chartX(year).toFixed(1)},${chartY(value).toFixed(1)}`)
        .join(' ');
    const yTicks = [0, 0.25, 0.5, 0.75, 1]
      .map(ratio => {
        const value = maxChartValue * ratio;
        const y = chartY(value);
        return html(
          `<g><line x1="${chartLeft}" x2="${chartWidth - chartRight}" y1="${y}" y2="${y}" />`,
          `<text x="${chartLeft - 10}" y="${y + 4}" text-anchor="end">${money(value, true)}</text></g>`,
        );
      })
      .join('');
    const tickYears = [
      ...new Set([...Array.from({ length: Math.floor(horizon / 5) + 1 }, (_, index) => index * 5), horizon]),
    ];
    const xTicks = tickYears
      .map(year => `<text x="${chartX(year)}" y="${chartHeight - 13}" text-anchor="middle">第 ${year} 年</text>`)
      .join('');
    const chartLegend = chartSeries
      .map(s => {
        const endValue = s.id === 'total' ? last.total : last.values[s.id];
        const off = hiddenSeries.has(s.id);
        // 關掉線條不連帶關掉數字：圖例上的年末金額是這條線唯一的文字出口，藏起來只是把資訊
        // 弄丟。「圖上沒有它」由色點轉空心與整體淡化表示。
        return html(
          `<button type="button" class="legend-toggle${off ? ' off' : ''}" data-series="${s.id}" data-user-label="${escapeHtml(s.name)}"`,
          ` aria-pressed="${!off}" title="${off ? '顯示' : '隱藏'}${escapeHtml(s.name)}走勢">`,
          `<i style="background:${off ? 'transparent' : escapeHtml(s.color)};border-color:${escapeHtml(s.color)}"></i>`,
          `${nameHtml(s.name)} <b>${money(endValue, true)}</b></button>`,
        );
      })
      .join('');
    const chartLines = visibleSeries
      .map(s => {
        const totalClass = s.id === 'total' ? 'total-line' : '';
        return `<path class="asset-line ${totalClass}" d="${chartPath(s.id)}" style="stroke:${escapeHtml(s.color)}"></path>`;
      })
      .join('');
    const chartTitle = `${horizon} 年資產趨勢${bankruptYear ? `（第 ${bankruptYear} 年停止）` : ''}`;
    const chart = html(
      `<section class="asset-chart" aria-label="${horizon} 年四個水庫及總資產趨勢">`,
      `<div class="chart-heading"><h3>${chartTitle}</h3>`,
      `<div class="chart-legend">${chartLegend}</div></div>`,
      `<svg id="asset-chart-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img"`,
      ' aria-label="四個水庫與總資產的模擬走勢">',
      `<g class="chart-grid">${yTicks}</g><g class="chart-axis">${xTicks}</g>`,
      `<line id="chart-guide" class="chart-guide" y1="${chartTop}" y2="${chartHeight - chartBottom}"`,
      ' visibility="hidden" />',
      `<g id="chart-points"></g>${chartLines}</svg>`,
      '<div id="chart-tooltip" class="chart-tooltip" role="status" aria-live="polite"></div></section>',
    );
    const shownYears = years.slice(projectionStart, projectionStart + 5);
    const rows = shownYears.map(y => renderProjectionRow(y, sourceName, bucketById, years, plan)).join('');
    const assetCardLabel = bankruptYear
      ? `第 ${bankruptYear} 年（${period.currentAge + bankruptYear} 歲）停止時資產`
      : `${period.targetAge} 歲時預估資產`;
    const assetCard = html(
      `<article><span>${assetCardLabel}</span><strong>${money(last.total)}</strong>`,
      change === null
        ? '<small>起始資產為 $0，無從比較</small></article>'
        : `<small class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${percent(change)} 對比起始資產</small></article>`,
    );
    const firstYearIncome = first.sources.income || 0;
    const sourceCard = html(
      `<article><span>第一年支出來源</span><strong>${money(firstYearIncome, true)} 配息</strong>`,
      `<small>${money(first.spend - firstYearIncome, true)} 由其他水庫支援</small></article>`,
    );
    // 沒有缺口時這一段更重要——「皆有來源」正是靠砍支出換來的，只在缺口分支顯示等於把代價
    // 藏起來。破產分支不加，資產耗盡已經蓋過一切。
    //
    // 要給兩個數字。原本只寫「護欄連續滿檔 N 年（支出被持續下調）」，但括號描述的是**收緊**
    // 而 N 是**滿檔**——兩者可以差很多（日經 1987 那條路徑連續收緊 15 年，其中滿檔只有 7 年），
    // 使用者自己數 CSV 就會發現對不上。滿檔是收緊的子集：砍了，但砍完仍高於下調觸發點。
    const saturationNote = guardrailCutYears
      ? `；支出連續下調 ${guardrailCutYears} 年` +
        (guardrailSaturatedYears ? `，其中 ${guardrailSaturatedYears} 年砍到上限仍壓不回區間` : '')
      : '';
    // 「無缺口」不等於 Floor 沒有代價：護欄若已被底線擋住，資產壓力會轉成日後的耗盡風險。
    // 這段是固定情境的黃燈出口；真正付不出 Floor 時仍沿用既有的缺口／耗盡說明，不另造紅燈。
    const floorNote = plan.spendingFloor.annualAmount
      ? cumulativeFloorGap > 1
        ? `；第 ${firstFloorGapYear} 年必要生活費短少 ${money(cumulativeFloorGap)}（累計）`
        : floorBindingYears
          ? `；Floor 自第 ${firstFloorBindingYear} 年咬住，共 ${floorBindingYears} 年，護欄無法再收緊`
          : '；Floor 未限制護欄'
      : '';
    const ruleDetail = bankruptYear
      ? `第 ${bankruptYear} 年四個水庫已耗盡，模擬停止；累計缺口 ${money(cumulativeUnmet)}（截至停止年）${floorNote}`
      : spendShortfall
        ? `第 ${firstShortfallYear} 年首度缺口；累計 ${money(cumulativeUnmet)}${saturationNote}${floorNote}`
        : eventShortfall
          ? `生活費皆有來源；意外支出曾有缺口${saturationNote}${floorNote}`
          : `${horizonYears} 年內生活費皆有來源${saturationNote}${floorNote}`;
    const floorConstrained = floorBindingYears > 0;
    const ruleCard = html(
      `<article><span>規則狀態</span><strong class="${bankruptYear || spendShortfall ? 'down' : floorConstrained ? 'warn' : 'up'}">`,
      bankruptYear ? '投資組合耗盡' : spendShortfall ? '需調整' : floorConstrained ? 'Floor 已咬住' : '可持續',
      `</strong><small>${ruleDetail}</small></article>`,
    );
    // 有年金之後「生活水準有沒有被砍」與「四個桶夠不夠」是兩個問題，只給前者會讓 90% 靠年金
    // 的計畫看起來像投資組合的功勞。兩個數字必須並排，否則就是第七個「標籤與數字不同步」。
    const cumulativeActual = years.reduce((sum, y) => sum + y.actualSpend, 0);
    // 這張卡把三個數字並排成一個加法：累計支應 ＝ 其中水庫 ＋ 保證性收入。因此第三個數字必須是
    // **用於生活費的那一段**，不是收到的總額——年金大於生活費時多出來的留在水庫裡沒被花掉，
    // 用毛額會讓這個加法差 $2,759,389 而沒有任何提示。結餘另外講，它是一筆真的存在的錢。
    const incomeSurplus = cumulativeGuaranteedIncome - cumulativeGuaranteedIncomeUsed;
    const incomeCard = cumulativeGuaranteedIncome
      ? html(
          '<article><span>累計支應</span>',
          `<strong>${percent((cumulativeActual / plannedSpendTotal) * 100)}</strong>`,
          `<small>其中水庫 ${percent((cumulativePortfolioActual / plannedSpendTotal) * 100)}；`,
          `保證性收入支應 ${money(cumulativeGuaranteedIncomeUsed, true)}`,
          incomeSurplus > 1 ? `（另有 ${money(incomeSurplus, true)} 轉入資產）` : '',
          '</small></article>',
        )
      : '';
    const cards = `<div class="scenario-cards">${assetCard}${sourceCard}${ruleCard}${incomeCard}</div>`;
    const callout = html(
      '<div class="scenario-callout"><span class="scenario-dot"></span><div>',
      `<strong>${scenario.label}：${scenario.description}</strong>`,
      '<small>正核心報酬年度依序由核心 ETF 補：緊急金至年度支出 100%、國債梯至當年目標梯長與到期現金流、',
      '現金流水庫至起始配置比例。熊市不賣核心補水。</small></div></div>',
    );
    const lastShownYear = Math.min(projectionStart + 5, years.length);
    const projectionControls = html(
      '<div class="projection-controls">',
      '<button class="page-button" data-action="export-csv">匯出 CSV</button>',
      // 出現條件原本只看 coreReturns：報酬被清掉、只剩複製過來的事件時按鈕整個消失，
      // 使用者就沒有出口了。三種逐年覆寫任一存在就顯示。
      Object.keys(state.coreReturns).length ||
        Object.keys(state.inflationRates).length ||
        Object.keys(state.safeRates ?? {}).length ||
        Object.keys(state.emergencyEvents).length
        ? '<button class="page-button" data-action="clear-per-year">清除逐年覆寫</button>'
        : '',
      `<button class="page-button" data-page="previous" ${projectionStart === 0 ? 'disabled' : ''}>`,
      '← 前五年</button>',
      `<button class="page-button" data-page="next" ${projectionStart + 5 >= years.length ? 'disabled' : ''}>`,
      '後五年 →</button></div>',
    );
    const projection = html(
      `<div class="projection"><div class="projection-heading">`,
      `<h3>第 ${projectionStart + 1}–${lastShownYear} 年提領軌跡 `,
      '<small>可逐年設定意外支出與核心報酬；可同時展開多個年末資產查看水庫明細</small></h3>',
      projectionControls,
      // 這張表跟另外兩張一樣要包在 .table-wrap 裡：沒包的話窄視窗下它會撐寬整份文件，
      // 讓整個視窗多一條橫向捲軸，而不是只在面板內捲動。
      '</div><div class="table-wrap"><table><thead><tr><th>年度</th><th>計畫支出</th><th>意外支出</th>',
      '<th>資金來源</th><th>核心報酬</th><th>年末資產</th></tr></thead>',
      `<tbody>${rows}</tbody></table></div></div>`,
    );
    const projectionOpen = $('#projection-details')?.open;
    const summaryOpen = $('#scenario-statistics')?.open;
    const headline =
      '<div class="result-headline">' +
      `<article><small>資產能否維持到 ${period.targetAge} 歲</small><strong>` +
      (bankruptYear ? '第 ' + bankruptYear + ' 年耗盡' : '本情境未耗盡') +
      '</strong></article>' +
      '<article><small>累計實際／原始生活費計畫</small><strong>' +
      (plannedSpendTotal > 0 ? percent((cumulativeActual / plannedSpendTotal) * 100) : '未設定生活費') +
      `</strong><small>原始計畫包含完整 ${horizonYears} 年</small></article>` +
      '<article><small>必要開銷能否支付</small><strong>' +
      (plan.spendingFloor.annualAmount
        ? cumulativeFloorGap > 1
          ? '曾有缺口'
          : bankruptYear
            ? '耗盡後無資產支應'
            : '本情境可支應'
        : '未設定必要生活費') +
      '</strong></article></div>';
    $('#scenario-content').innerHTML =
      (Object.keys(plan.inflationRates ?? {}).length
        ? '<p class="hint">逐年通膨覆寫優先；指定年度不使用方案年通膨。</p>'
        : '') +
      headline +
      '<details id="scenario-statistics" class="settings-fold" ' +
      (summaryOpen ? 'open' : '') +
      '><summary>完整統計與規則說明</summary>' +
      cards +
      callout +
      '</details>' +
      chart +
      '<details id="projection-details" class="settings-fold" ' +
      (projectionOpen ? 'open' : '') +
      '><summary>年度明細、逐年覆寫與匯出</summary>' +
      projection +
      '</details>';
    $('#scenario-content .scenario-callout small').textContent = [
      '生活費先使用配息，其餘按 ' +
        plan.withdrawalOrders.planned.map(id => withdrawalLabels[id]).join(' → ') +
        ' 支應。',
      '必要生活費與意外支出可突破熊市提款門檻；可調整生活費受門檻限制。',
      '意外支出：' + eventPolicyDescriptions[plan.eventWithdrawalPolicy],
      '補水目標：國債 ' +
        coverageTargets(plan).defense +
        '%、配息 ' +
        coverageTargets(plan).income +
        '% 的年度生活費；初始 $0 水庫不主動補水。',
    ].join(' ');
    $('#scenario-content').onclick = e => {
      const button = e.target.closest('.end-total, .page-button, .legend-toggle');
      if (!button) return;
      if (button.dataset.action === 'export-csv') {
        downloadCsv(
          trajectoryCsv(years, bucketById, {
            ...plan,
            historicalSampleSources: state.historicalSampleSources,
            representativePathSource: state.representativePathSource,
          }),
          '退休水庫提領軌跡.csv',
        );
        return;
      }
      if (button.dataset.action === 'clear-per-year') {
        clearPerYearOverrides();
        return;
      }
      if (button.dataset.series) {
        const id = button.dataset.series;
        if (hiddenSeries.has(id)) hiddenSeries.delete(id);
        else hiddenSeries.add(id);
      } else if (button.dataset.year) {
        const year = +button.dataset.year;
        if (expandedYears.has(year)) expandedYears.delete(year);
        else expandedYears.add(year);
      } else if (button.dataset.page === 'next') {
        projectionStart += 5;
      } else if (button.dataset.page === 'previous') {
        projectionStart -= 5;
      }
      renderScenario();
    };
    document.querySelectorAll('.year-return').forEach(
      select =>
        (select.onchange = e => {
          const year = +e.target.dataset.returnYear;
          state.coreReturns[year] = e.target.value === '' ? null : +e.target.value;
          // 代表路徑的 BXM 月頻資料只對原本那條路徑有效；手動改任一年度後不能再拿舊殘差重播。
          delete state.bxmMonthlyPath;
          delete state.incomeMonthlyPath;
          // 一年報酬改掉後，這組來源年份已不再能描述整條軌跡，CSV 不可繼續宣稱它可追溯。
          delete state.historicalSampleSources;
          delete state.representativePathSource;
          expandedYears.clear();
          renderAll();
        }),
    );
    document.querySelectorAll('.event-spend').forEach(input => {
      input.onchange = e => {
        const year = +e.target.dataset.eventYear,
          amount = Math.max(0, +e.target.value || 0);
        if (amount) state.emergencyEvents[year] = amount;
        else delete state.emergencyEvents[year];
        // 動過一格就整組轉為使用者所有。粒度刻意粗：逐年記來源會讓「清掉一半」變成可能的
        // 狀態，而那個狀態沒有人能解釋。
        state.eventsFromPath = false;
        delete state.representativePathSource;
        expandedYears.clear();
        renderAll();
      };
      input.onkeydown = event => {
        if (event.key === 'Enter') input.blur();
      };
    });
    const chartSvg = $('#asset-chart-svg'),
      chartTooltip = $('#chart-tooltip'),
      chartGuide = $('#chart-guide'),
      chartPoints = $('#chart-points');
    chartSvg.onmousemove = event => {
      const box = chartSvg.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      const index = Math.round(fraction * years.length);
      const valueSet = index === 0 ? startValues : { ...years[index - 1].values, total: years[index - 1].total };
      const x = chartX(index);
      chartGuide.setAttribute('x1', x);
      chartGuide.setAttribute('x2', x);
      chartGuide.setAttribute('visibility', 'visible');
      chartPoints.innerHTML = visibleSeries
        .map(s => `<circle cx="${x}" cy="${chartY(valueSet[s.id])}" r="4" style="fill:${escapeHtml(s.color)}" />`)
        .join('');
      const tooltipRows = visibleSeries
        .map(
          s =>
            `<span><i style="background:${escapeHtml(s.color)}"></i>${nameHtml(s.name)}<b>${money(valueSet[s.id])}</b></span>`,
        )
        .join('');
      chartTooltip.innerHTML = `<strong>第 ${index} 年</strong>${tooltipRows}`;
      const parentBox = chartSvg.parentElement.getBoundingClientRect();
      chartTooltip.style.left = `${Math.min(event.clientX - parentBox.left + 12, parentBox.width - 210)}px`;
      chartTooltip.style.top = `${Math.max(42, event.clientY - parentBox.top + 12)}px`;
      chartTooltip.classList.add('visible');
    };
    chartSvg.onmouseleave = () => {
      chartTooltip.classList.remove('visible');
      chartGuide.setAttribute('visibility', 'hidden');
      chartPoints.innerHTML = '';
    };
    applyLanguage();
  }
  function renderAll() {
    const signature = allocationInputsSignature();
    if (signature !== allocationSignature) {
      allocationTargetsApplied = false;
      state.allocationTargetsApplied = false;
      $('#allocation-preview').hidden = true;
    }
    allocationSignature = signature;
    renderSummary();
    renderBuckets();
    renderTreasury();
    renderIncomeSources();
    renderScenario();
    if (currentView === 'scenario-comparison-view') renderScenarioComparison();
    persist();
  }
  function renderMonteCarloInputs() {
    for (const [id, key] of [
      ['monte-carlo-scenario', 'scenario'],
      ['monte-carlo-paths', 'paths'],
      ['monte-carlo-seed', 'seed'],
      ['monte-carlo-mean', 'mean'],
      ['monte-carlo-volatility', 'volatility'],
      ['monte-carlo-event-probability', 'eventProbability'],
      ['monte-carlo-event-amount', 'eventAmount'],
    ])
      $('#' + id).value = state.monteCarlo[key];
    const historical = state.monteCarlo.samplingMode === 'historical';
    $('#monte-carlo-sampling-mode').value = historical ? 'historical' : 'parametric';
    $('#monte-carlo-historical-market').value = state.monteCarlo.historicalMarket ?? 'sp500';
    $('#monte-carlo-historical-block-length').value = state.monteCarlo.historicalBlockLength ?? 3;
    $('#monte-carlo-historical-jitter').value = state.monteCarlo.historicalJitter ?? 0;
    document.querySelectorAll('.historical-sampling-control').forEach(control => (control.hidden = !historical));
    $('#monte-carlo-mean').disabled = historical;
    $('#monte-carlo-volatility').disabled = historical;
    $('#monte-carlo-inflation-model').disabled = historical;
    $('#monte-carlo-inflation-model').value = state.monteCarlo.inflationModel ?? 'fixed';
    $('#monte-carlo-fixed-event-year').value = state.monteCarlo.fixedEvent?.year ?? '';
    $('#monte-carlo-fixed-event-amount').value = state.monteCarlo.fixedEvent?.amount ?? '';
    const previousSeed = $('#previous-monte-carlo-seed');
    previousSeed.hidden = previousMonteCarloSeed === null;
    if (previousMonteCarloSeed !== null) $('#previous-monte-carlo-seed-value').value = previousMonteCarloSeed;
  }
  function renderMonteCarloProfile() {
    $('#summary').hidden = true;
    $('#main-plan-editor').hidden = true;
    $('#comparison-workspace').hidden = false;
    $('#comparison-settings').hidden = false;
    $('#comparison-settings-title').textContent = '方案設定';
    $('#monte-carlo-profile-actions').hidden = false;
    const selected = selectedProfile();
    const profiles = state.monteCarloComparisonEnabled
      ? state.monteCarloProfiles.filter(profile => profile.enabled !== false)
      : [selected];
    $('#monte-carlo-profile-title').innerHTML =
      '<span>目前方案</span> ' + profiles.map(profile => nameHtml(profile.name)).join(' / ');
    $('#monte-carlo-profile-summary').innerHTML = profiles
      .map(
        profile =>
          `<p>${nameHtml(profile.name)} · <span>起始流動資產</span> ${money(profile.plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0))} · <span>首年生活費</span> ${money(profile.plan.annualSpend)} · <span>必要生活費</span> ${money(profile.plan.spendingFloor.annualAmount)}</p>`,
      )
      .join('');
    $('#monte-carlo-comparison-enabled').checked = state.monteCarloComparisonEnabled;
    renderSharedPlanSelector();
    renderProfileActions();
    renderPlanDifferences();
    renderMonteCarloPlanCards();
    applyLanguage();
  }
  function updateMonteCarloPlan(id, mutate) {
    const index = state.monteCarloProfiles.findIndex(profile => profile.id === id);
    if (index < 0) return;
    const profile = state.monteCarloProfiles[index];
    cancelProfileCopy();
    const draft = JSON.parse(JSON.stringify(profile.plan));
    mutate(draft);
    syncGrowthToLockedTotal(draft);
    const plan = monteCarloPlanSnapshot(hydrateState({ ...draft, monteCarloProfiles: null }, true));
    state.monteCarloProfiles[index] = { ...profile, plan };
    invalidateMonteCarlo();
    persist();
    renderMonteCarloProfile();
    renderMonteCarlo();
  }
  function renderProfileActions() {
    const host = $('#monte-carlo-profile-actions');
    host.innerHTML =
      '<p><span>複製來源</span> ' +
      nameHtml(selectedProfile().name) +
      '</p>' +
      ['a', 'b', 'c']
        .filter(id => !state.monteCarloProfiles.some(profile => profile.id === id))
        .map(
          id =>
            `<button type="button" class="ghost" data-create-profile="${id}"><span>新增方案</span> ${id.toUpperCase()} <span>（複製單選方案）</span></button>`,
        )
        .join('');
    host.querySelectorAll('[data-create-profile]').forEach(button => {
      button.onclick = () => requestProfileCopy(button.dataset.createProfile);
    });
  }
  function renderPlanDifferences() {
    const host = $('#plan-differences');
    host.hidden = !state.monteCarloComparisonEnabled;
    if (host.hidden) {
      host.replaceChildren();
      return;
    }
    const profiles = state.monteCarloProfiles;
    const baseline = profiles.find(profile => profile.enabled !== false);
    if (!baseline) return;
    const rows = [
      ['total', '起始流動資產', plan => plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0), money],
      ['spend', '首年生活費', plan => plan.annualSpend, money],
      ['floor', '必要生活費', plan => plan.spendingFloor.annualAmount, money],
      ['inflation', '年通膨率', plan => plan.inflation, percent],
      ...DEFAULT.buckets.map(bucket => [
        bucket.id,
        bucket.name,
        plan => plan.buckets.find(item => item.id === bucket.id).amount,
        money,
      ]),
      [
        'growth-strategy',
        '核心 ETF',
        plan => plan.growthProfile?.kind ?? 'market',
        value => (value === 'bxm' ? 'BXM' : '純大盤'),
      ],
      [
        'income-strategy',
        '現金流 ETF',
        plan => plan.incomeProfile?.kind ?? 'legacy',
        value => (value === 'legacy' ? '自訂收益型' : value.toUpperCase()),
      ],
    ];
    host.innerHTML = html(
      '<h3>方案差異摘要</h3><p class="hint">標示與基準不同的值；未比較方案不參與模擬。此表只摘要主要配置，完整規則請展開方案。</p>',
      '<div class="table-wrap"><table class="plan-difference-table"><thead><tr><th>項目</th>',
      profiles
        .map(
          profile =>
            `<th>${nameHtml(profile.name)}${profile.id === baseline.id ? '<small>（基準）</small>' : profile.enabled === false ? '<small>（未比較）</small>' : ''}</th>`,
        )
        .join(''),
      '</tr></thead><tbody>',
      rows
        .map(
          ([key, label, value, format]) =>
            `<tr data-difference-row="${key}"><th>${escapeHtml(label)}</th>${profiles
              .map(profile => {
                const different = value(profile.plan) !== value(baseline.plan);
                return `<td data-difference-profile="${profile.id}" class="${different ? 'plan-value-different' : ''}">${escapeHtml(String(format(value(profile.plan))))}${different ? '<small>與基準不同</small>' : ''}</td>`;
              })
              .join('')}</tr>`,
        )
        .join(''),
      '</tbody></table></div>',
    );
  }
  // 單方案模式有「目前方案」，只提供目前方案 → 其他方案；多方案比較沒有目前方案，
  // 每張卡都能從任一其他方案複製，不必先切回單方案改選。
  function copySources(profile) {
    const others = state.monteCarloProfiles.filter(item => item.id !== profile.id);
    if (state.monteCarloComparisonEnabled) return others;
    return profile.id === selectedPlanId ? [] : [selectedProfile()];
  }
  function renderMonteCarloPlanCards() {
    const root = $('#monte-carlo-plan-cards');
    const openCards = new Set([...root.querySelectorAll('[data-plan-card][open]')].map(card => card.dataset.planCard));
    const profiles = state.monteCarloProfiles;
    if (!profiles.length) {
      root.innerHTML = '';
      return;
    }
    root.innerHTML = html(
      '<div class="monte-carlo-plan-heading"><strong>方案設定</strong><small>修改立即儲存至此方案，固定情境與 MC 共用；各方案保留自己的年通膨率，MC 結果需重新執行。</small></div>',
      '<div class="monte-carlo-plan-cards">',
      profiles
        .map(profile => {
          const plan = profile.plan;
          const monthlySpend = planSpendInputModes.get(profile.id) === 'monthly';
          const enabled = !state.monteCarloComparisonEnabled || profile.enabled !== false;
          const activeCount = state.monteCarloProfiles.filter(item => item.enabled !== false).length;
          const total = plan.buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
          const locked = Number.isFinite(plan.lockedInitialAssets);
          const guaranteed = incomeScheduleLabel(plan.guaranteedIncome) || '無';
          const treasury = plan.treasury.rungs
            .map(rung => `第 ${rung.maturityYear} 年 ${money(rung.face)}／${percent(rung.coupon)}`)
            .join('；');
          const treasuryStrategy = plan.treasury.drawdownYears
            ? `自動縮短：第 ${plan.treasury.drawdownYears} 年將補梯目標降至 1 年（既有國債保留至到期）`
            : `固定 ${plan.treasury.length} 年梯`;
          const isBxm = plan.growthProfile?.kind === 'bxm';
          const coreStrategy = isBxm ? '大盤 Covered Call／BXM' : '純大盤';
          const incomeBucket = plan.buckets.find(bucket => bucket.id === 'income');
          const dividendProfile = DIVIDEND_ETF_PROFILES[plan.incomeProfile?.kind];
          const emergencyReturn = scenarios[state.monteCarlo.scenario].returns.emergency;
          const eventPolicy = { alpha: '方案甲', beta: '方案乙', gamma: '方案丙', custom: '自訂' }[
            plan.eventWithdrawalPolicy
          ];
          return html(
            `<details data-plan-card="${profile.id}" ${openCards.has(profile.id) ? 'open' : ''} class="monte-carlo-plan-card${enabled ? '' : ' excluded'}"><summary><span>${nameHtml(profile.name)}${profile.id === (state.monteCarloComparisonEnabled ? state.monteCarloProfiles.find(item => item.enabled !== false)?.id : selectedPlanId) ? '（基準）' : ''}${enabled ? '' : '（未比較）'}</span><span class="monte-carlo-plan-actions"><b>${money(total)}</b>${state.monteCarloComparisonEnabled ? `<button class="plan-toggle" type="button" data-profile-toggle="${profile.id}" data-user-label="${escapeHtml(profile.name)}" aria-label="${enabled ? `不比較 ${escapeHtml(profile.name)}` : `加入比較 ${escapeHtml(profile.name)}`}" title="${enabled ? '不比較此方案' : '加入比較'}"${enabled && activeCount === 1 ? ' disabled' : ''}>${enabled ? '×' : '加入'}</button>` : ''}</span></summary>`,
            `<div class="plan-copy-action"><button type="button" class="ghost" data-import-legacy="${profile.id}">匯入舊固定情境備份</button>${
              copySources(profile).length
                ? `<div class="plan-copy-sources">${copySources(profile)
                    .map(
                      source =>
                        `<button type="button" class="ghost" data-update-profile="${profile.id}" data-copy-source="${source.id}"><span>複製設定：</span> ${nameHtml(source.name)} → ${nameHtml(profile.name)}</button>`,
                    )
                    .join('')}</div>`
                : ''
            }</div>`,
            `<div class="comparison-assets"><div class="metric-label-row"><label for="plan-assets-${profile.id}">起始流動資產</label><button type="button" class="lock-button${locked ? ' locked' : ''}" data-plan-lock="${profile.id}" aria-pressed="${locked}">${locked ? '🔒 已鎖定' : '🔓 鎖定'}</button></div><div class="money-input"><span>$</span><input id="plan-assets-${profile.id}" data-plan-total="${profile.id}" type="number" min="0" step="10000" value="${locked ? plan.lockedInitialAssets : total}" ${locked ? '' : 'disabled'} /></div><small>${locked ? '核心 ETF 自動補足差額；其他水庫超過總額時，鎖定總額會提高。' : '鎖定目前總額以比較配置；解鎖可比較不同資產規模。'}</small></div>`,
            '<div class="monte-carlo-plan-fields">',
            `<label>方案名稱<input data-plan-name="${profile.id}" type="text" maxlength="40" value="${escapeHtml(profile.name)}"/></label>`,
            `<div class="plan-spend-field"><div class="plan-spend-heading"><label for="plan-spend-${profile.id}">首年生活費 · ${monthlySpend ? '每月' : '每年'}</label><select data-plan-spend-period="${profile.id}" aria-label="生活費輸入週期"><option value="annual"${monthlySpend ? '' : ' selected'}>每年</option><option value="monthly"${monthlySpend ? ' selected' : ''}>每月</option></select></div><div class="input-suffix prefix"><span>$</span><input id="plan-spend-${profile.id}" data-plan-field="annualSpend" data-profile="${profile.id}" type="number" min="0" step="any" value="${monthlySpend ? plan.annualSpend / 12 : plan.annualSpend}"/></div></div>`,
            `<label>必要生活費 · ${monthlySpend ? '每月' : '每年'}<div class="input-suffix prefix"><span>$</span><input data-plan-field="spendingFloor.annualAmount" data-profile="${profile.id}" type="number" min="0" step="any" value="${monthlySpend ? plan.spendingFloor.annualAmount / 12 : plan.spendingFloor.annualAmount}"/></div></label>`,
            `<label>年通膨率<div class="input-suffix compact"><input data-plan-field="inflation" data-profile="${profile.id}" type="number" min="-99" max="100" step="0.1" value="${plan.inflation}"/><span>%</span></div></label>`,
            ...plan.buckets.map(
              bucket =>
                `<label>${nameHtml(bucket.name)}<div class="input-suffix prefix"><span>$</span><input data-plan-bucket="${bucket.id}" data-profile="${profile.id}" type="number" min="0" step="10000" value="${bucket.amount}" ${locked && bucket.id === 'growth' ? 'disabled title="總資產已鎖定；核心 ETF 自動補足差額"' : ''}/></div></label>`,
            ),
            '<fieldset class="monte-carlo-guardrails"><legend>護欄（年提領率）</legend>',
            `<label>護欄下限<div class="input-suffix compact"><input data-plan-field="guardrails.lower" data-profile="${profile.id}" type="number" step="0.1" value="${plan.guardrails.lower}"/><span>%</span></div></label>`,
            `<label>護欄上限<div class="input-suffix compact"><input data-plan-field="guardrails.upper" data-profile="${profile.id}" type="number" step="0.1" value="${plan.guardrails.upper}"/><span>%</span></div></label>`,
            `<label>護欄上調<div class="input-suffix compact"><input data-plan-field="guardrails.raise" data-profile="${profile.id}" type="number" step="0.1" value="${plan.guardrails.raise}"/><span>%</span></div></label>`,
            `<label>護欄下調<div class="input-suffix compact"><input data-plan-field="guardrails.cut" data-profile="${profile.id}" type="number" step="0.1" value="${plan.guardrails.cut}"/><span>%</span></div></label>`,
            '</fieldset>',
            renderMonteCarloPlanEditors(profile),
            '</div>',
            '<details class="settings-fold"><summary>查看完整設定摘要</summary><dl class="monte-carlo-plan-details">',
            `<div><dt>核心 ETF 策略</dt><dd>${coreStrategy}${isBxm ? '<br><small>月頻校準＋BXM 專屬殘差；非保證防跌／現金流，未納入稅、費用、交易成本與追蹤誤差。</small>' : ''}</dd></div>`,
            `<div><dt>熊市下跌門檻</dt><dd>${percent(plan.bearThreshold)}（低於此核心報酬時，不為可調整生活費出售核心 ETF）</dd></div>`,
            `<div><dt>緊急預備金報酬</dt><dd>${percent(emergencyReturn)}／年</dd></div>`,
            `<div><dt>現金流 ETF 配息</dt><dd>${dividendProfile?.payoutModel ? `PBP：可變配發，平均參考率 ${percent(dividendProfile.targetYield * 100)}；假設 ROC ${percent(plan.incomeProfile.rocPercent ?? 0)}（不計稅）` : dividendProfile ? `${escapeHtml(dividendProfile.ticker)}：DPS／NAV 部分調整模型，起始殖利率 ${percent(dividendProfile.targetYield * 100)}；配息情境「${escapeHtml(dividendScenarioOf(plan).label)}」<br><small>${escapeHtml(dividendScenarioOf(plan).description)}</small>` : `${percent(incomeBucket.yield)}／年（legacy 基準）`}${incomeBucket.amount ? '' : '（目前配置 $0）'}</dd></div>`,
            `<div><dt>國債梯</dt><dd>${treasury}<br><small>${treasuryStrategy}</small></dd></div>`,
            `<div><dt>保證性收入</dt><dd>${guaranteed}</dd></div>`,
            `<div><dt>生活費提款順序</dt><dd>${plan.withdrawalOrders.planned.map(id => withdrawalLabels[id]).join(' → ')}</dd></div>`,
            `<div><dt>意外支出策略</dt><dd>${eventPolicy}<br><small>${eventPolicyDescriptions[plan.eventWithdrawalPolicy]}</small></dd></div>`,
            plan.eventWithdrawalPolicy === 'custom'
              ? `<div><dt>意外支出提款順序</dt><dd>${plan.withdrawalOrders.event.map(id => withdrawalLabels[id]).join(' → ')}</dd></div>`
              : '',
            '</dl></details>',
            '</details>',
          );
        })
        .join(''),
      '</div>',
    );
    root.querySelectorAll('[data-profile-toggle]').forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const id = event.currentTarget.dataset.profileToggle;
        const profile = state.monteCarloProfiles.find(item => item.id === id);
        const activeCount = state.monteCarloProfiles.filter(item => item.enabled !== false).length;
        if (!profile || (profile.enabled !== false && activeCount === 1)) return;
        if (profile.enabled === false) delete profile.enabled;
        else profile.enabled = false;
        invalidateMonteCarlo();
        persist();
        renderMonteCarloProfile();
        renderMonteCarlo();
      };
    });
    root.querySelectorAll('[data-import-legacy]').forEach(button => {
      button.onclick = () => requestProfileCopy(button.dataset.importLegacy, true);
    });
    root.querySelectorAll('[data-update-profile]').forEach(button => {
      button.onclick = () => requestProfileCopy(button.dataset.updateProfile, false, button.dataset.copySource);
    });
    root.querySelectorAll('[data-plan-lock]').forEach(button => {
      button.onclick = () =>
        updateMonteCarloPlan(button.dataset.planLock, draft => {
          if (Number.isFinite(draft.lockedInitialAssets)) delete draft.lockedInitialAssets;
          else draft.lockedInitialAssets = draft.buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
        });
    });
    root.querySelectorAll('[data-plan-total]').forEach(input => {
      input.onchange = () => {
        if (input.value === '' || !input.reportValidity()) return;
        updateMonteCarloPlan(input.dataset.planTotal, draft => {
          draft.lockedInitialAssets = Number(input.value);
        });
      };
    });
    root.querySelectorAll('[data-plan-name]').forEach(input => {
      input.oninput = () => {
        input.__userEdited = true;
      };
      input.onchange = event => {
        if (input.__localizedValue !== undefined && input.value === input.__localizedValue && !input.__userEdited)
          return;
        cancelProfileCopy();
        const profile = state.monteCarloProfiles.find(item => item.id === event.target.dataset.planName);
        profile.name = event.target.value.trim().slice(0, 40) || `方案 ${profile.id.toUpperCase()}`;
        invalidateMonteCarlo();
        persist();
        renderMonteCarloProfile();
        renderMonteCarlo();
      };
    });
    root.querySelectorAll('[data-plan-spend-period]').forEach(select => {
      select.onchange = () => {
        const id = select.dataset.planSpendPeriod;
        planSpendInputModes.set(id, select.value === 'monthly' ? 'monthly' : 'annual');
        renderMonteCarloProfile();
        root.querySelector(`[data-plan-spend-period="${id}"]`).focus();
      };
    });
    root.querySelectorAll('[data-plan-field]').forEach(input => {
      input.onchange = event => {
        if (!event.target.reportValidity() || event.target.value === '') return;
        const keys = event.target.dataset.planField.split('.');
        updateMonteCarloPlan(event.target.dataset.profile, draft => {
          if (keys[0] === 'coverageTargets') draft.coverageTargets = coverageTargets(draft);
          let target = draft;
          keys.slice(0, -1).forEach(key => (target = target[key]));
          const monthly =
            ['annualSpend', 'spendingFloor'].includes(keys[0]) &&
            planSpendInputModes.get(event.target.dataset.profile) === 'monthly';
          target[keys.at(-1)] = Number(event.target.value) * (monthly ? 12 : 1);
        });
      };
    });
    root.querySelectorAll('[data-plan-bucket]').forEach(input => {
      input.onchange = event => {
        if (!event.target.reportValidity() || event.target.value === '') return;
        updateMonteCarloPlan(event.target.dataset.profile, draft => {
          const bucket = draft.buckets.find(item => item.id === event.target.dataset.planBucket);
          setBucketAmount(bucket, event.target.value, draft);
        });
      };
    });
    bindMonteCarloPlanEditors(root);
    root.querySelectorAll('[data-preview-allocation]').forEach(button => {
      button.onclick = () => {
        const id = button.dataset.previewAllocation;
        const plan = state.monteCarloProfiles.find(profile => profile.id === id).plan;
        allocationPreview(plan, button.nextElementSibling, draft =>
          updateMonteCarloPlan(id, target => Object.assign(target, draft)),
        );
      };
    });
  }
  function renderMonteCarloPlanEditors(profile) {
    const { plan, id } = profile;
    const horizonYears = currentHorizonYears();
    const targets = coverageTargets(plan);
    const options = (items, value) =>
      items
        .map(
          ([key, label]) =>
            `<option value="${escapeHtml(key)}"${key === value ? ' selected' : ''}>${escapeHtml(label)}</option>`,
        )
        .join('');
    const number = (label, key, value, attrs = '') =>
      `<label>${label}<input data-plan-field="${key}" data-profile="${id}" type="number" value="${value}" ${attrs}/></label>`;
    const strategy = (kind, label, items, value) =>
      `<label>${label}<select data-mc-strategy="${kind}" data-profile="${id}">${options(items, value)}</select></label>`;
    const fieldset = (title, content) =>
      `<fieldset class="mc-plan-editor"><legend>${title}</legend>${content}</fieldset>`;
    const order = (kind, title) =>
      fieldset(
        title,
        plan.withdrawalOrders[kind]
          .map(
            (value, index) =>
              `<label>第 ${index + 1} 順位<select data-mc-order="${kind}" data-index="${index}" data-profile="${id}">${options(Object.entries(withdrawalLabels), value)}</select></label>`,
          )
          .join(''),
      );
    const rungField = (index, key, label, value, attrs) =>
      `<label>${label}<input data-mc-rung="${key}" data-index="${index}" data-profile="${id}" type="number" value="${value}" ${attrs}/></label>`;
    const incomeField = (index, key, label, value, attrs) =>
      `<label>${label}<input data-mc-income="${key}" data-index="${index}" data-profile="${id}" value="${escapeHtml(String(value ?? ''))}" ${attrs}/></label>`;
    const income = plan.buckets.find(b => b.id === 'income');
    const realProfile = DIVIDEND_ETF_PROFILES[plan.incomeProfile?.kind];
    const nextRungYear = nextFreeMaturityYear(plan.treasury.rungs);
    return html(
      `<button type="button" class="ghost" data-preview-allocation="${id}">依支應目標預覽初始配置</button><div class="allocation-preview" hidden></div>`,
      fieldset(
        '年度生活費支應目標',
        number('國債到期支應 %', 'coverageTargets.defense', targets.defense, 'min="0" max="100" step="1"') +
          number('現金流配息支應 %', 'coverageTargets.income', targets.income, 'min="0" max="100" step="1"') +
          '<p class="hint">合計不能超過 100%；0% 不主動補水。修改比例只改未來補水目標，不重配初始資產；可另外預覽並套用初始配置。配置為 $0 的水庫不補水。修改後兩個比例固定保存，剩餘生活費依提款順序支應。</p>' +
          (coverageWarning(plan) ? `<p class="hint coverage-warning">${escapeHtml(coverageWarning(plan))}</p>` : ''),
      ),
      fieldset(
        'ETF 策略與提款門檻',
        strategy(
          'growth',
          '核心 ETF',
          [
            ['market', '純大盤'],
            ['bxm', '大盤 Covered Call／BXM'],
          ],
          plan.growthProfile?.kind ?? 'market',
        ) +
          strategy(
            'income',
            '現金流 ETF',
            [
              ['legacy', '自訂收益型／legacy'],
              ['vym', 'VYM'],
              ['schd', 'SCHD'],
              ['pbp', 'PBP（可變配發）'],
            ],
            plan.incomeProfile?.kind ?? 'legacy',
          ) +
          `<label>Legacy 基準配息率 %<input data-mc-yield data-profile="${id}" type="number" min="0" step="0.1" value="${income.yield}"${realProfile ? ' disabled' : ''}/></label>` +
          (realProfile?.payoutModel
            ? number(
                '配發中假設 ROC 比例 %',
                'incomeProfile.rocPercent',
                plan.incomeProfile.rocPercent ?? 0,
                'min="0" max="100" step="1"',
              ) +
              '<p class="hint">PBP 配發從淨值扣除；MC 獨立抽取 2008–2025 年度配發率，不保證收益。ROC 是假設分類、不計稅；其餘配發未區分收益與資本利得。補水以歷史平均配發率估算，不預知下一年抽樣。</p>'
            : realProfile
              ? strategy(
                  'dividend',
                  '配息情境',
                  Object.entries(DIVIDEND_SCENARIOS).map(([key, { label }]) => [key, label]),
                  plan.incomeProfile.dividendScenario ?? 'base',
                ) +
                `<p class="hint">VYM／SCHD 使用 DPS／NAV 部分調整模型；legacy 配息率不參與運算。補水使用下一年 DPS。${escapeHtml(dividendScenarioOf(plan).description)}</p>`
              : '') +
          number('熊市不賣核心門檻 %', 'bearThreshold', plan.bearThreshold, 'max="0" step="0.1"'),
      ),
      fieldset(
        '國債梯明細',
        number(
          '縮梯至 1 年的年數（0＝關閉）',
          'treasury.drawdownYears',
          plan.treasury.drawdownYears ?? 0,
          `min="0" max="${horizonYears}" step="1" class="mc-short-input"`,
        ) +
          `<p class="hint">目前 ${plan.treasury.rungs.length} 階，補梯範圍 ${plan.treasury.length} 年（最遠到期年）；範圍內沒有面額的年度會在正報酬年補買。金額會同步至防守水庫，刪除一階會減少初始資產。</p>` +
          plan.treasury.rungs
            .map(
              (r, i) =>
                `<div class="mc-editor-row mc-rung-row">` +
                rungField(i, 'maturityYear', '到期年', r.maturityYear, `min="1" max="${horizonYears}" step="1"`) +
                rungField(i, 'face', '面額 $', r.face, 'min="0" step="any"') +
                rungField(i, 'coupon', '票息 %', r.coupon, 'min="0" step="any"') +
                `<button type="button" class="page-button mc-row-remove" data-mc-remove-rung="${i}" data-profile="${id}"${plan.treasury.rungs.length === 1 ? ' disabled' : ''}>刪除</button></div>`,
            )
            .join('') +
          `<button type="button" class="page-button mc-row-add" data-mc-add-rung data-profile="${id}"${nextRungYear ? '' : ' disabled'}>新增一階（初始面額 $0，${nextRungYear > plan.treasury.length ? '延長' : '填補'}至第 ${nextRungYear ?? '—'} 年）</button>`,
      ),
      fieldset(
        '保證性收入',
        plan.guaranteedIncome
          .map(
            (source, i) =>
              '<div class="mc-editor-row mc-income-row">' +
              incomeField(i, 'label', '名稱', source.label, 'type="text"') +
              incomeField(i, 'amount', '年收入 $（第 1 年幣值）', source.amount, 'type="number" min="0" step="any"') +
              incomeField(
                i,
                'startYear',
                '開始年',
                source.startYear,
                `type="number" min="1" max="${horizonYears}" step="1"`,
              ) +
              incomeField(
                i,
                'endYear',
                '結束年（留空＝終身）',
                source.endYear,
                `type="number" min="1" max="${horizonYears}" step="1"`,
              ) +
              `<label>調整方式<select data-mc-income="indexation" data-index="${i}" data-profile="${id}">${options(
                [
                  ['full', '隨通膨'],
                  ['nominal', '固定名目'],
                ],
                source.indexation,
              )}</select></label>` +
              `<button type="button" class="page-button mc-row-remove" data-mc-remove-income="${i}" data-profile="${id}">刪除</button></div>`,
          )
          .join('') +
          `<button type="button" class="page-button mc-row-add" data-mc-add-income data-profile="${id}">新增收入</button>`,
      ),
      order('planned', '生活費本金提款順序（配息優先）'),
      fieldset(
        '意外支出',
        strategy(
          'event',
          '提款策略',
          [
            ['alpha', '方案甲'],
            ['beta', '方案乙'],
            ['gamma', '方案丙'],
            ['custom', '自訂'],
          ],
          plan.eventWithdrawalPolicy,
        ) + `<p class="hint">${eventPolicyDescriptions[plan.eventWithdrawalPolicy]}</p>`,
      ),
      plan.eventWithdrawalPolicy === 'custom' ? order('event', '意外支出自訂提款順序') : '',
    );
  }
  // 先填梯內空期，沒有空期才延長一年；補梯範圍跟著最遠到期年走。
  function nextFreeMaturityYear(rungs) {
    return Array.from({ length: currentHorizonYears() }, (_, i) => i + 1).find(
      y => !rungs.some(r => r.maturityYear === y),
    );
  }
  function bindMonteCarloPlanEditors(root) {
    const bind = (selector, mutate) =>
      root.querySelectorAll(selector).forEach(control => {
        control.onchange = () => {
          if (!control.reportValidity()) return;
          if (control.type === 'number' && control.value === '' && control.dataset.mcIncome !== 'endYear') return;
          updateMonteCarloPlan(control.dataset.profile, draft => mutate(draft, control));
        };
      });
    bind('[data-mc-strategy]', (draft, el) => {
      const kind = el.dataset.mcStrategy;
      if (kind === 'event') draft.eventWithdrawalPolicy = el.value;
      else if (kind === 'dividend') {
        draft.incomeProfile = { kind: draft.incomeProfile.kind };
        if (el.value !== 'base') draft.incomeProfile.dividendScenario = el.value;
      } else {
        const key = `${kind}Profile`;
        if (el.value === 'market' || el.value === 'legacy') delete draft[key];
        else {
          const { dividendScenario } = kind === 'income' ? (draft.incomeProfile ?? {}) : {};
          draft[key] = {
            kind: el.value,
            ...(el.value === 'pbp' ? { rocPercent: 0 } : dividendScenario ? { dividendScenario } : {}),
          };
        }
        const bucket = draft.buckets.find(b => b.id === kind);
        bucket.assets =
          kind === 'growth'
            ? el.value === 'bxm'
              ? 'BXM buy-write 策略指數'
              : DEFAULT.buckets.find(b => b.id === kind).assets
            : (DIVIDEND_ETF_PROFILES[el.value]?.label ?? DEFAULT.buckets.find(b => b.id === kind).assets);
      }
    });
    bind('[data-mc-yield]', (draft, el) => {
      draft.buckets.find(b => b.id === 'income').yield = Number(el.value);
    });
    bind('[data-mc-order]', (draft, el) => {
      const order = draft.withdrawalOrders[el.dataset.mcOrder];
      const index = Number(el.dataset.index),
        other = order.indexOf(el.value);
      [order[index], order[other]] = [order[other], order[index]];
    });
    bind('[data-mc-rung]', (draft, el) => {
      draft.treasury.rungs[Number(el.dataset.index)][el.dataset.mcRung] = Number(el.value);
      draft.buckets.find(b => b.id === 'defense').amount = draft.treasury.rungs.reduce((sum, r) => sum + r.face, 0);
    });
    bind('[data-mc-income]', (draft, el) => {
      const field = el.dataset.mcIncome;
      draft.guaranteedIncome[Number(el.dataset.index)][field] = ['label', 'indexation'].includes(field)
        ? el.value
        : el.value === ''
          ? null
          : Number(el.value);
    });
    const action = (selector, mutate) =>
      root.querySelectorAll(selector).forEach(button => {
        button.onclick = () => updateMonteCarloPlan(button.dataset.profile, draft => mutate(draft, button));
      });
    action('[data-mc-add-income]', draft => {
      draft.guaranteedIncome.push({
        id: `income-${Date.now()}`,
        label: '新增收入',
        amount: 0,
        startYear: 1,
        endYear: null,
        indexation: 'full',
      });
    });
    action('[data-mc-remove-income]', (draft, el) => {
      draft.guaranteedIncome.splice(Number(el.dataset.mcRemoveIncome), 1);
    });
    action('[data-mc-add-rung]', draft => {
      const year = nextFreeMaturityYear(draft.treasury.rungs);
      if (year) draft.treasury.rungs.push({ maturityYear: year, face: 0, coupon: 4 });
    });
    action('[data-mc-remove-rung]', (draft, el) => {
      if (draft.treasury.rungs.length > 1) draft.treasury.rungs.splice(Number(el.dataset.mcRemoveRung), 1);
      draft.buckets.find(b => b.id === 'defense').amount = draft.treasury.rungs.reduce((sum, r) => sum + r.face, 0);
    });
  }
  function inflationSentence(result) {
    if (result?.samplingMode === 'historical')
      return '通膨與報酬逐年配對取自同一筆歷史資料；非核心水庫仍使用所選情境的固定報酬。';
    const stress = INFLATION_STRESS_PATHS[result?.inflationModel];
    if (stress) {
      const horizonYears = result.horizonYears ?? currentHorizonYears();
      const rates = Object.values(stressInflationPath(result.inflationModel, horizonYears));
      const safeCash = Object.values(stressSafeRates(result.inflationModel, horizonYears)).map(rate => rate.cash);
      return html(
        `通膨採歷史壓力路徑：${stress.label}，${stress.startYear}–${stress.startYear + horizonYears - 1} 實際 12 月年增率，`,
        `${horizonYears} 年平均 ${percent(result.inflationAverage.p50)}、最高 ${percent(Math.max(...rates))}；每條路徑相同，市場報酬仍隨機。`,
        `緊急預備金與到期現金改賺同年 3 個月國庫券平均（${percent(Math.min(...safeCash))}–${percent(Math.max(...safeCash))}），`,
        '補梯新買的國債票息取同年 12 月五年期公債殖利率（GS5）。',
      );
    }
    if (result?.inflationModel !== 'ar1') return '';
    const average = result.inflationAverage;
    return html(
      `通膨每條路徑隨機：以方案年通膨為中心，持續性 ${INFLATION_AR1.persistence.toFixed(2)}、`,
      `年衝擊 ${INFLATION_AR1.shockSd.toFixed(2)} 個百分點（${INFLATION_AR1.firstYear}–${INFLATION_AR1.lastYear} 美國 CPI 估計，`,
      `下限 ${INFLATION_FLOOR}%；不含 70 年代式失控）`,
      average
        ? `；${result.horizonYears ?? currentHorizonYears()} 年平均通膨 P10／P50／P90 為 ${percent(average.p10)}／${percent(average.p50)}／${percent(average.p90)}。`
        : '。',
    );
  }
  function fixedEventSentence(result) {
    const event = result?.fixedEvent;
    return event
      ? `每條路徑另在第 ${event.year} 年支付一筆確定支出 ${money(event.amount)}（第 1 年美元，依年通膨調整；代表路徑表標為「確定」）。`
      : '';
  }
  function samplingSentence(result) {
    if (result.samplingMode !== 'historical')
      return `${result.paths.toLocaleString()} 條路徑；平均報酬 ${percent(result.mean)}、波動率 ${percent(result.volatility)}、種子 ${result.seed}。`;
    const market = HISTORICAL_MARKETS[result.historicalMarket];
    return html(
      `${result.paths.toLocaleString()} 條合成歷史路徑，非真實歷史回放；`,
      `市場為「${market.label}」，直接採其年度資料（平均 ${percent(result.historicalStats.mean)}、波動率 ${percent(result.historicalStats.volatility)}），`,
      `ETF 使用保留年度複利的合成分層月路徑，非真實歷史月資料；每段 ${result.historicalBlockLength} 年、不重複來源年份，年度擾動 ±${result.historicalJitter}%；種子 ${result.seed}。`,
    );
  }
  function viewRepresentativePath(label, resultOverride = null, planOverride = null, profileName = '') {
    const sourceResult = resultOverride ?? monteCarloResult;
    const sourcePlan = planOverride ?? resultPlan;
    const path = sourceResult?.representativePaths?.[label];
    if (!path || !sourcePlan) return;
    const plan = JSON.parse(JSON.stringify(sourcePlan));
    plan.planningPeriod = sourceResult.planningPeriod ?? currentPlanningPeriod();
    plan.coreReturns = Object.fromEntries(path.coreReturns.map((value, index) => [index + 1, value]));
    for (const key of ['inflationRates', 'safeRates', 'bxmMonthlyPath', 'incomeMonthlyPath'])
      if (path[key]) plan[key] = path[key];
    plan.emergencyEvents = { ...path.emergencyEvents };
    if (path.fixedEvent)
      plan.emergencyEvents[path.fixedEvent.year] =
        (plan.emergencyEvents[path.fixedEvent.year] ?? 0) + path.fixedEvent.amount;
    const replay = simulate(plan, sourceResult.scenario);
    const { years } = replay;
    const eventFunding = eventFundingSummary(replay, plan.emergencyEvents);
    const root = $('#representative-detail');
    root.hidden = false;
    root.innerHTML =
      '<h3>' +
      label.toUpperCase() +
      ' 代表路徑 · ' +
      nameHtml(profileName || 'MC 方案') +
      '</h3><p>僅查看本次計算，不改動 MC 方案或固定情境。資產歸零後停止。</p><div class="table-wrap"><table><thead><tr><th>年度</th><th>生活費目標</th><th>實際生活費</th><th>生活費缺口</th>' +
      plan.buckets.map(b => '<th>' + nameHtml(b.name) + '</th>').join('') +
      '<th>意外支出</th><th>意外支出已支應</th><th>意外支出缺口</th><th>總資產</th></tr></thead><tbody>' +
      years
        .map(
          y =>
            '<tr><th>' +
            y.year +
            '</th><td>' +
            money(y.spend) +
            '</td><td>' +
            money(y.actualSpend) +
            '</td><td>' +
            money(y.unmetSpend ?? 0) +
            '</td>' +
            plan.buckets.map(b => '<td>' + money(y.values[b.id]) + '</td>').join('') +
            [y.eventSpend, y.eventSpend - y.eventUnmet, y.eventUnmet]
              .map(value => '<td>' + money(value) + '</td>')
              .join('') +
            '<td>' +
            money(y.total) +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table></div>' +
      '<p><span>耗盡後意外支出缺口</span> ' +
      money(eventFunding.annual.filter(row => row.stopped).reduce((sum, row) => sum + row.unpaid, 0)) +
      '</p>' +
      `<p class="hint">涵蓋完整 ${sourceResult.horizonYears ?? currentHorizonYears()} 年已抽定及確定事件；耗盡後事件視為未支應，不延長收支模擬。缺口不轉為負債，也不會事後追繳。</p>`;
    applyLanguage();
  }
  function copyRepresentativePathToPlanner(label) {
    const path = monteCarloResult?.representativePaths?.[label];
    if (!path) return;
    const profile = JSON.parse(JSON.stringify(resultPlan ?? monteCarloPlanSnapshot(state)));
    const coreReturns = Object.fromEntries(path.coreReturns.map((annualReturn, index) => [index + 1, annualReturn]));
    // Hydrate using the source plan, then copy only path data and its immutable CSV provenance.
    // Shared plans remain independent of the representative market path.
    const replay = hydrateState({
      ...profile,
      representativePathSource: {
        label: `${resultProfileName ?? 'MC 方案'} · ${label.toUpperCase()}`,
        rows: monteCarloSettingsRows(monteCarloResult),
      },
      coreReturns,
      // 隨機通膨路徑一併帶回（「清除逐年覆寫」可移除），否則重播用的是固定通膨，結果對不上。
      ...(path.inflationRates ? { inflationRates: path.inflationRates } : {}),
      ...(path.historicalSources ? { historicalSampleSources: path.historicalSources } : {}),
      // 壓力路徑的同期 GS5 利率也要帶回，否則國債票息與現金報酬會回到固定設定。
      ...(path.safeRates ? { safeRates: path.safeRates } : {}),
      ...(path.bxmMonthlyPath ? { bxmMonthlyPath: path.bxmMonthlyPath } : {}),
      ...(path.incomeMonthlyPath ? { incomeMonthlyPath: path.incomeMonthlyPath } : {}),
      // Monte Carlo 事件依累積通膨計算，可能帶有小數；水庫頁是以整數美元輸入意外支出，
      // 因此複製代表路徑時在交界處取整，避免把浮點尾數顯示進輸入框。
      // 確定事件與抽樣事件在水庫頁合併成同一年的一筆，重播才會得到同樣的結果。
      emergencyEvents: Object.fromEntries(
        Object.entries(
          path.fixedEvent
            ? {
                ...path.emergencyEvents,
                [path.fixedEvent.year]: (path.emergencyEvents[path.fixedEvent.year] ?? 0) + path.fixedEvent.amount,
              }
            : path.emergencyEvents,
        ).map(([year, amount]) => [year, Math.round(amount)]),
      ),
      // 這組事件是抽出來的，不是使用者輸入的；標記讓後續清除能分辨兩者。
      eventsFromPath: true,
      ...(Number.isFinite(state.lockedInitialAssets) ? { lockedInitialAssets: state.lockedInitialAssets } : {}),
      monteCarlo: state.monteCarlo,
      monteCarloProfiles: state.monteCarloProfiles,
      monteCarloComparisonEnabled: state.monteCarloComparisonEnabled,
    });
    for (const key of [
      'coreReturns',
      'inflationRates',
      'emergencyEvents',
      'safeRates',
      'bxmMonthlyPath',
      'incomeMonthlyPath',
      'historicalSampleSources',
      'representativePathSource',
      'eventsFromPath',
    ]) {
      delete state[key];
      if (replay[key] !== undefined) state[key] = replay[key];
    }
    state.historicalReplay = null;
    setScenario(monteCarloResult.scenario);
    expandedYears.clear();
    projectionStart = 0;
    renderInputs();
    setActiveView('planner-view');
    renderAll();
  }
  function renderMonteCarlo() {
    const root = $('#monte-carlo-content');
    const period = currentPlanningPeriod();
    $('#monte-carlo-heading').textContent =
      `${period.currentAge} → ${period.targetAge} 歲 · ${period.years} 年隨機路徑壓力測試`;
    if (!monteCarloResult) {
      root.className = 'monte-carlo-empty';
      root.textContent = monteCarloStale
        ? '結果尚未更新：計畫或測試設定已變更，請重新執行模擬。'
        : '設定完成後執行模擬；使用上方選定的方案。';
      applyLanguage();
      return;
    }
    if (monteCarloResult.profiles) {
      renderMonteCarloComparison(root, monteCarloResult);
      applyLanguage();
      return;
    }
    const result = monteCarloResult;
    const horizonYears = result.horizonYears ?? currentHorizonYears();
    const rate = value => percent(value * 100);
    const floorActive = result.floorActive;
    root.className = 'monte-carlo-results';
    root.innerHTML = html(
      '<p class="result-source">本次結果：' +
        (resultProfileName ? `MC ${nameHtml(resultProfileName)} · ` : 'MC 方案 · ') +
        '總資產 ' +
        money(resultPlan.buckets.reduce((sum, b) => sum + b.amount, 0)) +
        ' · 每年生活費 ' +
        money(resultPlan.annualSpend) +
        '</p>',
      '<div class="result-headline">',
      `<article><small>${horizonYears} 年內資產耗盡</small><strong>` +
        Math.round(result.assetDepletionRate * result.paths) +
        ' / ' +
        result.paths +
        ' 條</strong><small>本次模擬路徑數，非未來發生機率保證</small></article>',
      '<article><small>累計實際／原始生活費計畫</small><strong>' +
        rate(result.planSpendRatio.p25) +
        ' / ' +
        rate(result.planSpendRatio.p50) +
        '</strong><small>全部路徑的 P25／P50</small></article>',
      '<article><small>必要開銷曾有缺口</small><strong>' +
        (floorActive
          ? Math.round(result.floorGapRate * result.paths) + ' / ' + result.paths + ' 條'
          : '未設定必要生活費') +
        '</strong></article></div>',
      eventGapMetrics(result),
      '<div id="mc-asset-fan"></div>',
      '<details class="settings-fold"><summary>完整統計、假設與代表路徑</summary><div class="monte-carlo-metrics">',
      `<div><small>資產耗盡率</small><strong>${rate(result.assetDepletionRate)}</strong><span>${horizonYears} 年內資產歸零的路徑</span></div>`,
      `<div><small>生活費曾缺口率</small><strong>${rate(result.spendShortfallRate)}</strong><span>至少一年未完全支應生活費</span></div>`,
      `<div><small>年末資產 P25 / P50 / P75</small><strong>${money(result.finalAssets.p25, true)} / ${money(result.finalAssets.p50, true)} / ${money(result.finalAssets.p75, true)}</strong><span>第 ${horizonYears} 年總資產分位數</span></div>`,
      // 護欄的工作就是砍支出，所以「沒有缺口」不等於「照計畫過日子」。這兩格的分母一律
      // 是未經護欄調整的原始計畫，否則一份把生活水準砍半的計畫會和完美執行的看起來一樣。
      `<div><small>累計實際 / 原始計畫 P25 / P50</small><strong>${rate(result.planSpendRatio.p25)} / ${rate(result.planSpendRatio.p50)}</strong><span>終身總共花到計畫的幾成；全部 ${result.paths.toLocaleString()} 條路徑</span></div>`,
      result.hasGuaranteedIncome
        ? `<div><small>其中水庫支應 P25 / P50</small><strong>${rate(result.portfolioSpendRatio.p25)} / ${rate(result.portfolioSpendRatio.p50)}</strong><span>扣掉保證性收入後，四個水庫自己付出的部分</span></div>`
        : '',
      `<div><small>最差年度支應比例 P25 / P50</small><strong>${rate(result.worstYearRatio.p25)} / ${rate(result.worstYearRatio.p50)}</strong><span>最難熬的那一年只拿到計畫的幾成</span></div>`,
      floorActive
        ? `<div><small>Floor 曾咬住的路徑</small><strong>${rate(result.floorBindingRate)}</strong><span>護欄想低於必要生活費而被擋住</span></div>`
        : '',
      result.firstFloorBindingYear
        ? `<div><small>首次 Floor 咬住年 P25 / P50</small><strong>約第 ${Math.round(result.firstFloorBindingYear.p25)} / ${Math.round(result.firstFloorBindingYear.p50)} 年</strong><span>僅計入曾被 Floor 限制的路徑</span></div>`
        : '',
      floorActive
        ? `<div><small>必要生活費曾缺口率</small><strong>${rate(result.floorGapRate)}</strong><span>至少一年連 Floor 也無法全額支付</span></div>`
        : '',
      floorActive
        ? `<div><small>累計外部收入需求 P50 / P75</small><strong>${result.cumulativeFloorGap ? `${money(result.cumulativeFloorGap.p50, true)} / ${money(result.cumulativeFloorGap.p75, true)}` : '—'}</strong><span>僅計入曾有必要生活費缺口的路徑</span></div>`
        : '',
      floorActive
        ? `<div><small>必要生活費被迫賣核心 ETF</small><strong>${rate(result.forcedFloorSaleRate)}</strong><span>熊市門檻下仍需支付 Floor 的路徑</span></div>`
        : '',
      '</div>',
      `<p class="hint">${samplingSentence(result)}每年另以 ${percent(result.eventProbability)} 的獨立機率發生意外支出；基準值 ${money(result.eventAmount)}（第 1 年美元），其後依年通膨調整。${inflationSentence(result)}${fixedEventSentence(result)}${result.samplingMode === 'historical' ? '' : `波動會造成複利拖累，因此中位數不等於固定 ${percent(result.mean)} 報酬的結果。`}核心 ETF 以外的水庫報酬沿用「${scenarios[result.scenario].label}」的假設。支應比例的分母一律是未經護欄調整的原始計畫——護欄砍出來的節省不算成功。</p>`,
      resultPlan?.growthProfile?.kind === 'bxm'
        ? '<p class="hint bxm-model-note">本次 BXM 路徑以 12 個月市場報酬套用月頻 OLS，並抽樣 BXM 專屬殘差；它不是保證防跌或保證現金流，且未納入稅、費用、交易成本與實際追蹤誤差。</p>'
        : '',
      '</details>',
      '<section class="monte-carlo-representative-paths">',
      '<h3>P25／P50／P75 附近的代表路徑 <small>各欄從本次實際路徑中挑選年末資產最接近該分位數者。</small></h3>',
      '<p class="hint representative-path-hint">僅套用本次代表路徑至固定情境，不覆寫共用方案；包含逐年報酬、通膨與事件。清除逐年覆寫可恢復情境路徑。</p>',
      '<div class="representative-path-actions">',
      ['p25', 'p50', 'p75']
        .map(
          label =>
            `<button class="ghost" data-view-representative-path="${label}">查看 ${label.toUpperCase()} 年度明細</button><button class="ghost" data-copy-representative-path="${label}">套用 ${label.toUpperCase()} 至固定情境</button>`,
        )
        .join(''),
      '</div>',
      '<div class="table-wrap"><table class="representative-path-table"><thead><tr><th>年度</th>',
      ['p25', 'p50', 'p75']
        .map(
          label =>
            `<th>${label.toUpperCase()} <small>${money(result.representativePaths[label].finalAssets, true)}</small></th>`,
        )
        .join(''),
      '</tr></thead><tbody>',
      Array.from({ length: horizonYears }, (_, index) => {
        const cells = ['p25', 'p50', 'p75']
          .map(label => {
            const annualReturn = result.representativePaths[label].coreReturns[index];
            const pathInflation = result.representativePaths[label].inflationRates?.[index + 1];
            const eventAmount = result.representativePaths[label].emergencyEvents[index + 1];
            const fixed = result.representativePaths[label].fixedEvent;
            const fixedAmount = fixed?.year === index + 1 ? fixed.amount : 0;
            const source = result.representativePaths[label].historicalSources?.[index];
            return `<td class="${annualReturn >= 0 ? 'up' : 'down'}">${percent(annualReturn)}${
              eventAmount ? `<span class="event-marker down">意外 ${money(eventAmount, true)}</span>` : ''
            }${fixedAmount ? `<span class="event-marker down fixed">確定 ${money(fixedAmount, true)}</span>` : ''}${
              pathInflation === undefined ? '' : `<small class="path-cpi">CPI ${percent(pathInflation)}</small>`
            }${source ? `<small class="path-source">來源 ${source.year} · 區塊 ${source.block}-${source.position} · 擾動 ${percent(source.jitter * 100)}</small>` : ''}</td>`;
          })
          .join('');
        return `<tr><th>第 ${index + 1} 年</th>${cells}</tr>`;
      }).join(''),
      '</tbody></table></div>',
      '</section>',
    );
    renderMonteCarloAssetFan(result);
    root.querySelectorAll('[data-view-representative-path]').forEach(button => {
      button.onclick = () => viewRepresentativePath(button.dataset.viewRepresentativePath);
    });
    root.querySelectorAll('[data-copy-representative-path]').forEach(button => {
      button.onclick = () => copyRepresentativePathToPlanner(button.dataset.copyRepresentativePath);
    });
    applyLanguage();
  }
  function renderMonteCarloAssetFan(result) {
    const root = $('#mc-asset-fan');
    if (!root || !result.totalAssetTrajectory || !result.realTotalAssetTrajectory) return;
    const points = mcAssetBasis === 'real' ? result.realTotalAssetTrajectory : result.totalAssetTrajectory;
    const horizonYears = result.horizonYears ?? points.length;
    mcAssetYear = Math.min(mcAssetYear, horizonYears);
    // 重畫會替換整個區塊；記住原本有焦點的控制項（滑桿或口徑選單），鍵盤操作才不會在縮放時中斷。
    const focusedId = root.contains(document.activeElement) ? document.activeElement.id : '';
    const width = Math.max(260, Math.min(960, root.clientWidth ? root.clientWidth - 42 : 960)),
      height = width < 600 ? 280 : 340,
      left = width < 600 ? 62 : 106,
      right = 24,
      top = 22,
      bottom = 54;
    const max = Math.max(1, ...points.map(point => point.p90)) * 1.06;
    const x = year => left + ((year - 1) / Math.max(1, horizonYears - 1)) * (width - left - right);
    const y = value => top + (1 - value / max) * (height - top - bottom);
    const band = (lower, upper) =>
      points
        .map(point => x(point.year) + ',' + y(point[upper]))
        .concat([...points].reverse().map(point => x(point.year) + ',' + y(point[lower])))
        .join(' ');
    root.innerHTML = html(
      '<section class="mc-fan-chart" aria-labelledby="mc-fan-title">',
      '<div class="chart-heading"><h3 id="mc-fan-title">年度資產百分位帶狀圖</h3>',
      '<label><span>資產顯示口徑</span> <select id="mc-asset-basis">',
      '<option value="real"' + (mcAssetBasis === 'real' ? ' selected' : '') + '>實質資產</option>',
      '<option value="nominal"' +
        (mcAssetBasis === 'nominal' ? ' selected' : '') +
        '>名目資產</option></select></label></div>',
      '<div class="mc-fan-legend"><span class="mc-fan-upper-key">P75–P90</span><span class="mc-fan-inner-key">P25–P75</span><span class="mc-fan-lower-key">P10–P25</span><span class="mc-fan-line-key">P50</span></div>',
      '<svg id="mc-fan-svg" viewBox="0 0 ' +
        width +
        ' ' +
        height +
        '" role="img" aria-labelledby="mc-fan-title" aria-describedby="mc-fan-explanation">',
      '<g class="chart-grid">' +
        [0, 0.25, 0.5, 0.75, 1]
          .map(
            fraction =>
              '<line x1="' +
              left +
              '" x2="' +
              (width - right) +
              '" y1="' +
              y(max * fraction) +
              '" y2="' +
              y(max * fraction) +
              '"/>' +
              '<text x="' +
              (left - 12) +
              '" y="' +
              (y(max * fraction) + 4) +
              '" text-anchor="end">' +
              money(max * fraction, true) +
              '</text>',
          )
          .join('') +
        '</g>',
      '<polygon class="mc-fan-upper" points="' + band('p75', 'p90') + '"/>',
      '<polygon class="mc-fan-lower" points="' + band('p10', 'p25') + '"/>',
      '<polygon class="mc-fan-inner" points="' + band('p25', 'p75') + '"/>',
      '<polyline class="mc-fan-median" points="' +
        points.map(point => x(point.year) + ',' + y(point.p50)).join(' ') +
        '"/>',
      '<line id="mc-fan-guide" class="mc-fan-guide" y1="' + top + '" y2="' + (height - bottom) + '"/>',
      '<g class="chart-axis">' +
        axisYears(1, horizonYears, width < 600 ? 3 : 6)
          .map(year => '<text x="' + x(year) + '" y="' + (height - 31) + '" text-anchor="middle">' + year + '</text>')
          .join('') +
        '<text x="' +
        (left + width - right) / 2 +
        '" y="' +
        (height - 5) +
        '" text-anchor="middle">退休年度</text></g></svg>',
      '<label class="mc-fan-year"><span>查看退休年度</span><input id="mc-asset-year" type="range" min="1" max="' +
        horizonYears +
        '" step="1" value="' +
        mcAssetYear +
        '" /></label>',
      '<div id="mc-fan-readout" class="mc-fan-readout" role="status" aria-live="polite"></div>',
      '<p id="mc-fan-explanation" class="hint">每年跨全部模擬路徑計算百分位；耗盡後年份以零資產納入。P50 中線不是一條實際模擬路徑，也不是既有的 P50 代表路徑。</p>',
      '<p class="hint">色帶代表分位區間，垂直距離表示金額差距，不是機率。帶外仍有結果，不是上下限或未來保證。</p>',
      '<p class="hint">實質資產以退休起點購買力表示，依每條路徑截至該年年底的累積通膨換算，再計算百分位。</p></section>',
      '<div id="mc-asset-distribution"></div>',
    );
    const updateYear = year => {
      mcAssetYear = Math.max(1, Math.min(horizonYears, Math.round(year)));
      const point = points[mcAssetYear - 1];
      $('#mc-asset-year').value = mcAssetYear;
      const guide = $('#mc-fan-guide');
      guide.setAttribute('x1', x(mcAssetYear));
      guide.setAttribute('x2', x(mcAssetYear));
      $('#mc-fan-readout').innerHTML =
        '<strong>第 ' +
        mcAssetYear +
        ' 年</strong><span>年末總資產</span>' +
        ['p10', 'p25', 'p50', 'p75', 'p90']
          .map(key => '<span>' + key.toUpperCase() + ' <b>' + money(point[key]) + '</b></span>')
          .join('');
      applyLanguage($('#mc-fan-readout'));
      renderMonteCarloHistogram(result, width);
    };
    $('#mc-asset-year').oninput = event => updateYear(Number(event.target.value));
    $('#mc-asset-basis').onchange = event => {
      mcAssetBasis = event.target.value;
      renderMonteCarloAssetFan(result);
    };
    const selectFromPointer = event => {
      const box = $('#mc-fan-svg').getBoundingClientRect();
      if (!box.width) return;
      const year = Math.max(
        1,
        Math.min(
          horizonYears,
          Math.round(
            1 +
              ((((event.clientX - box.left) / box.width) * width - left) / (width - left - right)) * (horizonYears - 1),
          ),
        ),
      );
      if (year !== mcAssetYear) updateYear(year);
    };
    $('#mc-fan-svg').onpointermove = event => {
      if (event.pointerType === 'mouse') selectFromPointer(event);
    };
    $('#mc-fan-svg').onpointerdown = selectFromPointer;
    applyLanguage(root);
    updateYear(mcAssetYear);
    if (focusedId) document.getElementById(focusedId)?.focus();
  }
  function renderMonteCarloHistogram(result, width) {
    const root = $('#mc-asset-distribution');
    const distribution = result.assetDistributions?.[mcAssetBasis]?.[mcAssetYear - 1];
    if (!root || !distribution) return;
    const point = (mcAssetBasis === 'real' ? result.realTotalAssetTrajectory : result.totalAssetTrajectory)[
      mcAssetYear - 1
    ];
    const { sampleCount, zeroCount, edges, counts, overflowCount = 0, overflowThreshold = 0 } = distribution;
    const height = 300,
      top = 26,
      bottom = 60,
      left = width < 600 ? 44 : 72,
      right = 24;
    const zeroWidth = 22,
      positiveLeft = left + zeroWidth + 24,
      positiveWidth = width - right - positiveLeft - (overflowCount ? 46 : 0);
    const maximum = edges.at(-1) || 0;
    const maxCount = Math.max(1, zeroCount, overflowCount, ...counts);
    const plotHeight = height - top - bottom;
    const y = count => top + (1 - count / maxCount) * plotHeight;
    const valueX = value => (value === 0 ? left + zeroWidth / 2 : positiveLeft + (value / maximum) * positiveWidth);
    const share = count => ((sampleCount ? count / sampleCount : 0) * 100).toFixed(2) + '%';
    const formatEdge = value =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
    const bins = [
      { count: zeroCount, label: '$0', x: left, width: zeroWidth },
      ...counts.map((count, index) => ({
        count,
        label: '(' + formatEdge(edges[index]) + ', ' + formatEdge(edges[index + 1]) + ']',
        x: positiveLeft + (index / counts.length) * positiveWidth,
        width: positiveWidth / counts.length,
      })),
    ];
    if (overflowCount)
      bins.push({
        count: overflowCount,
        label: '>' + formatEdge(overflowThreshold),
        x: width - right - zeroWidth,
        width: zeroWidth,
        overflow: true,
      });
    root.innerHTML = html(
      '<section class="mc-hist-chart" aria-labelledby="mc-hist-title">',
      '<div class="chart-heading"><h3 id="mc-hist-title">選定年份資產分布</h3><p class="mc-hist-context"><strong>第 ' +
        mcAssetYear +
        ' 年</strong> · <span>' +
        (mcAssetBasis === 'real' ? '實質資產' : '名目資產') +
        '</span></p></div>',
      '<p class="mc-zero-summary"><span>零資產</span> <strong>' +
        zeroCount +
        ' / ' +
        sampleCount +
        ' · ' +
        share(zeroCount) +
        '</strong></p>',
      overflowCount
        ? '<p class="mc-tail-summary"><span>合併尾端</span> <strong>&gt;' +
            formatEdge(overflowThreshold) +
            ' · ' +
            overflowCount +
            ' / ' +
            sampleCount +
            ' · ' +
            share(overflowCount) +
            '</strong></p>'
        : '',
      '<svg id="mc-hist-svg" viewBox="0 0 ' +
        width +
        ' ' +
        height +
        '" role="group" aria-labelledby="mc-hist-title" aria-describedby="mc-hist-help">',
      '<g class="chart-grid"><text x="' +
        left +
        '" y="14">路徑比例</text>' +
        [0, 0.5, 1]
          .map(
            fraction =>
              '<line x1="' +
              left +
              '" x2="' +
              (width - right) +
              '" y1="' +
              y(maxCount * fraction) +
              '" y2="' +
              y(maxCount * fraction) +
              '"/>' +
              '<text x="' +
              (left - 8) +
              '" y="' +
              (y(maxCount * fraction) + 4) +
              '" text-anchor="end">' +
              Math.round((sampleCount ? (maxCount * fraction) / sampleCount : 0) * 100) +
              '%</text>',
          )
          .join('') +
        '</g>',
      bins
        .map(
          (bin, index) =>
            '<rect class="mc-hist-bar ' +
            (index === 0 ? 'mc-hist-zero' : bin.overflow ? 'mc-hist-overflow' : '') +
            '" x="' +
            bin.x +
            '" y="' +
            y(bin.count) +
            '" width="' +
            Math.max(0.5, bin.width - 0.5) +
            '" height="' +
            (plotHeight * bin.count) / maxCount +
            '"/>' +
            '<rect id="mc-hist-bin-' +
            index +
            '" class="mc-hist-hit" data-hist-bin="' +
            index +
            '" data-count="' +
            bin.count +
            '" x="' +
            bin.x +
            '" y="' +
            top +
            '" width="' +
            bin.width +
            '" height="' +
            plotHeight +
            '" tabindex="0" role="button" aria-label="' +
            bin.label +
            ' · ' +
            bin.count +
            ' / ' +
            sampleCount +
            ' · ' +
            share(bin.count) +
            '"><title>' +
            bin.label +
            ' · ' +
            bin.count +
            ' / ' +
            sampleCount +
            ' · ' +
            share(bin.count) +
            '</title></rect>',
        )
        .join(''),
      ['p25', 'p75', 'p50']
        .map(
          key =>
            '<line class="mc-hist-quantile ' +
            key +
            '" x1="' +
            valueX(point[key]) +
            '" x2="' +
            valueX(point[key]) +
            '" y1="' +
            top +
            '" y2="' +
            (height - bottom) +
            '"/>',
        )
        .join(''),
      '<g class="chart-axis"><text x="' +
        (left + zeroWidth / 2) +
        '" y="' +
        (height - 38) +
        '" text-anchor="middle">$0</text>' +
        (overflowCount
          ? '<text x="' +
            (width - right - zeroWidth / 2) +
            '" y="' +
            (height - 38) +
            '" text-anchor="middle">&gt;P75×2</text>'
          : '') +
        (maximum
          ? [0, 0.5, 1]
              .map(
                fraction =>
                  '<text x="' +
                  (positiveLeft + positiveWidth * fraction) +
                  '" y="' +
                  (height - 38) +
                  '" text-anchor="' +
                  (fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle') +
                  '">' +
                  (fraction === 0 ? '&gt;$0' : money(maximum * fraction, true)) +
                  '</text>',
              )
              .join('')
          : '') +
        '<text x="' +
        width / 2 +
        '" y="' +
        (height - 8) +
        '" text-anchor="middle">年末總資產</text></g></svg>',
      '<div class="mc-hist-legend">' +
        ['p25', 'p50', 'p75']
          .map(key => '<span class="' + key + '">' + key.toUpperCase() + ' <b>' + money(point[key]) + '</b></span>')
          .join('') +
        '</div>',
      '<div id="mc-hist-detail" class="mc-hist-detail" role="status" aria-live="polite"></div>',
      '<p id="mc-hist-help" class="hint">長條高度是占全部路徑的比例；虛線為 P25／P75，實線為 P50。點按長條或用 Tab 查閱數值，也可展開分箱明細。</p>',
      '<p class="hint">零資產獨立一格；超過當年 P75 兩倍的資產合併為尾端一格，其餘正資產等寬分成 40 格。P75 為零時，所有正資產併入尾端。切換年份或口徑不重新抽樣。</p>',
      '<details><summary>查看分箱明細</summary><p class="hint">區間左端不包含、右端包含；零資產另計。</p><div class="table-wrap"><table><thead><tr><th>資產區間</th><th>路徑數</th><th>路徑比例</th></tr></thead><tbody>' +
        bins
          .map(
            (bin, index) =>
              '<tr><th>' +
              (index === 0 ? '零資產' : bin.label) +
              '</th><td>' +
              bin.count +
              '</td><td>' +
              share(bin.count) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div></details></section>',
    );
    let selected = -1;
    const inspect = index => {
      if (selected === index) return;
      selected = index;
      const bin = bins[index];
      $('#mc-hist-detail').innerHTML =
        '<span>' +
        (index === 0 ? '零資產' : bin.label) +
        '</span> · <strong>' +
        bin.count +
        ' / ' +
        sampleCount +
        ' · ' +
        share(bin.count) +
        '</strong>';
      applyLanguage($('#mc-hist-detail'));
    };
    root.querySelectorAll('[data-hist-bin]').forEach(bar => {
      const inspectBar = () => inspect(Number(bar.dataset.histBin));
      bar.onpointerenter = inspectBar;
      bar.onclick = inspectBar;
      bar.onfocus = inspectBar;
      bar.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inspectBar();
        }
      };
    });
    inspect(0);
    applyLanguage(root);
  }
  function renderMonteCarloComparison(root, comparison) {
    const baselineName = nameHtml(comparison.profiles[0].name);
    const horizonYears = comparison.horizonYears ?? comparison.profiles[0].result.horizonYears;
    const rate = value => percent(value * 100);
    root.className = 'monte-carlo-results';
    root.innerHTML = html(
      '<section class="monte-carlo-comparison"><h3>配對方案比較</h3>',
      `<p class="hint"><span>方案共用市場報酬、事件年份與第 1 年事件基準金額；實際事件金額依各方案通膨調整。</span> ${fixedEventSentence(comparison.profiles[0]?.result)}</p>`,
      '<p class="hint">固定通膨採各方案設定；AR(1) 共用隨機衝擊，但各以自己的年通膨率為中心。歷史抽樣與壓力路徑採指定 CPI，不使用方案年通膨率。</p>',
      '<p class="hint model-caveat"><b>這是此模型下的比較，不是完整的股債市場比較。</b>',
      '核心 ETF 與現金流 ETF 共用市場路徑；BXM／VYM／SCHD 另抽各自的月頻殘差。國債梯與緊急預備金採設定利率、無隨機利率波動，',
      INFLATION_STRESS_PATHS[comparison.profiles[0]?.result?.inflationModel]
        ? `未模擬債券市價波動；通膨採歷史壓力路徑（${INFLATION_STRESS_PATHS[comparison.profiles[0].result.inflationModel].label}，所有方案相同），國債票息跟隨同期 GS5、現金報酬跟隨同期 3 個月國庫券。因此配置差距須在這些假設下解讀。${inflationSentence(comparison.profiles[0].result)}</p>`
        : comparison.profiles[0]?.result?.inflationModel === 'ar1'
          ? '<span>未模擬債券市價波動；隨機通膨以各方案年通膨率為中心，共用相同隨機衝擊，不含 70 年代式失控。</span></p>'
          : '未模擬債券市價波動；通膨採固定設定，不含隨機通膨。因此配置差距須在這些假設下解讀。</p>',
      `<div class="table-wrap"><table><thead><tr><th>方案</th><th>耗盡率</th><th>相對 ${baselineName}</th><th>僅 ${baselineName} 耗盡 / 僅此方案耗盡</th><th>零支出年</th><th>年末資產 P25 / P50 / P75</th></tr></thead><tbody>`,
      comparison.profiles
        .map((profile, index) => {
          const paired = comparison.paired.find(item => item.id === profile.id);
          const r = profile.result;
          return `<tr><th>${nameHtml(profile.name)}${index === 0 ? '（基準）' : ''}</th><td>${rate(r.assetDepletionRate)}</td><td>${paired ? `${paired.depletionRateDelta >= 0 ? '+' : ''}${percent(paired.depletionRateDelta * 100)}` : '—'}</td><td>${paired ? `${paired.onlyBaselineDepleted} / ${paired.onlyProfileDepleted}` : '—'}</td><td>${rate(r.zeroSpendRate)}</td><td>${money(r.finalAssets.p25, true)} / ${money(r.finalAssets.p50, true)} / ${money(r.finalAssets.p75, true)}</td></tr>`;
        })
        .join(''),
      '</tbody></table></div>',
      comparisonEventGapTable(comparison),
      '<div class="comparison-chart-tabs" role="tablist" aria-label="方案比較圖表">',
      '<button class="selected" role="tab" aria-selected="true" data-comparison-view="cagr">前 5 年 CAGR 十分位</button>',
      `<button role="tab" aria-selected="false" data-comparison-view="trajectory">${horizonYears} 年資產軌跡</button></div>`,
      '<section class="comparison-chart-panel" data-comparison-panel="cagr"><h3>核心 ETF 前 5 年 CAGR 十分位 vs 資產耗盡率</h3>',
      comparisonDecileChart(comparison),
      '<div class="table-wrap"><table><thead><tr><th>十分位</th><th>核心 ETF 前 5 年 CAGR</th><th>路徑數</th>',
      comparison.profiles.map(profile => `<th>${nameHtml(profile.name)} 耗盡率</th>`).join(''),
      '</tr></thead><tbody>',
      comparison.deciles
        .map(
          decile =>
            `<tr><th>${decile.label}</th><td>${percent(decile.lower * 100)} ~ ${percent(decile.upper * 100)}</td><td>${decile.paths}</td>${comparison.profiles.map(profile => `<td>${Number.isFinite(decile.depletionRates[profile.id]) ? rate(decile.depletionRates[profile.id]) : '—'}</td>`).join('')}</tr>`,
        )
        .join(''),
      '</tbody></table></div>',
      '<p class="hint model-caveat">這張圖是 <b>條件耗盡率</b>——「前 5 年市場報酬落在該十分位的路徑，最後有多少比例資產耗盡」，',
      '不是因果歸因。它衡量的是序列風險：同一條市場路徑對不同配置是不同的投資組合經驗，橫軸只描述市場。',
      INFLATION_STRESS_PATHS[comparison.profiles[0]?.result?.inflationModel]
        ? '所有路徑套用同一段歷史通膨，差異只來自市場報酬，所以這張圖不能當成完整的失敗原因分析。</p>'
        : comparison.profiles[0]?.result?.inflationModel === 'ar1'
          ? '通膨雖為隨機路徑，但橫軸只依市場報酬分組，所以這張圖不能當成完整的失敗原因分析。</p>'
          : '另外目前的抽樣 <b>不含隨機通膨</b>（每條路徑共用同一個通膨率），所以這張圖不能當成完整的失敗原因分析。</p>',
      '</section>',
      `<section class="comparison-chart-panel" data-comparison-panel="trajectory" hidden><h3>${horizonYears} 年總資產軌跡</h3>`,
      '<p class="hint">每條線都是該方案全部 Monte Carlo 路徑在各年度的總資產分位數；破產後的年度計為 $0。</p>',
      comparisonTrajectoryChart(comparison),
      '</section>',
      '<div class="comparison-representative-actions"><strong>代表路徑年度明細</strong>',
      comparison.profiles
        .map(
          profile =>
            `<button class="ghost" data-view-comparison-representative="${escapeHtml(profile.id)}">查看 ${nameHtml(profile.name)} P50 年度明細</button>`,
        )
        .join(''),
      '</div>',
      '<div class="representative-path-actions"><button class="ghost" data-export-comparison="summary">匯出比較摘要 CSV</button><button class="ghost" data-export-comparison="deciles">匯出 CAGR 十分位 CSV</button></div></section>',
    );
    root.querySelectorAll('[data-export-comparison]').forEach(button => {
      button.onclick = () => downloadComparisonCsv(comparison, button.dataset.exportComparison);
    });
    root.querySelectorAll('[data-view-comparison-representative]').forEach(button => {
      button.onclick = () => {
        const profile = comparison.profiles.find(item => item.id === button.dataset.viewComparisonRepresentative);
        if (profile) viewRepresentativePath('p50', profile.result, profile.plan, profile.name);
      };
    });
    root.querySelectorAll('[data-comparison-view]').forEach(button => {
      button.onclick = () => {
        const view = button.dataset.comparisonView;
        root.querySelectorAll('[data-comparison-view]').forEach(tab => {
          const selected = tab.dataset.comparisonView === view;
          tab.classList.toggle('selected', selected);
          tab.setAttribute('aria-selected', String(selected));
        });
        root
          .querySelectorAll('[data-comparison-panel]')
          .forEach(panel => (panel.hidden = panel.dataset.comparisonPanel !== view));
      };
    });
    root.querySelectorAll('[data-trajectory-series-toggle]').forEach(button => {
      button.onclick = () => {
        const id = button.dataset.trajectorySeriesToggle;
        if (hiddenComparisonTrajectorySeries.has(id)) hiddenComparisonTrajectorySeries.delete(id);
        else hiddenComparisonTrajectorySeries.add(id);
        const hidden = hiddenComparisonTrajectorySeries.has(id);
        button.classList.toggle('off', hidden);
        button.setAttribute('aria-pressed', String(!hidden));
        root.querySelector(`[data-trajectory-series="${id}"]`).classList.toggle('hidden', hidden);
      };
    });
  }
  function comparisonDecileChart(comparison) {
    const width = 720;
    const height = 250;
    const left = 48;
    const bottom = 32;
    // 空 bin 的耗盡率是 null（路徑數少於 10 時會出現）；別讓它變成 0 而畫出一條假的谷底。
    const rateOf = (decile, id) => (Number.isFinite(decile.depletionRates[id]) ? decile.depletionRates[id] : null);
    const maxRate = Math.max(
      0.01,
      ...comparison.deciles.flatMap(decile => Object.values(decile.depletionRates).filter(Number.isFinite)),
    );
    const colors = seriesColors;
    const x = index => left + (index * (width - left - 16)) / 9;
    const y = value => height - bottom - (value / maxRate) * (height - bottom - 16);
    return html(
      '<div class="comparison-decile-chart">',
      `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="核心 ETF 前五年 CAGR 十分位與各方案資產耗盡率">`,
      `<line x1="${left}" x2="${width - 16}" y1="${height - bottom}" y2="${height - bottom}" class="chart-axis"/>`,
      `<text x="4" y="20" class="chart-label">${percent(maxRate * 100)}</text><text x="4" y="${height - bottom}" class="chart-label">0%</text>`,
      comparison.deciles
        .map(
          (decile, index) =>
            `<text x="${x(index)}" y="${height - 8}" text-anchor="middle" class="chart-label">${decile.label}</text>`,
        )
        .join(''),
      comparison.profiles
        .map((profile, index) => {
          const points = comparison.deciles
            .map((decile, decileIndex) => ({ decileIndex, value: rateOf(decile, profile.id) }))
            .filter(point => point.value !== null)
            .map(point => `${x(point.decileIndex)},${y(point.value)}`)
            .join(' ');
          return `<polyline points="${points}" fill="none" style="stroke:${colors[index]}" stroke-width="3"/>`;
        })
        .join(''),
      '</svg>',
      '<div class="comparison-chart-legend" aria-label="方案折線圖例">',
      comparison.profiles
        .map(
          (profile, index) =>
            `<span><i style="background:${colors[index]}"></i>${nameHtml(profile.name)}${index === 0 ? '（基準）' : ''}</span>`,
        )
        .join(''),
      '</div></div>',
    );
  }
  function comparisonTrajectoryChart(comparison) {
    const width = 720;
    const height = 300;
    const left = 56;
    const bottom = 34;
    const maxValue = Math.max(
      1,
      ...comparison.profiles.flatMap(profile => profile.result.totalAssetTrajectory.map(year => year.p75)),
    );
    const colors = seriesColors;
    const horizonYears = comparison.horizonYears ?? comparison.profiles[0].result.horizonYears;
    const x = index => left + (index * (width - left - 16)) / Math.max(1, horizonYears - 1);
    const y = value => height - bottom - (value / maxValue) * (height - bottom - 18);
    const series = comparison.profiles.flatMap((profile, profileIndex) =>
      ['p25', 'p50', 'p75'].map(quantileLabel => ({
        profile,
        quantileLabel,
        color: colors[profileIndex],
        dash:
          quantileLabel === 'p25'
            ? ''
            : quantileLabel === 'p50'
              ? ' stroke-dasharray="6 4"'
              : ' stroke-dasharray="14 5"',
        id: `${profile.id}-${quantileLabel}`,
      })),
    );
    return html(
      '<div class="comparison-decile-chart comparison-trajectory-chart">',
      `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="方案 A、B、C 各 P25、P50、P75 的 ${horizonYears} 年總資產軌跡">`,
      `<line x1="${left}" x2="${width - 16}" y1="${height - bottom}" y2="${height - bottom}" class="chart-axis"/>`,
      `<text x="2" y="20" class="chart-label">${money(maxValue, true)}</text><text x="22" y="${height - bottom}" class="chart-label">$0</text>`,
      axisYears(1, horizonYears, 6)
        .map(year => year - 1)
        .map(
          index =>
            `<text x="${x(index)}" y="${height - 8}" text-anchor="middle" class="chart-label">${index + 1}</text>`,
        )
        .join(''),
      series
        .map(seriesItem => {
          const points = seriesItem.profile.result.totalAssetTrajectory
            .map((year, index) => `${x(index)},${y(year[seriesItem.quantileLabel])}`)
            .join(' ');
          const hidden = hiddenComparisonTrajectorySeries.has(seriesItem.id);
          return `<polyline data-trajectory-series="${seriesItem.id}" class="${hidden ? 'hidden' : ''}" points="${points}" fill="none" style="stroke:${seriesItem.color}" stroke-width="${seriesItem.quantileLabel === 'p50' ? 3 : 2}"${seriesItem.dash}/>`;
        })
        .join(''),
      '</svg><div class="comparison-chart-legend">',
      series
        .map(
          seriesItem =>
            `<button type="button" class="trajectory-legend-toggle${hiddenComparisonTrajectorySeries.has(seriesItem.id) ? ' off' : ''}" data-trajectory-series-toggle="${seriesItem.id}" aria-pressed="${!hiddenComparisonTrajectorySeries.has(seriesItem.id)}"><svg viewBox="0 0 24 6" aria-hidden="true"><line x1="0" y1="3" x2="24" y2="3" style="stroke:${seriesItem.color}" stroke-width="2"${seriesItem.dash}/></svg>${nameHtml(seriesItem.profile.name)} ${seriesItem.quantileLabel.toUpperCase()}</button>`,
        )
        .join(''),
      '</div></div>',
    );
  }
  function downloadComparisonCsv(comparison, kind) {
    downloadCsv(
      comparisonCsv(comparison, kind),
      kind === 'summary' ? '方案比較摘要.csv' : '核心ETF前5年CAGR十分位.csv',
    );
  }
  // Monte Carlo 的欄位只在按下按鈕時才寫回 state，所以每個會重繪這些欄位的動作都必須
  // 先把畫面上的值整組收下來；否則 renderMonteCarloInputs() 會拿舊 state 覆寫回去，使用者
  // 剛改好又還沒執行的平均報酬、波動率就這樣無聲消失。
  function readMonteCarloInputs() {
    // 界線一律交給 clampMonteCarlo，這裡只負責把欄位讀成數字；mean 的 -100 就是這樣溜過去的。
    return clampMonteCarlo({
      scenario: $('#monte-carlo-scenario').value,
      paths: $('#monte-carlo-paths').value,
      seed: $('#monte-carlo-seed').value,
      mean: $('#monte-carlo-mean').value,
      volatility: $('#monte-carlo-volatility').value,
      eventProbability: $('#monte-carlo-event-probability').value,
      eventAmount: $('#monte-carlo-event-amount').value,
      samplingMode: $('#monte-carlo-sampling-mode').value,
      historicalMarket: $('#monte-carlo-historical-market').value,
      historicalBlockLength: $('#monte-carlo-historical-block-length').value,
      historicalJitter: $('#monte-carlo-historical-jitter').value,
      inflationModel: $('#monte-carlo-inflation-model').value,
      fixedEvent: {
        year: $('#monte-carlo-fixed-event-year').value,
        amount: $('#monte-carlo-fixed-event-amount').value,
      },
    });
  }
  function invalidateMonteCarlo() {
    monteCarloGeneration++;
    monteCarloRunner.cancel();
    monteCarloResult = null;
    resultPlan = null;
    resultProfileName = null;
    monteCarloStale = true;
    $('#representative-detail').hidden = true;
    $('#run-monte-carlo').textContent = '執行模擬';
    applyLanguage();
  }
  $('#run-monte-carlo').onclick = async () => {
    if (monteCarloRunner.isRunning()) {
      invalidateMonteCarlo();
      renderMonteCarlo();
      return;
    }
    invalidateMonteCarlo();
    const generation = monteCarloGeneration;
    state.monteCarlo = readMonteCarloInputs();
    renderMonteCarloInputs();
    persist();
    $('#run-monte-carlo').textContent = '取消模擬';
    $('#monte-carlo-content').textContent = '模擬中…可繼續操作，修改方案或抽樣設定會取消本次計算。';
    applyLanguage();
    try {
      const primaryProfile = selectedProfile();
      const included = state.monteCarloProfiles.filter(profile => profile.enabled !== false);
      const profiles = included;
      if (state.monteCarloComparisonEnabled && !profiles.length) throw new Error('請至少保留一個方案參與比較');
      const runningPlan = {
        ...primaryProfile.plan,
        planningPeriod: currentPlanningPeriod(),
      };
      const result = await monteCarloRunner.run({
        comparison: state.monteCarloComparisonEnabled,
        profiles,
        state: { ...state, monteCarloProfile: runningPlan },
      });
      if (generation !== monteCarloGeneration) return;
      monteCarloResult = result;
      resultPlan = runningPlan;
      resultProfileName = state.monteCarloComparisonEnabled ? null : primaryProfile.name;
      monteCarloStale = false;
      renderMonteCarlo();
    } catch (error) {
      if (generation !== monteCarloGeneration) return;
      $('#monte-carlo-content').className = 'monte-carlo-empty';
      $('#monte-carlo-content').textContent = error.message;
    } finally {
      if (generation === monteCarloGeneration) {
        $('#run-monte-carlo').textContent = '執行模擬';
        applyLanguage();
      }
    }
  };
  for (const id of [
    'scenario',
    'paths',
    'seed',
    'mean',
    'volatility',
    'event-probability',
    'event-amount',
    'sampling-mode',
    'historical-market',
    'historical-block-length',
    'historical-jitter',
  ]) {
    $('#monte-carlo-' + id).onchange = () => {
      invalidateMonteCarlo();
      state.monteCarlo = readMonteCarloInputs();
      renderMonteCarloInputs();
      renderMonteCarloProfile();
      persist();
      renderMonteCarlo();
    };
  }
  $('#generate-monte-carlo-seed').onclick = () => {
    const current = readMonteCarloInputs();
    previousMonteCarloSeed = current.seed;
    const bytes = new Uint32Array(1);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else bytes[0] = Math.floor(Math.random() * 4294967296);
    state.monteCarlo = { ...current, seed: bytes[0] };
    invalidateMonteCarlo();
    renderMonteCarloInputs();
    renderMonteCarlo();
    persist();
  };
  let pendingProfileCopy = null;
  function cancelProfileCopy() {
    pendingProfileCopy = null;
    $('#profile-copy-confirmation').hidden = true;
  }
  function focusProfile(id) {
    const card = document.querySelector(`[data-plan-card="${id}"]`);
    if (!card) return;
    card.open = true;
    card.querySelector('summary').focus();
  }
  function saveProfileCopy(next) {
    cancelProfileCopy();
    const index = state.monteCarloProfiles.findIndex(profile => profile.id === next.id);
    if (index === -1) state.monteCarloProfiles.push(next);
    else state.monteCarloProfiles[index] = next;
    invalidateMonteCarlo();
    persist();
    renderMonteCarloProfile();
    renderMonteCarlo();
    focusProfile(next.id);
  }
  function requestProfileCopy(id, legacy = false, sourceId = selectedPlanId) {
    cancelProfileCopy();
    const existing = state.monteCarloProfiles.find(profile => profile.id === id);
    const source = state.monteCarloProfiles.find(profile => profile.id === sourceId) || selectedProfile();
    const name = existing?.name ?? `方案 ${id.toUpperCase()}`;
    const next = { ...existing, id, name, plan: monteCarloPlanSnapshot(legacy ? state : source.plan) };
    if (!existing) {
      saveProfileCopy(next);
      return;
    }
    pendingProfileCopy = next;
    $('#profile-copy-message').innerHTML =
      `<span>確認覆寫方案</span> ${nameHtml(name)} ← ${legacy ? '<span>舊固定情境備份</span>' : nameHtml(source.name)}`;
    $('#profile-copy-confirmation').hidden = false;
    $('#profile-copy-confirmation').scrollIntoView?.({ block: 'nearest' });
    applyLanguage();
    $('#confirm-profile-copy').focus();
  }
  $('#confirm-profile-copy').onclick = () => {
    if (pendingProfileCopy) saveProfileCopy(pendingProfileCopy);
  };
  $('#cancel-profile-copy').onclick = () => {
    const id = pendingProfileCopy?.id;
    cancelProfileCopy();
    if (id) focusProfile(id);
  };
  $('#return-fixed-plan').onclick = () => setActiveView('planner-view');
  function changePlanningAge(field, rawValue) {
    const previous = currentPlanningPeriod();
    const entered = Math.round(Number(rawValue));
    let currentAge = previous.currentAge;
    let targetAge = previous.targetAge;
    if (field === 'currentAge') {
      currentAge = Number.isFinite(entered)
        ? Math.max(MIN_CURRENT_AGE, Math.min(entered, MAX_TARGET_AGE - 1))
        : previous.currentAge;
      targetAge = Math.max(currentAge + 1, Math.min(targetAge, currentAge + 60, MAX_TARGET_AGE));
    } else {
      targetAge = Number.isFinite(entered)
        ? Math.max(currentAge + 1, Math.min(entered, currentAge + 60, MAX_TARGET_AGE))
        : previous.targetAge;
    }
    const hadHistoricalReplay = Boolean(state.historicalReplay);
    state = hydrateState({
      ...state,
      planningPeriod: { currentAge, targetAge, years: targetAge - currentAge },
    });
    if (hadHistoricalReplay) {
      if (state.historicalReplay) {
        const replay = state.historicalReplay;
        const reverse = replay.direction === 'reverse';
        state.coreReturns = historicalReturnPath(replay.market, replay.startYear, currentHorizonYears(), reverse);
        state.inflationRates = historicalInflationPath(replay.market, replay.startYear, currentHorizonYears(), reverse);
        const safeRates = historicalSafeRates(replay.market, replay.startYear, currentHorizonYears(), reverse);
        if (safeRates) state.safeRates = safeRates;
        else delete state.safeRates;
      } else {
        state.coreReturns = {};
        state.inflationRates = {};
        delete state.safeRates;
      }
      delete state.bxmMonthlyPath;
      delete state.incomeMonthlyPath;
      delete state.historicalSampleSources;
    }
    mcAssetYear = currentHorizonYears();
    fixedComparisonYear = Math.min(fixedComparisonYear, currentHorizonYears());
    scenarioComparisonYear = Math.min(scenarioComparisonYear, currentHorizonYears());
    expandedYears.clear();
    projectionStart = 0;
    invalidateMonteCarlo();
    renderInputs();
    renderAll();
    renderMonteCarloProfile();
    renderMonteCarlo();
    if (currentView === 'scenario-comparison-view') renderScenarioComparison();
    applyLanguage();
  }
  $('#planning-current-age').onchange = event => changePlanningAge('currentAge', event.target.value);
  $('#planning-target-age').onchange = event => changePlanningAge('targetAge', event.target.value);
  function changeSharedMode(enabled) {
    cancelProfileCopy();
    state.monteCarloComparisonEnabled = enabled;
    invalidateMonteCarlo();
    persist();
    renderMonteCarloProfile();
    renderMonteCarlo();
    renderScenario();
    renderPlanContext();
    applyLanguage();
  }
  $('#shared-plan-mode').onchange = event => changeSharedMode(event.target.value === 'comparison');
  $('#monte-carlo-comparison-enabled').onchange = event => changeSharedMode(event.target.checked);
  $('#fixed-comparison-enabled').onchange = event => changeSharedMode(event.target.checked);
  $('#edit-comparison-plans').onclick = () => {
    setActiveView('plans-view');
    persist();
    $('#comparison-settings').open = true;
    $('#comparison-settings').scrollIntoView?.({ block: 'start' });
  };
  $('#scenario-tabs').onclick = e => {
    if (!e.target.dataset.scenario) return;
    const nextScenario = e.target.dataset.scenario;
    // 只有「真的套用過歷史路徑」才清除，判斷依據是 state.historicalReplay 而不是目前頁籤。
    // 點進「歷史」只是打開選單看區間，此時切回基準不該動到使用者手動編輯或 MC 代表路徑的
    // 逐年報酬——用頁籤判斷會把它們一起清掉。
    if (state.historicalReplay && nextScenario !== 'historical') {
      state.coreReturns = {};
      state.inflationRates = {};
      delete state.safeRates;
      state.historicalReplay = null;
      dropPathSourcedEvents();
    }
    setScenario(nextScenario);
    expandedYears.clear();
    projectionStart = 0;
    renderScenario();
    persist();
  };
  $('.app-tabs').onclick = e => {
    if (!e.target.dataset.view) return;
    setActiveView(e.target.dataset.view);
  };
  $('#add-income').onclick = () => {
    // id 用時間戳而不是陣列長度：刪掉中間一列再新增會撞號，而 UI 的刪除鍵是按 index 走的，
    // 撞號本身不會出錯，但存回 localStorage 後兩列共用一個 id 就無從分辨。
    state.guaranteedIncome.push({
      id: `income-${Date.now().toString(36)}`,
      label: '',
      amount: 0,
      startYear: 1,
      endYear: null,
      indexation: 'full',
    });
    renderAll();
    renderIncomeSources();
  };
  $('#save').onclick = () => {
    persist();
    const b = $('#save');
    b.textContent = '已儲存';
    setTimeout(() => (b.textContent = '儲存設定'), 1200);
  };
  $('#reset').onclick = () => {
    selectedPlanId = 'a';
    localStorage.setItem('retirement-selected-plan', 'a');
    state.monteCarloComparisonEnabled = false;
    fixedComparisonYear = 1;
    fixedComparisonProfile = null;
    cancelProfileCopy();
    state = cloneDefault();
    allocationTargetsApplied = false;
    state.monteCarloProfiles = [{ id: 'a', name: '方案 A', plan: monteCarloPlanSnapshot(state) }];
    // Reset 已換掉快照；保留舊抽樣結果會讓 Monte Carlo 分頁看起來像是新設定剛跑出的。
    invalidateMonteCarlo();
    renderInputs();
    renderAll();
    renderMonteCarloProfile();
    renderMonteCarlo();
  };
  $('#edit-main-plan').onclick = () => setActiveView('plans-view');
  let mcFanResizeFrame;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(mcFanResizeFrame);
    mcFanResizeFrame = requestAnimationFrame(() => {
      if (currentView === 'scenario-comparison-view') renderScenarioComparison();
      if (currentView === 'monte-carlo-view' && monteCarloResult && !monteCarloResult.profiles)
        renderMonteCarloAssetFan(monteCarloResult);
    });
  });
  const themeSelect = $('#theme-select');
  if (themeSelect && window.RetirementTheme) {
    themeSelect.value = window.RetirementTheme.get();
    themeSelect.onchange = () => window.RetirementTheme.set(themeSelect.value);
  }
  $('#language-toggle').onclick = () => {
    currentLanguage = currentLanguage === 'en' ? 'zh' : 'en';
    localStorage.setItem('retirement-language', currentLanguage);
    applyLanguage();
  };
  $('#open-guide').onclick = event => openGuide(null, event.currentTarget);
  $('#close-guide').onclick = () => closeGuide();
  $('#guide-backdrop').onclick = () => closeGuide();
  $('#guide-search').oninput = event => filterGuide(event.target.value);
  $('#guide-drawer').onclick = event => {
    const topic = event.target.closest('[data-guide-topic]');
    if (topic) openGuide(topic.dataset.guideTopic, topic);
    const anchor = event.target.closest('[data-guide-anchor]');
    if (anchor) {
      event.preventDefault();
      document.querySelector(anchor.getAttribute('href'))?.scrollIntoView({ block: 'start' });
    }
    const step = event.target.closest('[data-guide-view]');
    if (step) openGuideStep(step);
  };
  document.body.addEventListener('click', event => {
    const topic = event.target.closest('[data-guide-topic]');
    if (topic && !topic.closest('#guide-drawer')) openGuide(topic.dataset.guideTopic, topic);
  });
  document.addEventListener('keydown', event => {
    const drawer = $('#guide-drawer');
    if (drawer.hidden) return;
    if (event.key === 'Escape') {
      closeGuide();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('button, input, a[href], [tabindex]')].filter(
      element => !element.disabled && !element.hidden && !element.closest('[hidden]'),
    );
    if (!focusable.length) {
      event.preventDefault();
      drawer.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  $('#preview-allocation').onclick = () =>
    allocationPreview(state, $('#allocation-preview'), draft => {
      state.buckets = draft.buckets;
      state.treasury = draft.treasury;
      state.coverageTargets = draft.coverageTargets;
      if (Number.isFinite(draft.lockedInitialAssets)) state.lockedInitialAssets = draft.lockedInitialAssets;
      allocationSignature = allocationInputsSignature();
      renderAll();
    });
  // 版本字串由主程序注入，避免與 package.json 形成第二個手動來源。
  if (window.desktop?.version) $('#app-version').textContent = `RETIREMENT ASSET PLANNER · v${window.desktop.version}`;
  // 只翻譯實際異動的子樹：childList 取容器、文字取所在元素、屬性取該元素。
  // 若改回無參數的 applyLanguage()，任何局部重畫（例如切換年份）都會再掃一次整頁。
  function mutationRoots(records) {
    const roots = new Set();
    for (const record of records) {
      const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (element?.isConnected) roots.add(element);
    }
    // 祖先已在清單中的子樹會被一起掃描，略過以免重複。
    return [...roots].filter(element => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement)
        if (roots.has(parent)) return false;
      return true;
    });
  }
  const languageObserver = new MutationObserver(records => mutationRoots(records).forEach(applyLanguage));
  languageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label', 'placeholder', 'data-tooltip'],
  });
  initializeGuide();
  renderInputs();
  renderAll();
  renderMonteCarloProfile();
  renderMonteCarlo();
  setActiveView(currentView);
  applyLanguage();
  if (!localStorage.getItem('retirement-guide-seen')) openGuide('guide-快速入門', $('#open-guide'));
})();
