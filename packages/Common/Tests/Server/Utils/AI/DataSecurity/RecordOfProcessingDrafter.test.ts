import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import AIService from "../../../../../Server/Services/AIService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DataSecurityAiCall from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityAiInput, {
  AiComplianceFacts,
  AiRecordDossier,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import RecordOfProcessingDossier from "../../../../../Server/Utils/AI/DataSecurity/RecordOfProcessingDossier";
import RecordOfProcessingDrafter, {
  RecordDraftOutcome,
} from "../../../../../Server/Utils/AI/DataSecurity/RecordOfProcessingDrafter";
import { RECORD_DRAFT_CASES } from "../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityPaperworkEvalCases";
import UserLanguage from "../../../../../Server/Utils/Notification/UserLanguage";
import {
  ComplianceFact,
  getFactsHash,
} from "../../../../../Types/DataSecurity/ComplianceFacts";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import {
  RecordDraftSkip,
  RecordField,
  RecordFieldStatus,
  RecordLegalBasis,
  RecordPeople,
  StoreRecordDrafts,
  emptyStoreRecordDrafts,
  getRecordFieldStatus,
  getRecordValueHash,
  readStoreRecordDrafts,
  toStoreRecordDraftsJson,
} from "../../../../../Types/DataSecurity/RecordOfProcessing";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ONEUPTIME AI'S DRAFTS OF A STORE'S RECORD NEVER OVERWRITE A PERSON
 * (#10375): only what nobody answered is asked for; a draft lands beside
 * the record, never in its columns; a field a person writes while OneUptime
 * AI drafts keeps their words; and a confirmed value whose facts changed
 * gets a change proposed beside it, never applied. The store's rows and the
 * model are stood in for; the drafting, holding and merging are the
 * product's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10375000-0000-4000-8000-0000000d0001",
);
const STORE_ID: ObjectID = new ObjectID("10375000-0000-4000-8000-0000000d0002");
const USER_ID: ObjectID = new ObjectID("10375000-0000-4000-8000-0000000d0003");
const NOW: Date = new Date("2026-11-23T10:00:00.000Z");
const DOSSIER: AiRecordDossier = RECORD_DRAFT_CASES.find(
  (testCase: { id: string }): boolean => {
    return testCase.id === "record-shop-orders";
  },
)!.dossier;
const NAMER: DataTypeNamer = DataTypeNamer.withoutCustomTypes();

function factsNow(): Array<ComplianceFact> {
  const built: AiComplianceFacts = DataSecurityAiInput.recordFacts({
    dossier: DOSSIER,
    dataTypeNamer: NAMER,
  });

  return built.facts;
}

// What OneUptime AI answers: every field, each citing every fact it was given.
function answer(): string {
  const ids: Array<string> = factsNow().map((fact: ComplianceFact): string => {
    return fact.id;
  });

  return JSON.stringify({
    purpose: {
      text: "Customers' orders from the web shop, for checkout and delivery",
      facts: ids,
    },
    retention: null,
    legalBasis: {
      value: RecordLegalBasis.Contract,
      reason: "The orders are taken to fulfil a contract with the customer.",
      facts: ids,
    },
    people: {
      value: [RecordPeople.Customers],
      reason: "The store holds the customers' own details.",
      facts: ids,
    },
  });
}

function storeOf(columns: {
  purpose?: string;
  legalBasis?: RecordLegalBasis;
  drafts?: StoreRecordDrafts;
}): DataStore {
  const store: DataStore = new DataStore(STORE_ID);

  store.projectId = PROJECT_ID;
  store.name = "shop-orders";
  store.kind = DataStoreKind.AwsRdsInstance;
  store.dataCategories = [DataCategory.ContactAndIdentity];

  if (columns.purpose) {
    store.purpose = columns.purpose;
  }

  if (columns.legalBasis) {
    store.legalBasis = columns.legalBasis;
  }

  store.recordDrafts = toStoreRecordDraftsJson(
    columns.drafts || emptyStoreRecordDrafts(),
  ) as JSONObject;

  return store;
}

let reads: Array<DataStore>;
let written: Array<JSONObject>;
let asked: SpyInstance<typeof DataSecurityAiCall.ask>;
let personWrites: SpyInstance<typeof DataStoreService.updateOneById>;

