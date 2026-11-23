import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { JSONObject, JSONValue } from "../JSON";
import { translationKey } from "../Translator";
import {
  CloudRegionLocation,
  getCloudRegionLocation,
  isEeaCountry,
} from "./CloudRegionCountry";
import {
  ComplianceFact,
  getFactsHash,
  readComplianceFacts,
} from "./ComplianceFacts";
import { toStableJsonText } from "./DataSecurityAi";

/*
 * THE RECORD OF PROCESSING, COMPLETED (#10375).
 *
 * GDPR Article 30 asks, for each processing activity, why it holds personal
 * data, the categories of people it is about, its recipients, its transfers
 * to other countries and how long it keeps the data. Data Security wrote
 * the part of the record its scans can know - what each store holds,
 * where, who owns it - and left the rest to be typed by hand, so the
 * record was never complete. Now a store's record has four fields people
 * answer for, and two worked out by plain code:
 *
 *   - Purpose, Retention, Legal basis (one of Article 6's six) and People
 *     it is about (customers, employees, patients...) are drafted by
 *     OneUptime AI from the facts the scans know (ComplianceFacts), each
 *     marked Drafted until a person confirms it. A telemetry store's
 *     retention is not drafted: it is the retention set for its records,
 *     filled in by plain code, as are the stores OneUptime declares
 *     (#10398);
 *   - Recipients and Transfers are worked out from the store's flows and
 *     regions (getRecordRecipients, getRecordTransfers), never drafted.
 *
 * DRAFTS NEVER OVERWRITE A PERSON. The store's columns (purpose, retention,
 * legalBasis, dataSubjects) hold only what a person wrote or confirmed;
 * OneUptime AI's drafts are kept beside them (DataStore.recordDrafts), so a
 * draft can never pass for a person's words, and no draft lands on them:
 *
 *   - a field a person wrote is never redrafted;
 *   - a confirmed draft is redrafted only when a fact it rests on changed,
 *     and the new draft is proposed beside it, for a person to take or
 *     leave (getRecordFieldDraftAction);
 *   - only a person's press puts a draft into the record.
 *
 * Not legal advice: the drafts are a starting point for whoever answers
 * for the project's compliance, and the pages say so once.
 *
 * Pure, for the server and the Dashboard alike.
 */

/*
 * GDPR Article 6(1)'s lawful bases. Stored on DataStore.legalBasis and
 * sent by the API: never rename one.
 */
export enum RecordLegalBasis {
  Consent = "Consent",
  Contract = "Contract",
  LegalObligation = "Legal obligation",
  VitalInterests = "Vital interests",
  PublicTask = "Public task",
  LegitimateInterests = "Legitimate interests",
}

export const RECORD_LEGAL_BASES: ReadonlyArray<RecordLegalBasis> = [
  RecordLegalBasis.Consent,
  RecordLegalBasis.Contract,
  RecordLegalBasis.LegalObligation,
  RecordLegalBasis.VitalInterests,
  RecordLegalBasis.PublicTask,
  RecordLegalBasis.LegitimateInterests,
];

export function isRecordLegalBasis(value: unknown): value is RecordLegalBasis {
  return (
    typeof value === "string" &&
    (RECORD_LEGAL_BASES as ReadonlyArray<string>).includes(value)
  );
}

export interface RecordLegalBasisInfo {
  basis: RecordLegalBasis;
  // Its point of Article 6(1), as the record cites it.
  article: string;
  // What it means, in a sentence.
  description: string;
}

export const RECORD_LEGAL_BASIS_INFO: Readonly<
  Record<RecordLegalBasis, RecordLegalBasisInfo>
> = {
  [RecordLegalBasis.Consent]: {
    basis: RecordLegalBasis.Consent,
    article: "Art. 6(1)(a)",
    description: translationKey(
      "The people it is about agreed to it, for this purpose.",
    ),
  },
  [RecordLegalBasis.Contract]: {
    basis: RecordLegalBasis.Contract,
    article: "Art. 6(1)(b)",
    description: translationKey(
      "It is needed for a contract with them, or to take a step they asked for before one.",
    ),
  },
  [RecordLegalBasis.LegalObligation]: {
    basis: RecordLegalBasis.LegalObligation,
    article: "Art. 6(1)(c)",
    description: translationKey(
      "A law the organization must follow requires it.",
    ),
  },
  [RecordLegalBasis.VitalInterests]: {
    basis: RecordLegalBasis.VitalInterests,
    article: "Art. 6(1)(d)",
    description: translationKey("It protects someone's life."),
  },
  [RecordLegalBasis.PublicTask]: {
    basis: RecordLegalBasis.PublicTask,
    article: "Art. 6(1)(e)",
    description: translationKey(
      "It is needed for a task in the public interest, or official authority.",
    ),
  },
  [RecordLegalBasis.LegitimateInterests]: {
    basis: RecordLegalBasis.LegitimateInterests,
    article: "Art. 6(1)(f)",
    description: translationKey(
      "It is needed for the organization's legitimate interests, which outweigh the people's own.",
    ),
  },
};

// Each basis's name as the Dashboard draws it: a key the reader's language words.
export const RECORD_LEGAL_BASIS_TITLES: Readonly<
  Record<RecordLegalBasis, string>
> = {
  [RecordLegalBasis.Consent]: translationKey("Consent"),
  [RecordLegalBasis.Contract]: translationKey("Contract"),
  [RecordLegalBasis.LegalObligation]: translationKey("Legal obligation"),
  [RecordLegalBasis.VitalInterests]: translationKey("Vital interests"),
  [RecordLegalBasis.PublicTask]: translationKey("Public task"),
  [RecordLegalBasis.LegitimateInterests]: translationKey(
    "Legitimate interests",
  ),
};

/*
 * The categories of people a store's data is about (Article 30(1)(c)).
 * Stored on DataStore.dataSubjects and sent by the API: never rename one.
 */
