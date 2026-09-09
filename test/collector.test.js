const { test } = require('node:test');
const assert = require('node:assert');
const { createOcmCollector, fetchStations } = require('../src');
const {
  normalizePoi,
  parseUsageCost,
  classifyUsageType,
  OCM_TO_OCPI_CONNECTOR,
  OCM_USAGE_TYPES,
} = require('../src/normalize');

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
        ConnectionTypeID: 25,
        FormalName: 'Type 2 (Socket Only)',
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
      type: 'iec62196T2',
      format: null,
      mode: null,
      maxPowerKw: 7.4,
      voltageV: 230,
      maxCurrentA: 32,
      typeKey: '25',
    },
  ]);
});

test('normalizePoi handles multi-connector POIs by mapping each connection type', () => {
  const poi = makePoi({
    Connections: [
      { ConnectionTypeID: 33, PowerKW: 50, Voltage: 400, Amps: 125 },
      { ConnectionTypeID: 2, PowerKW: 50, Voltage: 400, Amps: 125 },
      { ConnectionTypeID: 25, PowerKW: 22, Voltage: 230, Amps: 32 },
    ],
  });

  const station = normalizePoi(poi);

  assert.equal(station.connectors.length, 3);
  assert.equal(station.connectors[0].type, 'iec62196T2COMBO'); // CCS (Type 2)
  assert.equal(station.connectors[1].type, 'chademo'); // CHAdeMO
  assert.equal(station.connectors[2].type, 'iec62196T2'); // Type 2 (Socket Only)
  assert.deepEqual(station.connectorTypeKeys, ['33', '2', '25']);
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
    type: 'domesticF',
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
  assert.equal(OCM_TO_OCPI_CONNECTOR[28], 'domesticF'); // CEE 7/4 Schuko
  assert.equal(OCM_TO_OCPI_CONNECTOR[33], 'iec62196T2COMBO'); // CCS (Type 2)
  assert.equal(OCM_TO_OCPI_CONNECTOR[2], 'chademo'); // CHAdeMO
  assert.equal(OCM_TO_OCPI_CONNECTOR[25], 'iec62196T2'); // Type 2 (Socket Only)
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

test('parseUsageCost parses per-kWh prices to ENERGY components', () => {
  assert.deepStrictEqual(parseUsageCost('0,45\u20AC/kWh'), [
    { type: 'ENERGY', price: 0.45, currency: 'EUR' },
  ]);
  assert.deepStrictEqual(parseUsageCost('0.35 EUR per kWh'), [
    { type: 'ENERGY', price: 0.35, currency: 'EUR' },
  ]);
  assert.deepStrictEqual(parseUsageCost('0,25\u20AC/kWh '), [
    { type: 'ENERGY', price: 0.25, currency: 'EUR' },
  ]);
});

test('parseUsageCost splits DC and AC per-kWh prices with currentType restriction', () => {
  assert.deepStrictEqual(parseUsageCost('0,50\u20AC/kWh DC - 0,45\u20AC/kWh AC'), [
    { type: 'ENERGY', price: 0.5, currency: 'EUR', restrictions: { currentType: 'DC' } },
    { type: 'ENERGY', price: 0.45, currency: 'EUR', restrictions: { currentType: 'AC' } },
  ]);
  assert.deepStrictEqual(parseUsageCost('0.60\u20AC/kWh DC - 0,39\u20AC/kWh AC'), [
    { type: 'ENERGY', price: 0.6, currency: 'EUR', restrictions: { currentType: 'DC' } },
    { type: 'ENERGY', price: 0.39, currency: 'EUR', restrictions: { currentType: 'AC' } },
  ]);
  assert.deepStrictEqual(parseUsageCost('0,45\u20AC/kWh DC - 0,39\u20AC/kWh AC'), [
    { type: 'ENERGY', price: 0.45, currency: 'EUR', restrictions: { currentType: 'DC' } },
    { type: 'ENERGY', price: 0.39, currency: 'EUR', restrictions: { currentType: 'AC' } },
  ]);
  assert.deepStrictEqual(parseUsageCost('0,47\u20AC/kWh '), [
    { type: 'ENERGY', price: 0.47, currency: 'EUR' },
  ]);
});

test('parseUsageCost parses session and per-time costs', () => {
  assert.deepStrictEqual(parseUsageCost('5\u20AC/up to 60min'), [
    { type: 'FLAT', price: 5, currency: 'EUR' },
  ]);
  assert.deepStrictEqual(parseUsageCost('2\u20AC/session'), [
    { type: 'FLAT', price: 2, currency: 'EUR' },
  ]);
});

test('parseUsageCost returns empty for free, unknown or no-parseable text', () => {
  assert.deepStrictEqual(parseUsageCost('Gratis'), []);
  assert.deepStrictEqual(parseUsageCost('Free'), []);
  assert.deepStrictEqual(parseUsageCost('Variado'), []);
  assert.deepStrictEqual(parseUsageCost(''), []);
  assert.deepStrictEqual(parseUsageCost('Please contact station owner'), []);
});

test('normalizePoi enriches prices, availability and usage restrictions from OCM fields', () => {
  const station = normalizePoi(
    makePoi({
      UsageCost: '0,45\u20AC/kWh',
      UsageTypeID: 4,
      NumberOfPoints: 4,
      StatusTypeID: 50,
    }),
  );

  assert.deepStrictEqual(station.prices, [{ type: 'ENERGY', price: 0.45, currency: 'EUR' }]);
  assert.deepStrictEqual(station.availability, { status: 'AVAILABLE', evseCount: 4 });
  // OCM no contamina typeOfSite (sem\u00E1ntica de dgtEv en el contrato compartido).
  assert.equal(station.typeOfSite, undefined);
  assert.deepStrictEqual(station.usageRestrictions, {
    access: 'public',
    title: 'Public - Membership Required',
    payAtLocation: false,
    membershipRequired: true,
    accessKeyRequired: true,
  });
});

test('classifyUsageType maps the official OCM UsageTypes table', () => {
  assert.equal(classifyUsageType(0).access, 'unknown');
  assert.equal(classifyUsageType(1).access, 'public');
  assert.equal(classifyUsageType(2).access, 'private'); // Private - Restricted Access
  assert.equal(classifyUsageType(3).access, 'private'); // Privately Owned - Notice Required
  assert.equal(classifyUsageType(4).access, 'public'); // Public - Membership Required
  assert.equal(classifyUsageType(5).access, 'public'); // Public - Pay At Location
  assert.equal(classifyUsageType(6).access, 'private'); // Private - For Staff, Visitors or Customers
  assert.equal(classifyUsageType(7).access, 'public'); // Public - Notice Required

  assert.equal(classifyUsageType(5).payAtLocation, true);
  assert.equal(classifyUsageType(5).membershipRequired, false);
  assert.equal(classifyUsageType(4).membershipRequired, true);
  assert.equal(classifyUsageType(4).accessKeyRequired, true);
  assert.equal(classifyUsageType(1).payAtLocation, false);

  // T\u00EDtulos reales de OCM referencedata.
  assert.equal(classifyUsageType(5).title, 'Public - Pay At Location');
  assert.equal(classifyUsageType(6).title, 'Private - For Staff, Visitors or Customers');
  assert.equal(classifyUsageType(7).title, 'Public - Notice Required');
});

test('classifyUsageType falls back to unknown for missing or unrecognised UsageTypeID', () => {
  assert.deepStrictEqual(classifyUsageType(undefined), OCM_USAGE_TYPES[0]);
  assert.deepStrictEqual(classifyUsageType(null), OCM_USAGE_TYPES[0]);
  assert.deepStrictEqual(classifyUsageType(999), OCM_USAGE_TYPES[0]);
  assert.equal(classifyUsageType(undefined).access, 'unknown');
  // Devuelve una copia, no la referencia interna.
  assert.notEqual(classifyUsageType(0), OCM_USAGE_TYPES[0]);
});

test('normalizePoi always emits usageRestrictions, never undefined, even without UsageTypeID', () => {
  const station = normalizePoi(makePoi());
  assert.notEqual(station.usageRestrictions, undefined);
  assert.equal(station.usageRestrictions.access, 'unknown');
  assert.equal(station.typeOfSite, undefined);
});

test('normalizePoi keeps LOGGEX-style UsageTypeID 6 private (regression)', () => {
  // Regresi\u00F3n: la tabla vieja marcaba UsageTypeID 6 como "public"; OCM lo define
  // como "Private - For Staff, Visitors or Customers".
  const station = normalizePoi(makePoi({ UsageTypeID: 6 }));
  assert.equal(station.usageRestrictions.access, 'private');
  assert.equal(station.usageRestrictions.title, 'Private - For Staff, Visitors or Customers');
  assert.equal(station.typeOfSite, undefined);
});

test('normalizePoi maps UsageTypeID 5 (Pay At Location) to public with payAtLocation', () => {
  // Regresi\u00F3n: la tabla vieja marcaba UsageTypeID 5 como "private".
  const station = normalizePoi(makePoi({ UsageTypeID: 5 }));
  assert.equal(station.usageRestrictions.access, 'public');
  assert.equal(station.usageRestrictions.payAtLocation, true);
  assert.equal(station.usageRestrictions.membershipRequired, false);
});

test('normalizePoi maps notice-required usage types (3 private, 7 public)', () => {
  assert.equal(normalizePoi(makePoi({ UsageTypeID: 3 })).usageRestrictions.access, 'private');
  assert.equal(normalizePoi(makePoi({ UsageTypeID: 7 })).usageRestrictions.access, 'public');
  assert.equal(normalizePoi(makePoi({ UsageTypeID: 2 })).usageRestrictions.access, 'private');
});

test('normalizePoi reflects real OCM station with CCS+CHAdeMO+Type2 and DC/AC costs', () => {
  // Estación real de OCM (BDMED): web muestra "Number Of Stations/Bays: 2" = NumberOfPoints,
  // 1 x CCS (Type 2) 50kW DC, 1 x CHAdeMO 50kW DC, 1 x Type 2 (Socket Only) 22kW AC.
  const station = normalizePoi(
    makePoi({
      ID: 170662,
      AddressInfo: {
        Title: 'E.S. BDMED Hnos Bou',
        AddressLine1: 'Av. Lledó 5',
        Town: 'Castellón de la Plana',
        StateOrProvince: 'Castellón',
        Latitude: 39.9652551,
        Longitude: -0.0164207,
      },
      StatusTypeID: 50,
      NumberOfPoints: 2,
      Connections: [
        {
          ConnectionTypeID: 33,
          FormalName: 'CCS (Type 2)',
          LevelID: 3,
          Amps: 125,
          Voltage: 400,
          PowerKW: 50,
          CurrentTypeID: 30,
          CurrentDescription: 'DC',
        },
        {
          ConnectionTypeID: 2,
          FormalName: 'CHAdeMO',
          LevelID: 3,
          Amps: 125,
          Voltage: 400,
          PowerKW: 50,
          CurrentTypeID: 30,
          CurrentDescription: 'DC',
        },
        {
          ConnectionTypeID: 25,
          FormalName: 'Type 2 (Socket Only)',
          LevelID: 2,
          Amps: 32,
          Voltage: 230,
          PowerKW: 22,
          CurrentTypeID: 20,
          CurrentDescription: 'AC',
        },
      ],
      UsageCost: '0,50\u20AC/kWh DC - 0,45\u20AC/kWh AC',
    }),
  );

  assert.equal(station.connectors.length, 3);
  assert.deepEqual(
    station.connectors.map((c) => c.type),
    ['iec62196T2COMBO', 'chademo', 'iec62196T2'],
  );
  assert.deepEqual(station.connectorTypeKeys, ['33', '2', '25']);
  assert.deepStrictEqual(station.prices, [
    { type: 'ENERGY', price: 0.5, currency: 'EUR', restrictions: { currentType: 'DC' } },
    { type: 'ENERGY', price: 0.45, currency: 'EUR', restrictions: { currentType: 'AC' } },
  ]);
  assert.deepEqual(station.availability, { status: 'AVAILABLE', evseCount: 2 });
});