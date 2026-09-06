const { test } = require('node:test');
const assert = require('node:assert');
const { createOcmCollector, fetchStations } = require('../src');
const { normalizePoi, OCM_TO_OCPI_CONNECTOR } = require('../src/normalize');

function makePoi(overrides = {}) {
  return {
    ID: 200352,
    AddressInfo: {
      Title: 'Mardy Street',
      AddressLine1: 'Calle Mayor 1',
      Town: 'Madrid',
      StateOrProvince: 'Madrid',
      Postcode: '28013',
      Latitude: 40.416775,
      Longitude: -3.70379,
    },
    StatusTypeID: 50,
    OperatorInfo: { ID: 3341, Title: 'Opcharge', WebsiteURL: 'https://opcharge.example' },
    Connections: [
      {
        ConnectionTypeID: 28,
        FormalName: 'Type 2',
        LevelID: 2,
        Amps: 32,
        Voltage: 230,
        PowerKW: 7.4,
        CurrentTypeID: 10,
        CurrentDescription: 'AC',
      },
    ],
    ...overrides,
  };
}

test('normalizePoi maps a standard OCM POI to the Station contract', () => {
  const station = normalizePoi(makePoi());

  assert.equal(station.source, 'ocm');
  assert.equal(station.country, 'ES');
  assert.equal(station.sourceStationId, 'ocm-200352');
  assert.equal(station.name, 'Mardy Street');
  assert.equal(station.address, 'Calle Mayor 1');
  assert.equal(station.municipality, 'Madrid');
  assert.deepEqual(station.location, {
    type: 'Point',
    coordinates: [-3.70379, 40.416775],
  });
  assert.equal(station.status, 'AVAILABLE');
  assert.deepEqual(station.operator, {
    name: 'Opcharge',
    website: 'https://opcharge.example',
  });
  assert.deepEqual(station.connectors, [
    {
      type: 'IEC_62196_T2',
      format: null,
      mode: null,
      maxPowerKw: 7.4,
      voltageV: 230,
      maxCurrentA: 32,
      typeKey: '28',
    },
  ]);
});

test('normalizePoi handles multi-connector POIs by mapping each connection type', () => {
  const poi = makePoi({
    Connections: [
      { ConnectionTypeID: 30, PowerKW: 50, Voltage: 400, Amps: 125 },
      { ConnectionTypeID: 32, PowerKW: 20, Voltage: 400, Amps: 50 },
    ],
  });

  const station = normalizePoi(poi);

  assert.equal(station.connectors.length, 2);
  assert.equal(station.connectors[0].type, 'IEC_62196_T2_DC');
  assert.equal(station.connectors[1].type, 'CHADEMO');
  assert.deepEqual(station.connectorTypeKeys, ['30', '32']);
});

test('normalizePoi handles POIs with no operator', () => {
  const poi = makePoi({ OperatorInfo: undefined });

  const station = normalizePoi(poi);

  assert.equal(station.operator, undefined);
  assert.equal(station.status, 'AVAILABLE');
});

test('normalizePoi maps status types', () => {
  assert.equal(normalizePoi(makePoi({ StatusTypeID: 10 })).status, 'AVAILABLE');
  assert.equal(normalizePoi(makePoi({ StatusTypeID: 50 })).status, 'AVAILABLE');
  assert.equal(normalizePoi(makePoi({ StatusTypeID: 20 })).status, 'UNKNOWN');
  assert.equal(normalizePoi(makePoi({ StatusTypeID: 75 })).status, 'OUTOFORDER');
  assert.equal(normalizePoi(makePoi({ StatusTypeID: 150 })).status, 'UNKNOWN');
});

test('normalizeConnectors keeps connectors that only have a ConnectionTypeID', () => {
  const station = normalizePoi(
    makePoi({
      Connections: [
        { ConnectionTypeID: 28 },
        { ConnectionTypeID: 27 },
        { ConnectionTypeID: 999999 },
      ],
    }),
  );

  assert.equal(station.connectors.length, 3);
  assert.deepEqual(station.connectors[0], {
    type: 'IEC_62196_T2',
    format: null,
    mode: null,
    maxPowerKw: null,
    voltageV: null,
    maxCurrentA: null,
    typeKey: '28',
  });
  assert.equal(station.connectors[1].typeKey, '27');
  assert.equal(station.connectors[2].type, 'UNKNOWN');
  assert.deepEqual(station.connectorTypeKeys, ['28', '27', '999999']);
});

test('normalizeConnectors drops connector entries without a ConnectionTypeID', () => {
  const station = normalizePoi(
    makePoi({
      Connections: [{}, { ConnectionTypeID: 28, PowerKW: 22 }],
    }),
  );

  assert.equal(station.connectors.length, 1);
  assert.equal(station.connectors[0].typeKey, '28');
});

test('OCM_TO_OCPI_CONNECTOR maps known connector IDs', () => {
  assert.equal(OCM_TO_OCPI_CONNECTOR[28], 'IEC_62196_T2');
  assert.equal(OCM_TO_OCPI_CONNECTOR[32], 'CHADEMO');
});

function createFakeClient(results) {
  return {
    get: async (_url, { params = {} } = {}) => {
      const greaterThan = params.greaterthanid || -1;
      return {
        status: 200,
        data: results.slice(greaterThan + 1).slice(0, 2000),
      };
    },
  };
}

test('fetchStations returns normalized stations', async () => {
  const stations = await fetchStations({
    httpClient: createFakeClient([makePoi(), makePoi({ ID: 999 })]),
    apiKey: 'test-key',
    logger: null,
  });

  assert.equal(stations.length, 2);
  assert.equal(stations[0].source, 'ocm');
  assert.equal(stations[0].sourceStationId, 'ocm-200352');
  assert.equal(stations[1].sourceStationId, 'ocm-999');
});

function createPaginatedClient(count) {
  return {
    get: async (_url, { params = {} } = {}) => {
      const greaterThan = params.greaterthanid || -1;
      const max = params.maxresults || 2000;
      const page = [];
      for (let i = greaterThan + 1; i < Math.min(count, greaterThan + 1 + max); i += 1) {
        page.push(makePoi({ ID: i }));
      }
      return { status: 200, data: page };
    },
  };
}

test('fetchStations pages past a single pageSize so big datasets are not truncated', async () => {
  const stations = await fetchStations({
    httpClient: createPaginatedClient(2500),
    apiKey: 'test-key',
    logger: null,
  });

  assert.equal(stations.length, 2500);
  assert.equal(stations[0].sourceStationId, 'ocm-0');
  assert.equal(stations[2499].sourceStationId, 'ocm-2499');
});

test('createOcmCollector exposes the collector contract', async () => {
  const collector = createOcmCollector({
    httpClient: createFakeClient([makePoi()]),
    apiKey: 'test-key',
    logger: null,
  });

  assert.equal(collector.name, 'ocm');
  assert.equal(collector.country, 'ES');
  assert.equal(typeof collector.fetch, 'function');

  const stations = await collector.fetch({});
  assert.equal(stations.length, 1);
});

test('fetchStations throws on unexpected payload', async () => {
  await assert.rejects(
    () => fetchStations({ httpClient: { get: async () => ({ data: { foo: 1 } }) }, logger: null }),
    /Unexpected OCM response payload/,
  );
});