// Mapa ConnectionTypeID de OCM -> clave canónica del catálogo del API GasolinaRadar
// (connectorCatalog.constants.js), NO el enum OCPI uppercase: el API resuelve
// `connector.type` tal cual (keyMap vacío por defecto), así que la clave que emita la
// librería es la que termina en `connectorTypeKeys` y la que determina label/icono en la
// app. Tabla oficial sacada de ocm-export referencedata.json (ConnectionTypes no obsoletos).
// IDs no incluidos (NEMA US, GB/T, Wireless, Avcon, XLR, Battery Swap...) caen a `UNKNOWN`
// porque no tienen equivalente en el catálogo ni presencia relevante en España.
const OCM_TO_OCPI_CONNECTOR = {
  1: 'iec62196T1', // Type 1 (J1772)
  2: 'chademo', // CHAdeMO
  3: 'domesticG', // BS1363 3 Pin 13 Amp (UK Type G)
  4: 'iec60309x2single16', // Blue Commando (2P+E), CEE monofásico
  8: 'teslaR', // Tesla (Roadster)
  13: 'domesticC', // Europlug (CEE 7/16)
  16: 'iec60309x2single16', // CEE 3 Pin (monofásico)
  17: 'iec60309x2three32', // CEE 5 Pin (trifásico)
  23: 'domesticE', // CEE 7/5 (Type E, Francia)
  25: 'iec62196T2', // Type 2 (Socket Only)
  26: 'iec62196T3C', // SCAME Type 3C
  27: 'teslaS', // NACS / Tesla Supercharger
  28: 'domesticF', // CEE 7/4 Schuko (Type F)
  29: 'domesticI', // Type I (AS 3112)
  30: 'teslaS', // Tesla (Model S/X)
  32: 'iec62196T1COMBO', // CCS (Type 1)
  33: 'iec62196T2COMBO', // CCS (Type 2)
  34: 'iec60309x2single16', // IEC 60309 3-pin (monofásico)
  35: 'iec60309x2three32', // IEC 60309 5-pin (trifásico)
  36: 'iec62196T3A', // SCAME Type 3A (Low Power)
  1036: 'iec62196T2', // Type 2 (Tethered Connector)
  1037: 'domesticJ', // T13 - SEC1011 (Type J, Suiza)
  1044: 'chademo', // ChaoJi / CHAdeMO 3.x
};

const OCM_STATUS_TO_OCPI = {
  10: 'AVAILABLE',
  50: 'AVAILABLE',
  20: 'UNKNOWN',
  150: 'UNKNOWN',
  75: 'OUTOFORDER',
};

// UsageTypeID de OCM -> restricciones de acceso. Tabla oficial sacada de la
// referencedata en vivo de OCM (`/v3/referencedata`, colección `UsageTypes`).
// OJO: la tabla anterior mezclaba semántica de uso dentro de `typeOfSite`, que
// en el contrato Station compartido tiene la semántica de dgtEv y colisionaba.
// Ahora esto alimenta el campo propio `usageRestrictions` y NO toca `typeOfSite`.
//
//   ID  Title                                        access
//   0   (Unknown)                                    unknown
//   1   Public                                       public
//   2   Private - Restricted Access                  private
//   3   Privately Owned - Notice Required            private
//   4   Public - Membership Required                 public  (membershipRequired, accessKeyRequired)
//   5   Public - Pay At Location                     public  (payAtLocation)
//   6   Private - For Staff, Visitors or Customers   private
//   7   Public - Notice Required                     public
const OCM_USAGE_TYPES = {
  0: {
    access: 'unknown',
    title: '(Unknown)',
    payAtLocation: false,
    membershipRequired: false,
    accessKeyRequired: false,
  },
  1: {
    access: 'public',
    title: 'Public',
    payAtLocation: false,
    membershipRequired: false,
    accessKeyRequired: false,
  },
  2: {
    access: 'private',
    title: 'Private - Restricted Access',
    payAtLocation: false,
    membershipRequired: false,
    accessKeyRequired: false,
  },
  3: {
    access: 'private',
    title: 'Privately Owned - Notice Required',
    payAtLocation: false,
    membershipRequired: false,
    accessKeyRequired: false,
  },
  4: {
    access: 'public',
    title: 'Public - Membership Required',
    payAtLocation: false,
    membershipRequired: true,
    accessKeyRequired: true,
  },
  5: {
    access: 'public',
    title: 'Public - Pay At Location',
    payAtLocation: true,
    membershipRequired: false,
    accessKeyRequired: false,
  },
  6: {
    access: 'private',
    title: 'Private - For Staff, Visitors or Customers',
    payAtLocation: false,
    membershipRequired: false,
    accessKeyRequired: false,
  },
  7: {
    access: 'public',
    title: 'Public - Notice Required',
    payAtLocation: false,
    membershipRequired: false,
    accessKeyRequired: false,
  },
};

