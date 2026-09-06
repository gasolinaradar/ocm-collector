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

function normalizePoi(poi) {
  const addressInfo = poi.AddressInfo || {};
  const operatorInfo = poi.OperatorInfo || {};

  const lat = Number(addressInfo.Latitude);
  const lon = Number(addressInfo.Longitude);

  return {
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
    connectorTypeKeys: (poi.ConnectionTypes || []).map((conn) => String(conn.ConnectionTypeID)),
    connectors: normalizeConnectors(poi.ConnectionTypes),
    operator: operatorInfo.Title
      ? {
          name: operatorInfo.Title,
          website: operatorInfo.WebsiteURL?.trim() || undefined,
        }
      : undefined,
    status: normalizeStatus(poi.StatusTypeID),
    services: ['ev_charging'],
    typeOfSite: undefined,
    lastUpdated: new Date(),
  };
}

module.exports = {
  normalizePoi,
  normalizeConnectors,
  normalizeConnectorType,
  normalizeStatus,
  OCM_TO_OCPI_CONNECTOR,
  OCM_STATUS_TO_OCPI,
};