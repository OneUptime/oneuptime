import DataCategory, { isDataCategory } from "./DataCategory";

/*
 * A DATA SECURITY RULE DRAFTED FROM A SENTENCE (#10378).
 *
 * "EU personal data must stay in the EU", "the payments team owns every
 * payments- store", "label every store with card numbers PCI": one of three
 * kinds of rule a person writes in Settings, drafted by OneUptime AI from
 * the person's own words (Server/Utils/AI/DataSecurity/RuleFromSentence) -
 * so the model in the conversation never chooses the kind before the
 * person sees what the sentence became - and shown with the stores it
 * matches today before anything is saved:
 *
 *   residency  which kinds of personal data, about people of which
 *              countries, may be kept only in which cloud regions
 *              (DataSecurityResidencyRule); a store that breaks it gets an
 *              issue at the next check
 *   owner      who owns every store a store's name, description, cloud
 *              tags or labels match (DataStoreOwnerRule)
 *   label      which labels every such store gets (DataStoreLabelRule)
 *
 * The draft names people, teams and labels by name: OneUptime finds them
 * in the project as the person may read it, after the draft. Pure.
 */

export enum DataSecurityRuleKind {
  Residency = "residency",
  Owner = "owner",
  Label = "label",
}

export const ALL_DATA_SECURITY_RULE_KINDS: ReadonlyArray<DataSecurityRuleKind> =
  [
    DataSecurityRuleKind.Residency,
    DataSecurityRuleKind.Owner,
    DataSecurityRuleKind.Label,
  ];

export interface DataSecurityRuleDraft {
  kind: DataSecurityRuleKind;
  name: string;
  description: string;
  // Residency: the kinds of personal data it covers; none for every personal kind.
  dataCategories: Array<DataCategory>;
  // Residency: the countries (ISO 3166-1 alpha-2) of the people it is about; none for anyone.
  subjectCountries: Array<string>;
  // Residency: where the data may be kept, as each cloud names its regions; * matches any characters.
  allowedRegions: Array<string>;
  // Owner and label: what of a store they match, every one given (an empty one matches every store).
  nameRegexPattern: string;
  descriptionRegexPattern: string;
  cloudTagPattern: string;
  matchLabels: Array<string>;
  // Owner: members (by name or email) and teams (by name).
  owners: Array<string>;
  // Label: the labels each store it matches gets, by name.
  labelsToAdd: Array<string>;
}

// The limits a draft is held to, as the rules' own forms hold them.
export const MAX_RULE_NAME_LENGTH: number = 100;
export const MAX_RULE_DESCRIPTION_LENGTH: number = 500;
export const MAX_RULE_PATTERN_LENGTH: number = 300;
export const MAX_RULE_LIST_ITEMS: number = 20;
export const MAX_RULE_REGIONS: number = 100;

// A cloud region as a residency rule names it: lower case, * for any characters.
const REGION_PATTERN: RegExp = /^[a-z0-9*][a-z0-9*-]{0,63}$/;
// A country, ISO 3166-1 alpha-2.
const COUNTRY_PATTERN: RegExp = /^[A-Z]{2}$/;

export function isDataSecurityRuleKind(
  value: unknown,
): value is DataSecurityRuleKind {
  return (ALL_DATA_SECURITY_RULE_KINDS as ReadonlyArray<unknown>).includes(
    value,
  );
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function readList(value: unknown, maxItemLength: number): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: Array<string> = [];

  for (const item of value) {
    const text: string = readText(item, maxItemLength);

    if (text && !items.includes(text)) {
      items.push(text);
    }

    if (items.length >= MAX_RULE_LIST_ITEMS) {
      break;
    }
  }

  return items;
}

/*
 * A draft as a call hands it - the draft tool's answer, passed back to
 * save it - read field by field: every text held to its length, every
 * list to its items, a region lower-cased, a country upper-cased, a data
 * category only when it is one. What is not this shape reads as empty;
 * whether the draft is a rule is getDataSecurityRuleDraftProblem's to say.
 */
export function readDataSecurityRuleDraft(
  value: unknown,
): DataSecurityRuleDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const fields: Record<string, unknown> = value as Record<string, unknown>;
  const kind: unknown =
    typeof fields["kind"] === "string"
      ? fields["kind"].trim().toLowerCase()
      : fields["kind"];

  if (!isDataSecurityRuleKind(kind)) {
    return null;
  }

  return {
    kind,
    name: readText(fields["name"], MAX_RULE_NAME_LENGTH),
    description: readText(fields["description"], MAX_RULE_DESCRIPTION_LENGTH),
    dataCategories: readList(fields["dataCategories"], 100).filter(
      (category: string): category is DataCategory => {
        return isDataCategory(category);
      },
    ),
    subjectCountries: readList(fields["subjectCountries"], 2).map(
      (country: string): string => {
        return country.toUpperCase();
      },
    ),
    allowedRegions: readList(fields["allowedRegions"], 64)
      .map((region: string): string => {
        return region.toLowerCase().replace(/\s+/g, "");
      })
      .slice(0, MAX_RULE_REGIONS),
    nameRegexPattern: readText(fields["nameRegexPattern"], MAX_RULE_PATTERN_LENGTH),
    descriptionRegexPattern: readText(
      fields["descriptionRegexPattern"],
      MAX_RULE_PATTERN_LENGTH,
    ),
    cloudTagPattern: readText(fields["cloudTagPattern"], MAX_RULE_PATTERN_LENGTH),
    matchLabels: readList(fields["matchLabels"], 100),
    owners: readList(fields["owners"], 200),
    labelsToAdd: readList(fields["labelsToAdd"], 100),
  };
}

/*
 * Why a draft is no rule a person could save, in a sentence; null when it
 * is one. Patterns are checked where they run (the server), names where
 * the project's people and labels are (RuleFromSentence and the save).
 */
export function getDataSecurityRuleDraftProblem(
  draft: DataSecurityRuleDraft,
): string | null {
  if (!draft.name) {
    return "A rule needs a name.";
  }

  if (draft.kind === DataSecurityRuleKind.Residency) {
    if (draft.allowedRegions.length === 0) {
      return "A residency rule names at least one region the data may be kept in.";
    }

    const notARegion: string | undefined = draft.allowedRegions.find(
      (region: string): boolean => {
        return !REGION_PATTERN.test(region);
      },
    );

    if (notARegion) {
      return `${JSON.stringify(notARegion)} is not a region. Regions are written as a cloud names them, such as eu-west-1, europe-west4 or westeurope; * matches any characters.`;
    }

    const notACountry: string | undefined = draft.subjectCountries.find(
      (country: string): boolean => {
        return !COUNTRY_PATTERN.test(country);
      },
    );

    if (notACountry) {
      return `${JSON.stringify(notACountry)} is not a country's two-letter code, such as DE or FR.`;
    }

    return null;
  }

  if (draft.kind === DataSecurityRuleKind.Owner && draft.owners.length === 0) {
    return "An owner rule names at least one member or team who owns the stores it matches.";
  }

  if (
    draft.kind === DataSecurityRuleKind.Label &&
    draft.labelsToAdd.length === 0
  ) {
    return "A label rule names at least one label the stores it matches get.";
  }

  return null;
}

// Whether a draft of an owner or label rule matches every store: it names no condition.
export function isDraftForEveryStore(draft: DataSecurityRuleDraft): boolean {
  return (
    !draft.nameRegexPattern &&
    !draft.descriptionRegexPattern &&
    !draft.cloudTagPattern &&
    draft.matchLabels.length === 0
  );
}