// Clasifica un UsageTypeID de OCM en `usageRestrictions`. Un POI sin UsageTypeID
// (o con uno desconocido) cae al ID 0 -> el campo SIEMPRE se emite, nunca undefined.
function classifyUsageType(usageTypeId) {
  const key = Number(usageTypeId);
  const entry = Number.isInteger(key) && OCM_USAGE_TYPES[key] ? OCM_USAGE_TYPES[key] : OCM_USAGE_TYPES[0];
  return { ...entry };
}

function normalizeConnectorType(connectionTypeId) {
  const key = Number(connectionTypeId);
  return OCM_TO_OCPI_CONNECTOR[key] || 'UNKNOWN';
}

function normalizeConnectors(connectionTypes) {
  if (!Array.isArray(connectionTypes)) {
    return [];
  }
  return connectionTypes
    .map((conn) => ({
      type: normalizeConnectorType(conn.ConnectionTypeID),
      format: null,
      mode: null,
      maxPowerKw: Number.isFinite(Number(conn.PowerKW)) ? Number(conn.PowerKW) : null,
      voltageV: Number.isFinite(Number(conn.Voltage)) ? Number(conn.Voltage) : null,
      maxCurrentA: Number.isFinite(Number(conn.Amps)) ? Number(conn.Amps) : null,
      typeKey: String(conn.ConnectionTypeID),
    }))
    .filter(
      (conn) => conn.typeKey !== 'undefined' && conn.typeKey !== 'null' && conn.typeKey !== '',
    );
}

function normalizeStatus(statusTypeId) {
  return OCM_STATUS_TO_OCPI[statusTypeId] || 'UNKNOWN';
}

const CURRENCY_SYMBOLS = {
  '€': 'EUR',
  EUR: 'EUR',
  '$': 'USD',
  USD: 'USD',
};

// Extrae `10` de `0,45€/kWh`, `0.35 EUR per kWh`, `5€/up to 60min`, `2 €/h`.
// Devuelve el valor numérico con `.` decimal.
function extractAmount(text) {
  const m = text.match(/\d+(?:[.,]\d+)?/);
  if (!m) {
    return null;
  }
  return Number(m[0].replace(',', '.'));
}

// Lee el símbolo/abreviatura de moneda que precede (o rodea) a la cantidad.
function detectCurrency(text) {
  const normalized = text.toUpperCase();
  if (/€|EUR/.test(normalized)) {
    return 'EUR';
  }
  if (/\$|USD/.test(normalized)) {
    return 'USD';
  }
  return undefined;
}

// Unitario por energía: `<amount><currency>/kWh|MWh|per kWh` -> ENERGY.
function isEnergyUnit(text) {
  return /\/(kWh|MWh)\b/i.test(text) || /per\s+(kWh|MWh)\b/i.test(text);
}

// Unitario por tiempo/servicio -> FLAT (sesión) o TIME (por tiempo).
function detectFlatOrTime(text) {
  if (/session|sesión|sesion|visit|uso|use|charge/i.test(text) && !/\/(kWh|MWh)/.test(text)) {
    return 'FLAT';
  }
  if (/\/(hr|hour|h|min|minute|hora)/i.test(text) || /per\s+(hr|hour|h|min|minute|hora|hour)/i.test(text)) {
    return 'TIME';
  }
  return null;
}

// OCM distingue tarifas por corriente de carga en el mismo texto libre de UsageCost
// ("0,50€/kWh DC - 0,45€/kWh AC"). Se conserva como restriction del componente para que la
// API pueda asociar el coste al conector que le corresponde (AC vs DC).
function detectCurrentType(text) {
  if (/\bDC\b/i.test(text)) {
    return 'DC';
  }
  if (/\bAC\b/i.test(text)) {
    return 'AC';
  }
  return undefined;
}