export enum RecordPeople {
  Customers = "Customers",
  Users = "Users",
  Prospects = "Prospects",
  WebsiteVisitors = "Website visitors",
  Employees = "Employees",
  JobApplicants = "Job applicants",
  Contractors = "Contractors",
  BusinessContacts = "Business contacts",
  Patients = "Patients",
  Students = "Students",
  Children = "Children",
  Public = "Members of the public",
}

export const RECORD_PEOPLE: ReadonlyArray<RecordPeople> = [
  RecordPeople.Customers,
  RecordPeople.Users,
  RecordPeople.Prospects,
  RecordPeople.WebsiteVisitors,
  RecordPeople.Employees,
  RecordPeople.JobApplicants,
  RecordPeople.Contractors,
  RecordPeople.BusinessContacts,
  RecordPeople.Patients,
  RecordPeople.Students,
  RecordPeople.Children,
  RecordPeople.Public,
];

export function isRecordPeople(value: unknown): value is RecordPeople {
  return (
    typeof value === "string" &&
    (RECORD_PEOPLE as ReadonlyArray<string>).includes(value)
  );
}

// Each category's name as the Dashboard draws it.
export const RECORD_PEOPLE_TITLES: Readonly<Record<RecordPeople, string>> = {
  [RecordPeople.Customers]: translationKey("Customers"),
  [RecordPeople.Users]: translationKey("Users"),
  [RecordPeople.Prospects]: translationKey("Prospects"),
  [RecordPeople.WebsiteVisitors]: translationKey("Website visitors"),
  [RecordPeople.Employees]: translationKey("Employees"),
  [RecordPeople.JobApplicants]: translationKey("Job applicants"),
  [RecordPeople.Contractors]: translationKey("Contractors"),
  [RecordPeople.BusinessContacts]: translationKey("Business contacts"),
  [RecordPeople.Patients]: translationKey("Patients"),
  [RecordPeople.Students]: translationKey("Students"),
  [RecordPeople.Children]: translationKey("Children"),
  [RecordPeople.Public]: translationKey("Members of the public"),
};

// Who each category is, for OneUptime AI and the picker's hint.
export const RECORD_PEOPLE_DESCRIPTIONS: Readonly<Record<RecordPeople, string>> =
  {
    [RecordPeople.Customers]: "People who buy from the organization.",
    [RecordPeople.Users]: "People who use its product or service.",
    [RecordPeople.Prospects]: "Leads and people it markets to.",
    [RecordPeople.WebsiteVisitors]: "People who visit its websites.",
    [RecordPeople.Employees]: "Its staff, past and present.",
    [RecordPeople.JobApplicants]: "People who apply to work there.",
    [RecordPeople.Contractors]: "Freelancers and contractors who work for it.",
    [RecordPeople.BusinessContacts]:
      "People at its suppliers, partners and business customers.",
    [RecordPeople.Patients]: "People it gives care or health services to.",
    [RecordPeople.Students]: "People it teaches.",
    [RecordPeople.Children]: "People under 16.",
    [RecordPeople.Public]: "Anyone else.",
  };

// The fields of a store's record people answer for: each named by its DataStore column.
export enum RecordField {
  Purpose = "purpose",
  Retention = "retention",
  LegalBasis = "legalBasis",
  People = "dataSubjects",
}

// In the order the record and the walk-through read them.
export const RECORD_FIELDS: ReadonlyArray<RecordField> = [
  RecordField.Purpose,
  RecordField.Retention,
  RecordField.LegalBasis,
  RecordField.People,
];

export function isRecordField(value: unknown): value is RecordField {
  return (
    typeof value === "string" &&
    (RECORD_FIELDS as ReadonlyArray<string>).includes(value)
  );
}

export const RECORD_FIELD_TITLES: Readonly<Record<RecordField, string>> = {
  [RecordField.Purpose]: translationKey("Purpose"),
  [RecordField.Retention]: translationKey("Retention"),
  [RecordField.LegalBasis]: translationKey("Legal Basis"),
  [RecordField.People]: translationKey("People It Is About"),
};

// The longest each text field takes: its column's length.
export const RECORD_PURPOSE_MAX_LENGTH: number = 500;
export const RECORD_RETENTION_MAX_LENGTH: number = 100;

/*
 * Where a field of a store's record stands. Read from the store's column
 * and its drafts (getRecordFieldStatus); sent by the API: never rename one.
 */
export enum RecordFieldStatus {
  // Nothing yet: no person wrote it, and no draft is waiting.
  Empty = "Empty",
  // OneUptime AI's draft, waiting for a person.
  Drafted = "Drafted",
  // A person confirmed OneUptime AI's draft.
  Confirmed = "Confirmed",
  /*
   * A confirmed draft, a fact it rests on has changed since, and OneUptime
   * AI's new draft waits beside it for a person to take or leave.
   */
  ChangeProposed = "ChangeProposed",
  // A person's own words: never redrafted.
  Written = "Written",
  /*
   * Worked out by plain code: a telemetry store's retention, and what
   * OneUptime declares of the stores it keeps for the project's security.
   */
  FilledIn = "FilledIn",
}

export const RECORD_FIELD_STATUS_TITLES: Readonly<
  Record<RecordFieldStatus, string>
> = {
  [RecordFieldStatus.Empty]: translationKey("Empty"),
  [RecordFieldStatus.Drafted]: translationKey("Drafted by OneUptime AI"),
  [RecordFieldStatus.Confirmed]: translationKey("Confirmed"),
  [RecordFieldStatus.ChangeProposed]: translationKey("Change proposed"),
  [RecordFieldStatus.Written]: translationKey("Written by your team"),
  [RecordFieldStatus.FilledIn]: translationKey("Filled in by OneUptime"),
};

/*
 * ---------------------------------------------------------------------------
 * A field's value
 * ---------------------------------------------------------------------------
 */

// What a field holds: a sentence, a legal basis, or the people it is about.
export type RecordFieldValue = string | Array<RecordPeople>;

