const axios = require('axios');

const DEFAULT_OCM_URL = 'https://api.openchargemap.io/v3/poi';
const DEFAULT_MAXRESULTS = 10000;
const DEFAULT_PAGE_SIZE = 2000;
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RETRIES = 3;

function resolveApiKey(keyOption) {
  if (typeof keyOption === 'string' && keyOption.trim()) {
    return keyOption.trim();
  }
  return process.env.OCM_API_KEY || '';
}

function resolveLogger(loggerOption) {
  return loggerOption && typeof loggerOption.info === 'function' ? loggerOption : console;
}

function resolveHttpClient(httpClientOption) {
  return httpClientOption && typeof httpClientOption.get === 'function' ? httpClientOption : axios;
}

function retry(fn, options = {}) {
  const { retries = DEFAULT_RETRIES, minTimeoutMs = 1000, logger = console } = options;
  return (async () => {
    let delay = minTimeoutMs;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        logger.warn(`OCM retry attempt ${attempt + 1} after failure: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  })();
}

function buildParams({ apiKey, maxresults, offset }) {
  const params = {
    countrycode: 'ES',
    maxresults,
    compact: true,
    verbose: false,
    opendata: true,
  };
  if (offset > 0) {
    params.offset = offset;
  }
  if (apiKey) {
    params.key = apiKey;
  }
  return params;
}

function normalizePagination(result) {
  const data = result?.data;
  if (Array.isArray(data)) {
    return { series: data, total: data.length };
  }
  if (Array.isArray(data?.PoiList)) {
    return { series: data.PoiList, total: data.Count ?? data.PoiList.length };
  }
  if (Array.isArray(data?.Results) && Array.isArray(data?.Stations)) {
    return { series: data.Stations, total: data.Results.Length };
  }
  throw new Error('Unexpected OCM response payload');
}

async function fetchPage(httpClient, { url, timeout, apiKey, maxresults, offset }) {
  return httpClient.get(url, {
    timeout,
    params: buildParams({ apiKey, maxresults, offset }),
  });
}

async function fetchStations(options = {}, hooks = {}) {
  const logger = resolveLogger(options.logger);
  const httpClient = resolveHttpClient(options.httpClient);
  const url = options.url || DEFAULT_OCM_URL;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const apiKey = resolveApiKey(options.apiKey);

  if (!apiKey) {
    logger.warn('OCM_API_KEY is not set; OCM may reject requests or return limited data');
  }

  const reportProgress =
    typeof hooks.reportProgress === 'function' ? hooks.reportProgress : () => {};

  reportProgress(5, { stage: 'requesting_dataset' });
  logger.info('Requesting OCM POI dataset', { url, maxresults: DEFAULT_MAXRESULTS });

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxresults = DEFAULT_MAXRESULTS;
  const all = [];
  let total = null;
  let offset = 0;

  const fetchWithRetry = () =>
    retry(
      async () => {
        const response = await fetchPage(httpClient, {
          url,
          timeout,
          apiKey,
          maxresults,
          offset,
        });
        const { series, total: seriesTotal } = normalizePagination(response);
        if (total === null && seriesTotal !== null) {
          total = seriesTotal;
        }
        return series;
      },
      { retries, logger },
    );

  do {
    const series = await fetchWithRetry();
    all.push(...series);
    reportProgress(50, {
      stage: 'fetching_dataset',
      fetched: all.length,
      total: total || 'unknown',
    });
    offset += series.length;
    const target = total && total !== 0 ? total : maxresults;
    if (offset >= target) {
      break;
    }
  } while (all.length < maxresults);

  reportProgress(60, { stage: 'normalizing_dataset', stationCount: all.length });
  const { normalizePoi } = require('./normalize');
  const normalized = all.map(normalizePoi);
  reportProgress(100, { stage: 'completed', stationCount: normalized.length });
  return normalized;
}

module.exports = {
  fetchStations,
  DEFAULT_OCM_URL,
  DEFAULT_MAXRESULTS,
};