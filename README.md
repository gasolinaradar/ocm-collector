<p align="center">
  <h1 align="center">@gasolinaradar/ocm-collector</h1>
  <p align="center">
    Normalized EV charging stations for Spain, straight from OpenChargeMap.<br />
    Estaciones de carga EV de España, normalizadas desde OpenChargeMap.
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/@gasolinaradar/ocm-collector"><img alt="npm version" src="https://img.shields.io/npm/v/%40gasolinaradar%2Focm-collector" /></a>
    <a href="./LICENSE"><img alt="license: MIT" src="https://img.shields.io/npm/l/%40gasolinaradar%2Focm-collector" /></a>
    <img alt="node >= 18" src="https://img.shields.io/badge/node-%E2%89%A518-339933" />
    <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" />
    <img alt="Spain EV charging" src="https://img.shields.io/badge/Spain-EV%20Charging-e83e8c" />
  </p>
</p>

A Node.js collector for **electric-vehicle charging stations in Spain** sourced from [OpenChargeMap](https://openchargemap.org) (OCM). It queries the OCM API v3 `/poi` endpoint, paginates the full Spain dataset, and returns a **normalized, ready-to-use** array of stations following the shared `Station` contract.

## Features / Características

- Official OpenChargeMap API (open data only via `opendata=true`).
- Paginates past OCM's per-request result cap to collect all stations (`countrycode=ES`, `maxresults=10000`).
- Maps OCM `ConnectionTypeID`s to OCPI connector types (`OCM_TO_OCPI_CONNECTOR`).
- Maps OCM `StatusTypeID`s to a canonical status (`AVAILABLE` / `UNKNOWN` / `OUTOFORDER`).
- Classifies OCM `UsageTypeID`s into a `usageRestrictions` object (`access` + `payAtLocation` / `membershipRequired` / `accessKeyRequired`) from the official OCM `UsageTypes` table.
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

## Configuration / Configuración

| Option       | Type                   | Default            | Description                                                       |
| ------------ | ---------------------- | ------------------ | ----------------------------------------------------------------- |
| `url`        | `string`               | OCM v3 `/poi` URL  | API endpoint.                                                     |
| `apiKey`     | `string`               | `OCM_API_KEY` env  | OCM API key.                                                      |
| `timeout`    | `number`               | `15000`            | HTTP timeout in milliseconds.                                     |
| `retries`    | `number`               | `3`                | Retry attempts before failing.                                    |
| `logger`     | `{ info, warn }`       | `console`          | Injectable logger.                                                |
| `httpClient` | `{ get(url, opts) }`   | `axios`            | Injectable HTTP client (useful for tests).                        |
| `pageDelayMs` | `number`              | `250`              | Wait between pages in ms (OCM rate limit). `0` disables it.       |
| `sleep`      | `(ms) => Promise`     | `setTimeout`       | Injectable sleep function (useful for tests).                     |

## Station contract / Contrato de estación

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
  typeOfSite: undefined, // never set for OCM points (that key carries dgtEv semantics)
  usageRestrictions: {
    access: 'unknown', // 'public' | 'private' | 'unknown'
    title: '(Unknown)', // real OCM UsageTypes title
    payAtLocation: false,
    membershipRequired: false,
    accessKeyRequired: false,
  },
  lastUpdated: Date, // timestamp of the normalization
}
```

Notes / Notas:

- Coordinates are `[longitude, latitude]` (GeoJSON order).
- `status` is derived from OCM `StatusTypeID`: `10/50 → AVAILABLE`, `20 → UNKNOWN`, `75 → OUTOFORDER`, `150 → UNKNOWN`.
- `usageRestrictions` is derived from OCM `UsageTypeID` via the official `UsageTypes` referencedata table
  (`1 → public`, `2/3/6 → private`, `4 → public + membershipRequired + accessKeyRequired`,
  `5 → public + payAtLocation`, `7 → public`, `0`/missing → `unknown`). It is always present.
- `typeOfSite` is never populated for OCM points; use `usageRestrictions.access` instead.
- A POI without a matching connector table entry or operator is handled gracefully (connector type `UNKNOWN`, `operator: undefined`).

### Price semantics / Semántica de precios

Un precio de `0` en EV significa precio **desconocido**, no gratis. `UsageCost` se parsea
en componentes `{ type, price, currency, restrictions? }` y los segmentos con importe `0`
(p. ej. `0€/kWh`) se descartan; el resto de segmentos de la misma tarifa se conservan.
Los textos "gratis"/"free" tampoco generan precios.

## Testing / Tests

```bash
npm test   # unit tests (mocked HTTP)
```

## Ecosystem / Ecosistema

Part of the **Gasolina Radar** ingestion stack. Companion repositories and the source of this collector live at [github.com/gasolinaradar/ocm-collector](https://github.com/gasolinaradar/ocm-collector). The normalized `Station` output is designed to be consumed by downstream pipelines and shared across collectors.

## License / Licencia

MIT. See [LICENSE](./LICENSE). The underlying OCM data is subject to OCM's own terms and is filtered to open data via `opendata=true`.