/*
 * A field's value as the store's column holds it, read: "" or [] for none.
 * A legal basis no build of OneUptime wrote, and a category of people it
 * does not know, read as none.
 */
export function readRecordFieldValue(
  field: RecordField,
  value: unknown,
): RecordFieldValue {
  if (field === RecordField.People) {
    return Array.isArray(value)
      ? RECORD_PEOPLE.filter((category: RecordPeople): boolean => {
          return value.includes(category);
        })
      : [];
  }

  if (field === RecordField.LegalBasis) {
    return isRecordLegalBasis(value) ? value : "";
  }

  return typeof value === "string" ? value.trim() : "";
}

export function isRecordFieldValueEmpty(value: RecordFieldValue): boolean {
  return Array.isArray(value) ? value.length === 0 : value.trim().length === 0;
}

/*
 * A value, in sixty-four hex digits: what a confirmation keeps, so a value a
 * person changed after confirming it reads as their own.
 */
export function getRecordValueHash(value: RecordFieldValue): string {
  return sha256Hex(
    toStableJsonText(
      Array.isArray(value)
        ? [...value].sort()
        : value.replace(/\s+/g, " ").trim(),
    ),
  );
}

// A value as one line of English: the record's exports, and a fact OneUptime AI reads.
export function getRecordValueText(value: RecordFieldValue): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

/*
 * ---------------------------------------------------------------------------
 * The drafts a store keeps (DataStore.recordDrafts)
 * ---------------------------------------------------------------------------
 */

export interface RecordFieldDraft {
  value: RecordFieldValue;
  // Why, in one sentence: the drafted legal basis and people say it.
  reason: string;
  // The keys of the facts it rests on.
  factKeys: Array<string>;
  // What those facts said when it was drafted (getFactsHash).
  factsHash: string;
  // ISO 8601.
  draftedAt: string;
  // The language its words are in ("en", "de").
  language: string;
}

export interface RecordFieldConfirmation {
  // The value a person confirmed (getRecordValueHash).
  valueHash: string;
  // The facts the confirmed draft rested on, and what they said then.
  factKeys: Array<string>;
  factsHash: string;
  /*
   * Those facts as they were: what Review Drafts sets beside them when one
   * changed, so a person sees what changed under the value they confirmed.
   */
  facts: Array<ComplianceFact>;
  confirmedAt: string;
  confirmedByUserId?: string | undefined;
}

export interface RecordFieldState {
  // OneUptime AI's draft of a field nobody confirmed or wrote.
  draft?: RecordFieldDraft | undefined;
  // How a person confirmed a draft into the record.
  confirmed?: RecordFieldConfirmation | undefined;
  // A new draft for a confirmed field whose facts changed, waiting beside it.
  proposed?: RecordFieldDraft | undefined;
}

export interface StoreRecordDrafts {
  version: number;
  // The facts the latest drafts were written from.
  facts: Array<ComplianceFact>;
  fields: Partial<Record<RecordField, RecordFieldState>>;
  // What the latest drafts were written from, hashed: a read with the same input asks nothing.
  inputHash?: string | undefined;
  draftedAt?: string | undefined;
}

export const STORE_RECORD_DRAFTS_VERSION: number = 1;

export function emptyStoreRecordDrafts(): StoreRecordDrafts {
  return { version: STORE_RECORD_DRAFTS_VERSION, facts: [], fields: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, maxLength: number = 1000): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function readKeys(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value
        .filter((key: unknown): key is string => {
          return typeof key === "string" && key.length > 0;
        })
        .slice(0, 40)
    : [];
}

function readDraft(
  field: RecordField,
  value: unknown,
): RecordFieldDraft | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const draftValue: RecordFieldValue = readRecordFieldValue(
    field,
    value["value"],
  );

  if (isRecordFieldValueEmpty(draftValue)) {
    return undefined;
  }

  return {
    value: draftValue,
    reason: readText(value["reason"], 600),
    factKeys: readKeys(value["factKeys"]),
    factsHash: readText(value["factsHash"], 64),
    draftedAt: readText(value["draftedAt"], 40),
    language: readText(value["language"], 20) || "en",
  };
}

function readConfirmation(value: unknown): RecordFieldConfirmation | undefined {
  if (!isRecord(value) || typeof value["valueHash"] !== "string") {
    return undefined;
  }

  return {
    valueHash: readText(value["valueHash"], 64),
    factKeys: readKeys(value["factKeys"]),
    factsHash: readText(value["factsHash"], 64),
    facts: readComplianceFacts(value["facts"]),
    confirmedAt: readText(value["confirmedAt"], 40),
    confirmedByUserId: readText(value["confirmedByUserId"], 40) || undefined,
  };
}

// The facts of a list that a draft's keys name.
function factsOf(
  facts: ReadonlyArray<ComplianceFact>,
  keys: ReadonlyArray<string>,
): Array<ComplianceFact> {
  return facts.filter((fact: ComplianceFact): boolean => {
    return keys.includes(fact.key);
  });
}

/*
 * The drafts a store keeps, read: what this build cannot read is left out,
 * never guessed at, and nothing at all reads as no drafts.
 */
export function readStoreRecordDrafts(value: unknown): StoreRecordDrafts {
  if (!isRecord(value)) {
    return emptyStoreRecordDrafts();
  }

  const fields: Partial<Record<RecordField, RecordFieldState>> = {};
  const kept: unknown = value["fields"];

  for (const field of RECORD_FIELDS) {
    const state: unknown = isRecord(kept) ? kept[field] : undefined;

    if (!isRecord(state)) {
      continue;
    }

    const read: RecordFieldState = {
      draft: readDraft(field, state["draft"]),
      confirmed: readConfirmation(state["confirmed"]),
      proposed: readDraft(field, state["proposed"]),
    };

    if (read.draft || read.confirmed || read.proposed) {
      fields[field] = read;
    }
  }

  return {
    version: STORE_RECORD_DRAFTS_VERSION,
    facts: readComplianceFacts(value["facts"]),
    fields,
    inputHash: readText(value["inputHash"], 64) || undefined,
    draftedAt: readText(value["draftedAt"], 40) || undefined,
  };
}

