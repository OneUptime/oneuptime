import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import Queue from "../../../../../Server/Infrastructure/Queue";
import AIService, {
  AI_DATA_SECURITY_DATA_TYPE_DRAFT_FEATURE,
  AILogRequest,
} from "../../../../../Server/Services/AIService";
import DataSecurityAiProposalService from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecuritySettingService from "../../../../../Server/Services/DataSecuritySettingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import DataTypeDiscovery, {
  DATA_TYPE_DRAFT_ATTEMPTS,
  DataTypeDiscoveryOutcome,
  DataTypeDiscoverySkip,
  MAX_DRAFTS_PER_RUN,
} from "../../../../../Server/Utils/AI/DataSecurity/DataTypeDiscovery";
import { DRAFT_DATA_TYPE_SYSTEM_PROMPT } from "../../../../../Server/Utils/AI/DataSecurity/DataTypeDraftPrompt";
import { classifyCollectedFields } from "../../../../../Server/Utils/DataSecurity/Content/ContentClassifier";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import DataTypeProving, {
  getShadowKey,
} from "../../../../../Server/Utils/DataSecurity/DataTypeProving";
import { FingerprintAccumulator } from "../../../../../Server/Utils/DataSecurity/Fingerprint";
import {
  FieldAnswer,
  getFieldAnswerKey,
  withPendingFields,
} from "../../../../../Server/Utils/DataSecurity/FieldSuggestionState";
import logger from "../../../../../Server/Utils/Logger";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { CollectedField } from "../../../../../Utils/DataSecurity/FieldCollector";
import {
  DataTypeDraftVariant,
  DataTypeDropReason,
  DataTypeProof,
  DataTypeProposalPlan,
  DROPPED_DATA_TYPE_COOLDOWN_DAYS,
  getElsewhereMatchShare,
  getGroupMatchShare,
  readDataTypeProposalPlan,
} from "../../../../../Utils/DataSecurity/DataTypeProposal";
import { ShadowScanDetector } from "../../../../../Utils/DataSecurity/ShadowCount";
import {
  describeUnplacedField,
  UnplacedField,
} from "../../../../../Utils/DataSecurity/UnplacedFields";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * OneUptime AI learns the company's own data types (#10371): the fields a
 * project's scans could not place are grouped across stores, each new
 * group drafted into a data type - from names and shapes, never a value -
 * held to what a saved type is held to, proven in shadow on its stores'
 * next scans, and offered with what the scans counted. The stores, the
 * proposals, the model and the queue are stand-ins; the grouping, the
 * prompts, the scans' counting and the proof are the product's own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-23T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

interface FakeStore {
  id: ObjectID;
  name: string;
  // Each column's values, by its location.
  columns: Record<string, Array<string>>;
  answers?: Record<string, FieldAnswer> | undefined;
}

let stores: Array<FakeStore>;
let proposals: Array<DataSecurityAiProposal>;
let aiEnabled: boolean;
let answers: Array<string>;
let executeSpy: jest.SpyInstance;
let scanIntervalInHours: number;

// Made-up policy numbers: two capitals, a dash, seven digits.
function policyNumbers(count: number, seed: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    const letters: string = String.fromCharCode(
      65 + ((seed + index) % 26),
      65 + ((seed * 7 + index) % 26),
    );

    return `${letters}-${String(1000000 + seed * 9973 + index * 37).slice(0, 7)}`;
  });
}

function emails(count: number, seed: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `person${seed}-${index}@acme.example`;
  });
}

// Eleven columns of policy numbers in six stores, under the names a company uses.
function sixStores(): Array<FakeStore> {
  const group: Array<[string, Array<string>]> = [
    ["public.policies.policy_no", "public.claims.policy_no"],
    ["sales.contracts.policyNumber", "sales.renewals.policyNumber"],
    ["public.vertraege.police_nr", "public.schaeden.police_nr"],
    ["crm.customers.policy_ref", "crm.leads.policy_ref"],
    ["billing.invoices.policy_ref", "billing.payments.policy_ref"],
    ["dw.facts.policy_no"],
  ].map((locations: Array<string>, index: number): [string, Array<string>] => {
    return [`Store ${index + 1}`, locations];
  });

  return group.map(([name, locations]: [string, Array<string>], index: number) => {
    const columns: Record<string, Array<string>> = {};

    locations.forEach((location: string, column: number): void => {
      columns[location] = policyNumbers(40, index * 10 + column + 1);
    });

    // Beside them, what any store has: emails, and notes that seldom name a policy.
    columns[`${locations[0]!.split(".").slice(0, -1).join(".")}.contact_email`] =
      emails(40, index);
    columns[`${locations[0]!.split(".").slice(0, -1).join(".")}.note`] = Array.from(
      { length: 200 },
      (_value: unknown, row: number): string => {
        return row === 0 ? "renewal of policy AB-1234567 confirmed" : "called";
      },
    );

    return {
      id: ObjectID.generate(),
      name,
      columns,
    };
  });
}

