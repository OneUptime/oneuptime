/*
 * WHICH COUNTRY A CLOUD REGION KEEPS ITS DATA IN (#10375).
 *
 * The record of processing says where each store's data goes (GDPR Article
 * 30(1)(e)): a store whose data is about people in Germany, kept in AWS
 * us-east-1, is a transfer to the United States. A cloud names a region
 * its own way - "eu-central-1" (AWS), "germanywestcentral" (Azure),
 * "europe-west3" (Google Cloud) - so each is read here to the country its
 * data centres are in, by ISO 3166-1 alpha-2.
 *
 * A multi-region location (Google Cloud's "EU", "US") keeps its data in
 * several countries of one area: the EU's are all in the European Economic
 * Area, so data there never leaves it, though which country holds it is
 * not known. A region this list does not know is not guessed: its country
 * is unknown, and the record says so.
 *
 * Pure, for the server and the Dashboard alike.
 */

// Where a region keeps its data.
export interface CloudRegionLocation {
  // The region as the store's cloud names it, in lower case.
  region: string;
  // The country, ISO 3166-1 alpha-2; null for a multi-region location.
  country: string | null;
  // Whether every country it keeps data in is in the European Economic Area.
  isInEea: boolean;
}

/*
 * The European Economic Area: the 27 EU states with Iceland, Liechtenstein
 * and Norway. Personal data moves freely between them, so GDPR's Chapter V
 * transfer rules start at its edge.
 */
export const EEA_COUNTRIES: ReadonlyArray<string> = [
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
];

export function isEeaCountry(country: string | null | undefined): boolean {
  return Boolean(country) && EEA_COUNTRIES.includes(country!.toUpperCase());
}

// AWS regions, by their code.
const AWS_REGION_COUNTRIES: Readonly<Record<string, string>> = {
  "us-east-1": "US",
  "us-east-2": "US",
  "us-west-1": "US",
  "us-west-2": "US",
  "us-gov-east-1": "US",
  "us-gov-west-1": "US",
  "ca-central-1": "CA",
  "ca-west-1": "CA",
  "mx-central-1": "MX",
  "sa-east-1": "BR",
  "eu-west-1": "IE",
  "eu-west-2": "GB",
  "eu-west-3": "FR",
  "eu-central-1": "DE",
  "eu-central-2": "CH",
  "eu-north-1": "SE",
  "eu-south-1": "IT",
  "eu-south-2": "ES",
  "il-central-1": "IL",
  "me-central-1": "AE",
  "me-south-1": "BH",
  "af-south-1": "ZA",
  "ap-south-1": "IN",
  "ap-south-2": "IN",
  "ap-east-1": "HK",
  "ap-east-2": "TW",
  "ap-northeast-1": "JP",
  "ap-northeast-2": "KR",
  "ap-northeast-3": "JP",
  "ap-southeast-1": "SG",
  "ap-southeast-2": "AU",
  "ap-southeast-3": "ID",
  "ap-southeast-4": "AU",
  "ap-southeast-5": "MY",
  "ap-southeast-6": "NZ",
  "ap-southeast-7": "TH",
  "cn-north-1": "CN",
  "cn-northwest-1": "CN",
};

