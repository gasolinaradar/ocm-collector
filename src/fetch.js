const axios = require('axios');

const DEFAULT_OCM_URL = 'https://api.openchargemap.io/v3/poi';
const DEFAULT_MAXRESULTS = 100000;
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

function buildParams({ apiKey, maxresults, greaterthanid }) {
  const params = {
    countrycode: 'ES',
    maxresults,
    compact: true,
    verbose: false,
    opendata: true,
    sortby: 'id_asc',
  };
  if (greaterthanid > 0) {
    params.greaterthanid = greaterthanid;
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

async function fetchPage(httpClient, { url, timeout, apiKey, maxresults, greaterthanid }) {
  return httpClient.get(url, {
    timeout,
    params: buildParams({ apiKey, maxresults, greaterthanid }),
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
  logger.info('Requesting OCM POI dataset', { url, pageSize: DEFAULT_PAGE_SIZE });

  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxresults = options.maxresults ?? DEFAULT_MAXRESULTS;
  const all = [];
  let lastId = 0;
  let pageCount = 0;

  const fetchWithRetry = () =>
    retry(
      async () => {
        const response = await fetchPage(httpClient, {
          url,
          timeout,
          apiKey,
          maxresults: pageSize,
          greaterthanid: lastId,
        });
        const { series } = normalizePagination(response);
        return series;
      },
      { retries, logger },
    );

  do {
    const series = await fetchWithRetry();
    const before = all.length;
    all.push(...series);
    pageCount += 1;
    // El % del fetch va de 5 a 60; los últimos 40 puntos se reservan para la
    // persistencia/upsert que el API ejecuta después del fetch. Sin un total
    // conocido (OCM no lo devuelve con greaterthanid), se avanza por página con
    // un tope en 60 para no pintar "100%" mientras aún falta persistir.
    reportProgress(Math.min(5 + pageCount * 5, 60), {
      stage: 'fetching_dataset',
      fetched: all.length,
      pageCount,
      pageSize: series.length,
      lastId,
    });
    if (series.length > 0) {
      // OCM no soporta offset; la paginación se hace ordenando por id
      // ascendente y pidiendo solo ids mayores que el último recibido.
      lastId = series[series.length - 1].ID;
    }
    // Una página más corta que el tamaño pedido indica que no hay más
    // datos. lastId sin avance (respuesta vacía o duplicada) corta también.
    const finished =
      series.length === 0 ||
      series.length < pageSize ||
      all.length === before ||
      all.length >= maxresults;
    if (finished) {
      break;
    }
  } while (true);

  reportProgress(60, { stage: 'normalizing_dataset', stationCount: all.length });
  const { normalizePoi } = require('./normalize');
  const normalized = [];
  const skipped = [];
  for (const raw of all) {
    try {
      normalized.push(normalizePoi(raw));
    } catch (err) {
      skipped.push(err.message);
    }
  }
  if (skipped.length > 0) {
    logger.warn(`Skipped ${skipped.length} OCM POIs with invalid data`, {
      skipped: skipped.slice(0, 5),
    });
  }
  // El fetch termina al 60%; el API sube hasta 100 a medida que persiste.
  reportProgress(60, { stage: 'fetch_completed', stationCount: normalized.length });
  return normalized;
}

module.exports = {
  fetchStations,
  DEFAULT_OCM_URL,
  DEFAULT_MAXRESULTS,
};