// The drafts as JSON, for the column.
export function toStoreRecordDraftsJson(drafts: StoreRecordDrafts): JSONObject {
  return JSON.parse(JSON.stringify(drafts)) as JSONObject;
}

/*
 * ---------------------------------------------------------------------------
 * Where a field stands, and what OneUptime AI may do with it
 * ---------------------------------------------------------------------------
 */

/*
 * A field's standing, from the store's column, its drafts and whether plain
 * code fills it in:
 *
 *   - a value in the column is a person's: Confirmed when it is the draft
 *     they confirmed (ChangeProposed while a new draft waits beside it),
 *     Written otherwise - a value changed after confirming is theirs too;
 *   - an empty column is filled in by plain code where that applies, else
 *     Drafted while OneUptime AI's draft waits, else Empty.
 */
export function getRecordFieldStatus(data: {
  value: RecordFieldValue;
  state?: RecordFieldState | undefined;
  isFilledIn?: boolean | undefined;
}): RecordFieldStatus {
  if (!isRecordFieldValueEmpty(data.value)) {
    if (
      data.state?.confirmed &&
      data.state.confirmed.valueHash === getRecordValueHash(data.value)
    ) {
      return data.state.proposed
        ? RecordFieldStatus.ChangeProposed
        : RecordFieldStatus.Confirmed;
    }

    return RecordFieldStatus.Written;
  }

  if (data.isFilledIn) {
    return RecordFieldStatus.FilledIn;
  }

  return data.state?.draft
    ? RecordFieldStatus.Drafted
    : RecordFieldStatus.Empty;
}

// What OneUptime AI does with one field when it drafts a store's record.
export enum RecordFieldDraftAction {
  // Draft it: nothing stands there yet, or its draft's facts changed.
  Draft = "Draft",
  // Draft a change beside the confirmed value: a fact it rests on changed.
  Propose = "Propose",
  // Leave it as it is.
  Leave = "Leave",
}

/*
 * What OneUptime AI may do with a field, given the facts it would draft
 * from now. Never anything with a person's words or with what plain code
 * fills in; a draft nobody confirmed is drafted again when what it was
 * drafted from changed; a confirmed one is proposed again only when a fact
 * it rests on changed - and, once proposed, again only when one changed
 * since the proposal. `force` - a person pressed Draft Again - drafts again
 * what no person confirmed, whatever changed.
 */
export function getRecordFieldDraftAction(data: {
  status: RecordFieldStatus;
  state?: RecordFieldState | undefined;
  facts: ReadonlyArray<ComplianceFact>;
  // The input the store's latest drafts were written from, and the one now.
  previousInputHash?: string | undefined;
  inputHash: string;
  force?: boolean | undefined;
}): RecordFieldDraftAction {
  switch (data.status) {
    case RecordFieldStatus.Written:
    case RecordFieldStatus.FilledIn:
      return RecordFieldDraftAction.Leave;
    case RecordFieldStatus.Empty:
      return RecordFieldDraftAction.Draft;
    case RecordFieldStatus.Drafted:
      return data.force || data.previousInputHash !== data.inputHash
        ? RecordFieldDraftAction.Draft
        : RecordFieldDraftAction.Leave;
    case RecordFieldStatus.Confirmed: {
      const confirmed: RecordFieldConfirmation | undefined =
        data.state?.confirmed;

      if (!confirmed) {
        return RecordFieldDraftAction.Leave;
      }

      return getFactsHash({ facts: data.facts, keys: confirmed.factKeys }) !==
        confirmed.factsHash
        ? RecordFieldDraftAction.Propose
        : RecordFieldDraftAction.Leave;
    }
    case RecordFieldStatus.ChangeProposed: {
      const proposed: RecordFieldDraft | undefined = data.state?.proposed;

      if (!proposed) {
        return RecordFieldDraftAction.Leave;
      }

      return getFactsHash({ facts: data.facts, keys: proposed.factKeys }) !==
        proposed.factsHash
        ? RecordFieldDraftAction.Propose
        : RecordFieldDraftAction.Leave;
    }
    default:
      return RecordFieldDraftAction.Leave;
  }
}

/*
 * The keys of the facts a confirmed field rests on whose words changed
 * since it was confirmed: what Review Drafts says changed beside a
 * proposal. A key the facts no longer hold is one of them.
 */
export function getChangedFactKeys(data: {
  previous: ReadonlyArray<ComplianceFact>;
  current: ReadonlyArray<ComplianceFact>;
  keys: ReadonlyArray<string>;
}): Array<string> {
  return data.keys.filter((key: string): boolean => {
    return (
      getFactsHash({ facts: data.previous, keys: [key] }) !==
      getFactsHash({ facts: data.current, keys: [key] })
    );
  });
}

/*
 * ---------------------------------------------------------------------------
 * What a person does with a field
 * ---------------------------------------------------------------------------
 *
 * Each returns the store's new column value, if it changes, and its new
 * drafts - or why it cannot be done, in a sentence a person reads. The
 * server writes both, the column with the person's own permissions.
 */

export enum RecordFieldAction {
  // Put OneUptime AI's draft into the record, as it is.
  Confirm = "Confirm",
  // Put a person's own words into the record.
  Write = "Write",
  // Take the change OneUptime AI proposed for a confirmed field.
  UseProposal = "UseProposal",
  // Keep the confirmed value, and drop the change proposed for it.
  KeepConfirmed = "KeepConfirmed",
}

export function isRecordFieldAction(value: unknown): value is RecordFieldAction {
  return (
    typeof value === "string" &&
    (Object.values(RecordFieldAction) as Array<string>).includes(value)
  );
}

export type RecordFieldActionResult =
  | {
      isDone: true;
      // The column's new value: undefined when it does not change, null to empty it.
      value?: RecordFieldValue | null | undefined;
      drafts: StoreRecordDrafts;
    }
  | { isDone: false; refusal: string };

