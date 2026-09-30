// 退休水庫模擬核心。純函式，無 DOM 依賴。
// 同時支援瀏覽器（window.RetirementSim）與 Node（require）；不使用 ES module，
// 因為 Electron 以 file:// 載入頁面，Chromium 會因 CORS 阻擋 file:// 的 import。
// 以 IIFE 包住：傳統 <script> 共用同一個全域語彙環境，若 const 洩漏到全域，
// app.js 端的 const { DEFAULT, ... } 會觸發 "Identifier has already been declared"。
(function () {
  const DEFAULT = {
    schemaVersion: 1,
    // 固定情境頁選中的情境。不存的話重開會固定回到 base，而 coreReturns／inflationRates
    // 是存下來的——畫面說「基準」，模擬卻仍在跑歷史回放，歷史控制區還被藏起來。
    scenario: 'base',
    // 實際套用過的歷史窗口，{ market, startYear } 或 null。**不能用「目前在哪個頁籤」代替**：
    // 點進「歷史」只是打開選單，還沒套用任何東西；若用頁籤判斷，切回基準就會把 Monte Carlo
    // 代表路徑或使用者手動編輯的逐年報酬一起清掉。
    historicalReplay: null,
    annualSpend: 240000,
    // 必要生活支出底線。0 = 停用：不能讓另一個 enabled 旗標和金額互相矛盾。
    spendingFloor: { annualAmount: 0 },
    inflation: 2.5,
    // 固定情境可選擇以歷史 CPI 覆寫各年度通膨；空白時一律使用上方年通膨率。
    inflationRates: {},
    bearThreshold: -15,
    coreReturns: {},
    emergencyEvents: {},
    // 非計畫支出是使用者逐年輸入的，但複製 Monte Carlo 代表路徑時會整批寫入一組**隨機生成**
    // 的事件。兩者長得一模一樣，所以「該不該清掉」無法從 emergencyEvents 本身推導——這個
    // 旗標記的就是那個無法推導的事實。使用者手動改動任何一格即轉為 false：那一刻起這組事件
    // 是他的，不再屬於那條路徑。與 historicalReplay 同一個模式。
    eventsFromPath: false,
    withdrawalOrders: {
      planned: ['defense', 'emergency', 'growth', 'income'],
      event: ['emergency', 'defense', 'growth', 'income'],
    },
    // 保證性收入（Social Security、年金、兼職）。清單而非單筆：起領年不同的配偶給付、有結束年
    // 的兼職、調整方式不同的商業年金都表達不了；「自第 N 年起打 X 折」也是用兩筆來源表達
    // （前一筆 endYear: N-1、後一筆 startYear: N 且金額打折），因此不另設 reliability 欄位。
    // 空陣列 = 停用，既有配置的結果逐位不變。
    guaranteedIncome: [],
    eventWithdrawalPolicy: 'gamma',
    // 調整幅度以**實質**表示：上調 = CPI + raise，下調 = CPI − cut，未觸發 = 剛好跟上 CPI。
    // 砍得比加得快是刻意的：序列風險不對稱，早期少花救得回來，早期多花救不回來。
    guardrails: { lower: 3.5, upper: 4.5, raise: 2, cut: 5 },
    monteCarlo: {
      paths: 1000,
      seed: 20260915,
      mean: 7,
      volatility: 18,
      eventProbability: 1,
      eventAmount: 50000,
      scenario: 'base',
    },
    // 比較模式預設關閉，既有單方案結果不應因新增功能而改變。
    monteCarloComparisonEnabled: false,
    monteCarloProfiles: [],
    treasury: {
      length: 3,
      rungs: [
        { maturityYear: 1, face: 150000, coupon: 4 },
        { maturityYear: 2, face: 150000, coupon: 4 },
        { maturityYear: 3, face: 150000, coupon: 4 },
      ],
    },
    buckets: [
      {
        id: 'emergency',
        name: '1. 緊急預備金',
        short: '極致流動性',
        amount: 240000,
        assets: '現金 / MMF',
        purpose: '突發支出與即時流動性',
        yield: 4.0,
        color: '#59d6b1',
      },
      {
        id: 'defense',
        name: '2. 防守安全國債梯',
        short: '鎖定現金流',
        amount: 450000,
        assets: '3 年期美債梯',
        purpose: '熊市不賣股票的生活費緩衝',
        yield: 3.8,
        color: '#86aaff',
      },
      {
        id: 'income',
        name: '3. 現金流ETF',
        short: '被動現金流',
        amount: 960000,
        assets: 'QQQI / SPYI',
        purpose: '以配息負擔日常開銷',
        yield: 10.0,
        color: '#ffc86b',
      },
      {
        id: 'growth',
        name: '4. 核心增值ETF',
        short: '長期成長',
        amount: 4350000,
        assets: 'VTI / VOO / QQQ',
        purpose: '抗通膨與長期本金續航',
        yield: 1.3,
        color: '#f58ea1',
      },
    ],
  };
  // 歷史回放的非核心水庫沿用基準情境。共用同一份常數，避免兩處字面值日後各自漂移。
  const BASE_SCENARIO_RETURNS = Object.freeze({ emergency: 3.5, defense: 3.5, income: 8, growth: 7 });
  const scenarios = {
    bull: {
      label: '牛市',
      description: '回放 1996–1999 網路泡沫吹起的四年實際報酬，其後回到長期平均。',
      returns: { emergency: 4, defense: 3.8, income: 12, growth: 14 },
    },
    base: {
      label: '基準情境',
      description: '長期平均市場環境；以收入水庫和分層提領維持支出。',
      returns: { ...BASE_SCENARIO_RETURNS },
    },
    bear: {
      label: '熊市',
      description: '回放 2000–2002 泡沫破裂與 2003–2004 的實際反彈，其後回到長期平均；核心資產避免在低點出售。',
      returns: { emergency: 3.5, defense: 4, income: -8, growth: -22 },
    },
    historical: {
      label: '歷史回放',
      description: '核心報酬與 CPI 依所選市場的完整歷史年度回放；其餘水庫沿用基準假設。',
      returns: { ...BASE_SCENARIO_RETURNS },
    },
  };
  // S&P 500 Total Return，完整曆年、含股息再投資；1960–2025。
  // 1960–1995 取自 Damodaran 年度報酬表（data/sp500-total-return-damodaran.csv 快照，測試逐格比對），
  // 1996–2025 取自 S&P 官方 SPXT；口徑差異見 README。2026 尚未完整，不納入可重播的歷史路徑。
  const SP500_TOTAL_RETURNS = Object.freeze({
    1960: 0.34,
    1961: 26.64,
    1962: -8.81,
    1963: 22.61,
    1964: 16.42,
    1965: 12.4,
    1966: -9.97,
    1967: 23.8,
    1968: 10.81,
    1969: -8.24,
    1970: 3.56,
    1971: 14.22,
    1972: 18.76,
    1973: -14.31,
    1974: -25.9,
    1975: 37,
    1976: 23.83,
    1977: -6.98,
    1978: 6.51,
    1979: 18.52,
    1980: 31.74,
    1981: -4.7,
    1982: 20.42,
    1983: 22.34,
    1984: 6.15,
    1985: 31.24,
    1986: 18.49,
    1987: 5.81,
    1988: 16.54,
    1989: 31.48,
    1990: -3.06,
    1991: 30.23,
    1992: 7.49,
    1993: 9.97,
    1994: 1.33,
    1995: 37.2,
    1996: 22.96,
    1997: 33.36,
    1998: 28.58,
    1999: 21.04,
    2000: -9.1,
    2001: -11.89,
    2002: -22.1,
    2003: 28.68,
    2004: 10.88,
    2005: 4.91,
    2006: 15.79,
    2007: 5.49,
    2008: -37,
    2009: 26.46,
    2010: 15.06,
    2011: 2.11,
    2012: 16,
    2013: 32.39,
    2014: 13.69,
    2015: 1.38,
    2016: 11.96,
    2017: 21.83,
    2018: -4.38,
    2019: 31.49,
    2020: 18.4,
    2021: 28.71,
    2022: -18.11,
    2023: 26.29,
    2024: 25.02,
    2025: 17.88,
  });
  // BLS CPI-U（CUSR0000SA0）12 月相對前一年 12 月的變動率；與 S&P 500 完整曆年報酬配對。
  // 1975–2025：BLS 下載檔 data/us-cpi-u-december-change.xlsx。1960–1974：同一序列在 FRED 的指數
  // （CPIAUCSL，data/us-cpi-u-sa-index-fred.csv）以 12 月對 12 月計算、取一位小數；此算法在
  // 1975–2025 重疊的 51 年與 BLS 公布值逐年相同。2026 年尚未完整，不提供回放。
  const US_CPI_DECEMBER_CHANGES = Object.freeze({
    1960: 1.4,
    1961: 0.7,
    1962: 1.2,
    1963: 1.6,
    1964: 1.2,
    1965: 1.9,
    1966: 3.4,
    1967: 3.3,
    1968: 4.7,
    1969: 5.9,
    1970: 5.6,
    1971: 3.3,
    1972: 3.4,
    1973: 8.9,
    1974: 12.1,
    1975: 7.1,
    1976: 5.0,
    1977: 6.7,
    1978: 9.0,
    1979: 13.3,
    1980: 12.4,
    1981: 8.9,
    1982: 3.8,
    1983: 3.8,
    1984: 4.0,
    1985: 3.8,
    1986: 1.2,
    1987: 4.3,
    1988: 4.4,
    1989: 4.6,
    1990: 6.3,
    1991: 3.0,
    1992: 3.0,
    1993: 2.8,
    1994: 2.6,
    1995: 2.5,
    1996: 3.4,
    1997: 1.7,
    1998: 1.6,
    1999: 2.7,
    2000: 3.4,
    2001: 1.6,
    2002: 2.5,
    2003: 2.0,
    2004: 3.3,
    2005: 3.3,
    2006: 2.5,
    2007: 4.1,
    2008: 0.0,
    2009: 2.8,
    2010: 1.4,
    2011: 3.1,
    2012: 1.8,
    2013: 1.5,
    2014: 0.7,
    2015: 0.6,
    2016: 2.1,
    2017: 2.1,
    2018: 2.0,
    2019: 2.3,
    2020: 1.3,
    2021: 7.2,
    2022: 6.4,
    2023: 3.3,
    2024: 2.9,
    2025: 2.7,
  });
  // FRED GS5（五年期公債固定到期殖利率，月頻）的年平均與 12 月值，1960–2025。
  // 來源：data/us-treasury-5y-yield.csv；年平均取 12 個月算術平均、四位小數，測試逐格比對。
  // 目前只用於通膨壓力路徑：錨定失效時利率也會跟著上升，固定票息會高估安全資產的實質損失。
  const US_TREASURY_5Y_ANNUAL_AVERAGE = Object.freeze({
    1960: 4.09,
    1961: 3.7508,
    1962: 3.7017,
    1963: 3.8292,
    1964: 4.0683,
    1965: 4.2475,
    1966: 5.1042,
    1967: 5.1075,
    1968: 5.6983,
    1969: 6.9333,
    1970: 7.3758,
    1971: 5.9875,
    1972: 5.9817,
    1973: 6.8667,
    1974: 7.8017,
    1975: 7.7658,
    1976: 7.1792,
    1977: 6.99,
    1978: 8.3175,
    1979: 9.5183,
    1980: 11.4783,
    1981: 14.2358,
    1982: 13.0058,
    1983: 10.7958,
    1984: 12.2408,
    1985: 10.1292,
    1986: 7.3108,
    1987: 7.935,
    1988: 8.4717,
    1989: 8.5042,
    1990: 8.37,
    1991: 7.37,
    1992: 6.1883,
    1993: 5.1475,
    1994: 6.6833,
    1995: 6.3908,
    1996: 6.1767,
    1997: 6.2225,
    1998: 5.15,
    1999: 5.5408,
    2000: 6.1525,
    2001: 4.5508,
    2002: 3.815,
    2003: 2.9683,
    2004: 3.4292,
    2005: 4.0458,
    2006: 4.745,
    2007: 4.425,
    2008: 2.7983,
    2009: 2.1908,
    2010: 1.9275,
    2011: 1.5225,
    2012: 0.7608,
    2013: 1.1725,
    2014: 1.6408,
    2015: 1.5292,
    2016: 1.3383,
    2017: 1.91,
    2018: 2.7483,
    2019: 1.9575,
    2020: 0.54,
    2021: 0.855,
    2022: 2.9992,
    2023: 4.0567,
    2024: 4.1258,
    2025: 3.9217,
  });
  // FRED TB3MS（3 個月國庫券次級市場利率，折現基礎，月頻）的年平均，1960–2025。現金報酬用它，
  // 不用五年期的 GS5：現金（國庫券、MMF）拿不到期限溢酬，ZIRP 年代兩者差到 1–2 個百分點。
  // 折現基礎略低於投資報酬率口徑，偏保守。來源：data/us-treasury-3m-bill-fred.csv，測試逐格比對。
  const US_TBILL_3M_ANNUAL_AVERAGE = Object.freeze({
    1960: 2.8833,
    1961: 2.3542,
    1962: 2.7733,
    1963: 3.1592,
    1964: 3.5467,
    1965: 3.9492,
    1966: 4.8625,
    1967: 4.3067,
    1968: 5.3383,
    1969: 6.6667,
    1970: 6.3917,
    1971: 4.3325,
    1972: 4.0725,
    1973: 7.0317,
    1974: 7.83,
    1975: 5.775,
    1976: 4.9742,
    1977: 5.2692,
    1978: 7.1883,
    1979: 10.0692,
    1980: 11.4342,
    1981: 14.025,
    1982: 10.6142,
    1983: 8.6108,
    1984: 9.5225,
    1985: 7.4792,
    1986: 5.9783,
    1987: 5.775,
    1988: 6.6675,
    1989: 8.1117,
    1990: 7.4933,
    1991: 5.375,
    1992: 3.4317,
    1993: 2.9975,
    1994: 4.2467,
    1995: 5.49,
    1996: 5.0058,
    1997: 5.0608,
    1998: 4.7767,
    1999: 4.6383,
    2000: 5.8167,
    2001: 3.3883,
    2002: 1.6025,
    2003: 1.0108,
    2004: 1.3717,
    2005: 3.1467,
    2006: 4.7267,
    2007: 4.3533,
    2008: 1.365,
    2009: 0.15,
    2010: 0.1367,
    2011: 0.0525,
    2012: 0.0858,
    2013: 0.0583,
    2014: 0.0325,
    2015: 0.0525,
    2016: 0.3175,
    2017: 0.9308,
    2018: 1.9392,
    2019: 2.0608,
    2020: 0.365,
    2021: 0.0442,
    2022: 2.0217,
    2023: 5.0683,
    2024: 4.9667,
    2025: 4.0667,
  });
  const US_TREASURY_5Y_DECEMBER = Object.freeze({
    1960: 3.67,
    1961: 3.91,
    1962: 3.56,
    1963: 4.04,
    1964: 4.09,
    1965: 4.72,
    1966: 5,
    1967: 5.75,
    1968: 6.12,
    1969: 7.96,
    1970: 5.95,
    1971: 5.69,
    1972: 6.16,
    1973: 6.8,
    1974: 7.31,
    1975: 7.76,
    1976: 6.1,
    1977: 7.48,
    1978: 9.08,
    1979: 10.42,
    1980: 13.25,
    1981: 13.6,
    1982: 10.22,
    1983: 11.54,
    1984: 11.07,
    1985: 8.73,
    1986: 6.67,
    1987: 8.45,
    1988: 9.09,
    1989: 7.75,
    1990: 7.73,
    1991: 6.19,
    1992: 6.08,
    1993: 5.15,
    1994: 7.78,
    1995: 5.51,
    1996: 6.07,
    1997: 5.77,
    1998: 4.45,
    1999: 6.19,
    2000: 5.17,
    2001: 4.39,
    2002: 3.03,
    2003: 3.27,
    2004: 3.6,
    2005: 4.39,
    2006: 4.53,
    2007: 3.49,
    2008: 1.52,
    2009: 2.34,
    2010: 1.93,
    2011: 0.89,
    2012: 0.7,
    2013: 1.58,
    2014: 1.64,
    2015: 1.7,
    2016: 1.96,
    2017: 2.18,
    2018: 2.68,
    2019: 1.68,
    2020: 0.39,
    2021: 1.23,
    2022: 3.76,
    2023: 4,
    2024: 4.25,
    2025: 3.7,
  });
  // MC 隨機通膨：AR(1)，今年 − 中心 = 持續性 ×（去年 − 中心）+ 衝擊，中心是使用者設定的年通膨率。
  // 每年獨立抽樣會產生「2% → 8% → 1%」這種歷史上從未出現的鋸齒（1976–2025 零次；獨立常態每 30 年
  // 約 1.6 次），所以要有持續性。
  //
  // **只用 1983 年以後校準。** 1976–2025 全期混了兩個時代：70 年代的高通膨大波動，與 Volcker 之後
  // 預期被錨定的 2–3%。全期估出的持續性 0.73、衝擊 1.88 放在 2.5% 中心附近，15% 的年份通縮、
  // 四成路徑出現連續三年以上通縮（歷史零次）。1983 年以後估計的路徑像真實的錨定時代，
  // 30 年平均落在設定值 ±0.5% 內。這個模型回答「錨定世界裡，通膨假設的正常誤差」；
  // 70 年代式的錨定失效由固定的壓力路徑處理，不塞進同一個分布。資料延伸時自動重估（測試釘住數值）。
  const INFLATION_CALIBRATION_START = 1983;
  function estimateInflationAr1(series, startYear = INFLATION_CALIBRATION_START) {
    const years = Object.keys(series)
      .map(Number)
      .filter(year => year >= startYear)
      .sort((a, b) => a - b);
    const values = years.map(year => series[year]);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    let numerator = 0,
      denominator = 0;
    for (let index = 1; index < values.length; index++) {
      numerator += (values[index] - mean) * (values[index - 1] - mean);
      denominator += (values[index - 1] - mean) ** 2;
    }
    const persistence = numerator / denominator;
    const residuals = values.slice(1).map((value, index) => value - mean - persistence * (values[index] - mean));
    const shockSd = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / (residuals.length - 2));
    return { persistence, shockSd, historicalMean: mean, firstYear: years[0], lastYear: years.at(-1) };
  }
  const INFLATION_AR1 = Object.freeze(estimateInflationAr1(US_CPI_DECEMBER_CHANGES));
  // 下限避免抽出不合理的深度通縮；美國 12 月年增率 1976 年以來最低是 2008 的 0.0%。
  // 以 1983 年以後的參數，約 5% 的年份低於 0%，下限很少生效。
  const INFLATION_FLOOR = -1;
  // 通膨壓力路徑：錨定失效不放進 AR(1) 分布，而是直接套用一段真實的美國 CPI，每條 MC 路徑相同、
  // 市場報酬仍隨機。回答「如果通膨像 70 年代那樣，但股市照常隨機波動」。不以使用者的通膨率
  // 為中心：這是實際發生過的名目路徑。
  const INFLATION_STRESS_PATHS = Object.freeze({
    us1966: Object.freeze({ label: '1966 年起美國 CPI（70 年代完整一輪）', startYear: 1966 }),
    us1973: Object.freeze({ label: '1973 年起美國 CPI（石油危機起）', startYear: 1973 }),
  });
  function stressInflationPath(id) {
    const stress = Object.hasOwn(INFLATION_STRESS_PATHS, id) ? INFLATION_STRESS_PATHS[id] : null;
    return stress ? historicalSeriesPath(US_CPI_DECEMBER_CHANGES, stress.startYear, HORIZON_YEARS) : null;
  }
  // 壓力路徑同期的安全資產利率：緊急預備金與到期現金全年賺當年 3 個月國庫券平均；年末補梯新買的
  // 國債票息取當年 12 月 GS5（梯級是 1–5 年期的國債）。
  function stressSafeRates(id) {
    const stress = Object.hasOwn(INFLATION_STRESS_PATHS, id) ? INFLATION_STRESS_PATHS[id] : null;
    return stress ? historicalSafeRates('sp500', stress.startYear) : null;
  }
  // normals[i] 是第 i+1 年的標準常態衝擊；上一期起點取中心，第 1 年即已帶衝擊。
  function inflationPath(center, normals) {
    let previous = center;
    return Object.fromEntries(
      normals.map((shock, index) => {
        const rate = Math.max(
          INFLATION_FLOOR,
          center + INFLATION_AR1.persistence * (previous - center) + INFLATION_AR1.shockSd * shock,
        );
        previous = rate;
        return [index + 1, rate];
      }),
    );
  }
  // FRED FPCPITOTLZGJPN：日本消費者物價全年平均的年增率；與日經完整曆年報酬配對。
  // 來源：FPCPITOTLZGJPN.xlsx。2026 年尚未完整，不提供回放。
  const JAPAN_CPI_ANNUAL_CHANGES = Object.freeze({
    1976: 9.374036,
    1977: 8.161827,
    1978: 4.209566,
    1979: 3.701851,
    1980: 7.778582,
    1981: 4.912163,
    1982: 2.741041,
    1983: 1.89972,
    1984: 2.261614,
    1985: 2.032277,
    1986: 0.595587,
    1987: 0.126177,
    1988: 0.678558,
    1989: 2.27229,
    1990: 3.078516,
    1991: 3.251438,
    1992: 1.760283,
    1993: 1.243046,
    1994: 0.695458,
    1995: -0.127899,
    1996: 0.1366,
    1997: 1.747805,
    1998: 0.661974,
    1999: -0.341297,
    2000: -0.676579,
    2001: -0.740056,
    2002: -0.923494,
    2003: -0.256542,
    2004: -0.008573,
    2005: -0.282946,
    2006: 0.249355,
    2007: 0.060039,
    2008: 1.380079,
    2009: -1.352837,
    2010: -0.728243,
    2011: -0.272456,
    2012: -0.044065,
    2013: 0.335038,
    2014: 2.759227,
    2015: 0.79528,
    2016: -0.127259,
    2017: 0.4842,
    2018: 0.989095,
    2019: 0.468776,
    2020: -0.024996,
    2021: -0.233353,
    2022: 2.497703,
    2023: 3.268134,
    2024: 2.738537,
    2025: 3.17253,
  });
  // Nikkei 225，完整曆年、價格報酬（不含股息）；1976–2025。
  // 官方 Nikkei TR 雖可回溯至 1979，卻不足完整 50 年；故不能把此序列稱為 TR。
  const NIKKEI_225_PRICE_RETURNS = Object.freeze({
    1976: 14.94,
    1977: -2.51,
    1978: 23.35,
    1979: 9.46,
    1980: 7.51,
    1981: 8.76,
    1982: 4.36,
    1983: 23.42,
    1984: 16.66,
    1985: 13.35,
    1986: 43.85,
    1987: 14.58,
    1988: 39.86,
    1989: 29.04,
    1990: -38.72,
    1991: -3.63,
    1992: -26.36,
    1993: 2.91,
    1994: 13.24,
    1995: 0.74,
    1996: -2.55,
    1997: -21.19,
    1998: -9.28,
    1999: 36.79,
    2000: -27.19,
    2001: -23.52,
    2002: -18.63,
    2003: 24.45,
    2004: 7.61,
    2005: 40.24,
    2006: 6.92,
    2007: -11.13,
    2008: -42.12,
    2009: 19.04,
    2010: -3.01,
    2011: -17.34,
    2012: 22.94,
    2013: 56.72,
    2014: 7.12,
    2015: 9.07,
    2016: 0.42,
    2017: 19.1,
    2018: -12.08,
    2019: 18.2,
    2020: 16.01,
    2021: 4.91,
    2022: -9.37,
    2023: 28.24,
    2024: 19.22,
    2025: 26.18,
  });
  // 加權股價指數（TAIEX）完整曆年、價格報酬（不含股息）；1976–2025。
  // 台灣的殖利率長期高於美日，所以「不含股息」在這裡的低估幅度比日經更大——它是三個市場
  // 裡唯一連近似 TR 都拿不到的，解讀時必須把這件事一起講。
  // 來源：data/taiwan_taiex_cpi_1976_2025.csv 的 TAIEX_年成長率_pct 欄。
  const TAIEX_PRICE_RETURNS = Object.freeze({
    1976: 12.76,
    1977: 21.02,
    1978: 18.2,
    1979: 3.22,
    1980: 1.62,
    1981: -1.33,
    1982: -19.5,
    1983: 71.77,
    1984: 9.99,
    1985: -0.35,
    1986: 24.43,
    1987: 125.18,
    1988: 118.78,
    1989: 88,
    1990: -52.93,
    1991: 0.23,
    1992: -25.62,
    1993: 79.76,
    1994: 17.14,
    1995: -27.46,
    1996: 34.41,
    1997: 18.08,
    1998: -21.6,
    1999: 31.63,
    2000: -43.85,
    2001: 17.02,
    2002: -19.79,
    2003: 32.3,
    2004: 4.23,
    2005: 6.66,
    2006: 19.48,
    2007: 8.72,
    2008: -46.03,
    2009: 78.34,
    2010: 9.58,
    2011: -21.18,
    2012: 8.87,
    2013: 11.85,
    2014: 8.08,
    2015: -10.41,
    2016: 10.98,
    2017: 15.01,
    2018: -8.6,
    2019: 23.33,
    2020: 22.8,
    2021: 23.66,
    2022: -22.4,
    2023: 26.83,
    2024: 28.47,
    2025: 25.74,
  });
  // 主計總處消費者物價指數，全年平均年增率；與台股完整曆年報酬配對。
  // 口徑與日本同為「全年平均」，與美國的「12 月年增率」不同——跨市場比較 CPI 時要記得。
  // 來源：同一個 CSV 的 CPI_全年平均年增率_pct 欄。
  const TAIWAN_CPI_ANNUAL_CHANGES = Object.freeze({
    1976: 2.5,
    1977: 7,
    1978: 5.8,
    1979: 9.8,
    1980: 19,
    1981: 10.9,
    1982: 3,
    1983: 1.4,
    1984: 0,
    1985: -0.2,
    1986: 0.7,
    1987: 0.5,
    1988: 1.3,
    1989: 4.4,
    1990: 4.1,
    1991: 3.6,
    1992: 4.5,
    1993: 2.9,
    1994: 4.1,
    1995: 3.7,
    1996: 3.1,
    1997: 0.9,
    1998: 1.7,
    1999: 0.2,
    2000: 1.2,
    2001: 0,
    2002: -0.2,
    2003: -0.3,
    2004: 1.6,
    2005: 2.3,
    2006: 0.6,
    2007: 1.8,
    2008: 3.5,
    2009: -0.9,
    2010: 1,
    2011: 1.4,
    2012: 1.9,
    2013: 0.8,
    2014: 1.2,
    2015: -0.3,
    2016: 1.4,
    2017: 1.22,
    2018: -0.06,
    2019: 1.15,
    2020: 0.04,
    2021: 2.63,
    2022: 2.71,
    2023: 2.7,
    2024: 2.1,
    2025: 1.31,
  });
  // 標在期間選單上的重大年度。**只收「年度報酬本身看得出來」的事件**：這個模型以曆年
  // 為單位，年中崩盤但全年收紅的事件（1987 黑色星期一全年 +5.81%、2020 COVID 全年
  // +18.40%）標上去只會讓人以為數字錯了。要的是序列風險——危機落在退休第幾年——而不是
  // 大事記。
  const SP500_MARKET_EVENTS = Object.freeze({
    1973: '石油危機',
    2000: '網路泡沫',
    2008: '次貸風暴',
    2022: '暴力升息',
  });
  // 1987–1990 的本土大泡沫是三個市場裡最極端的一段：三年 +125%／+119%／+88% 之後一年
  // −52.93%。起漲與破裂都標出來，因為「退休當年正好是泡沫第幾年」才是這段的重點——
  // 1987 年退休看到資產三年翻四倍，1990 年退休看到的是腰斬。
  const TAIEX_MARKET_EVENTS = Object.freeze({
    1987: '本土泡沫起漲',
    1990: '泡沫破裂',
    2000: '網路泡沫',
    2008: '金融海嘯',
    // 標成「美國」升息：對台股這是外來衝擊，與上面三個本土／全球事件的性質不同。
    2022: '美國暴力升息',
  });
  const NIKKEI_MARKET_EVENTS = Object.freeze({
    1990: '泡沫破裂',
    1997: '亞洲金融風暴',
    2000: '網路泡沫',
    2008: '金融危機',
    2011: '東日本大震災',
  });
  // 固定情境是便於比較規則的壓力路徑，不是市場預測。牛熊的前幾年直接取 2000 年網路泡沫
  // 前後的實際 S&P 500 總報酬：這樣「這條路徑為什麼長這樣」有一個可查證的出處，而不是
  // 憑感覺挑幾個數字；也不必把同一批數字在檔案裡抄第二份。尾端值持續套用至第 30 年。
  const dotComYears = (startYear, count) =>
    Array.from({ length: count }, (_, index) => SP500_TOTAL_RETURNS[startYear + index]);
  const SCENARIO_CORE_RETURN_PATHS = Object.freeze({
    // 1996–1999：泡沫吹起來的四年。
    bull: [...dotComYears(1996, 4), 7],
    base: [7],
    // 2000–2002 的三年跌勢，再接 2003–2004 的實際反彈。反彈不能省：退休試算真正要回答的
    // 是「在低點被迫賣出之後還回不回得來」，少了反彈就變成另一個問題了。
    bear: [...dotComYears(2000, 5), 7],
    historical: [7],
  });
  function scenarioCoreReturn(key, year) {
    const path = SCENARIO_CORE_RETURN_PATHS[key] || SCENARIO_CORE_RETURN_PATHS.base;
    return path[Math.min(Math.max(1, Number(year) || 1), path.length) - 1];
  }
  const HORIZON_YEARS = 30;
  // 一個市場一列，報酬與 CPI 同筆。CPI 曾另外開一份 { sp500, nikkei } 對照表，於是新增
  // 市場時可能只加到一半：回放照跑，CPI 卻回 null 被呼叫端的 || {} 吞掉，靜默退回固定
  // 通膨而畫面仍寫著「歷史回放」。合併成一份之後，漏掉一半在結構上就不可能發生。
  const HISTORICAL_MARKETS = Object.freeze({
    sp500: {
      label: 'S&P 500 Total Return（含股息）',
      returns: SP500_TOTAL_RETURNS,
      cpi: US_CPI_DECEMBER_CHANGES,
      events: SP500_MARKET_EVENTS,
      note: 'S&P 500 完整曆年 Total Return（含股息再投資）；同步套用同年 CPI-U（12 月年增率），緊急預備金與到期現金賺同年 3 個月國庫券利率平均、新買國債票息取同年 12 月五年期公債殖利率（GS5）。',
    },
    nikkei: {
      label: '日經 225 價格報酬（不含股息）',
      returns: NIKKEI_225_PRICE_RETURNS,
      cpi: JAPAN_CPI_ANNUAL_CHANGES,
      events: NIKKEI_MARKET_EVENTS,
      note: '日經 225 完整曆年價格報酬（不含股息）；同步套用同年日本 CPI（全年平均年增率）。',
    },
    taiwan: {
      label: '加權股價指數 價格報酬（不含股息）',
      returns: TAIEX_PRICE_RETURNS,
      cpi: TAIWAN_CPI_ANNUAL_CHANGES,
      events: TAIEX_MARKET_EVENTS,
      note: '加權股價指數完整曆年價格報酬（不含股息，台股殖利率高，低估幅度大於日經）；同步套用同年台灣 CPI（全年平均年增率）。',
    },
  });
  // 任一年缺值就整段作廢：半段歷史、半段推測的路徑比沒有路徑更難察覺。
  function historicalSeriesPath(series, startYear, length, reverse = false) {
    const start = Number(startYear);
    const path = Array.from({ length }, (_, index) => series?.[start + (reverse ? -index : index)]);
    if (!path.every(Number.isFinite)) return null;
    return Object.fromEntries(path.map((value, index) => [index + 1, value]));
  }
  function historicalReturnPath(market, startYear, length = HORIZON_YEARS, reverse = false) {
    return historicalSeriesPath(HISTORICAL_MARKETS[market]?.returns, startYear, length, reverse);
  }
  function historicalInflationPath(market, startYear, length = HORIZON_YEARS, reverse = false) {
    return historicalSeriesPath(HISTORICAL_MARKETS[market]?.cpi, startYear, length, reverse);
  }
  // 歷史回放與通膨壓力路徑共用：只有美國有同期殖利率（GS5），日經與台股回 null、維持固定利率。
  function historicalSafeRates(market, startYear, length = HORIZON_YEARS, reverse = false) {
    if (market !== 'sp500') return null;
    const cash = historicalSeriesPath(US_TBILL_3M_ANNUAL_AVERAGE, startYear, length, reverse);
    const coupon = historicalSeriesPath(US_TREASURY_5Y_DECEMBER, startYear, length, reverse);
    return cash && coupon
      ? Object.fromEntries(Object.keys(cash).map(year => [year, { cash: cash[year], coupon: coupon[year] }]))
      : null;
  }
  function sp500TotalReturnPath(startYear, length = HORIZON_YEARS) {
    return historicalReturnPath('sp500', startYear, length);
  }
  // 收益型 covered-call ETF：上漲時讓出部分上漲空間；下跌時由權利金提供小幅緩衝。
  function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  function finiteNumber(value, fallback, minimum = -Infinity) {
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum ? number : fallback;
  }
  // 設定欄位的界線只定義一次，遷移與即時輸入共用。這個專案在「載入路徑有守、即時輸入沒守」
  // 上踩過三次（熊市門檻、護欄區間、負數），逐欄位各寫一份界線就是第四次的溫床。
  const SETTING_BOUNDS = {
    annualSpend: { min: 0 },
    spendingFloorAmount: { min: 0 },
    inflation: { min: 0 },
    bearThreshold: { max: 0 },
  };
  function clampTreasuryDrawdownYears(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= HORIZON_YEARS ? Math.round(number) : fallback;
  }
  // 梯長是最遠到期年，不是階數：1、2、10 年三階的梯子要補的是 10 年內的空期。
  // 以階數當梯長時，MC 編輯器新增一階會悄悄拉長補梯範圍，把到期年拉遠的那一階則永遠不會再補。
  function treasuryLadderLength(rungs) {
    return Math.max(1, ...rungs.map(rung => rung.maturityYear));
  }
  function targetTreasuryLength(treasury, year) {
    const initialLength = Math.max(0, Math.round(Number(treasury?.length) || 0));
    const drawdownYears = clampTreasuryDrawdownYears(treasury?.drawdownYears, 0);
    if (initialLength <= 1 || drawdownYears === 0) return initialLength;
    if (drawdownYears === 1) return 1;
    // y1 保留完整初始梯長，並在第 drawdownYears 年剛好降至一階。
    const progress = Math.min(Math.max(0, Math.round(year) - 1), drawdownYears - 1);
    const reductions = Math.floor((progress * (initialLength - 1)) / (drawdownYears - 1));
    return Math.max(1, initialLength - reductions);
  }
  function clampSetting(key, value, fallback = 0) {
    const { min = -Infinity, max = Infinity } = SETTING_BOUNDS[key] ?? {};
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
  }
  // 保證性收入逐列的界線。與 SETTING_BOUNDS 同一個理由：遷移與即時輸入共用一份（K2）。
  const INCOME_BOUNDS = {
    amount: { min: 0 },
    startYear: { min: 1, max: HORIZON_YEARS },
    endYear: { min: 1, max: HORIZON_YEARS },
  };
  const INDEXATIONS = ['full', 'nominal'];
  function clampIncomeField(key, value, fallback = 0) {
    const { min = -Infinity, max = Infinity } = INCOME_BOUNDS[key] ?? {};
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
  }
  // 非法設定一律**就地修正成最接近的合法值，不丟棄**。原本這裡把起訖顛倒的來源整筆濾掉，
  // 而 app.js 的即時輸入是就地修正成 endYear = startYear——同一種非法狀態、兩條路兩種相反的
  // 處理。統一成修正的理由：丟棄會讓一整列無聲消失，使用者不會知道自己少了一筆；修正之後
  // 畫面上看得到它被改成什麼，還能自己改回來。歷史回放的 metadata 仍然維持「寧可當成沒有」，
  // 因為那描述的是一次操作而不是使用者填的資料，兩者的取捨方向本來就不同。
  function hydrateGuaranteedIncome(stored) {
    if (!Array.isArray(stored)) return [];
    return stored
      .map((source, index) => {
        const rawEnd = source?.endYear;
        return {
          id: typeof source?.id === 'string' && source.id ? source.id : `income-${index + 1}`,
          label: typeof source?.label === 'string' ? source.label : '',
          amount: clampIncomeField('amount', source?.amount, 0),
          startYear: clampIncomeField('startYear', source?.startYear, 1),
          endYear:
            rawEnd === null || rawEnd === undefined || rawEnd === ''
              ? null
              : clampIncomeField('endYear', rawEnd, HORIZON_YEARS),
          indexation: INDEXATIONS.includes(source?.indexation) ? source.indexation : 'full',
        };
      })
      .map(source =>
        source.endYear !== null && source.endYear < source.startYear
          ? { ...source, endYear: source.startYear }
          : source,
      );
  }
  // 區間太窄時，上調會立刻把提領率推過下調觸發點、下調又推回來，護欄變成逐年空轉的振盪器。
  const MIN_GUARDRAIL_BAND = 0.5;
  // 以「對支出做了什麼」命名，不用市場狀態的字眼：牛市／熊市在情境頁籤已經有另一個意思，
  // 同一頁兩種用法會逼讀者先分辨哪個是哪個。命名沿用使用者在介面上看到的字，錯誤訊息才
  // 對得上他正在看的欄位。
  const GUARDRAIL_LABELS = {
    lower: '放寬觸發門檻',
    upper: '收緊觸發門檻',
    raise: '放寬幅度',
    cut: '收緊幅度',
  };
  function guardrailError(guardrails) {
    const g = guardrails ?? {};
    for (const [key, label] of Object.entries(GUARDRAIL_LABELS)) {
      if (!Number.isFinite(g[key])) return `${label}必須是數字。`;
      // 負的調整幅度會把「下調 −10%」跑成加錢：介面說在砍，實際在加。
      if (g[key] < 0) return `${label}不能是負數（目前 ${g[key]}%）。`;
    }
    if (g.upper - g.lower < MIN_GUARDRAIL_BAND)
      return `收緊觸發門檻需高於放寬觸發門檻至少 ${MIN_GUARDRAIL_BAND} 個百分點（目前 ${g.lower}%–${g.upper}%）。`;
    return '';
  }
  // coreReturns 的 null 代表「該年依情境報酬」，不可當成 0：Number(null) 是有限數，
  // 會把那一年悄悄釘死在 0%，而 0 不在報酬下拉選單裡，介面仍顯示「依情境」。
  function isNumericEntry(entry) {
    return typeof entry === 'number'
      ? Number.isFinite(entry)
      : typeof entry === 'string' && entry.trim() !== '' && Number.isFinite(Number(entry));
  }
  // 逐年安全資產利率：{ 年: { cash, coupon } }，兩個欄位都要是有限數字，年份限 1–30。
  function hydrateSafeRates(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([year, entry]) =>
            Number.isInteger(Number(year)) &&
            Number(year) >= 1 &&
            Number(year) <= HORIZON_YEARS &&
            Number.isFinite(Number(entry?.cash)) &&
            Number.isFinite(Number(entry?.coupon)),
        )
        .map(([year, entry]) => [year, { cash: Number(entry.cash), coupon: Number(entry.coupon) }]),
    );
  }
  function recordOfFiniteNumbers(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, entry]) => isNumericEntry(entry))
            .map(([key, entry]) => [key, Number(entry)]),
        )
      : {};
  }
  const WITHDRAWAL_IDS = ['emergency', 'defense', 'growth', 'income'];
  function withdrawalOrder(value, fallback) {
    if (!Array.isArray(value) || value.length !== WITHDRAWAL_IDS.length) return [...fallback];
    return new Set(value).size === WITHDRAWAL_IDS.length && value.every(id => WITHDRAWAL_IDS.includes(id))
      ? [...value]
      : [...fallback];
  }
  const EVENT_WITHDRAWAL_POLICIES = ['alpha', 'beta', 'gamma', 'custom'];
  function eventWithdrawalPolicy(value, fallback) {
    return EVENT_WITHDRAWAL_POLICIES.includes(value) ? value : fallback;
  }
  function eventWithdrawalOrder(state, coreReturn) {
    switch (state.eventWithdrawalPolicy) {
      case 'alpha':
        return ['emergency'];
      case 'beta':
        return coreReturn > 0
          ? ['emergency', 'defense', 'growth', 'income']
          : ['emergency', 'defense', 'income', 'growth'];
      case 'gamma':
        return ['emergency', 'defense', 'growth'];
      default:
        return state.withdrawalOrders.event;
    }
  }
  // localStorage 不可信：用已知 schema 合併舊資料，避免缺欄位讓 renderer 在初始化時白屏。
  function hydrateState(stored, isProfile = false) {
    const fallback = cloneDefault();
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || stored.schemaVersion > DEFAULT.schemaVersion)
      return fallback;
    const sourceBuckets = Array.isArray(stored.buckets) ? stored.buckets : [];
    const buckets = DEFAULT.buckets.map(defaultBucket => {
      const source = sourceBuckets.find(bucket => bucket && bucket.id === defaultBucket.id) || {};
      return {
        ...defaultBucket,
        name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : defaultBucket.name,
        short: typeof source.short === 'string' ? source.short : defaultBucket.short,
        amount: finiteNumber(source.amount, defaultBucket.amount, 0),
        assets: typeof source.assets === 'string' ? source.assets : defaultBucket.assets,
        purpose: typeof source.purpose === 'string' ? source.purpose : defaultBucket.purpose,
        yield: finiteNumber(source.yield, defaultBucket.yield, 0),
        color: typeof source.color === 'string' ? source.color : defaultBucket.color,
      };
    });
    // v3.23 的 BXM 是錯放在現金流 ETF 的舊 profile；v3.24 改為核心策略後，曾經選過它的
    // 快照可能仍留下舊標的名稱。它不是使用者有效的現金流 ETF 選項，清掉文字但絕不搬動金額。
    const income = buckets.find(bucket => bucket.id === 'income');
    if (income.assets === 'BXM buy-write 策略指數')
      income.assets = DEFAULT.buckets.find(bucket => bucket.id === 'income').assets;
    const defense = buckets.find(bucket => bucket.id === 'defense');
    const migrateBxmToGrowth = stored.incomeProfile?.kind === 'bxm';
    const growth = buckets.find(bucket => bucket.id === 'growth');
    const usesBxmGrowth = migrateBxmToGrowth || stored.growthProfile?.kind === 'bxm';
    // 策略與標的名稱是一組設定：BXM 不應只出現在策略列、卻讓標的仍寫 VTI／VOO／QQQ。
    // 反過來，殘留的 BXM 標籤也不能在純大盤策略下誤導使用者。
    if (usesBxmGrowth) growth.assets = 'BXM buy-write 策略指數';
    else if (growth.assets === 'BXM buy-write 策略指數')
      growth.assets = DEFAULT.buckets.find(bucket => bucket.id === 'growth').assets;
    const sourceRungs =
      Array.isArray(stored.treasury?.rungs) && stored.treasury.rungs.length ? stored.treasury.rungs : null;
    const rungCount = sourceRungs ? sourceRungs.length : DEFAULT.treasury.length;
    const rungs = (
      sourceRungs ||
      Array.from({ length: rungCount }, (_, index) => ({
        maturityYear: index + 1,
        face: defense.amount / rungCount,
        coupon: 4,
      }))
    ).map((rung, index) => ({
      maturityYear: Math.min(HORIZON_YEARS, Math.round(finiteNumber(rung?.maturityYear, index + 1, 1))),
      face: finiteNumber(rung?.face, defense.amount / rungCount, 0),
      coupon: finiteNumber(rung?.coupon, 4, 0),
    }));
    // 國債梯是防守水庫的持倉明細；若舊資料兩者不一致，以明細加總避免首年憑空消失資產。
    defense.amount = rungs.reduce((sum, rung) => sum + rung.face, 0);
    const incomeProfileKind = ['vym', 'schd', 'pbp'].includes(stored.incomeProfile?.kind)
      ? stored.incomeProfile.kind
      : null;
    const drawdownYears = clampTreasuryDrawdownYears(stored.treasury?.drawdownYears, 0);
    const bxmMonthlyPath = hydrateBxmMonthlyPath(stored.bxmMonthlyPath);
    // Older representative paths did not identify which income ETF produced their residuals. The legacy
    // fixed plan still carries that strategy, so use it once during hydration and persist the explicit kind.
    const incomeMonthlyPath = hydrateBxmMonthlyPath(stored.incomeMonthlyPath, incomeProfileKind);
    const hydrated = {
      ...fallback,
      ...(stored.coverageTargets
        ? { coverageTargets: coverageTargets({ buckets, coverageTargets: stored.coverageTargets }) }
        : {}),
      schemaVersion: DEFAULT.schemaVersion,
      // 載入路徑沒有地方顯示錯誤，超出界線的儲存值退回預設；即時輸入則夾住並立即顯示夾後的值。
      scenario: scenarios[stored.scenario] ? stored.scenario : fallback.scenario,
      historicalReplay: hydrateHistoricalReplay(stored.historicalReplay),
      annualSpend: finiteNumber(stored.annualSpend, fallback.annualSpend, SETTING_BOUNDS.annualSpend.min),
      ...(lockedInitialAssets(stored.lockedInitialAssets) !== null
        ? { lockedInitialAssets: lockedInitialAssets(stored.lockedInitialAssets) }
        : {}),
      spendingFloor: {
        annualAmount: finiteNumber(
          stored.spendingFloor?.annualAmount,
          fallback.spendingFloor.annualAmount,
          SETTING_BOUNDS.spendingFloorAmount.min,
        ),
      },
      inflation: finiteNumber(stored.inflation, fallback.inflation, SETTING_BOUNDS.inflation.min),
      inflationRates: recordOfFiniteNumbers(stored.inflationRates),
      // 不落盤空物件：沒有覆寫的舊存檔逐位不變。
      ...(Object.keys(hydrateSafeRates(stored.safeRates)).length
        ? { safeRates: hydrateSafeRates(stored.safeRates) }
        : {}),
      bearThreshold: clampSetting('bearThreshold', stored.bearThreshold, fallback.bearThreshold),
      coreReturns: recordOfFiniteNumbers(stored.coreReturns),
      ...(stored.representativePathSource &&
      typeof stored.representativePathSource.label === 'string' &&
      Array.isArray(stored.representativePathSource.rows) &&
      stored.representativePathSource.rows.length <= 100 &&
      stored.representativePathSource.rows.every(
        row =>
          Array.isArray(row) &&
          row.length <= 3 &&
          row.every(cell => typeof cell === 'string' || (typeof cell === 'number' && Number.isFinite(cell))),
      )
        ? { representativePathSource: JSON.parse(JSON.stringify(stored.representativePathSource)) }
        : {}),
      ...(hydrateHistoricalSampleSources(stored.historicalSampleSources)
        ? { historicalSampleSources: hydrateHistoricalSampleSources(stored.historicalSampleSources) }
        : {}),
      // 代表路徑複製回固定情境頁時，BXM 必須帶著原本 12 個市場月報酬與 ETF 專屬殘差，
      // 否則只靠年報酬重建會把月頻非線性與殘差一起遺失，無法重播同一條路徑。
      ...(bxmMonthlyPath ? { bxmMonthlyPath } : {}),
      ...(incomeMonthlyPath ? { incomeMonthlyPath } : {}),
      emergencyEvents: recordOfFiniteNumbers(stored.emergencyEvents),
      // 沒有事件卻標著「來自路徑」是沒有意義的狀態，而且留著會在日後誤清新輸入的事件。
      // 與 hydrateHistoricalReplay 同樣的態度：描述不了實際資料的標記，寧可當成沒有。
      eventsFromPath:
        stored.eventsFromPath === true && Object.keys(recordOfFiniteNumbers(stored.emergencyEvents)).length > 0,
      withdrawalOrders: {
        planned: withdrawalOrder(stored.withdrawalOrders?.planned, fallback.withdrawalOrders.planned),
        event: withdrawalOrder(stored.withdrawalOrders?.event, fallback.withdrawalOrders.event),
      },
      eventWithdrawalPolicy: eventWithdrawalPolicy(stored.eventWithdrawalPolicy, fallback.eventWithdrawalPolicy),
      // legacy 不落盤：舊快照、舊 MC comparison 結果與新增 profile 前逐位一致。
      ...(usesBxmGrowth ? { growthProfile: { kind: 'bxm' } } : {}),
      ...(incomeProfileKind
        ? {
            incomeProfile: {
              kind: incomeProfileKind,
              ...(incomeProfileKind === 'pbp'
                ? { rocPercent: Math.min(100, finiteNumber(stored.incomeProfile.rocPercent, 0, 0)) }
                : dividendScenarioId(stored.incomeProfile.dividendScenario) === 'base'
                  ? {}
                  : { dividendScenario: stored.incomeProfile.dividendScenario }),
            },
          }
        : {}),
      guaranteedIncome: hydrateGuaranteedIncome(stored.guaranteedIncome),
      guardrails: hydrateGuardrails(stored.guardrails, fallback.guardrails),
      monteCarlo: clampMonteCarlo(stored.monteCarlo, fallback.monteCarlo),
      buckets,
      treasury: {
        length: treasuryLadderLength(rungs),
        rungs,
        // 不存 0，讓新功能關閉時舊快照與比較輸出保持逐位相同。
        ...(drawdownYears ? { drawdownYears } : {}),
      },
    };
    // Monte Carlo 的計畫快照需要同樣的遷移與界線防護。快照本身不再帶巢狀快照，避免遞迴儲存。
    if (isProfile) return hydrated;
    // v1 的單一 monteCarloProfile 遷移為 A；往後只保存一種「比較方案快照」，避免兩條
    // hydrate 生命週期各自演化。空清單代表尚未建立 B／C，但 A 永遠存在。
    const storedProfiles =
      Array.isArray(stored.monteCarloProfiles) && stored.monteCarloProfiles.length
        ? stored.monteCarloProfiles
        : stored.monteCarloProfile
          ? [{ id: 'a', name: '方案 A', plan: stored.monteCarloProfile }]
          : [{ id: 'a', name: '方案 A', plan: hydrated }];
    // 槽位由 ID 決定；先建立 C 再建立 B 時，儲存順序不是 A/B/C。
    const monteCarloProfiles = ['a', 'b', 'c']
      .map(id => storedProfiles.find(profile => profile?.id === id && profile.plan))
      .filter(Boolean)
      .map(profile => ({
        id: profile.id,
        // 啟用是預設，僅保存明確排除的方案，避免新欄位改變未使用此功能時的舊快照／結果。
        ...(profile.enabled === false ? { enabled: false } : {}),
        name:
          typeof profile.name === 'string' && profile.name.trim()
            ? profile.name.trim().slice(0, 40)
            : `方案 ${profile.id.toUpperCase()}`,
        plan: monteCarloPlanSnapshot(
          hydrateState({ ...profile.plan, monteCarloProfile: null, monteCarloProfiles: null }, true),
        ),
      }));
    if (!monteCarloProfiles.some(profile => profile.id === 'a'))
      monteCarloProfiles.unshift({ id: 'a', name: '方案 A', plan: monteCarloPlanSnapshot(hydrated) });
    return {
      ...hydrated,
      monteCarloComparisonEnabled: stored.monteCarloComparisonEnabled === true,
      monteCarloProfiles: monteCarloProfiles.length
        ? monteCarloProfiles
        : [{ id: 'a', name: '方案 A', plan: monteCarloPlanSnapshot(hydrated) }],
    };
  }
  // 快照用排除清單而不是挑選清單：新增設定欄位時預設會被帶進 Monte Carlo，
  // 忘了處理的那一邊是安全的。挑選清單漏一個欄位不會報錯，Monte Carlo 會安靜地
  // 用一組與計畫不同的規則算風險（與 F4／B1 同型的「兩份清單必須手動一致」）。
  //
  // 但有一類欄位必須反過來，永遠排除：**固定情境頁的逐年資料**。快照只承載初始配置與
  // 規則（水庫配置、提領補水規則），不承載提領軌跡表上一年一格的推演。目前四個：
  //   coreReturns      核心報酬欄，使用者逐年輸入
  //   bxmMonthlyPath   BXM 代表路徑的月頻市場／殘差；只屬於固定情境頁的重播資料
  //   emergencyEvents  非計畫支出欄，使用者逐年輸入
  //   eventsFromPath   上述事件是否來自複製的代表路徑
  //   inflationRates   歷史回放整批寫入的 CPI；表上唯讀顯示，沒有輸入欄
  //   scenario         固定情境頁選中的情境；Monte Carlo 有自己的 monteCarlo.scenario
  //   historicalReplay 套用過的歷史窗口
  // 判準是「只屬於固定情境頁的那一條路徑」，而不是「有沒有輸入框」——inflationRates 使用者
  // 改不到、scenario 與 historicalReplay 也不是逐年資料，但它們同樣只描述那條固定路徑，帶進
  // Monte Carlo 就是一個看不見的前提。日後新增同類欄位一併加入。
  // 記下來的窗口必須仍然產得出完整路徑，否則寧可當成沒套用過——留著一個指向不存在區間的
  // 標記，會讓「要不要清除逐年報酬」這個判斷永遠答錯。
  function hydrateHistoricalReplay(stored) {
    const market = stored?.market;
    const startYear = Number(stored?.startYear);
    const reverse = stored?.direction === 'reverse';
    if (!HISTORICAL_MARKETS[market] || !historicalReturnPath(market, startYear, HORIZON_YEARS, reverse)) return null;
    return { market, startYear, ...(reverse ? { direction: 'reverse' } : {}) };
  }
  // 這是「已複製的抽樣路徑」的稽核資料，不是另一種歷史回放。只有完整 30 年且每列都可
  // 描述時才保留，避免 CSV 印出半套、無法追溯的來源欄位。
  function hydrateHistoricalSampleSources(stored) {
    if (!Array.isArray(stored) || stored.length !== HORIZON_YEARS) return null;
    const sources = stored.map(source => ({
      year: Math.round(Number(source?.year)),
      block: Math.round(Number(source?.block)),
      position: Math.round(Number(source?.position)),
      jitter: Number(source?.jitter),
    }));
    return sources.every(
      source =>
        Number.isFinite(source.year) &&
        source.year > 0 &&
        Number.isFinite(source.block) &&
        source.block > 0 &&
        Number.isFinite(source.position) &&
        source.position > 0 &&
        Number.isFinite(source.jitter),
    )
      ? sources
      : null;
  }
  function lockedInitialAssets(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
  }
  const SNAPSHOT_EXCLUDED = [
    'safeRates',
    'monteCarlo',
    'monteCarloProfile',
    'monteCarloProfiles',
    'monteCarloComparisonEnabled',
    'scenario',
    'historicalReplay',
    'coreReturns',
    'bxmMonthlyPath',
    'incomeMonthlyPath',
    'inflationRates',
    'emergencyEvents',
    'eventsFromPath',
    'historicalSampleSources',
    'representativePathSource',
  ];
  function monteCarloPlanSnapshot(state) {
    const plan = Object.fromEntries(Object.entries(state ?? {}).filter(([key]) => !SNAPSHOT_EXCLUDED.includes(key)));
    return JSON.parse(
      JSON.stringify({
        ...plan,
        // 目前 Monte Carlo 沒有專屬逐年 UI；不能讓固定情境頁的設定或舊資料靜默變成
        // 抽樣路徑的前提。因此每條路徑的所有年度都由本分頁的分布產生：核心報酬來自
        // 平均／波動度，意外支出來自機率／金額。
        coreReturns: {},
        inflationRates: {},
        emergencyEvents: {},
      }),
    );
  }
  // 載入路徑沒有地方顯示輸入錯誤，所以區間不合法時整組退回預設值，而不是留著會振盪的設定。
  function hydrateGuardrails(stored, fallback) {
    const merged = Object.fromEntries(
      Object.entries(fallback).map(([key, value]) => [key, finiteNumber(stored?.[key], value, 0)]),
    );
    return guardrailError(merged) ? { ...fallback } : merged;
  }
  // Monte Carlo 的設定界線與其他設定欄位一樣只定義一次，遷移與即時輸入共用（見 K2 的教訓）。
  // mean 必須嚴格大於 -100：σ 的反解式以 (1 + mean/100) 為分母，-100 會直接除以 0 產生 NaN。
  const MONTE_CARLO_BOUNDS = {
    paths: { min: 1, max: 20000, integer: true },
    seed: { min: 0, max: 4294967295, integer: true },
    mean: { min: -99, max: 100 },
    volatility: { min: 0, max: 200 },
    eventProbability: { min: 0, max: 100 },
    eventAmount: { min: 0, max: 10000000 },
  };
  // 歷史區塊抽樣只接受完整、可解釋的設定組合。區塊長度與擾動不是一般連續數值：把 2.4
  // 年或 7% 悄悄取整會讓畫面寫的假設與實際抽樣不同，因此非法值回到預設。
  const HISTORICAL_SAMPLING = Object.freeze({
    market: 'sp500',
    blockLength: 3,
    jitter: 0,
    blockLengths: Object.freeze([1, 2, 3]),
    jitters: Object.freeze([0, 5, 10]),
  });
  // MC 的確定事件：「第 N 年一定要付一筆錢」，每條路徑都帶著它。金額以第 1 年美元輸入，
  // 與抽樣事件同樣依累積通膨調整。金額 0 或無效時視為沒有，不落盤，舊結果逐位不變。
  function clampFixedEvent(value) {
    // 空白年份不能被 Number('') = 0 夾成第 1 年。
    if (value?.year === '' || value?.year === null || value?.year === undefined) return null;
    const amount = Number(value?.amount);
    const year = Math.round(Number(value?.year));
    if (!(amount > 0) || !Number.isFinite(year)) return null;
    return {
      year: Math.min(Math.max(year, 1), HORIZON_YEARS),
      amount: Math.min(amount, MONTE_CARLO_BOUNDS.eventAmount.max),
    };
  }
  function clampMonteCarlo(stored, fallback = DEFAULT.monteCarlo) {
    const numerical = Object.fromEntries(
      Object.entries(MONTE_CARLO_BOUNDS).map(([key, { min, max, integer }]) => {
        const number = Number(stored?.[key]);
        if (!Number.isFinite(number)) return [key, fallback[key]];
        const bounded = Math.min(Math.max(number, min), max);
        return [key, integer ? Math.round(bounded) : bounded];
      }),
    );
    const fixedEvent = clampFixedEvent(stored?.fixedEvent);
    const historical = stored?.samplingMode === 'historical';
    return {
      ...numerical,
      scenario: Object.hasOwn(scenarios, stored?.scenario) ? stored.scenario : fallback.scenario,
      ...(fixedEvent ? { fixedEvent } : {}),
      ...(historical
        ? {
            samplingMode: 'historical',
            historicalMarket: Object.hasOwn(HISTORICAL_MARKETS, stored?.historicalMarket)
              ? stored.historicalMarket
              : HISTORICAL_SAMPLING.market,
            historicalBlockLength: HISTORICAL_SAMPLING.blockLengths.includes(Number(stored?.historicalBlockLength))
              ? Number(stored.historicalBlockLength)
              : HISTORICAL_SAMPLING.blockLength,
            historicalJitter: HISTORICAL_SAMPLING.jitters.includes(Number(stored?.historicalJitter))
              ? Number(stored.historicalJitter)
              : HISTORICAL_SAMPLING.jitter,
          }
        : {}),
      // 固定通膨不落盤：舊設定、golden hash 與比較結果逐位不變。
      ...(!historical &&
      (stored?.inflationModel === 'ar1' || Object.hasOwn(INFLATION_STRESS_PATHS, stored?.inflationModel ?? ''))
        ? { inflationModel: stored.inflationModel }
        : {}),
    };
  }
  function incomeTotalReturn(coreReturn) {
    return coreReturn >= 0 ? coreReturn - 3 : coreReturn + 0.5;
  }
  function incomeDistributionRate(coreReturn, yieldRate = 10) {
    return coreReturn < 0 ? yieldRate * 1.3 : yieldRate;
  }
  // 來源：research/calibration/cashflow-etf-market-regression.json（BXM，月頻 ^SP500TR OLS）。
  // 常數刻意放在可離線執行的 renderer 核心，而非在執行時讀研究檔：Electron 的 CSP 禁止網路與
  // file:// fetch；測試會把本常數與可版控的 calibration JSON 逐值比對，避免兩份資料漂移。
  const BXM_MONTHLY_PROFILE = Object.freeze({
    alpha: 0.0056049457,
    betaUp: 0.4593819311,
    betaDown: 0.7986049926,
    residualSd: 0.0140540798,
  });
  // VYM / SCHD 的起始價格是研究資料最後一個完整曆年（2025）的 12 月收盤，起始 DPS 是同年官方
  // 對帳的全年配息（split-adjusted）；它不是保證，也不把 option income 誤當成這兩檔股利 ETF 的配息。
  //
  // 配息採部分調整（Lintner）：每年把 DPS 往「目標殖利率 × 年末 NAV」拉近 speed 的比例，
  // 目標殖利率是各檔的起始殖利率。v4.3.2 以前用「歷史 DPS 成長率外推 + 前一年跌幅連動 +
  // 4.29% 殖利率上限」：常數成長率只對某一種市場假設與淨值相容（+7% 大盤下 VYM／SCHD 應為
  // 3.7%／3.2%，1989–2025 歷史大盤下應為 9.0%／8.4%，實際用 7.6%／12.0%），於是上限在
  // SCHD 第 2 年、VYM 第 13 年起主導配息，並讓崩盤減配繞過 maxCut。部分調整在任何市場假設下
  // 長期都跟著 NAV，崩盤時減配落後一年且被 maxCut 夾住。
  // 來源：research/calibration/cashflow-etf-market-regression.json 的 dividends.shared.partial_adjustment。
  // speed 只能由 VYM 估計（R² 0.05，唯一經歷股息衰退的樣本；重現 2009 年 −19.1% 為 −17.8%），
  // 是情境假設而不是已驗證的規律。
  const DIVIDEND_ADJUSTMENT_SPEED = 0.5891340312;
  // 保險絲：下一年 DPS 不超過「目標殖利率 × 1.43 × NAV」。1.43 = VYM 2008 年末殖利率 ÷ VYM
  // 樣本平均殖利率，是資料中最大的殖利率相對飆升。以各檔自己的目標殖利率為基準，
  // 起始殖利率較高的 SCHD 才不會一遇到普通熊市就被共用的絕對上限砍配息。
  const DIVIDEND_YIELD_SPIKE_RATIO = 1.4328169506;
  // Reproduced by scripts/calibrate-pbp.mjs: annual distributions / opening NAV, full years only.
  // Empirical independent payout sampling is a scenario assumption, not a tax classification or forecast.
  const PBP_PAYOUT_YIELDS = Object.freeze([
    0.016542239035668406, 0.01869688385269122, 0.07680148768014877, 0.10220201542374414, 0.04383282141524866,
    0.06997455470737914, 0.049493975903614464, 0.05156777616980222, 0.026572403705509503, 0.10954395862717443,
    0.023822842712221785, 0.06050632911392404, 0.01341689817006044, 0.0700829673011225, 0.011639982187798261,
    0.036083497212549845, 0.10170506443755463, 0.11540093338990243,
  ]);
  const PBP_MEAN_YIELD = PBP_PAYOUT_YIELDS.reduce((sum, value) => sum + value, 0) / PBP_PAYOUT_YIELDS.length;
  const DIVIDEND_ETF_PROFILES = Object.freeze({
    pbp: Object.freeze({
      ticker: 'PBP',
      label: 'PBP／Invesco S&P 500 BuyWrite ETF（可變配發）',
      payoutModel: true,
      initialNav: 22.83,
      initialDps: 22.83 * PBP_MEAN_YIELD,
      targetYield: PBP_MEAN_YIELD,
      alpha: 0.0054880519,
      betaUp: 0.4376656842,
      betaDown: 0.8188328367,
      residualSd: 0.0151686165,
    }),
    vym: Object.freeze({
      ticker: 'VYM',
      label: 'VYM／Vanguard High Dividend Yield ETF',
      initialNav: 143.520004,
      initialDps: 3.5008,
      targetYield: 3.5008 / 143.520004,
      historicalMeanYield: 0.0299734248,
      maxCut: -0.1905751906,
      maxRaise: 0.2163153071,
      alpha: 0.0019193733,
      betaUp: 0.8117099474,
      betaDown: 0.9258599135,
      residualSd: 0.0162219868,
    }),
    schd: Object.freeze({
      ticker: 'SCHD',
      label: 'SCHD／Schwab U.S. Dividend Equity ETF',
      initialNav: 27.43,
      initialDps: 1.0476,
      targetYield: 1.0476 / 27.43,
      historicalMeanYield: 0.0305539909,
      // 規格明文「maxCut 不能是 0」。SCHD 樣本期無任何減配年，採用資料中唯一一次真實股息
      // 衰退（VYM 2009 的 −19.06%）作為下限，而不是把「沒觀察到」當成「不會發生」。
      maxCut: -0.1905751906,
      maxRaise: 0.197917079,
      alpha: 0.0030341818,
      betaUp: 0.7660219128,
      betaDown: 0.8926488104,
      residualSd: 0.0209160901,
    }),
  });
  // 配息情境：同一組市場路徑下比較不同的配息假設。只有 base 與 historicalYield 有資料來源；
  // 其餘是壓力測試，數值是刻意選的整數，不是校準結果。base 不落盤，舊方案與比較結果逐位不變。
  const DIVIDEND_SCENARIOS = Object.freeze({
    base: Object.freeze({
      label: '基準',
      description: '目標殖利率＝起始殖利率，調整速度 0.59（VYM 估計），單年減配上限 −19%（VYM 2009）。',
    }),
    historicalYield: Object.freeze({
      label: '回歸歷史平均殖利率',
      description: '目標殖利率改為該檔樣本平均：VYM 3.00%（高於起始 2.44%）、SCHD 3.06%（低於起始 3.82%）。',
      targetYield: profile => profile.historicalMeanYield,
    }),
    deepCut: Object.freeze({
      label: '減配較深（壓力）',
      description: '下跌時配息一次調到目標（跌多少砍多少），單年減配上限放寬到 −40%。非歷史校準。',
      cutSpeed: 1,
      maxCut: -0.4,
    }),
    slowRecovery: Object.freeze({
      label: '恢復較慢（壓力）',
      description: '減配照基準，回升速度減半（0.29）。非歷史校準。',
      raiseSpeedScale: 0.5,
    }),
    stress: Object.freeze({
      label: '深減配＋慢恢復（壓力）',
      description: '同時套用「減配較深」與「恢復較慢」。非歷史校準。',
      cutSpeed: 1,
      maxCut: -0.4,
      raiseSpeedScale: 0.5,
    }),
  });
  function dividendScenarioId(value) {
    return Object.hasOwn(DIVIDEND_SCENARIOS, value) ? value : 'base';
  }
  function dividendParameters(profile, scenarioId) {
    const scenario = DIVIDEND_SCENARIOS[dividendScenarioId(scenarioId)];
    return {
      targetYield: scenario.targetYield ? scenario.targetYield(profile) : profile.targetYield,
      cutSpeed: scenario.cutSpeed ?? DIVIDEND_ADJUSTMENT_SPEED,
      raiseSpeed: DIVIDEND_ADJUSTMENT_SPEED * (scenario.raiseSpeedScale ?? 1),
      maxCut: scenario.maxCut ?? profile.maxCut,
      maxRaise: profile.maxRaise,
    };
  }
  // 下一年 DPS：部分調整 → 夾在 [maxCut, maxRaise] → 殖利率保險絲。NAV 歸零（清算）時為 0。
  function nextDividendPerShare(profile, dps, nav, scenarioId = 'base') {
    if (!(nav > 0)) return 0;
    if (profile.payoutModel) return nav * profile.targetYield;
    const params = dividendParameters(profile, scenarioId);
    const target = params.targetYield * nav;
    const speed = target < dps ? params.cutSpeed : params.raiseSpeed;
    const growth = dps > 0 ? (speed * (target - dps)) / dps : 0;
    const bounded = dps * (1 + Math.min(params.maxRaise, Math.max(params.maxCut, growth)));
    return Math.min(bounded, params.targetYield * DIVIDEND_YIELD_SPIKE_RATIO * nav);
  }
  function dividendEtfMonthlyReturn(profile, marketReturn, residual = 0) {
    const market = Number(marketReturn);
    return Math.max(
      -0.999999,
      profile.alpha +
        profile.betaUp * Math.max(Number.isFinite(market) ? market : 0, 0) +
        profile.betaDown * Math.min(Number.isFinite(market) ? market : 0, 0) +
        (Number.isFinite(Number(residual)) ? Number(residual) : 0),
    );
  }
  function dividendEtfTotalReturn(profile, monthlyMarketReturns, monthlyResiduals = []) {
    return (
      (monthlyMarketReturns.reduce(
        (value, marketReturn, index) =>
          value * (1 + dividendEtfMonthlyReturn(profile, marketReturn, monthlyResiduals[index])),
        1,
      ) -
        1) *
      100
    );
  }
  function bxmMonthlyReturn(marketReturn, residual = 0) {
    const market = Number(marketReturn);
    const noise = Number(residual);
    const modeled =
      BXM_MONTHLY_PROFILE.alpha +
      BXM_MONTHLY_PROFILE.betaUp * Math.max(Number.isFinite(market) ? market : 0, 0) +
      BXM_MONTHLY_PROFILE.betaDown * Math.min(Number.isFinite(market) ? market : 0, 0) +
      (Number.isFinite(noise) ? noise : 0);
    // 正態殘差理論上無界，但資產單月不可能跌破歸零；夾在 -100% 上方避免極端抽樣產生負 NAV。
    return Math.max(-0.999999, modeled);
  }
  // 來源：research/data/sp500-total-return-monthly.csv 的月 log 報酬樣本標準差（1988-01 ~ 2026-08，
  // n = 464，年化 14.64%）。測試逐值比對，避免與原始檔漂移。
  const SP500_MONTHLY_LOG_SD = 0.0422583095;
  // 12 個單位變異數的分層常態衝擊：z_i = Φ⁻¹((i-0.5)/12) 再除以其樣本 SD（0.948246）校正
  // 分層抽樣的離散度低估。對稱且總和為 0，所以年度複利完全由下方的 mu 決定。
  const MONTHLY_STRATIFIED_SHOCKS = Object.freeze([
    -1.8261769906, -1.2131343541, -0.8565478746, -0.5784601071, -0.3360303966, -0.1103442501, 0.1103442501,
    0.3360303966, 0.5784601071, 0.8565478746, 1.2131343541, 1.8261769906,
  ]);
  // BXM／股利 ETF 的分段 beta 模型只有在看得到**下跌月**時才有意義：betaUp 0.46 與 betaDown 0.80
  // 的不對稱就是它的全部內容。把年報酬均分成 12 個相同的月報酬會讓 betaDown 永遠用不到，於是
  // 模型只剩 betaUp 加上每月 alpha。實測：餵真實月路徑時模型重現 BXM 的 5.96%／年（實際 6.18%），
  // 餵均分月報酬則得到 10.04%——+4.07pp 的系統性順風，而且在校準樣本上就把正負號弄反。
  //
  // 因此這裡用確定性的分層常態衝擊補回月度離散度：衝擊對稱且和為 0，所以 12 個月的複利**精確等於**
  // 傳入的年報酬，固定情境頁仍然可重現、可手動對帳。Monte Carlo 不走這條路——它本來就會抽自己的
  // 月頻市場路徑（monte-carlo.js 的 includeMonthly 分支）。
  function marketMonthsForAnnualReturn(marketReturn) {
    const annual = Number(marketReturn) / 100;
    // 年報酬剛好 -100% 時不存在可均分的 12 次方根；把歸零放在第一個月，其餘月為 0，
    // 年度複利仍精確為 -100%。
    if (!Number.isFinite(annual) || annual <= -1) return [-1, ...Array(11).fill(0)];
    const mu = Math.log(1 + annual) / 12;
    return MONTHLY_STRATIFIED_SHOCKS.map(shock => Math.exp(mu + SP500_MONTHLY_LOG_SD * shock) - 1);
  }
  function bxmTotalReturn(monthlyMarketReturns, monthlyResiduals = []) {
    const marketMonths = Array.isArray(monthlyMarketReturns)
      ? monthlyMarketReturns
      : marketMonthsForAnnualReturn(monthlyMarketReturns);
    return (
      (marketMonths.reduce(
        (value, marketReturn, index) => value * (1 + bxmMonthlyReturn(marketReturn, monthlyResiduals[index])),
        1,
      ) -
        1) *
      100
    );
  }
  function hydrateBxmMonthlyPath(stored, fallbackKind = null) {
    if (!stored || typeof stored !== 'object') return null;
    const read = key => {
      if (!stored[key] || typeof stored[key] !== 'object') return null;
      const values = {};
      for (let year = 1; year <= HORIZON_YEARS; year += 1) {
        const months = stored[key][year];
        if (!Array.isArray(months) || months.length !== 12 || months.some(value => !Number.isFinite(Number(value))))
          return null;
        values[year] = months.map(Number);
      }
      return values;
    };
    const marketReturns = read('marketReturns');
    const residuals = read('residuals');
    if (!marketReturns || !residuals) return null;
    const payoutYields = recordOfFiniteNumbers(stored.payoutYields);
    const kind = ['vym', 'schd', 'pbp'].includes(stored.kind) ? stored.kind : fallbackKind;
    return {
      marketReturns,
      residuals,
      ...(kind ? { kind } : {}),
      ...(Object.keys(payoutYields).length
        ? {
            payoutYields: Object.fromEntries(
              Object.entries(payoutYields).map(([year, value]) => [
                year,
                Math.min(Math.max(...PBP_PAYOUT_YIELDS), Math.max(0, value)),
              ]),
            ),
          }
        : {}),
    };
  }
  function createIncomePosition(value, initialNav = 1) {
    const nav = Number.isFinite(initialNav) && initialNav > 0 ? initialNav : 1;
    return { units: Math.max(0, value) / nav, nav, dps: 0 };
  }
  function inflationRateForYear(state, year) {
    const historical = Number(state.inflationRates?.[year]);
    return Number.isFinite(historical) ? historical : state.inflation;
  }
  // Missing settings retain the legacy split; once edited, percentages remain explicit.
  function coverageTargets(state) {
    const active = id => state.buckets.some(b => b.id === id && Number(b.amount) > 0);
    const fallback = active('defense') && active('income') ? 50 : 100;
    return Object.fromEntries(
      ['defense', 'income'].map(id => {
        const raw = state.coverageTargets?.[id];
        const value = raw === null || raw === undefined || raw === '' ? fallback : Number(raw);
        return [id, Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback];
      }),
    );
  }
  function simulate(state, key) {
    const scenario = scenarios[key],
      values = Object.fromEntries(state.buckets.map(b => [b.id, +b.amount]));
    const enabled = Object.fromEntries(state.buckets.map(b => [b.id, +b.amount > 0]));
    const targets = coverageTargets(state);
    const treasuryCoverage = enabled.defense ? targets.defense / 100 : 0;
    const incomeCoverage = enabled.income ? targets.income / 100 : 0;
    const incomeDistributionYield = state.buckets.find(b => b.id === 'income').yield / 100;
    const dividendProfile = DIVIDEND_ETF_PROFILES[state.incomeProfile?.kind] || null;
    // Step 1 的 legacy adapter 仍讓既有美元公式作為唯一真相，因此所有舊結果（含 MC golden
    // hash）不變；position 在每年結尾與美元餘額對齊，提供 Step 2 起 profile 使用的狀態機地基。
    let incomePosition = createIncomePosition(values.income, dividendProfile?.initialNav);
    if (dividendProfile) incomePosition.dps = dividendProfile.initialDps;
    const averageTreasuryCoupon =
      state.treasury.rungs.reduce((sum, rung) => sum + rung.coupon, 0) / state.treasury.rungs.length;
    let activeRungs = enabled.defense ? state.treasury.rungs.map(rung => ({ ...rung })) : [];
    let treasuryCash = 0;
    const years = [];
    let spendShortfall = false,
      eventShortfall = false,
      firstShortfallYear = null,
      firstEventShortfallYear = null,
      cumulativeUnmet = 0,
      cumulativeEventUnmet = 0,
      cumulativePortfolioActual = 0,
      cumulativeGuaranteedIncome = 0,
      cumulativeGuaranteedIncomeUsed = 0,
      firstFloorBindingYear = null,
      firstFloorGapYear = null,
      cumulativeFloorGap = 0,
      floorBindingYears = 0,
      bankruptYear = null,
      firstIlliquidYear = null,
      currentGuardrailSaturation = 0,
      guardrailSaturatedYears = 0,
      // 「砍了」與「砍到上限仍壓不回區間」是兩個不同的數字，而且差距可以很大：日經 1987
      // 起算的那條路徑連續收緊 15 年，其中只有 7 年是滿檔。摘要卡兩個都要給，否則使用者
      // 自己數 CSV 會發現對不上。
      currentGuardrailCut = 0,
      guardrailCutYears = 0;
    // 原始計畫支出：第 1 年的生活費依通膨逐年成長，完全不受護欄調整與缺口影響。這是
    // 「當初打算花多少」的基準線。護欄的工作就是砍支出，拿砍完的數字當分母會讓「成功
    // 避免破產」與「照計畫過日子」看起來是同一件事（M5）；破產後沒花到的年份也不能從
    // 分母消失（N3）——所以這條線一律跑滿 HORIZON_YEARS，與模擬是否提早中止無關。
    const plannedSpendByYear = [];
    for (let year = 1, planned = state.annualSpend; year <= HORIZON_YEARS; year++) {
      plannedSpendByYear.push(planned);
      planned *= 1 + inflationRateForYear(state, year) / 100;
    }
    const plannedSpendTotal = plannedSpendByYear.reduce((sum, value) => sum + value, 0);
    // 累計物價倍數自己算一份，不從 plannedSpendByYear 相除推導：年支出為 0 時那個除法會爆
    // （N8／N9 的零支出終局是既有情境）。步進口徑與 plannedSpendByYear 相同。
    const cpiFactorByYear = [];
    for (let year = 1, factor = 1; year <= HORIZON_YEARS; year++) {
      cpiFactorByYear.push(factor);
      factor *= 1 + inflationRateForYear(state, year) / 100;
    }
    let priorSpend = state.annualSpend;
    for (let year = 1; year <= HORIZON_YEARS; year++) {
      // indexation 管的是第 1 年到第 30 年**整條線**，不分請領前後：金額一律以第 1 年幣值輸入。
      // full = 全程實質不變（my Social Security 給的就是今日美元的估算）、nominal = 全程名目不變
      // （商業固定年金契約上的給付額）。只有兩種：階梯式（台灣勞保那種累計 CPI 達門檻才調）被這
      // 兩個界夾住，而它是法定參數，依規矩要有出處並進 data/ 逐格比對，見〈延後決策〉。
      const guaranteedIncome = (state.guaranteedIncome ?? []).reduce((sum, source) => {
        if (year < source.startYear) return sum;
        if (source.endYear !== null && source.endYear !== undefined && year > source.endYear) return sum;
        return sum + source.amount * (source.indexation === 'nominal' ? 1 : cpiFactorByYear[year - 1]);
      }, 0);
      // 年金年初全額進緊急預備金，生活費照原本的提領鏈支付，年末多的走既有補水級聯回核心。
      // 「只有結餘才入帳」在日經 21 窗口只差 1.0pp，而全額入帳與使用者實際的現金流一致。
      //
      // **opening 必須在入帳之前捕捉。** 護欄的分子已經扣掉年金（裁示四），分母若把當年的年金
      // 算成投資本金，就是分子分母兩種口徑：年金是每年都會再來一次的流量，不是可投資的本金，
      // 把它一年算一次進資產基數會讓提領率被系統性低估、護欄過度寬鬆。實例：資產 $4.4M、
      // 年金 $10 萬、支出 $30 萬——含年金算出 4.44% 不觸發，不含則是 4.55% 應收緊。
      // openingTotal 同時是 proposedRate、區間夾制、withdrawalRate 與滿檔判定的分母，
      // 在這裡修一次，四個地方一起同口徑。
      const opening = { ...values };
      const openingIncomePosition = { ...incomePosition };
      values.emergency += guaranteedIncome;
      const openingTotal = Object.values(opening).reduce((sum, value) => sum + value, 0);
      // 第 N 年的預算用的是「第 N−1 年實際發生的通膨」，不是第 N 年自己的。1996 年退休，
      // 1997 年的預算反映的是 1996 年的物價變動——社會安全金的 COLA 也是這個口徑。原本
      // 寫成 inflationRateForYear(state, year)，等於讓預算預知當年還沒發生的通膨，而且
      // 回放窗口第一年的 CPI 從頭到尾用不到、最後一年的卻被用掉（P9）。
      const inflationRate = inflationRateForYear(state, year);
      const inflationAdjustedSpend =
        year === 1 ? state.annualSpend : priorSpend * (1 + inflationRateForYear(state, year - 1) / 100);
      let spend = inflationAdjustedSpend;
      // Floor 與原始計畫一樣以前一年 CPI 步進，但永遠不跟著護欄的上下調跑。0 是關閉，而非
      // 一筆 $0 的必要帳單；這讓既有設定在沒有使用 Floor 時逐位不變。
      const floorSpend = state.spendingFloor.annualAmount * cpiFactorByYear[year - 1];
      let guardrailAction = '未觸發護欄';
      // 方向另外記一個欄位，不要靠解析 guardrailAction 的字串。滿檔判定原本是
      // guardrailAction.includes('下調')——改一次文案就可能默默改壞判定，而測試只會在
      // 剛好有人釘住那個字串時才發現。
      let guardrailDirection = null;
      // 年初已無資產時仍要留下破產年度供 UI／CSV 解釋，但不可先除以 0 產生 Infinity。
      // 正常「年末歸零」會在該年結尾中止；這裡只處理初始即歸零或未來新增路徑的防線。
      const noOpeningAssets = openingTotal <= 1;
      // 護欄的分子是**水庫要自己出的錢**。年金那一段每年都會再來一次，卻只在入帳當年短暫出現在
      // 分母裡：13.5% 的年金第 1 年只佔資產 1.19%，而要自己生出同樣的現金流需要約 30% 的資產。
      // 用毛額當分子等於對一筆有對應流入的流出踩煞車——實測日經 30% 時累計實得少 11.5pp、最低
      // 支出從 66% 掉到 51%，而且 5%–20% 之間年金一分都沒變成生活費，全部變成末年資產。
      const proposedRate = noOpeningAssets ? 0 : Math.max(0, inflationAdjustedSpend - guaranteedIncome) / openingTotal;
      const guardrails = state.guardrails;
      // 純區間制：低於上調觸發點就加，但最多加到區間頂；高於下調觸發點就減，但最多減到區間底。
      // 剛好落在邊界不動作——邊界上觸發會讓支出在兩個觸發點之間逐年來回。
      // 調整幅度是**實質**的：上調讓當年名目成長變成 CPI + raise，下調變成 CPI − cut。
      // 舊版是名目相對變動（±step%），於是同一組設定在 1980 年（CPI 12.4%）與 2015 年
      // （0.6%）等於兩條完全不同的規則——歷史回放開始餵實際 CPI 之後，這個歧義不能留。
      // 第 1 年沒有通膨步進（支出就是輸入值），此時 delta 直接作用在輸入值上。
      const realAdjustedSpend = delta =>
        Math.max(
          0,
          year === 1
            ? state.annualSpend * (1 + delta / 100)
            : priorSpend * (1 + (inflationRateForYear(state, year - 1) + delta) / 100),
        );
      if (!noOpeningAssets && proposedRate < guardrails.lower / 100) {
        spend = Math.min(
          realAdjustedSpend(guardrails.raise),
          guaranteedIncome + (openingTotal * guardrails.upper) / 100,
        );
        guardrailAction = `放寬 ${guardrails.raise}%（實質）`;
        guardrailDirection = 'raise';
      } else if (!noOpeningAssets && proposedRate > guardrails.upper / 100) {
        spend = Math.max(
          realAdjustedSpend(-guardrails.cut),
          guaranteedIncome + (openingTotal * guardrails.lower) / 100,
        );
        guardrailAction = `收緊 ${guardrails.cut}%（實質）`;
        guardrailDirection = 'cut';
      }
      // 先保存護欄自己的候選值，Floor 才能回答「護欄想砍、但必要帳單不允許」；不能只留下最後
      // 的 spend，否則 Floor 綁住過多少年、代價是什麼都無從對帳。
      const guardrailSpend = spend;
      const floorBinding = floorSpend > guardrailSpend + 1e-9;
      if (floorBinding) {
        floorBindingYears++;
        firstFloorBindingYear ??= year;
      }
      spend = Math.max(guardrailSpend, floorSpend);
      const rawEventSpend = Number(state.emergencyEvents?.[year]);
      const eventSpend = Number.isFinite(rawEventSpend) && rawEventSpend > 0 ? rawEventSpend : 0;
      const returns = { ...scenario.returns };
      // 逐年安全資產利率覆寫（目前只由通膨壓力路徑產生）：現金報酬取代情境的緊急金報酬。
      const safeRate = state.safeRates?.[year];
      if (Number.isFinite(safeRate?.cash)) returns.emergency = safeRate.cash;
      returns.growth = scenarioCoreReturn(key, year);
      const configuredScenarioCoreReturn = returns.growth;
      const customCoreReturn = state.coreReturns[year];
      if (customCoreReturn !== null && customCoreReturn !== undefined) returns.growth = customCoreReturn;
      const marketReturn = returns.growth;
      if (state.growthProfile?.kind === 'bxm') {
        const monthlyPath = state.bxmMonthlyPath;
        const marketMonths = monthlyPath?.marketReturns?.[year] ?? marketMonthsForAnnualReturn(marketReturn);
        const residuals = monthlyPath?.residuals?.[year] ?? [];
        returns.growth = bxmTotalReturn(marketMonths, residuals);
      }
      // Both reservoirs follow the same market input; changing the core strategy must not change the income model.
      if (dividendProfile) {
        const monthlyPath = state.incomeMonthlyPath;
        const marketMonths = monthlyPath?.marketReturns?.[year] ?? marketMonthsForAnnualReturn(marketReturn);
        const residuals = monthlyPath?.residuals?.[year] ?? [];
        // Once this modeled fund has liquidated, its remaining balance is non-interest-bearing cash.
        // Do not give cash ETF returns or resurrect units at an invented positive NAV.
        returns.income = incomePosition.nav > 0 ? dividendEtfTotalReturn(dividendProfile, marketMonths, residuals) : 0;
      } else returns.income = incomeTotalReturn(marketReturn);
      // Real dividend ETF profiles model actual per-share distributions; the editable yield remains only
      // the legacy adapter's assumption and cannot silently override VYM/SCHD's DPS state.
      if (dividendProfile?.payoutModel)
        incomePosition.dps =
          incomePosition.nav *
          Math.min(
            Math.max(...PBP_PAYOUT_YIELDS),
            Math.max(0, state.incomeMonthlyPath?.payoutYields?.[year] ?? PBP_MEAN_YIELD),
          );
      const distributionRate = dividendProfile
        ? incomePosition.nav > 0
          ? (incomePosition.dps / incomePosition.nav) * 100
          : 0
        : incomeDistributionRate(marketReturn, incomeDistributionYield * 100);
      // 到期本金與票息若未在上一年用掉，會暫存為防守水庫的 MMF 現金；
      // 它不是零報酬的黑洞。沿用緊急金的現金／MMF 報酬，避免提款順序
      // 只因誰先花到期現金而不合理地改變長期總資產。
      treasuryCash *= 1 + returns.emergency / 100;
      Object.keys(values)
        .filter(id => id !== 'defense' && !(id === 'income' && dividendProfile))
        .forEach(id => (values[id] *= 1 + returns[id] / 100));
      const treasuryCoupon = activeRungs.reduce((sum, rung) => sum + (rung.face * rung.coupon) / 100, 0);
      const maturingRungs = activeRungs.filter(rung => rung.maturityYear === year);
      const treasuryMaturity = maturingRungs.reduce((sum, rung) => sum + rung.face, 0);
      activeRungs = activeRungs.filter(rung => rung.maturityYear > year);
      treasuryCash += treasuryCoupon + treasuryMaturity;
      // 非計畫支出與生活費各自有可設定的提款順序；現金流 ETF 本金可以在需要時出售。
      const canSellGrowth = returns.growth >= state.bearThreshold;
      let remaining = spend;
      const sources = {};
      // 配息以年初持倉計算，但不能超過當下持倉，否則會把 income 算成負數。
      // Total return already includes the distribution.  For the real profile the ex-dividend NAV is
      // therefore total-return NAV minus this year's DPS; cash stays available until it is spent or reinvested.
      let incomeDistributionGross = 0;
      if (enabled.income) {
        if (dividendProfile && openingIncomePosition.nav <= 0) {
          // Preserve liquidation cash (including later transfers) for the normal withdrawal chain.
          incomePosition.nav = 0;
          incomePosition.dps = 0;
        } else if (dividendProfile) {
          const totalReturnNav = openingIncomePosition.nav * (1 + returns.income / 100);
          incomeDistributionGross = Math.min(
            Math.max(0, totalReturnNav * openingIncomePosition.units),
            openingIncomePosition.units * incomePosition.dps,
          );
          incomePosition.nav = Math.max(0, totalReturnNav - incomePosition.dps);
          // Keep the distribution as cash in the income reservoir for the withdrawal chain.  Any remainder
          // is reinvested at year end when units are reconciled to this same dollar balance.
          values.income = incomePosition.units * incomePosition.nav + incomeDistributionGross;
        } else incomeDistributionGross = Math.min(values.income, (opening.income * distributionRate) / 100);
      }
      const incomeDistribution = Math.min(remaining, incomeDistributionGross);
      sources.income = incomeDistribution;
      values.income -= incomeDistribution;
      remaining -= incomeDistribution;
      for (const id of state.withdrawalOrders.planned) {
        if (!remaining || (id === 'growth' && !canSellGrowth)) continue;
        const available = id === 'defense' ? treasuryCash : values[id];
        const take = Math.min(remaining, Math.max(0, available));
        const sourceId = id === 'income' ? 'incomePrincipal' : id;
        sources[sourceId] = (sources[sourceId] || 0) + take;
        if (id === 'defense') treasuryCash -= take;
        else values[id] -= take;
        remaining -= take;
      }
      // 熊市時，生活費中可調整的部分仍不賣核心 ETF。唯一的例外是必要帳單：在保證性收入、配息、
      // 緊急金、到期國債與現金流 ETF 本金都已依提領鏈支應後，若實際可得金額仍低於 Floor，才賣
      // 核心補到 Floor。這個額度從「已由非核心來源支應多少」推導，故即使使用者把 growth 排在
      // emergency 前面，也不會把明明有年金／現金可用的必要支出誤判為被迫賣股。
      let floorGrowthTake = 0;
      if (!canSellGrowth && floorSpend > 0) {
        const nonGrowthFunded = spend - remaining;
        const floorNeed = Math.max(0, floorSpend - nonGrowthFunded);
        floorGrowthTake = Math.min(floorNeed, Math.max(0, values.growth));
        if (floorGrowthTake > 0) {
          sources.growth = (sources.growth || 0) + floorGrowthTake;
          values.growth -= floorGrowthTake;
          remaining -= floorGrowthTake;
        }
      }
      const unmetSpend = remaining;
      // 事件排在生活費之後。v0.1.26 review 曾把順序更正為「事件先」，理由是事件當時**只有
      // 緊急金一個來源**，而生活費有四個——先讓生活費搶緊急金等於餓死沒有退路的那一方。
      //
      // 那個前提在 v2.2.0（F1／D2）就消失了：事件從此有可設定的完整提款順序，來源不比生活費
      // 少，而且還多一項特權——可以突破熊市門檻。被凍結擋住的反而是生活費。原本的通則
      //「讓可選來源較少的需求先取用」仍然成立，只是誰比較受限已經對調。
      //
      // 維持舊順序的後果：事件先吃光緊急金與國債到期現金，再用突破門檻的特權賣核心；輪到
      // 生活費時流動資產沒了、核心又凍結，只能報缺口。實測核心凍結 + 56 萬事件的年度，
      // 合計支應會從 804,800 掉到 560,000——24 萬憑空蒸發。
      let eventRemaining = eventSpend;
      const eventTakes = Object.fromEntries(WITHDRAWAL_IDS.map(id => [id, 0]));
      const eventOrder = eventWithdrawalOrder(state, returns.growth);
      for (const id of eventOrder) {
        if (!eventRemaining) break;
        const available = id === 'defense' ? treasuryCash : values[id];
        const take = Math.min(eventRemaining, Math.max(0, available));
        eventTakes[id] += take;
        if (id === 'defense') treasuryCash -= take;
        else values[id] -= take;
        eventRemaining -= take;
      }
      const eventEmergencyTake = eventTakes.emergency;
      const eventDefenseTake = eventTakes.defense;
      const eventGrowthTake = eventTakes.growth;
      const eventIncomeTake = eventTakes.income;
      const eventUnmet = eventRemaining;
      const forcedGrowthSale = eventGrowthTake > 0 && !canSellGrowth;
      if (unmetSpend > 1) {
        spendShortfall = true;
        firstShortfallYear ??= year;
        cumulativeUnmet += unmetSpend;
      }
      if (eventUnmet > 1) {
        eventShortfall = true;
        firstEventShortfallYear ??= year;
        cumulativeEventUnmet += eventUnmet;
      }
      // 已到期國債現金本身可直接在防守水庫內調度，不必等待核心報酬為正；
      // 核心 ETF 只補剩下的差額。既有國債不因通膨或支出變動而賣出或調整。
      // Prepare next-year DPS before calculating next-year replenishment targets.
      // 本年度的市場報酬經由年末 NAV 決定**下一年**的 DPS：股息對市場是落後反應。
      if (dividendProfile)
        incomePosition.dps = nextDividendPerShare(
          dividendProfile,
          incomePosition.dps,
          incomePosition.nav,
          state.incomeProfile.dividendScenario,
        );
      let incomeRebuildCash = null;
      // 清算（NAV 歸零）後水庫裡只剩現金，不該卡在一個已經沒有持倉的水庫：當年就轉入緊急預備金
      // （它本來就是現金，超出目標的部分會在正報酬年照既有規則回收至核心），緊急金停用時轉入核心。
      // 兩者都停用時沒有去處，留在原地當現金。之後的補水年再依支應目標重新買進。
      let incomeLiquidationTransfer = 0,
        incomeLiquidationTarget = null;
      if (dividendProfile && enabled.income && !(incomePosition.nav > 0) && values.income > 0) {
        incomeLiquidationTarget = enabled.emergency ? 'emergency' : enabled.growth ? 'growth' : null;
        if (incomeLiquidationTarget) {
          incomeLiquidationTransfer = values.income;
          values[incomeLiquidationTarget] += incomeLiquidationTransfer;
          values.income = 0;
        }
      }
      const emergencyMinimum = spend * 0.5,
        emergencyTarget = spend;
      let treasuryCashToEmergency = 0,
        emergencyTransfer = 0,
        treasuryCashToLadder = 0,
        ladderTransfer = 0,
        treasuryCashRecovery = 0,
        incomeTransfer = 0,
        incomeTarget = 0;
      const emergencyNeedsReplenishment = enabled.emergency && values.emergency < emergencyMinimum;
      if (emergencyNeedsReplenishment && treasuryCash > 0) {
        treasuryCashToEmergency = Math.min(emergencyTarget - values.emergency, treasuryCash);
        values.emergency += treasuryCashToEmergency;
        treasuryCash -= treasuryCashToEmergency;
      }
      if (returns.growth > 0) {
        // 先用到期現金補過緊急金後，核心才是其餘安全水庫補水與回收的對手方。
        if (enabled.emergency) {
          if (emergencyNeedsReplenishment) {
            emergencyTransfer = Math.min(emergencyTarget - values.emergency, values.growth);
          } else if (values.emergency > emergencyTarget) {
            emergencyTransfer = emergencyTarget - values.emergency;
          }
          values.emergency += emergencyTransfer;
          values.growth -= emergencyTransfer;
        }
        // 補齊目前目標梯長內的空期：自動縮短只停止補買，既有債券自然到期，不提前出售。
        // 新增債券面額一律向上取整到 $1,000。
        const treasuryTargetLength = targetTreasuryLength(state.treasury, year);
        if (enabled.defense && treasuryCoverage > 0) {
          for (let offset = 1; offset <= treasuryTargetLength; offset++) {
            const maturityYear = year + offset;
            const existingFace = activeRungs
              .filter(rung => rung.maturityYear === maturityYear)
              .reduce((sum, rung) => sum + rung.face, 0);
            if (existingFace > 0) continue;
            // 年末只知道今年的 CPI：未來每一年都假設通膨維持今年的水準。舊版讀未來年度的實際
            // 通膨（歷史回放、隨機通膨、壓力路徑時各年不同），等於預知 1978 年會衝到 9%，梯子
            // 事先買得剛剛好。固定通膨時各年相同，結果不變。
            const knownInflation = inflationRateForYear(state, year);
            // 保留逐年相乘的順序：固定通膨時與舊版逐位相同。
            const projectedSpend = Array.from({ length: offset }, () => knownInflation).reduce(
              (amount, rate) => amount * (1 + rate / 100),
              spend,
            );
            const purchase = Math.ceil((projectedSpend * treasuryCoverage) / 1000) * 1000;
            if (treasuryCash + values.growth >= purchase) {
              const cashContribution = Math.min(treasuryCash, purchase);
              const coreContribution = purchase - cashContribution;
              activeRungs.push({
                maturityYear,
                face: purchase,
                coupon: Number.isFinite(safeRate?.coupon) ? safeRate.coupon : averageTreasuryCoupon,
              });
              treasuryCash -= cashContribution;
              values.growth -= coreContribution;
              treasuryCashToLadder += cashContribution;
              ladderTransfer += coreContribution;
            }
          }
        }
        // 清算後的第一個補水年重新建立同類 ETF 部位，接著由下方的正常補水依支應目標買進。
        // 淨值絕對值不影響結果，取起始 NAV 當單價，下一年 DPS 設為目標殖利率 × NAV。
        // 清算現金通常已轉出（部位從 0 開始）；只有緊急金與核心都停用時才會帶著現金重建。
        if (dividendProfile && enabled.income && !(incomePosition.nav > 0)) {
          incomeRebuildCash = Math.max(0, values.income);
          incomePosition.nav = dividendProfile.initialNav;
          incomePosition.dps =
            (dividendProfile.payoutModel
              ? dividendProfile.targetYield
              : dividendParameters(dividendProfile, state.incomeProfile.dividendScenario).targetYield) *
            incomePosition.nav;
        }
        // 依設定比例補足下年度生活費所需的 ETF 規模；其餘資產保留在核心 ETF。
        const nextYearSpend = spend * (1 + inflationRateForYear(state, year) / 100);
        if (enabled.income && (dividendProfile || incomeDistributionYield > 0)) {
          const targetYield = dividendProfile
            ? incomePosition.nav > 0
              ? incomePosition.dps / incomePosition.nav
              : 0
            : incomeDistributionYield;
          incomeTarget = targetYield > 0 ? (nextYearSpend * incomeCoverage) / targetYield : 0;
          incomeTransfer = Math.min(Math.max(0, incomeTarget - values.income), values.growth);
          values.income += incomeTransfer;
          values.growth -= incomeTransfer;
        }
        // 使用者把緊急金關掉（配置 0）時，補水級聯整段都被 enabled.emergency 擋住，年金入帳會
        // 停在那個桶裡以現金報酬複利到最後一年——與 N14 的「未動用國債到期現金被當成零報酬資產」
        // 同一型的靜默漏損。沒有年金時 values.emergency 恆為 0，這段是死碼，既有結果不變。
        //
        // 原本的條件是 !enabled.emergency && enabled.growth：**核心也停用時漏損原封不動回來**，
        // 實測末年有 $10,340,310 留在一個使用者已經關掉的桶裡。改成依序找第一個啟用的去處。
        // 防守水庫不在候選裡：它是有面額與到期年的國債梯，現金倒進去沒有對應的持倉。
        if (!enabled.emergency && values.emergency > 0) {
          const spillover = ['growth', 'income'].find(id => enabled[id]);
          if (spillover) {
            values[spillover] += values.emergency;
            values.emergency = 0;
          }
          // 只剩國債梯時現金確實無處可去，留在緊急金桶是誠實的結果（它就是現金，且仍可被提領
          // 鏈動用、仍計入總資產）。不為了讓不變式好看而把它塞進一個沒有持倉可買的桶。
        }
        // 補緊急金與補梯後仍留下的到期現金，不是額外目標水位；在可 rebalace 的
        // 正報酬年度回收至核心，避免提款順序把防守水庫變成無上限的現金囤積。
        if (enabled.growth && treasuryCash > 0) {
          treasuryCashRecovery = treasuryCash;
          values.growth += treasuryCashRecovery;
          treasuryCash = 0;
        }
      }
      // 年末快照要包含剛補入的新債；這個值才可直接與防守水庫年末值對帳。
      const treasuryFaceAtYearEnd = activeRungs.reduce((sum, rung) => sum + rung.face, 0);
      const treasuryTargetLength = targetTreasuryLength(state.treasury, year);
      const treasuryDrawdownEnabled = state.treasury.drawdownYears > 0;
      values.defense = treasuryFaceAtYearEnd + treasuryCash;
      // legacy profile 的可觀察結果維持原樣；僅在這個受控邊界把 dollars 投影回 units/NAV/DPS。
      // 開始支援真實 profile 後，這會反轉為「units/NAV 是真相、values 是顯示快照」。
      if ((state.incomeProfile?.kind ?? 'legacy') === 'legacy') {
        incomePosition.nav = openingIncomePosition.nav * (1 + returns.income / 100);
        incomePosition.dps = openingIncomePosition.nav * (distributionRate / 100);
        incomePosition.units = incomePosition.nav > 0 ? Math.max(0, values.income) / incomePosition.nav : 0;
      } else if (dividendProfile) {
        // All unspent distributions and replenishment dollars buy units at the ex-distribution NAV.
        // This keeps the visible balance and the per-share state mathematically identical.
        incomePosition.units = incomePosition.nav > 0 ? Math.max(0, values.income) / incomePosition.nav : 0;
      }
      const actualSpend = spend - unmetSpend;
      const floorGap = Math.max(0, floorSpend - actualSpend);
      if (floorGap > 1) {
        firstFloorGapYear ??= year;
        cumulativeFloorGap += floorGap;
      }
      // 水庫要自己出的錢。護欄的觸發、夾制與這裡的滿檔判定必須是同一個口徑——這個欄位原本用
      // 毛支出判定，於是年金啟用後會出現「軌跡列顯示淨提領率 3.94%，摘要卡卻說砍到上限仍壓不
      // 回區間」：實測日經 1990 起、年金 15 萬時，6 個滿檔年**全部**如此。與裁示四同一個教訓
      // （proposedRate 與 withdrawalRate 只改一個會讓那行自相矛盾），只是當時漏了這一個。
      const portfolioSpend = Math.max(0, spend - guaranteedIncome);
      const guardrailSaturated =
        !noOpeningAssets && guardrailDirection === 'cut' && (portfolioSpend / openingTotal) * 100 > guardrails.upper;
      currentGuardrailSaturation = guardrailSaturated ? currentGuardrailSaturation + 1 : 0;
      guardrailSaturatedYears = Math.max(guardrailSaturatedYears, currentGuardrailSaturation);
      currentGuardrailCut = guardrailDirection === 'cut' ? currentGuardrailCut + 1 : 0;
      guardrailCutYears = Math.max(guardrailCutYears, currentGuardrailCut);
      const closingTotal = Object.values(values).reduce((sum, value) => sum + value, 0);
      // 資產歸零本身就是終局：下一年不可能支應任何東西，繼續推進只會讓 openingTotal 為 0，
      // 把 Infinity 送進 proposedRate 與介面（N2）。當年是否支應得了生活費不影響這個判斷。
      // illiquid 仍是另一件事：資產還在、只是當年拿不到（凍結／未到期），熊市門檻本來就要撐過去。
      const unfunded = actualSpend <= 1 && spend > 1;
      const bankrupt = closingTotal <= 1;
      const illiquid = unfunded && closingTotal > 1;
      if (bankrupt && bankruptYear === null) bankruptYear = year;
      if (illiquid && firstIlliquidYear === null) firstIlliquidYear = year;
      // 低於門檻本身不代表有核心 ETF 被凍結；事件先賣光核心時，也不能誤說成股票凍結。
      const growthFrozen = !canSellGrowth && values.growth > 1;
      // 「生活水準有沒有被砍」與「四個桶夠不夠」在有年金之後是兩個問題：日經 30% 時累計實得
      // 94.7%，其中只有 64.7% 來自水庫。actualSpend 回答前者，portfolioActual 回答後者。
      // 下限 0 是防線而非預期：年金入帳在緊急金，而生活費提領鏈一定會走到那個桶。
      const portfolioActual = Math.max(0, actualSpend - guaranteedIncome);
      // 年金大於當年實際支出時，多的那段留在水庫裡沒有被花掉。摘要卡把三個數字並排
      //（累計支應 = 其中水庫 + 保證性收入累計），而累加毛額會讓這個加法在年金大於生活費時
      // 對不起來——實測差 $2,759,389。用於生活費的與轉入資產的分開記，恆等式才成立：
      // actualSpend ≡ portfolioActual + guaranteedIncomeUsed。
      const guaranteedIncomeUsed = Math.min(guaranteedIncome, actualSpend);
      cumulativePortfolioActual += portfolioActual;
      cumulativeGuaranteedIncome += guaranteedIncome;
      cumulativeGuaranteedIncomeUsed += guaranteedIncomeUsed;
      years.push({
        year,
        spend,
        actualSpend,
        guardrailSpend,
        floorSpend,
        floorBinding,
        floorGap,
        guaranteedIncome,
        guaranteedIncomeUsed,
        portfolioSpend,
        portfolioActual,
        noOpeningAssets,
        eventSpend,
        eventWithdrawalPolicy: state.eventWithdrawalPolicy,
        eventWithdrawalOrder: [...eventOrder],
        eventEmergencyTake,
        eventDefenseTake,
        eventGrowthTake,
        eventIncomeTake,
        eventUnmet,
        forcedGrowthSale,
        floorGrowthTake,
        // floorGrowthTake 只會在核心凍結的分支中產生；旗標直接由金額導出，避免重複一個
        // 恆真的條件而讓兩者日後分岔。
        forcedFloorGrowthSale: floorGrowthTake > 0,
        growthFrozen,
        illiquid,
        unmetSpend,
        // 兩個欄位必須同口徑。app.js 印的是「調整前 X → 動作 → 調整後 Y」；只改前者會讓這行讀成
        // 「放寬 2%，率卻跳了 0.62pp」，而沒有任何人寫錯程式。毛提領率要顯示的話，得是另一個有
        // 自己名字的欄位，不能混進這條敘述。
        proposedRate: proposedRate * 100,
        withdrawalRate: noOpeningAssets ? 0 : (portfolioSpend / openingTotal) * 100,
        guardrailAction,
        guardrailDirection,
        guardrailSaturated,
        guardrailSaturationStreak: currentGuardrailSaturation,
        scenarioCoreReturn: configuredScenarioCoreReturn,
        plannedSpend: plannedSpendByYear[year - 1],
        inflationRate,
        returns: returns.growth,
        incomeReturn: returns.income,
        distributionRate,
        incomeDistributionGross,
        incomeProfile: dividendProfile?.ticker ?? 'legacy',
        incomeUnits: incomePosition.units,
        incomeNav: incomePosition.nav,
        incomeDps: incomePosition.dps,
        ...(dividendProfile?.payoutModel
          ? {
              incomeRoc:
                (incomeDistributionGross * Math.min(100, Math.max(0, state.incomeProfile.rocPercent ?? 0))) / 100,
              incomeNonRoc:
                incomeDistributionGross * (1 - Math.min(100, Math.max(0, state.incomeProfile.rocPercent ?? 0)) / 100),
              incomePayoutYield: distributionRate / 100,
              incomePaidPerShare:
                openingIncomePosition.units > 0 ? incomeDistributionGross / openingIncomePosition.units : 0,
            }
          : {}),
        ...(dividendProfile && incomePosition.nav === 0
          ? { incomeLiquidated: true, incomeCash: Math.max(0, values.income) }
          : {}),
        ...(incomeRebuildCash === null ? {} : { incomeRebuilt: true, incomeRebuildCash }),
        ...(incomeLiquidationTransfer ? { incomeLiquidationTransfer, incomeLiquidationTarget } : {}),
        sources,
        treasuryCoupon,
        treasuryMaturity,
        treasuryCash,
        treasuryFaceAtYearEnd,
        ...(treasuryDrawdownEnabled ? { treasuryTargetLength, treasuryActualRungCount: activeRungs.length } : {}),
        emergencyMinimum,
        emergencyTarget,
        treasuryCashToEmergency,
        emergencyTransfer,
        treasuryCashToLadder,
        ladderTransfer,
        treasuryCashRecovery,
        incomeTransfer,
        incomeTarget,
        treasuryCoverage,
        incomeCoverage,
        total: Object.values(values).reduce((a, b) => a + b, 0),
        opening,
        values: { ...values },
        bankrupt,
      });
      if (bankrupt) break;
      // 缺口不改寫往後的支出基準。A4 當初讓下一年的通膨基準改用實際可支應金額，但那把兩件
      // 完全不同的事混為一談：「拿不到錢」與「沒有錢」。
      //
      // **在還能繼續跑的模擬裡，缺口必然是前者**——「沒有錢」已經由 closingTotal <= 1 判成破產
      // 並中止（N2／N8／N9）。所以 actualSpend 那條路徑沒有合法的適用情境，卻會把一次凍結年的
      // 缺口永久烙進基準：實測核心凍結一年後，計畫支出從 244,800 崩到 41,800 並再也回不來，
      // 而同期資產從 762 萬長到 1,079 萬，工具還回報「零缺口、可持續」。
      //
      // 真正變窮由護欄處理：資產縮水 → 提領率升高 → 收緊。缺口本身則由 M5 的兩個指標
      //（累計實際／原始計畫、最差年度支應比例）如實反映，不需要再改寫基準。
      priorSpend = spend;
    }
    return {
      years,
      plannedSpendTotal,
      spendShortfall,
      eventShortfall,
      firstShortfallYear,
      firstEventShortfallYear,
      cumulativeUnmet,
      cumulativeEventUnmet,
      cumulativePortfolioActual,
      cumulativeGuaranteedIncome,
      cumulativeGuaranteedIncomeUsed,
      firstFloorBindingYear,
      firstFloorGapYear,
      cumulativeFloorGap,
      floorBindingYears,
      guardrailSaturatedYears,
      guardrailCutYears,
      bankruptYear,
      firstIlliquidYear,
    };
  }

  const exported = {
    DEFAULT,
    scenarios,
    SCENARIO_CORE_RETURN_PATHS,
    scenarioCoreReturn,
    SP500_TOTAL_RETURNS,
    US_CPI_DECEMBER_CHANGES,
    JAPAN_CPI_ANNUAL_CHANGES,
    NIKKEI_225_PRICE_RETURNS,
    TAIWAN_CPI_ANNUAL_CHANGES,
    TAIEX_PRICE_RETURNS,
    HORIZON_YEARS,
    HISTORICAL_MARKETS,
    historicalReturnPath,
    historicalInflationPath,
    sp500TotalReturnPath,
    hydrateState,
    clampSetting,
    clampTreasuryDrawdownYears,
    targetTreasuryLength,
    treasuryLadderLength,
    clampIncomeField,
    INCOME_BOUNDS,
    INDEXATIONS,
    guardrailError,
    MIN_GUARDRAIL_BAND,
    MONTE_CARLO_BOUNDS,
    HISTORICAL_SAMPLING,
    clampMonteCarlo,
    clampFixedEvent,
    INFLATION_AR1,
    INFLATION_FLOOR,
    INFLATION_CALIBRATION_START,
    INFLATION_STRESS_PATHS,
    stressInflationPath,
    stressSafeRates,
    historicalSafeRates,
    US_TREASURY_5Y_ANNUAL_AVERAGE,
    US_TREASURY_5Y_DECEMBER,
    US_TBILL_3M_ANNUAL_AVERAGE,
    inflationPath,
    inflationRateForYear,
    estimateInflationAr1,
    incomeTotalReturn,
    SP500_MONTHLY_LOG_SD,
    MONTHLY_STRATIFIED_SHOCKS,
    incomeDistributionRate,
    BXM_MONTHLY_PROFILE,
    DIVIDEND_ETF_PROFILES,
    PBP_PAYOUT_YIELDS,
    DIVIDEND_ADJUSTMENT_SPEED,
    DIVIDEND_YIELD_SPIKE_RATIO,
    nextDividendPerShare,
    DIVIDEND_SCENARIOS,
    dividendParameters,
    dividendEtfMonthlyReturn,
    dividendEtfTotalReturn,
    bxmMonthlyReturn,
    marketMonthsForAnnualReturn,
    bxmTotalReturn,
    WITHDRAWAL_IDS,
    EVENT_WITHDRAWAL_POLICIES,
    monteCarloPlanSnapshot,
    coverageTargets,
    simulate,
  };
  // Worker 裡沒有 window，只有 self——掛在 window 上會讓 importScripts() 跑完什麼都沒暴露。
  // globalThis 在 renderer 等於 window、在 Worker 等於 self，一條涵蓋兩邊。
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else globalThis.RetirementSim = exported;
})();
