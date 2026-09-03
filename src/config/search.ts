type FranceTravailRadiusKm = 5 | 10 | 20 | 30 | 40 | 50 | 100;

export const searchConfig = {
    history: {
        enabled: true,
        directoryName: "results",
    },
    scrapers: {
        enabled: {
            franceTravail: true,
            meteojob: true,
            hellowork: true,
            glassdoor: false,
            cadremploi: false,
            apec: false,
            jobijoba: false,
        },
    },
    location: {
        city: "Coignières",
        postalCode: "78310",
        departmentCode: "78",
        inseeCode: "78168",
        radiusKm: 15,
    },
    filters: {
        excludedBroadLocations: ["Île-de-France"],
        excludedContracts: ["Alternance", "Stage"],
    },
    franceTravail: {
        locationCode: "78168",
        radiusKm: 20 as FranceTravailRadiusKm,
        api: {
            enabled: true,
        },
    },
    apec: {
        locationId: "592050",
    },
    glassdoor: {
        locationPath: "coignieres-emplois-SRCH_IL.0,10.htm",
        radiusMiles: 15,
    },
    cadremploi: {
        locationSlug: "coignieres-78",
    },
    jobijoba: {
        radiusKm: 15,
    },
} as const;
