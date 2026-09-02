/**
 * Example configuration for changing the search area.
 * Copy the relevant values into search.ts.
 *
 * The last-24-hours filter is automatic and must not be configured here.
 */
export const searchConfigExample = {
  location: {
    // Name used by HelloWork and Meteojob.
    city: "Trappes",
    postalCode: "78190",
    departmentCode: "78",
    // INSEE code of the municipality, available from the INSEE website
    // or in the France Travail search URL.
    inseeCode: "78621",
    radiusKm: 10,
  },

  franceTravail: {
    // Location identifier used by France Travail:
    // /offres/emploi/trappes/v236 -> locationCode = "78621"
    locationCode: "78621",
  },

  apec: {
    // APEC location identifier from the Location field autocomplete.
    // Endpoint : /cms/webservices/autocompletion/lieuautocomplete?q=VILLE
    locationId: "592230",
  },

  glassdoor: {
    // Copy the path after /Emploi/ from the Glassdoor URL.
    locationPath: "trappes-emplois-SRCH_IL.0,7_IC2941075.htm",
    // Glassdoor expects miles: 10 km is approximately 7 miles.
    radiusMiles: 7,
  },

  cadremploi: {
    // Slug used in the URL: city + department.
    locationSlug: "trappes-78",
  },
} as const;
