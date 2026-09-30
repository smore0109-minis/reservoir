(function () {
  // 每次執行擁有獨立 Worker；取消、失敗與成功都會釋放，舊結果不能覆蓋新方案。
  function createMonteCarloRunner(makeWorker = () => new Worker('monte-carlo-worker.js')) {
    let active = null;
    function cancel() {
      if (!active) return;
      const error = new Error('模擬已取消');
      error.name = 'AbortError';
      active.finish(error);
    }
    function run(payload) {
      cancel();
      return new Promise((resolve, reject) => {
        let worker;
        try {
          worker = makeWorker();
        } catch (error) {
          reject(error);
          return;
        }
        const job = {
          finish(error, result) {
            if (active !== job) return;
            active = null;
            worker.terminate();
            if (error) reject(error);
            else resolve(result);
          },
        };
        active = job;
        worker.onmessage = ({ data }) => {
          if (data.error) job.finish(new Error(data.error));
          else job.finish(null, data.result);
        };
        worker.onerror = event => job.finish(new Error(event.message || '無法執行模擬，請重試。'));
        worker.onmessageerror = () => job.finish(new Error('無法讀取模擬結果，請重試。'));
        try {
          worker.postMessage(payload);
        } catch (error) {
          job.finish(error);
        }
      });
    }
    return { run, cancel, isRunning: () => active !== null };
  }
  const exported = { createMonteCarloRunner };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else globalThis.RetirementWorkerClient = exported;
})();