// What a store's last scan left: the fields it could not place, described.
function toDataStore(store: FakeStore): DataStore {
  const row: DataStore = new DataStore(store.id);
  const pending: Array<UnplacedField> = [];
  const names: Array<string> = Object.keys(store.columns);

  for (const [location, values] of Object.entries(store.columns)) {
    const field: UnplacedField | null = describeUnplacedField({
      path: location,
      values,
      neighbours: names,
      locationKind: DataStoreLocationKind.Column,
    });

    // Emails are placed by a detector: only the rest is unplaced.
    if (field && !location.endsWith("contact_email")) {
      pending.push(field);
    }
  }

  row.projectId = PROJECT_ID;
  row.name = store.name;
  row.kind = DataStoreKind.PostgreSql;
  row.fieldSuggestionState = withPendingFields({
    previous: { answers: store.answers || {} },
    pending,
    scannedAt: new Date(NOW.getTime() - DAY_IN_MS),
  });

  return row;
}

const POLICY_DRAFT: JSONObject = {
  name: "Insurance policy number",
  description: "The number of an insurance policy, such as AA-9999999.",
  category: DataCategory.Financial,
  sensitivity: DataSensitivity.Confidential,
  pattern: "\\b[A-Z]{2}-?\\d{7}\\b",
  ignoreCase: false,
  keywords: ["policy"],
  nameHints: ["policy no"],
  validator: "None",
};

function draftAnswer(draft: JSONObject | null = POLICY_DRAFT): string {
  return JSON.stringify({
    dataType: draft,
    reason: "Every field's name says policy, and every value has one shape.",
  });
}

function request(index: number = 0): AILogRequest {
  return executeSpy.mock.calls[index]![0] as AILogRequest;
}

function sentData(index: number = 0): JSONObject {
  return JSON.parse(request(index).messages[1]!.content as string) as JSONObject;
}

function proposalsOf(
  status?: DataSecurityAiProposalStatus,
): Array<DataSecurityAiProposal> {
  return proposals.filter((proposal: DataSecurityAiProposal): boolean => {
    return !status || proposal.status === status;
  });
}

function planOf(proposal: DataSecurityAiProposal): DataTypeProposalPlan {
  return readDataTypeProposalPlan(proposal.plan)!;
}

function run(now: Date = NOW): Promise<DataTypeDiscoveryOutcome> {
  return DataTypeDiscovery.runForProject({ projectId: PROJECT_ID, now });
}