export const RECORD_DRAFT_GONE_MESSAGE: string = translationKey(
  "This draft changed or was confirmed since you opened it, so nothing was done. Look at the field again.",
);

export const RECORD_NO_PROPOSAL_MESSAGE: string = translationKey(
  "There is no change waiting for this field any more, so nothing was done. Look at the field again.",
);

export const RECORD_VALUE_TOO_LONG_MESSAGE: string = translationKey(
  "This is longer than the record keeps. Shorten it, then save it again.",
);

export const RECORD_VALUE_NOT_ALLOWED_MESSAGE: string = translationKey(
  "Pick one of the listed values, then save it again.",
);

function withField(
  drafts: StoreRecordDrafts,
  field: RecordField,
  state: RecordFieldState | null,
): StoreRecordDrafts {
  const fields: Partial<Record<RecordField, RecordFieldState>> = {
    ...drafts.fields,
  };

  if (state && (state.draft || state.confirmed || state.proposed)) {
    fields[field] = state;
  } else {
    delete fields[field];
  }

  return { ...drafts, fields };
}

/*
 * A value a person wrote, checked: a sentence within its column's length,
 * a legal basis of the six, people of the listed categories. Null to empty
 * the field.
 */
export function readWrittenRecordValue(
  field: RecordField,
  value: unknown,
):
  | { isRead: true; value: RecordFieldValue | null }
  | { isRead: false; refusal: string } {
  if (value === null || value === undefined) {
    return { isRead: true, value: null };
  }

  if (field === RecordField.People) {
    if (
      !Array.isArray(value) ||
      !value.every((item: unknown): boolean => {
        return isRecordPeople(item);
      })
    ) {
      return { isRead: false, refusal: RECORD_VALUE_NOT_ALLOWED_MESSAGE };
    }

    const people: Array<RecordPeople> = readRecordFieldValue(
      field,
      value,
    ) as Array<RecordPeople>;

    return { isRead: true, value: people.length > 0 ? people : null };
  }

  if (typeof value !== "string") {
    return { isRead: false, refusal: RECORD_VALUE_NOT_ALLOWED_MESSAGE };
  }

  const written: string = value.trim();

  if (!written) {
    return { isRead: true, value: null };
  }

  if (field === RecordField.LegalBasis) {
    return isRecordLegalBasis(written)
      ? { isRead: true, value: written }
      : { isRead: false, refusal: RECORD_VALUE_NOT_ALLOWED_MESSAGE };
  }

  const maxLength: number =
    field === RecordField.Purpose
      ? RECORD_PURPOSE_MAX_LENGTH
      : RECORD_RETENTION_MAX_LENGTH;

  return Array.from(written).length > maxLength
    ? { isRead: false, refusal: RECORD_VALUE_TOO_LONG_MESSAGE }
    : { isRead: true, value: written };
}

/*
 * What a person's press does to one field of a store's record:
 *
 *   - Confirm puts the waiting draft into the record - only the draft the
 *     person was shown (its draftedAt), so one drafted again since is not
 *     confirmed unseen - and keeps what it rests on, for a change to be
 *     proposed when one of those facts changes;
 *   - Write puts the person's own words in: never redrafted from then on;
 *   - UseProposal takes the proposed change, as Confirm takes a draft;
 *   - KeepConfirmed keeps the confirmed value and drops the proposal: the
 *     person read the changed facts, so the value now rests on them as they
 *     are, and is proposed again only when they change again.
 */
export function applyRecordFieldAction(data: {
  field: RecordField;
  action: RecordFieldAction;
  value: RecordFieldValue;
  drafts: StoreRecordDrafts;
  // The facts as they are now, for KeepConfirmed.
  facts: ReadonlyArray<ComplianceFact>;
  // The draft the person was shown, by when it was drafted.
  shownDraftedAt?: string | undefined;
  written?: unknown;
  userId?: string | undefined;
  now: Date;
}): RecordFieldActionResult {
  const state: RecordFieldState = data.drafts.fields[data.field] || {};
  const status: RecordFieldStatus = getRecordFieldStatus({
    value: data.value,
    state,
  });

  switch (data.action) {
    case RecordFieldAction.Confirm: {
      const draft: RecordFieldDraft | undefined = state.draft;

      if (
        status !== RecordFieldStatus.Drafted ||
        !draft ||
        (data.shownDraftedAt !== undefined &&
          data.shownDraftedAt !== draft.draftedAt)
      ) {
        return { isDone: false, refusal: RECORD_DRAFT_GONE_MESSAGE };
      }

      return {
        isDone: true,
        value: draft.value,
        drafts: withField(data.drafts, data.field, {
          confirmed: {
            valueHash: getRecordValueHash(draft.value),
            factKeys: draft.factKeys,
            factsHash: draft.factsHash,
            facts: factsOf(data.drafts.facts, draft.factKeys),
            confirmedAt: data.now.toISOString(),
            confirmedByUserId: data.userId,
          },
        }),
      };
    }
    case RecordFieldAction.UseProposal: {
      const proposed: RecordFieldDraft | undefined = state.proposed;

      if (
        status !== RecordFieldStatus.ChangeProposed ||
        !proposed ||
        (data.shownDraftedAt !== undefined &&
          data.shownDraftedAt !== proposed.draftedAt)
      ) {
        return { isDone: false, refusal: RECORD_NO_PROPOSAL_MESSAGE };
      }

      return {
        isDone: true,
        value: proposed.value,
        drafts: withField(data.drafts, data.field, {
          confirmed: {
            valueHash: getRecordValueHash(proposed.value),
            factKeys: proposed.factKeys,
            factsHash: proposed.factsHash,
            facts: factsOf(data.drafts.facts, proposed.factKeys),
            confirmedAt: data.now.toISOString(),
            confirmedByUserId: data.userId,
          },
        }),
      };
    }
    case RecordFieldAction.KeepConfirmed: {
      const confirmed: RecordFieldConfirmation | undefined = state.confirmed;

      if (status !== RecordFieldStatus.ChangeProposed || !confirmed) {
        return { isDone: false, refusal: RECORD_NO_PROPOSAL_MESSAGE };
      }

      return {
        isDone: true,
        drafts: withField(data.drafts, data.field, {
          confirmed: {
            ...confirmed,
            factsHash: getFactsHash({
              facts: data.facts,
              keys: confirmed.factKeys,
            }),
            facts: factsOf(data.facts, confirmed.factKeys),
            confirmedAt: data.now.toISOString(),
            confirmedByUserId: data.userId,
          },
        }),
      };
    }
    case RecordFieldAction.Write: {
      const read:
        | { isRead: true; value: RecordFieldValue | null }
        | { isRead: false; refusal: string } = readWrittenRecordValue(
        data.field,
        data.written,
      );

      if (!read.isRead) {
        return { isDone: false, refusal: read.refusal };
      }

      /*
       * A person's own words: nothing of OneUptime AI's stays beside them.
       * Emptied, the field is left for OneUptime AI to draft again.
       */
      return {
        isDone: true,
        value: read.value,
        drafts: withField(data.drafts, data.field, null),
      };
    }
    default:
      return { isDone: false, refusal: RECORD_VALUE_NOT_ALLOWED_MESSAGE };
  }
}