function parseUsageSegment(segment) {
  const text = segment.trim();
  const amount = extractAmount(text);
  if (amount === null) {
    return null;
  }
  const currency = detectCurrency(text) || 'EUR'; // OCM España mayoritariamente EUR

  const energy = isEnergyUnit(text);
  const type = energy
    ? 'ENERGY'
    : detectFlatOrTime(text) || (text.includes('/') ? 'FLAT' : undefined);

  if (!type) {
    // Sin unidad clara -> solo se emite si hay precio, como FLAT genérico de sesión.
    return { type: 'FLAT', price: amount, currency };
  }

  const currentType = detectCurrentType(text);
  const component = { type, price: amount, currency };
  if (currentType) {
    component.restrictions = { currentType };
  }
  return component;
}

// Un UsageCost puede traer varias tarifas separadas por guiones ("0,50€/kWh DC - 0,45€/kWh AC").
function parseUsageCost(usageCost) {
  if (!usageCost || typeof usageCost !== 'string') {
    return [];
  }
  const text = usageCost.trim();
  if (!text || /gratis|free|variado|varius|please contact|contact/i.test(text)) {
    return [];
  }

  const components = [];
  for (const segment of text.split(/\s+[-–]\s+/)) {
    const component = parseUsageSegment(segment);
    if (
      component &&
      !components.some(
        (existing) =>
          existing.type === component.type &&
          existing.price === component.price &&
          existing.currency === component.currency &&
          JSON.stringify(existing.restrictions) === JSON.stringify(component.restrictions),
      )
    ) {
      components.push(component);
    }
  }

  return components;
}

function normalizeAvailability(poi) {
  const status = normalizeStatus(poi.StatusTypeID);
  return status === 'UNKNOWN' ? undefined : { status, evseCount: poi.NumberOfPoints };
}

function normalizePoi(poi) {
  const addressInfo = poi.AddressInfo || {};
  const operatorInfo = poi.OperatorInfo || {};
  const connections = poi.Connections || poi.ConnectionTypes || [];

  const lat = Number(addressInfo.Latitude);
  const lon = Number(addressInfo.Longitude);

  const availability = normalizeAvailability(poi);

  const station = {
    source: 'ocm',
    country: 'ES',
    sourceStationId: `ocm-${poi.ID}`,
    name: addressInfo.Title?.trim() || 'Desconocido',
    address: addressInfo.AddressLine1?.trim() || '',
    municipality: addressInfo.Town?.trim() || '',
    province: addressInfo.StateOrProvince?.trim() || '',
    postalCode: addressInfo.Postcode?.trim() || undefined,
    location:
      Number.isFinite(lat) && Number.isFinite(lon)
        ? { type: 'Point', coordinates: [lon, lat] }
        : undefined,
    connectorTypeKeys: connections.map((conn) => String(conn.ConnectionTypeID)),
    connectors: normalizeConnectors(connections),
    operator: operatorInfo.Title
      ? {
          name: operatorInfo.Title,
          website: operatorInfo.WebsiteURL?.trim() || undefined,
        }
      : undefined,
    status: normalizeStatus(poi.StatusTypeID),
    services: ['ev_charging'],
    // OCM ya no escribe uso en `typeOfSite` (esa clave es semántica de dgtEv en el
    // contrato Station compartido). El acceso OCM vive en `usageRestrictions`.
    typeOfSite: undefined,
    usageRestrictions: classifyUsageType(poi.UsageTypeID),
    lastUpdated: new Date(),
  };

  const prices = parseUsageCost(poi.UsageCost);
  if (prices.length > 0) {
    station.prices = prices;
  }
  if (availability) {
    station.availability = availability;
  }
  if (Array.isArray(poi.UserComments) && poi.UserComments.length > 0) {
    station.comments = poi.UserComments.map((c) => c.CommentText || c.Comment).filter(Boolean);
  }

  return station;
}

module.exports = {
  normalizePoi,
  parseUsageCost,
  normalizeConnectors,
  normalizeConnectorType,
  normalizeStatus,
  classifyUsageType,
  OCM_TO_OCPI_CONNECTOR,
  OCM_STATUS_TO_OCPI,
  OCM_USAGE_TYPES,
};
