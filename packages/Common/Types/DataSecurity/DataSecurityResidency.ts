import DataCategory, { isPersonalDataCategory } from "./DataCategory";
import { DataTypeInfo, getBuiltInDataType } from "./DataTypeCatalog";

/*
 * WHERE DATA MAY LIVE, AND WHETHER A STORE KEEPS TO IT.
 *
 * A residency rule names data categories (every kind of personal data when
 * it names none), optionally only data about people in some countries, and
 * the regions that data may be stored or replicated in, written the way
 * clouds name regions with * for any characters: "eu-*" (AWS), "europe-*"
 * (Google Cloud), "westeurope" (Azure). A store breaks the rule when it
 * holds data the rule covers and its region, or a region its data is
 * replicated to, matches none of the allowed ones.
 *
 * Whose data a store holds is read from the data itself: a country-bound
 * data type - a German tax ID, an Indian Aadhaar number, a UK NHS number -
 * says its people are in that country (getSubjectCountries).
 */

export interface ResidencyRuleInput {
  name: string;
  dataCategories: ReadonlyArray<string>;
  subjectCountries: ReadonlyArray<string>;
  allowedRegions: ReadonlyArray<string>;
}

export interface ResidencyStoreInput {
  region?: string | undefined;
  replicationRegions?: ReadonlyArray<string> | undefined;
  dataCategories: ReadonlyArray<DataCategory>;
  subjectCountries: ReadonlyArray<string>;
}

export interface ResidencyViolation {
  ruleName: string;
  region: string;
}

// The countries whose people's data the data types say a store holds.
export function getSubjectCountries(
  dataTypeIds: ReadonlyArray<string>,
): Array<string> {
  const countries: Set<string> = new Set();

  for (const dataTypeId of dataTypeIds) {
    const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);

    if (info?.country) {
      countries.add(info.country);
    }
  }

  return [...countries].sort();
}

/*
 * Whether a region matches a pattern: case-insensitive, * for any run of
 * characters, the whole region (eu-* matches eu-west-1, not us-eu-1).
 */
export function regionMatches(pattern: string, region: string): boolean {
  const wanted: string = pattern.trim().toLowerCase();
  const actual: string = region.trim().toLowerCase();

  if (!wanted || !actual) {
    return false;
  }

  const parts: Array<string> = wanted.split("*");

  if (parts.length === 1) {
    return wanted === actual;
  }

  const first: string = parts[0]!;
  const last: string = parts[parts.length - 1]!;

  if (
    first.length + last.length > actual.length ||
    !actual.startsWith(first) ||
    !actual.endsWith(last)
  ) {
    return false;
  }

  // The middle parts in order, between the fixed start and end.
  let position: number = first.length;
  const end: number = actual.length - last.length;

  for (let index: number = 1; index < parts.length - 1; index++) {
    const part: string = parts[index]!;
    const found: number = actual.indexOf(part, position);

    if (found < 0 || found + part.length > end) {
      return false;
    }

    position = found + part.length;
  }

  return position <= end;
}

export function ruleCoversStore(
  rule: ResidencyRuleInput,
  store: ResidencyStoreInput,
): boolean {
  const coversData: boolean =
    rule.dataCategories.length === 0
      ? store.dataCategories.some((category: DataCategory) => {
          return isPersonalDataCategory(category);
        })
      : store.dataCategories.some((category: DataCategory) => {
          return rule.dataCategories.includes(category);
        });

  if (!coversData) {
    return false;
  }

  if (rule.subjectCountries.length === 0) {
    return true;
  }

  return store.subjectCountries.some((country: string) => {
    return rule.subjectCountries.includes(country);
  });
}

export function getResidencyViolations(
  rules: ReadonlyArray<ResidencyRuleInput>,
  store: ResidencyStoreInput,
): Array<ResidencyViolation> {
  const violations: Array<ResidencyViolation> = [];
  const regions: Array<string> = [
    ...(store.region ? [store.region] : []),
    ...(store.replicationRegions || []),
  ];

  for (const rule of rules) {
    if (rule.allowedRegions.length === 0 || !ruleCoversStore(rule, store)) {
      continue;
    }

    for (const region of regions) {
      const allowed: boolean = rule.allowedRegions.some((pattern: string) => {
        return regionMatches(pattern, region);
      });

      if (!allowed) {
        violations.push({ ruleName: rule.name, region });
      }
    }
  }

  return violations;
}
