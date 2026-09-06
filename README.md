# @gasolinaradar/ocm-collector

A Node.js collector for **electric-vehicle charging stations in Spain** sourced from [OpenChargeMap](https://openchargemap.org) (OCM). It queries the OCM API v3 `/poi` endpoint, paginates the full Spain dataset, and returns a **normalized, ready-to-use** array of stations following the shared `Station` contract.

## Features / Características

- Official OpenChargeMap API (open data only via `opendata=true`).
- Paginates past OCM's per-request result cap to collect all stations (`countrycode=ES`, `maxresults=10000`).
- Maps OCM `ConnectionTypeID`s to OCPI connector types (`OCM_TO_OCPI_CONNECTOR`).
- Maps OCM `StatusTypeID`s to a canonical status (`AVAILABLE` / `UNKNOWN` / `OUTOFORDER`).
- Built-in retry with exponential backoff.
- Injectable logger, HTTP client, and URL resolver.
- Progress reporting hook for long runs.
- API key read from the `OCM_API_KEY` environment variable.

## Installation / Instalación

```bash
npm install @gasolinaradar/ocm-collector
```

## Quick start / Inicio rápido

```bash
export OCM_API_KEY=your_key_here
```

```js
const { fetchStations } = require('@gasolinaradar/ocm-collector');

async function main() {
  const stations = await fetchStations();
  console.log(`Fetched ${stations.length} charging stations`);
  console.log(stations[0]);
}

main();
```

## API

### `fetchStations(options?) → Promise<Station[]>`

Downloads the full Spain OCM dataset and returns normalized stations in one step.

```js
const { fetchStations } = require('@gasolinaradar/ocm-collector');

const stations = await fetchStations({
  apiKey: process.env.OCM_API_KEY,
  logger: console,
  timeout: 15000,
  retries: 3,
});
```

The API key is also read automatically from the `OCM_API_KEY` environment variable when `options.apiKey` is omitted.

### `createOcmCollector(options?) → Collector`

Returns an object matching the common **collector contract** used by ingestion pipelines:

```js
{ name: 'ocm', country: 'ES', fetch(context) }
```

```js
const { createOcmCollector } = require('@gasolinaradar/ocm-collector');

const ocmCollector = createOcmCollector({ logger });

const stations = await ocmCollector.fetch({
  reportProgress(percent, metadata = {}) {
    console.log(`${percent}%`, metadata);
  },
});
```

## Options / Opciones

| Option       | Type                   | Default            | Description                                                       |
| ------------ | ---------------------- | ------------------ | ----------------------------------------------------------------- |
| `url`        | `string`               | OCM v3 `/poi` URL  | API endpoint.                                                     |
| `apiKey`     | `string`               | `OCM_API_KEY` env  | OCM API key.                                                      |
| `timeout`    | `number`               | `15000`            | HTTP timeout in milliseconds.                                     |
| `retries`    | `number`               | `3`                | Retry attempts before failing.                                    |
| `logger`     | `{ info, warn }`       | `console`          | Injectable logger.                                                |
| `httpClient` | `{ get(url, opts) }`   | `axios`            | Injectable HTTP client (useful for tests).                        |

## Output schema / Esquema de salida

Each normalized station matches the shared EV `Station` contract:

```js
{
  source: 'ocm',
  country: 'ES',
  sourceStationId: 'ocm-200352',
  name: 'Mardy Street',
  address: 'Calle Mayor 1',
  municipality: 'Madrid',
  province: 'Madrid',
  postalCode: '28013',
  location: { type: 'Point', coordinates: [-3.70379, 40.416775] }, // [lon, lat]
  connectorTypeKeys: ['28'],
  connectors: [
    {
      type: 'IEC_62196_T2',
      format: null,
      mode: null,
      maxPowerKw: 7.4,
      voltageV: 230,
      maxCurrentA: 32,
      typeKey: '28',
    },
  ],
  operator: { name: 'Opcharge', website: 'https://opcharge.example' },
  status: 'AVAILABLE',
  services: ['ev_charging'],
  typeOfSite: undefined,
  lastUpdated: Date, // timestamp of the normalization
}
```

Notes / Notas:

- Coordinates are `[longitude, latitude]` (GeoJSON order).
- `status` is derived from OCM `StatusTypeID`: `10/50 → AVAILABLE`, `20 → UNKNOWN`, `75 → OUTOFORDER`, `150 → UNKNOWN`.
- A POI without a matching connector table entry or operator is handled gracefully (connector type `UNKNOWN`, `operator: undefined`).

## Tests

```bash
npm test   # unit tests (mocked HTTP)
```

## License / Licencia

MIT. See [LICENSE](./LICENSE). The underlying OCM data is subject to OCM's own terms and is filtered to open data via `opendata=true`.