// Azure regions, by their name without spaces.
const AZURE_REGION_COUNTRIES: Readonly<Record<string, string>> = {
  eastus: "US",
  eastus2: "US",
  centralus: "US",
  northcentralus: "US",
  southcentralus: "US",
  westcentralus: "US",
  westus: "US",
  westus2: "US",
  westus3: "US",
  canadacentral: "CA",
  canadaeast: "CA",
  mexicocentral: "MX",
  brazilsouth: "BR",
  brazilsoutheast: "BR",
  chilecentral: "CL",
  northeurope: "IE",
  westeurope: "NL",
  uksouth: "GB",
  ukwest: "GB",
  francecentral: "FR",
  francesouth: "FR",
  germanywestcentral: "DE",
  germanynorth: "DE",
  switzerlandnorth: "CH",
  switzerlandwest: "CH",
  norwayeast: "NO",
  norwaywest: "NO",
  swedencentral: "SE",
  swedensouth: "SE",
  polandcentral: "PL",
  italynorth: "IT",
  spaincentral: "ES",
  austriaeast: "AT",
  belgiumcentral: "BE",
  denmarkeast: "DK",
  finlandcentral: "FI",
  greececentral: "GR",
  australiaeast: "AU",
  australiasoutheast: "AU",
  australiacentral: "AU",
  australiacentral2: "AU",
  newzealandnorth: "NZ",
  japaneast: "JP",
  japanwest: "JP",
  koreacentral: "KR",
  koreasouth: "KR",
  southeastasia: "SG",
  eastasia: "HK",
  centralindia: "IN",
  southindia: "IN",
  westindia: "IN",
  jioindiacentral: "IN",
  jioindiawest: "IN",
  indonesiacentral: "ID",
  malaysiawest: "MY",
  taiwannorth: "TW",
  uaenorth: "AE",
  uaecentral: "AE",
  qatarcentral: "QA",
  israelcentral: "IL",
  saudiarabiaeast: "SA",
  southafricanorth: "ZA",
  southafricawest: "ZA",
};

// Google Cloud regions, by their name.
const GCP_REGION_COUNTRIES: Readonly<Record<string, string>> = {
  "us-central1": "US",
  "us-east1": "US",
  "us-east4": "US",
  "us-east5": "US",
  "us-south1": "US",
  "us-west1": "US",
  "us-west2": "US",
  "us-west3": "US",
  "us-west4": "US",
  "northamerica-northeast1": "CA",
  "northamerica-northeast2": "CA",
  "northamerica-south1": "MX",
  "southamerica-east1": "BR",
  "southamerica-west1": "CL",
  "europe-west1": "BE",
  "europe-west2": "GB",
  "europe-west3": "DE",
  "europe-west4": "NL",
  "europe-west6": "CH",
  "europe-west8": "IT",
  "europe-west9": "FR",
  "europe-west10": "DE",
  "europe-west12": "IT",
  "europe-north1": "FI",
  "europe-north2": "SE",
  "europe-central2": "PL",
  "europe-southwest1": "ES",
  "me-west1": "IL",
  "me-central1": "QA",
  "me-central2": "SA",
  "africa-south1": "ZA",
  "asia-east1": "TW",
  "asia-east2": "HK",
  "asia-northeast1": "JP",
  "asia-northeast2": "JP",
  "asia-northeast3": "KR",
  "asia-south1": "IN",
  "asia-south2": "IN",
  "asia-southeast1": "SG",
  "asia-southeast2": "ID",
  "australia-southeast1": "AU",
  "australia-southeast2": "AU",
};

/*
 * Multi-region locations (Google Cloud Storage and BigQuery): an area,
 * not a country. "eu" and "europe" keep data inside the EEA.
 */
const MULTI_REGION_IN_EEA: ReadonlyArray<string> = ["eu", "europe"];
const MULTI_REGION_COUNTRIES: Readonly<Record<string, string>> = {
  us: "US",
};

/*
 * Where a region keeps its data, or null for a region this list does not
 * know - never a guess. An Azure region may be written with spaces or in
 * capitals ("West Europe"), as its portal shows it.
 */
export function getCloudRegionLocation(
  region: string | null | undefined,
): CloudRegionLocation | null {
  const name: string = (region || "").trim().toLowerCase();

  if (!name) {
    return null;
  }

  const compact: string = name.replace(/\s+/g, "");
  const country: string | undefined =
    AWS_REGION_COUNTRIES[name] ||
    GCP_REGION_COUNTRIES[name] ||
    AZURE_REGION_COUNTRIES[compact] ||
    MULTI_REGION_COUNTRIES[name];

  if (country) {
    return { region: name, country, isInEea: isEeaCountry(country) };
  }

  if (MULTI_REGION_IN_EEA.includes(name)) {
    return { region: name, country: null, isInEea: true };
  }

  return null;
}
