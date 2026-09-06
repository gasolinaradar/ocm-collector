const OCM_TO_OCPI_CONNECTOR = {
  27: 'IEC_62196_T2', // Schuko / Type 2
  28: 'IEC_62196_T2', // Type 2
  30: 'IEC_62196_T2_DC', // CCS/COMBO
  31: 'IEC_62196_T2_DC', // CCS/COMBO
  32: 'CHADEMO', // CHAdeMO
  33: 'CHADEMO', // CHAdeMO
  1: 'IEC_60309_2_PIN', // CEE 3-pin
  2: 'IEC_60309_2_PIN', // CEE 5-pin
  23: 'TESLA', // Tesla
  26: 'IEC_62196_T1', // J1772
  10: 'IEC_62196_T3', // Scame (CEE)
  24: 'GBT_20234', // GB/T
};

const OCM_STATUS_TO_OCPI = {
  10: 'AVAILABLE',
  50: 'AVAILABLE',
  20: 'UNKNOWN',
  150: 'UNKNOWN',
  75: 'OUTOFORDER',
};

// Uso (UsageTypeID) -> tipo de estación. La mayoría de los POIs de OCM son públicos
// (UsageTypeID 1 'Public'). Membership y private se mantienen para señalizar accesibilidad.
const OCM_USAGE_TO_SITE = {
  1: 'public',
  2: 'private',
  3: 'private',
  4: 'public', // Public - Membership Required: sigue siendo accesible públicamente
  5: 'private',
  6: 'public', // Public - Notice Required
};

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

// Parse sostenido del texto libre de OCM `UsageCost` a componentes de precio OCPI.
// Devuelve `[]` cuando no se puede extraer un precio numérico (gratis, variado, desconocido).
function parseUsageCost(usageCost) {
  if (!usageCost || typeof usageCost !== 'string') {
    return [];
  }
  const text = usageCost.trim();
  if (!text || /gratis|free|variado|varius|please contact|contact/i.test(text)) {
    return [];
  }

  const amount = extractAmount(text);
  if (amount === null) {
    return [];
  }
  const currency = detectCurrency(text) || 'EUR'; // OCM España mayoritariamente EUR

  const energy = isEnergyUnit(text);
  const flatType = energy
    ? 'ENERGY'
    : detectFlatOrTime(text) || (text.includes('/') ? 'FLAT' : undefined);

  if (!flatType) {
    // Sin unidad clara -> solo se emite si hay precio, como FLAT genérico de sesión.
    return [{ type: 'FLAT', price: amount, currency }];
  }

  return [{ type: flatType, price: amount, currency }];
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
    typeOfSite: OCM_USAGE_TO_SITE[poi.UsageTypeID],
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
  OCM_TO_OCPI_CONNECTOR,
  OCM_STATUS_TO_OCPI,
};
