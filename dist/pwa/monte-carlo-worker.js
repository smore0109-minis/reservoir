importScripts('simulate.js', 'monte-carlo.js');
self.onmessage = ({ data }) => {
  try {
    const result = data.comparison
      ? self.RetirementMonteCarlo.runMonteCarloComparison(data.profiles, data.state)
      : self.RetirementMonteCarlo.runMonteCarlo(data.state);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