function scanOptions(detectors: Array<ShadowScanDetector>): ContentScanOptions {
  return {
    limits: {
      maxObjects: 0,
      maxBytesPerObject: 0,
      maxBytesTotal: 50_000_000,
      maxRowsPerTable: 1000,
      maxTables: 200,
      deadline: new Date(Date.now() + 60_000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test",
    shadowDetectors: detectors,
  };
}

/*
 * A store's next scan, as a database scan reads its columns: the drafts
 * being proven on it run in shadow, and its result is recorded.
 */
async function scanStore(store: FakeStore, at: Date): Promise<ContentScanResult> {
  const detectors: Array<ShadowScanDetector> =
    await DataTypeProving.getShadowDetectorsForStore({
      projectId: PROJECT_ID,
      dataStoreId: store.id,
    });
  const fields: Array<CollectedField> = Object.entries(store.columns).map(
    ([path, values]: [string, Array<string>]): CollectedField => {
      return { path, values };
    },
  );
  const classified: ReturnType<typeof classifyCollectedFields> =
    classifyCollectedFields({
      fields,
      options: scanOptions(detectors),
      fingerprints: new FingerprintAccumulator("test"),
      locationKind: DataStoreLocationKind.Column,
    });
  const result: ContentScanResult = {
    ...emptyContentScanResult(),
    locations: classified.locations,
    unplacedFields: classified.unplacedFields,
    shadowCounts: classified.shadowCounts,
  };

  await DataTypeProving.recordStoreScan({
    projectId: PROJECT_ID,
    dataStoreId: store.id,
    result,
    scannedAt: at,
  });

  return result;
}

beforeEach(() => {
  stores = sixStores();
  proposals = [];
  aiEnabled = true;
  answers = [draftAnswer()];
  scanIntervalInHours = 24;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
    return stores.map(toDataStore);
  }) as never);
  jest.spyOn(AIService, "isProjectAIEnabled").mockImplementation((async () => {
    return aiEnabled;
  }) as never);
  executeSpy = jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async () => {
      const content: string = answers.length > 1 ? answers.shift()! : answers[0]!;
      return { content };
    }) as never);
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockImplementation((async () => {
      return { setting: {}, options: {}, customTypes: new Map() };
    }) as never);
  jest
    .spyOn(DataSecuritySettingService, "getOrCreateForProject")
    .mockImplementation((async () => {
      return { contentScanIntervalInHours: scanIntervalInHours };
    }) as never);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  jest.spyOn(logger, "info").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});

  // The proposals, in memory: each change of state a claim, as the service's.
  jest
    .spyOn(DataSecurityAiProposalService, "create")
    .mockImplementation((async (create: { data: DataSecurityAiProposal }) => {
      create.data._id = ObjectID.generate().toString();
      create.data.version = 1;
      create.data.createdAt = new Date(NOW.getTime());
      proposals.push(create.data);
      return create.data;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "findBy")
    .mockImplementation((async (find: { query: JSONObject }) => {
      return proposals.filter((proposal: DataSecurityAiProposal): boolean => {
        return (
          (!find.query["kind"] || proposal.kind === find.query["kind"]) &&
          (!find.query["status"] || proposal.status === find.query["status"])
        );
      });
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "findOneBy")
    .mockImplementation((async (find: { query: JSONObject }) => {
      return (
        proposals.find((proposal: DataSecurityAiProposal): boolean => {
          return (
            proposal._id === (find.query["_id"] as ObjectID).toString() &&
            (!find.query["status"] || proposal.status === find.query["status"])
          );
        }) || null
      );
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "attemptTransition")
    .mockImplementation((async (transition: {
      proposalId: ObjectID;
      fromStatuses: Array<DataSecurityAiProposalStatus>;
      set: JSONObject;
    }) => {
      const proposal: DataSecurityAiProposal | undefined = proposals.find(
        (entry: DataSecurityAiProposal): boolean => {
          return entry._id === transition.proposalId.toString();
        },
      );

      if (!proposal || !transition.fromStatuses.includes(proposal.status!)) {
        return 0;
      }

      Object.assign(proposal, transition.set);
      proposal.version = (proposal.version || 0) + 1;
      return 1;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "attemptProvingResult")
    .mockImplementation((async (write: {
      proposalId: ObjectID;
      atVersion: number;
      result: JSONObject;
    }) => {
      const proposal: DataSecurityAiProposal | undefined = proposals.find(
        (entry: DataSecurityAiProposal): boolean => {
          return entry._id === write.proposalId.toString();
        },
      );

      if (
        !proposal ||
        proposal.status !== DataSecurityAiProposalStatus.Proving ||
        proposal.version !== write.atVersion
      ) {
        return 0;
      }

      proposal.result = write.result;
      proposal.version = (proposal.version || 0) + 1;
      return 1;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("eleven policy number columns in six stores", () => {
  test("become one proposed data type, with its counts from shadow scans", async () => {
    const outcome: DataTypeDiscoveryOutcome = await run();

    expect(outcome).toMatchObject({ candidates: 1, drafted: 1, dropped: 0 });
    expect(executeSpy).toHaveBeenCalledTimes(1);

    const [proving] = proposalsOf(DataSecurityAiProposalStatus.Proving);

    expect(proving).toBeDefined();
    expect(proving!.kind).toBe(DataSecurityAiProposalKind.AddDataType);

    const plan: DataTypeProposalPlan = planOf(proving!);

    expect(plan.fieldCount).toBe(11);
    expect(plan.storeCount).toBe(6);
    expect(plan.draft.name).toBe("Insurance policy number");
    // Its own fields' names among its field names, and a narrowed variant.
    expect(plan.draft.nameHints).toEqual(
      expect.arrayContaining(["policy no", "policy number", "police nr"]),
    );
    expect(plan.narrowed.requiresKeyword).toBe(true);
    expect(plan.narrowed.keywords).toEqual(
      expect.arrayContaining(["policy", "police"]),
    );

    // The next scan of each store counts it in shadow; the sixth decides.
    for (const [index, store] of stores.entries()) {
      const result: ContentScanResult = await scanStore(
        store,
        new Date(NOW.getTime() + (index + 1) * 60_000),
      );

      // Counted, never found: no finding names it, and its fields stay unplaced.
      expect(
        result.locations.some((location: { classifications: Array<{ dataTypeId: string }> }) => {
          return location.classifications.some(
            (classification: { dataTypeId: string }): boolean => {
              return classification.dataTypeId.startsWith("shadow:");
            },
          );
        }),
      ).toBe(false);
      expect(
        result.shadowCounts![getShadowKey(proving!.id!, DataTypeDraftVariant.AsDrafted)],
      ).toBeDefined();

      if (index < stores.length - 1) {
        expect(proving!.status).toBe(DataSecurityAiProposalStatus.Proving);
      }
    }

    expect(proving!.status).toBe(DataSecurityAiProposalStatus.Proposed);

    const proof: DataTypeProof = planOf(proving!).proof!;

    expect(proof).toMatchObject({
      variant: DataTypeDraftVariant.AsDrafted,
      storesInGroup: 6,
      storesCounted: 6,
      fieldsInGroup: 11,
      fieldsCounted: 11,
      groupValues: 440,
      groupMatched: 440,
    });
    expect(getGroupMatchShare(proof)).toBe(1);
    // Elsewhere: the emails and the notes, one of whose 1,200 values names a policy.
    expect(proof.elsewhereValues).toBe(6 * 40 + 6 * 200);
    expect(proof.elsewhereMatched).toBe(6);
    expect(getElsewhereMatchShare(proof)).toBeCloseTo(6 / 1440, 6);
    expect(proving!.title).toBe(
      "Add the data type Insurance policy number, found in 11 fields of 6 stores",
    );
    expect(proving!.proofMarkdown).toContain(
      "it matches 100% of the values in 11 of its 11 fields, and 0.4% of values elsewhere in the same stores.",
    );
  });

  test("OneUptime AI is told the fields' names and shapes, never a value", async () => {
    await run();

    const sent: string = JSON.stringify(request().messages);
    const data: JSONObject = sentData();

    expect(request().feature).toBe(AI_DATA_SECURITY_DATA_TYPE_DRAFT_FEATURE);
    expect(request().storeContentPreviews).toBe(false);
    expect(request().messages[0]!.content).toContain(
      DRAFT_DATA_TYPE_SYSTEM_PROMPT,
    );
    expect(data["stores"]).toBe(6);
    expect((data["fields"] as Array<JSONObject>).length).toBe(11);
    expect((data["fields"] as Array<JSONObject>)[0]).toMatchObject({
      store: DataStoreKind.PostgreSql,
      shapes: [["AA-9999999", 1]],
    });
    expect(data["knownDataTypes"]).toEqual(
      expect.arrayContaining(["Email address"]),
    );

    for (const store of stores) {
      for (const [location, values] of Object.entries(store.columns)) {
        // A note's words are no value of the type: its own test is the shapes'.
        if (location.endsWith(".note")) {
          continue;
        }

        for (const value of values.slice(0, 5)) {
          expect({ value, sent: sent.includes(value) }).toEqual({
            value,
            sent: false,
          });
        }
      }
    }
  });
});

describe("what is drafted", () => {
  test("nothing with the project's AI off, though the proofs being run are still decided", async () => {
    await run();
    aiEnabled = false;
    stores.push(...sixStores().map((store: FakeStore, index: number) => {
      return { ...store, name: `Other ${index}` };
    }));

    const outcome: DataTypeDiscoveryOutcome = await run(
      new Date(NOW.getTime() + 3 * DAY_IN_MS),
    );

    expect(outcome.skipped).toBe(DataTypeDiscoverySkip.AiOff);
    // The draft no store scanned in time is decided, with no model asked.
    expect(outcome.decided).toBe(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(proposalsOf(DataSecurityAiProposalStatus.Expired)).toHaveLength(1);
    expect(
      (proposalsOf(DataSecurityAiProposalStatus.Expired)[0]!.result as JSONObject)[
        "dropReason"
      ],
    ).toBe(DataTypeDropReason.NotScanned);
  });

  test("a group already drafted is not drafted again, nor one a person said is not a data type, under any key", async () => {
    await run();
    await run();

    expect(executeSpy).toHaveBeenCalledTimes(1);

    // Not a Data Type: dismissed - and the group gains a store, under another key.
    proposals[0]!.status = DataSecurityAiProposalStatus.Dismissed;
    proposals[0]!.planKey = "data-type:0000000000000000";
    stores.push({
      id: ObjectID.generate(),
      name: "Store 7",
      columns: { "archive.old.policy_number": policyNumbers(40, 99) },
    });

    await run();

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  test(`a dropped group is drafted again only ${DROPPED_DATA_TYPE_COOLDOWN_DAYS} days after`, async () => {
    answers = [draftAnswer(null)];

    await run();

    expect(proposalsOf(DataSecurityAiProposalStatus.Expired)).toHaveLength(1);
    expect(
      (proposals[0]!.result as JSONObject)["dropReason"],
    ).toBe(DataTypeDropReason.NotADataType);

    await run(new Date(NOW.getTime() + 2 * DAY_IN_MS));

    expect(executeSpy).toHaveBeenCalledTimes(1);

    answers = [draftAnswer()];
    await run(
      new Date(NOW.getTime() + (DROPPED_DATA_TYPE_COOLDOWN_DAYS + 1) * DAY_IN_MS),
    );

    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(proposalsOf(DataSecurityAiProposalStatus.Proving)).toHaveLength(1);
  });

  test("a draft whose pattern cannot be used is asked for once more, told why, then dropped", async () => {
    answers = [
      draftAnswer({ ...POLICY_DRAFT, pattern: "\\w+" }),
      draftAnswer({ ...POLICY_DRAFT, pattern: "PL-\\d{7}" }),
    ];

    const outcome: DataTypeDiscoveryOutcome = await run();

    expect(executeSpy).toHaveBeenCalledTimes(DATA_TYPE_DRAFT_ATTEMPTS);
    expect(sentData(1)["previousDraft"]).toEqual({
      pattern: "\\w+",
      problem: "it matches plain words, so it would match words everywhere",
    });
    expect(outcome).toMatchObject({ drafted: 0, dropped: 1 });
    expect((proposals[0]!.result as JSONObject)["dropReason"]).toBe(
      DataTypeDropReason.DraftUnusable,
    );
  });

  test("a second draft that can be used is proven", async () => {
    answers = [
      draftAnswer({ ...POLICY_DRAFT, pattern: "(a|)" }),
      draftAnswer(),
    ];

    const outcome: DataTypeDiscoveryOutcome = await run();

    expect(outcome.drafted).toBe(1);
    expect(proposalsOf(DataSecurityAiProposalStatus.Proving)).toHaveLength(1);
  });

  test("a field OneUptime AI already named a known type for is placed, and left out", async () => {
    for (const store of stores) {
      const field: UnplacedField = describeUnplacedField({
        path: Object.keys(store.columns)[0]!,
        values: Object.values(store.columns)[0]!,
        neighbours: Object.keys(store.columns),
        locationKind: DataStoreLocationKind.Column,
      })!;

      store.answers = {
        [getFieldAnswerKey(field)]: {
          at: new Date(NOW.getTime() - DAY_IN_MS).toISOString(),
          dataTypeId: "iban",
        },
      };
    }

    await run();

    // Five fields of five stores are left: the first field of each store was placed.
    expect(planOf(proposals[0]!).fieldCount).toBe(5);
  });

  test(`drafts at most ${MAX_DRAFTS_PER_RUN} groups in one run, the ones in the most fields first`, async () => {
    for (const word of ["member", "claim", "patient", "contract"]) {
      stores.forEach((store: FakeStore, index: number): void => {
        if (index < 3) {
          store.columns[`app.${word}_ref`] = policyNumbers(40, index + 50).map(
            (value: string): string => {
              return `${value}X`;
            },
          );
        }
      });
    }

    await run();

    // Each group drafted is a proposal: proven, or kept as dropped.
    expect(proposals).toHaveLength(MAX_DRAFTS_PER_RUN);
    expect(planOf(proposals[0]!).fieldCount).toBe(11);
  });

  test("is proven for 48 hours, or one scan interval and an hour where a project scans less often", async () => {
    await run();

    const plan: DataTypeProposalPlan = planOf(proposals[0]!);

    expect(Date.parse(plan.provingUntil) - Date.parse(plan.provingSince)).toBe(
      48 * 60 * 60 * 1000,
    );

    proposals = [];
    scanIntervalInHours = 168;
    await run();

    const weekly: DataTypeProposalPlan = planOf(proposals[0]!);

    expect(
      Date.parse(weekly.provingUntil) - Date.parse(weekly.provingSince),
    ).toBe(169 * 60 * 60 * 1000);
  });
});

describe("the proof", () => {
  test("narrows a draft that matches too much elsewhere, without another wait", async () => {
    /*
     * A store's notes that name a policy number in one note of five, with
     * no word that says so: scattered, not a field that holds the data.
     */
    stores[0]!.columns["public.policies.note"] = Array.from(
      { length: 200 },
      (_value: unknown, row: number): string => {
        return row % 5 === 0 ? `ref ${policyNumbers(1, row + 300)[0]!}` : "called";
      },
    );

    await run();

    for (const store of stores) {
      await scanStore(store, new Date(NOW.getTime() + 60_000));
    }

    const proposal: DataSecurityAiProposal = proposals[0]!;
    const proof: DataTypeProof = planOf(proposal).proof!;

    expect(proposal.status).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(proof.variant).toBe(DataTypeDraftVariant.Narrowed);
    expect(getGroupMatchShare(proof)).toBe(1);
    expect(proposal.proofMarkdown).toContain(
      "As first drafted it matched too much elsewhere",
    );
  });

  test("drops a draft that misses its own fields' values", async () => {
    answers = [draftAnswer({ ...POLICY_DRAFT, pattern: "\\b[A-Z]{2}-\\d{7}\\b" })];
    // Most of a store's policy numbers have no dash: the draft asks for one.
    for (const store of stores) {
      for (const [location, values] of Object.entries(store.columns)) {
        if (location.endsWith("policy_no") || location.endsWith("policyNumber")) {
          store.columns[location] = values.map((value: string): string => {
            return value.replace("-", "");
          });
        }
      }
    }

    await run();

    for (const store of stores) {
      await scanStore(store, new Date(NOW.getTime() + 60_000));
    }

    expect(proposals[0]!.status).toBe(DataSecurityAiProposalStatus.Expired);
    expect((proposals[0]!.result as JSONObject)["dropReason"]).toBe(
      DataTypeDropReason.MissesItsFields,
    );
  });

  test("offers what was counted once its time is over, though some stores were never scanned", async () => {
    await run();

    for (const store of stores.slice(0, 3)) {
      await scanStore(store, new Date(NOW.getTime() + 60_000));
    }

    expect(proposals[0]!.status).toBe(DataSecurityAiProposalStatus.Proving);

    await DataTypeProving.finishProofs({
      projectId: PROJECT_ID,
      now: new Date(NOW.getTime() + 49 * 60 * 60 * 1000),
    });

    expect(proposals[0]!.status).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(planOf(proposals[0]!).proof).toMatchObject({
      storesCounted: 3,
      storesInGroup: 6,
    });
  });

  test("a scan of a store outside the group, or with no counts, records nothing", async () => {
    await run();

    const version: number | undefined = proposals[0]!.version;
    const stranger: FakeStore = {
      id: ObjectID.generate(),
      name: "Elsewhere",
      columns: { "x.policy_no": policyNumbers(10, 5) },
    };

    expect(
      await DataTypeProving.recordStoreScan({
        projectId: PROJECT_ID,
        dataStoreId: stranger.id,
        result: {
          ...emptyContentScanResult(),
          shadowCounts: {
            [getShadowKey(proposals[0]!.id!, DataTypeDraftVariant.AsDrafted)]: {
              fields: 1,
              values: 10,
              matched: 10,
              matchedFields: {},
            },
          },
        },
        scannedAt: NOW,
      }),
    ).toBe(0);
    expect(
      await DataTypeProving.recordStoreScan({
        projectId: PROJECT_ID,
        dataStoreId: stores[0]!.id,
        result: emptyContentScanResult(),
        scannedAt: NOW,
      }),
    ).toBe(0);
    expect(proposals[0]!.version).toBe(version);
  });
});