/*
 * ---------------------------------------------------------------------------
 * Recipients and transfers, by plain code
 * ---------------------------------------------------------------------------
 */

export enum RecordRecipientKind {
  // A host outside the project that a service using the store calls.
  ExternalHost = "ExternalHost",
  // An AI provider the store's data, or a service using it, is sent to.
  AiProvider = "AiProvider",
  // Another store that holds a copy of its data.
  Copy = "Copy",
}

export const RECORD_RECIPIENT_KIND_TITLES: Readonly<
  Record<RecordRecipientKind, string>
> = {
  [RecordRecipientKind.ExternalHost]: translationKey("Outside host"),
  [RecordRecipientKind.AiProvider]: translationKey("AI provider"),
  [RecordRecipientKind.Copy]: translationKey("Copy in another store"),
};

export interface RecordRecipient {
  kind: RecordRecipientKind;
  // The host, the provider, or the other store's name.
  name: string;
  // The services through which it receives the data, by name.
  via: Array<string>;
  // The other store, for a copy.
  dataStoreId?: string | undefined;
}

// What the recipients are worked out from: the store's flows, as Data Flows lists them.
export interface RecordFlowInput {
  // DataSecurityFlows' kinds: Uses, External Host, AI Provider, Copy.
  kind: string;
  sourceDataStoreId?: string | undefined;
  destinationDataStoreId?: string | undefined;
  serviceId?: string | undefined;
  destination?: string | undefined;
}

export interface RecordStoreInput {
  id: string;
  name: string;
  region?: string | undefined;
  replicationRegions?: ReadonlyArray<string> | undefined;
  subjectCountries?: ReadonlyArray<string> | undefined;
}

// The kinds of DataSecurityFlows' flows, as they are stored.
export const RECORD_FLOW_KINDS: {
  uses: string;
  aiProvider: string;
  externalHost: string;
  copy: string;
} = {
  uses: "Uses",
  aiProvider: "AI Provider",
  externalHost: "External Host",
  copy: "Copy",
};

// The most recipients one store's record lists.
export const MAX_RECORD_RECIPIENTS: number = 30;

/*
 * Who receives a store's data, from its flows (Article 30(1)(d)):
 *
 *   - each host outside the project a service using the store calls -
 *     the service map shows the service using the store and calling the
 *     host, so the host may receive what the service reads;
 *   - each AI provider the store's own data is sent to (a service's AI
 *     conversations), or a service using it sends calls to;
 *   - each other store holding a copy of its data.
 *
 * The services a store's data reaches inside the project are not
 * recipients: they are the project's own. Sorted by kind, then name.
 */
export function getRecordRecipients(data: {
  store: RecordStoreInput;
  flows: ReadonlyArray<RecordFlowInput>;
  // Every store of the project by id, for a copy's name.
  storeNames: ReadonlyMap<string, string>;
  // Every service of the project by id, for the name a recipient is reached through.
  serviceNames: ReadonlyMap<string, string>;
}): Array<RecordRecipient> {
  const storeId: string = data.store.id.toLowerCase();
  const servicesUsing: Set<string> = new Set();

  for (const flow of data.flows) {
    if (
      flow.kind === RECORD_FLOW_KINDS.uses &&
      (flow.sourceDataStoreId || "").toLowerCase() === storeId &&
      flow.serviceId
    ) {
      servicesUsing.add(flow.serviceId.toLowerCase());
    }
  }

  const byKey: Map<string, RecordRecipient> = new Map();
  const add: (
    kind: RecordRecipientKind,
    name: string,
    via: string | undefined,
    dataStoreId?: string,
  ) => void = (
    kind: RecordRecipientKind,
    name: string,
    via: string | undefined,
    dataStoreId?: string,
  ): void => {
    const trimmed: string = name.trim();

    if (!trimmed) {
      return;
    }

    const key: string = `${kind}:${trimmed.toLowerCase()}`;
    const recipient: RecordRecipient = byKey.get(key) || {
      kind,
      name: trimmed,
      via: [],
      ...(dataStoreId ? { dataStoreId } : {}),
    };

    if (via && !recipient.via.includes(via)) {
      recipient.via.push(via);
    }

    byKey.set(key, recipient);
  };

  for (const flow of data.flows) {
    const serviceId: string = (flow.serviceId || "").toLowerCase();
    const via: string | undefined = serviceId
      ? data.serviceNames.get(serviceId)
      : undefined;

    if (
      flow.kind === RECORD_FLOW_KINDS.externalHost &&
      serviceId &&
      servicesUsing.has(serviceId)
    ) {
      add(RecordRecipientKind.ExternalHost, flow.destination || "", via);
    } else if (
      flow.kind === RECORD_FLOW_KINDS.aiProvider &&
      ((flow.sourceDataStoreId || "").toLowerCase() === storeId ||
        (serviceId && servicesUsing.has(serviceId)))
    ) {
      add(RecordRecipientKind.AiProvider, flow.destination || "", via);
    } else if (
      flow.kind === RECORD_FLOW_KINDS.copy &&
      (flow.sourceDataStoreId || "").toLowerCase() === storeId &&
      flow.destinationDataStoreId
    ) {
      const otherId: string = flow.destinationDataStoreId.toLowerCase();

      add(
        RecordRecipientKind.Copy,
        data.storeNames.get(otherId) || "",
        undefined,
        otherId,
      );
    }
  }

  const order: ReadonlyArray<RecordRecipientKind> = [
    RecordRecipientKind.ExternalHost,
    RecordRecipientKind.AiProvider,
    RecordRecipientKind.Copy,
  ];

  return [...byKey.values()]
    .sort((a: RecordRecipient, b: RecordRecipient): number => {
      return (
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        a.name.localeCompare(b.name)
      );
    })
    .slice(0, MAX_RECORD_RECIPIENTS);
}

