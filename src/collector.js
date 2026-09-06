const { fetchStations } = require('./fetch');

function createOcmCollector(options = {}) {
  return {
    name: 'ocm',
    country: 'ES',
    async fetch(context = {}) {
      const reportProgress =
        typeof context?.reportProgress === 'function' ? context.reportProgress : () => {};
      return fetchStations(options, { reportProgress });
    },
  };
}

module.exports = {
  createOcmCollector,
};