beforeEach(() => {
  reads = [];
  written = [];

  jest
    .spyOn(RecordOfProcessingDossier, "readStore")
    .mockImplementation((async () => {
      return storeOf({});
    }) as never);
  jest
    .spyOn(RecordOfProcessingDossier, "read")
    .mockResolvedValue(DOSSIER as never);
  // The record as it is before drafting, then as it is when the drafts are written.
  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
    return reads.length > 1 ? reads.shift()! : reads[0]!;
  }) as never);
  jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      written.push(data.data);
    }) as never);
  personWrites = jest.spyOn(DataStoreService, "updateOneById");
  jest
    .spyOn(AIService, "assertProjectAIEnabled")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  asked = jest
    .spyOn(DataSecurityAiCall, "ask")
    .mockImplementation((async () => {
      return { content: answer() };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function draft(): Promise<RecordDraftOutcome> {
  return RecordOfProcessingDrafter.draftStore({
    projectId: PROJECT_ID,
    dataStoreId: STORE_ID,
    feature: DataSecurityAiFeature.DraftRecordOnRequest,
    userId: USER_ID,
    dataTypeNamer: NAMER,
    now: NOW,
  });
}

function writtenDrafts(): StoreRecordDrafts {
  expect(written).toHaveLength(1);
  // Only the drafts beside the record are written: never a column of it.
  expect(Object.keys(written[0]!)).toEqual(["recordDrafts"]);

  return readStoreRecordDrafts(written[0]!["recordDrafts"]);
}

describe("OneUptime AI's drafts of a store's record", () => {
  test("only the fields nobody answered are drafted, beside the record; a person's words are never asked about or touched", async () => {
    reads = [storeOf({ purpose: "Our own words about the orders" })];

    const outcome: RecordDraftOutcome = await draft();

    expect(outcome).toEqual({
      drafted: true,
      draftedFields: [RecordField.LegalBasis, RecordField.People],
      proposedFields: [],
    });

    const drafts: StoreRecordDrafts = writtenDrafts();

    expect(drafts.fields[RecordField.Purpose]).toBeUndefined();
    expect(drafts.fields[RecordField.LegalBasis]?.draft?.value).toBe(
      RecordLegalBasis.Contract,
    );
    expect(drafts.fields[RecordField.People]?.draft?.value).toEqual([
      RecordPeople.Customers,
    ]);
    // Retention: no fact says how long, and the answer said nothing.
    expect(drafts.fields[RecordField.Retention]).toBeUndefined();
    expect(personWrites).not.toHaveBeenCalled();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  test("a field a person writes while OneUptime AI drafts keeps their words", async () => {
    reads = [
      storeOf({}),
      // The person chose a basis while the model was answering.
      storeOf({ legalBasis: RecordLegalBasis.LegalObligation }),
    ];

    const outcome: RecordDraftOutcome = await draft();
    const drafts: StoreRecordDrafts = writtenDrafts();

    expect(drafts.fields[RecordField.LegalBasis]).toBeUndefined();
    expect(outcome).toMatchObject({ drafted: true });
    expect(
      (outcome as { draftedFields: Array<RecordField> }).draftedFields,
    ).not.toContain(RecordField.LegalBasis);
    expect(personWrites).not.toHaveBeenCalled();
  });

  test("a confirmed value whose facts changed gets a change proposed beside it, never applied", async () => {
    const confirmed: StoreRecordDrafts = {
      ...emptyStoreRecordDrafts(),
      fields: {
        [RecordField.Purpose]: {
          confirmed: {
            valueHash: getRecordValueHash("Orders"),
            factKeys: ["store"],
            // What the store's facts said when it was confirmed: not what they say now.
            factsHash: getFactsHash({ facts: [], keys: ["store"] }),
            facts: [],
            confirmedAt: "2026-11-01T08:00:00.000Z",
          },
        },
      },
    };

    reads = [storeOf({ purpose: "Orders", drafts: confirmed })];

    const outcome: RecordDraftOutcome = await draft();
    const drafts: StoreRecordDrafts = writtenDrafts();

    expect(outcome).toMatchObject({
      drafted: true,
      proposedFields: [RecordField.Purpose],
    });
    expect(drafts.fields[RecordField.Purpose]?.confirmed).toEqual(
      confirmed.fields[RecordField.Purpose]!.confirmed,
    );
    expect(drafts.fields[RecordField.Purpose]?.proposed?.value).toBe(
      "Customers' orders from the web shop, for checkout and delivery",
    );
    // The record still says what the person confirmed.
    expect(
      getRecordFieldStatus({
        value: "Orders",
        state: drafts.fields[RecordField.Purpose],
      }),
    ).toBe(RecordFieldStatus.ChangeProposed);
    expect(personWrites).not.toHaveBeenCalled();
  });

  test("with every field answered, nothing is asked", async () => {
    const store: DataStore = storeOf({
      purpose: "Orders",
      legalBasis: RecordLegalBasis.Contract,
    });

    store.retention = "Two years";
    store.dataSubjects = [RecordPeople.Customers];
    reads = [store];

    expect(await draft()).toEqual({
      drafted: false,
      reason: RecordDraftSkip.NothingToDraft,
    });
    expect(asked).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });
});