// How a store's data reaches another country.
export enum RecordTransferRoute {
  // The store itself is kept there.
  Store = "Store",
  // Its cloud copies it to a region there.
  Replication = "Replication",
  // Another store, which holds a copy of its data, is kept there.
  Copy = "Copy",
}

export interface RecordTransfer {
  route: RecordTransferRoute;
  // The countries the data's people are in that it leaves, ISO 3166-1 alpha-2.
  fromCountries: Array<string>;
  // Where it goes: its country (null for a multi-region area), and the region.
  toCountry: string | null;
  toRegion: string;
  // Whether it leaves the European Economic Area for a country outside it.
  leavesEea: boolean;
  // The other store, for a copy.
  copyStoreName?: string | undefined;
}

/*
 * Whether data about a person in `from` kept in `to` leaves their
 * country: never inside the European Economic Area, where it moves
 * freely; otherwise whenever the countries differ. A multi-region area
 * inside the EEA keeps EEA people's data inside it.
 */
function leaves(from: string, to: CloudRegionLocation): boolean {
  if (isEeaCountry(from) && to.isInEea) {
    return false;
  }

  return to.country === null || to.country !== from;
}

export interface RecordTransfers {
  transfers: Array<RecordTransfer>;
  // Why transfers could not be worked out, when they could not.
  unknownBecause: RecordTransfersUnknownReason | null;
}

export enum RecordTransfersUnknownReason {
  // No data type the store holds says which country its people are in.
  NoSubjectCountries = "NoSubjectCountries",
  // The store's region is not one OneUptime knows the country of.
  UnknownRegion = "UnknownRegion",
}

export const RECORD_TRANSFERS_UNKNOWN_TEXTS: Readonly<
  Record<RecordTransfersUnknownReason, string>
> = {
  [RecordTransfersUnknownReason.NoSubjectCountries]: translationKey(
    "Not known: no data type it holds says which country its people are in.",
  ),
  [RecordTransfersUnknownReason.UnknownRegion]: translationKey(
    "Not known: OneUptime does not know which country its region is in.",
  ),
};

/*
 * Where a store's data goes outside the countries its people are in
 * (Article 30(1)(e)), by plain code: the store's own region, each region
 * its cloud copies it to, and each other store holding a copy, each
 * against the countries its data is about (DataStore.subjectCountries,
 * from country-bound data types). Leaving the EEA for a country outside it
 * is marked: that is where GDPR's transfer rules apply. Where the
 * countries its people are in are not known, nothing is guessed: the
 * record says why.
 */
export function getRecordTransfers(data: {
  store: RecordStoreInput;
  // The other stores holding a copy of its data.
  copies: ReadonlyArray<{ name: string; region?: string | undefined }>;
}): RecordTransfers {
  const subjects: Array<string> = [
    ...new Set(
      (data.store.subjectCountries || []).map((country: string): string => {
        return country.toUpperCase();
      }),
    ),
  ].sort();

  if (subjects.length === 0) {
    return {
      transfers: [],
      unknownBecause: RecordTransfersUnknownReason.NoSubjectCountries,
    };
  }

  const own: CloudRegionLocation | null = getCloudRegionLocation(
    data.store.region,
  );
  const transfers: Array<RecordTransfer> = [];
  const seen: Set<string> = new Set();

  const check: (
    route: RecordTransferRoute,
    region: string | undefined,
    copyStoreName?: string,
  ) => void = (
    route: RecordTransferRoute,
    region: string | undefined,
    copyStoreName?: string,
  ): void => {
    const location: CloudRegionLocation | null = getCloudRegionLocation(region);

    if (!location) {
      return;
    }

    const from: Array<string> = subjects.filter((country: string): boolean => {
      return leaves(country, location);
    });

    if (from.length === 0) {
      return;
    }

    const key: string = `${route}:${location.region}:${copyStoreName || ""}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    transfers.push({
      route,
      fromCountries: from,
      toCountry: location.country,
      toRegion: location.region,
      leavesEea:
        from.some((country: string): boolean => {
          return isEeaCountry(country);
        }) && !location.isInEea,
      ...(copyStoreName ? { copyStoreName } : {}),
    });
  };

  check(RecordTransferRoute.Store, data.store.region);

  for (const region of data.store.replicationRegions || []) {
    check(RecordTransferRoute.Replication, region);
  }

  for (const copy of data.copies) {
    check(RecordTransferRoute.Copy, copy.region, copy.name);
  }

  // Nothing leaves only where the store's own place is known.
  return {
    transfers,
    unknownBecause:
      transfers.length === 0 && !own
        ? RecordTransfersUnknownReason.UnknownRegion
        : null,
  };
}

// A country's English name, for the exports: "United States".
export function getCountryNameInEnglish(country: string | null): string {
  if (!country) {
    return "the European Economic Area";
  }

  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        country.toUpperCase(),
      ) || country
    );
  } catch {
    return country;
  }
}

// A transfer as one English line, for the exports: "Germany to the United States (us-east-1)".
export function describeRecordTransfer(transfer: RecordTransfer): string {
  const from: string = transfer.fromCountries
    .map((country: string): string => {
      return getCountryNameInEnglish(country);
    })
    .join(", ");
  const to: string = getCountryNameInEnglish(transfer.toCountry);
  const through: string =
    transfer.route === RecordTransferRoute.Replication
      ? ", by replication"
      : transfer.route === RecordTransferRoute.Copy
        ? `, in ${transfer.copyStoreName || "another store"}`
        : "";

  return `${from} to ${to} (${transfer.toRegion}${through})`;
}

// A recipient as one English line, for the exports: "api.stripe.com (outside host, via checkout)".
export function describeRecordRecipient(recipient: RecordRecipient): string {
  const kind: string =
    recipient.kind === RecordRecipientKind.ExternalHost
      ? "outside host"
      : recipient.kind === RecordRecipientKind.AiProvider
        ? "AI provider"
        : "copy";

  return `${recipient.name} (${kind}${
    recipient.via.length > 0 ? `, via ${recipient.via.join(", ")}` : ""
  })`;
}

/*
 * Why OneUptime AI drafted nothing for a store. Sent by the API: never
 * rename one.
 */
export enum RecordDraftSkip {
  // The store holds no personal data: it is not in the record.
  NotPersonalData = "not-personal-data",
  // OneUptime declares the store and fills in its record itself (#10398).
  Declared = "declared",
  // Every field is a person's, filled in by OneUptime, or up to date.
  NothingToDraft = "nothing-to-draft",
  // OneUptime AI's answer could not be read, or none of it held to its facts.
  NothingHeld = "nothing-held",
  NoLlmProvider = "no-llm-provider",
  NoAiCredits = "no-ai-credits",
  AiDailyLimitReached = "ai-daily-limit-reached",
  Failed = "failed",
}

// What a person is told when a draft they asked for drafted nothing.
export const RECORD_DRAFT_SKIP_TEXTS: Readonly<Record<RecordDraftSkip, string>> =
  {
    [RecordDraftSkip.NotPersonalData]: translationKey(
      "This store holds no personal data, so it is not in the record of processing.",
    ),
    [RecordDraftSkip.Declared]: translationKey(
      "OneUptime fills in this store's record itself.",
    ),
    [RecordDraftSkip.NothingToDraft]: translationKey(
      "Nothing to draft: every field is answered or drafted, and nothing it rests on changed.",
    ),
    [RecordDraftSkip.NothingHeld]: translationKey(
      "OneUptime AI found nothing in what the scans know of this store to draft from. Write the fields yourself.",
    ),
    [RecordDraftSkip.NoLlmProvider]: translationKey(
      "No LLM provider is set up for this project.",
    ),
    [RecordDraftSkip.NoAiCredits]: translationKey(
      "This project has no AI credits left.",
    ),
    [RecordDraftSkip.AiDailyLimitReached]: translationKey(
      "This project reached its AI limit for today.",
    ),
    [RecordDraftSkip.Failed]: translationKey(
      "OneUptime AI could not draft this store's record. Try again in a moment.",
    ),
  };

/*
 * ---------------------------------------------------------------------------
 * The record's state, counted
 * ---------------------------------------------------------------------------
 */

export interface RecordFieldCounts {
  drafted: number;
  changeProposed: number;
  confirmed: number;
  written: number;
  filledIn: number;
  empty: number;
}

export function emptyRecordFieldCounts(): RecordFieldCounts {
  return {
    drafted: 0,
    changeProposed: 0,
    confirmed: 0,
    written: 0,
    filledIn: 0,
    empty: 0,
  };
}

// The fields of the record by where they stand: what the record's card counts.
export function countRecordFields(
  statuses: ReadonlyArray<RecordFieldStatus>,
): RecordFieldCounts {
  const counts: RecordFieldCounts = emptyRecordFieldCounts();

  for (const status of statuses) {
    switch (status) {
      case RecordFieldStatus.Drafted:
        counts.drafted++;
        break;
      case RecordFieldStatus.ChangeProposed:
        counts.changeProposed++;
        break;
      case RecordFieldStatus.Confirmed:
        counts.confirmed++;
        break;
      case RecordFieldStatus.Written:
        counts.written++;
        break;
      case RecordFieldStatus.FilledIn:
        counts.filledIn++;
        break;
      default:
        counts.empty++;
    }
  }

  return counts;
}

// Whether a field waits for a person: a draft to confirm, or a change to take or leave.
export function isRecordFieldToReview(status: RecordFieldStatus): boolean {
  return (
    status === RecordFieldStatus.Drafted ||
    status === RecordFieldStatus.ChangeProposed
  );
}

/*
 * What a store's record says of one field, as the API sends it: the value
 * in the record (a person's, or what plain code fills in), where it
 * stands, and what waits for a person.
 */
export interface RecordFieldView {
  field: RecordField;
  status: RecordFieldStatus;
  // The value the record says: a person's, what plain code fills in, or "" / [].
  value: RecordFieldValue;
  // OneUptime AI's draft, while the field is Drafted.
  draft?: RecordFieldDraft | undefined;
  // OneUptime AI's proposed change, while the field is ChangeProposed.
  proposed?: RecordFieldDraft | undefined;
  // The keys of the facts that changed under a confirmed field, beside a proposal.
  changedFactKeys?: Array<string> | undefined;
  // Those facts as they were when the value was confirmed.
  previousFacts?: Array<ComplianceFact> | undefined;
}

// What a record field's view says, as JSON: its value is plain JSON already.
export function toRecordFieldViewJson(view: RecordFieldView): JSONValue {
  return JSON.parse(JSON.stringify(view)) as JSONValue;
}
