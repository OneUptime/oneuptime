import DataSecurityFieldSuggestion, {
  FIELD_SUGGESTION_MAX_COMPLETION_TOKENS,
  FIELD_SUGGESTION_TIMEOUT_IN_MS,
  FieldSuggestionOutcome,
  FieldSuggestionSkip,
  toSuggestedLocation,
} from "../../../../../Server/Utils/AI/DataSecurity/FieldSuggestion";
import {
  FIELD_SUGGESTION_SYSTEM_PROMPT,
  MAX_FIELDS_PER_SUGGESTION_REQUEST,
} from "../../../../../Server/Utils/AI/DataSecurity/FieldSuggestionPrompt";
import AIService, {
  AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
  AILogRequest,
} from "../../../../../Server/Services/AIService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import Queue from "../../../../../Server/Infrastructure/Queue";
import DataSecurityFindingWriter, {
  CustomDataTypeSummary,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityFindingWriter";
import { DATA_SECURITY_EVALUATE_PROJECT_JOB } from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import {
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  FieldSuggestionState,
  getFieldAnswerKey,
  readFieldSuggestionState,
  toStoredFieldSuggestionState,
} from "../../../../../Server/Utils/DataSecurity/FieldSuggestionState";
import logger from "../../../../../Server/Utils/Logger";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { DATA_TYPE_CATALOG } from "../../../../../Types/DataSecurity/DataTypeCatalog";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { UnplacedField } from "../../../../../Utils/DataSecurity/UnplacedFields";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * OneUptime AI names the data type of the fields a store's scan could not
 * place (DataSecurityFieldSuggestion): asked once per field while its
 * answer stands, never when Enable AI is off, never about a field a person
 * judged, written as suggestions that count only once confirmed. The
 * store, its findings, the model and the queue are stand-ins.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const CUSTOM_TYPE: string = "custom:5c0e1f3a-0000-4000-8000-000000000001";

let store: DataStore | null;
let latestStore: DataStore | null;
let findings: Array<DataStoreFinding>;
let aiEnabled: boolean;
let answer: string | Error;
let disabledDataTypeIds: Array<string>;
let customTypes: Map<string, CustomDataTypeSummary>;
let executeSpy: jest.SpyInstance;
let writeSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;
let saveSpy: jest.SpyInstance;
let queueSpy: jest.SpyInstance;
let infoSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

function field(location: string, shape: string = "AA-999999"): UnplacedField {
  return {
    location,
    locationKind: DataStoreLocationKind.Column,
    neighbours: ["name", "email"],
    shapes: [{ shape, share: 1 }],
    valueCount: 25,
    averageLength: 9,
  };
}

function storeWith(state: FieldSuggestionState): DataStore {
  const row: DataStore = new DataStore(STORE_ID);
  row.projectId = PROJECT_ID;
  row.kind = DataStoreKind.PostgreSql;
  row.isArchived = false;
  row.fieldSuggestionState = toStoredFieldSuggestionState(state);
  return row;
}

function aiFinding(
  location: string,
  dataTypeId: string,
  judged: { isConfirmed?: boolean; isSuppressed?: boolean } = {},
): DataStoreFinding {
  const row: DataStoreFinding = new DataStoreFinding(ObjectID.generate());
  row.dataStoreId = STORE_ID;
  row.location = location;
  row.dataTypeId = dataTypeId;
  row.isAiSuggested = true;
  row.isConfirmed = Boolean(judged.isConfirmed);
  row.isSuppressed = Boolean(judged.isSuppressed);
  findings.push(row);
  return row;
}

function answerWith(
  fields: Array<{ ref: string; dataTypeId: string | null; reason?: string }>,
): string {
  return JSON.stringify({ fields });
}

function request(): AILogRequest {
  expect(executeSpy).toHaveBeenCalledTimes(1);
  return executeSpy.mock.calls[0]![0] as AILogRequest;
}

function prompt(): JSONObject {
  return JSON.parse(request().messages[1]!.content as string) as JSONObject;
}

function askedLocations(): Array<string> {
  return (prompt()["fields"] as Array<JSONObject>).map(
    (entry: JSONObject): string => {
      return entry["location"] as string;
    },
  );
}

function written(): Array<LocationFindings> {
  if (writeSpy.mock.calls.length === 0) {
    return [];
  }

  expect(writeSpy).toHaveBeenCalledTimes(1);
  return (writeSpy.mock.calls[0]![0] as { locations: Array<LocationFindings> })
    .locations;
}

function writtenTypes(): Array<[string, string, string | undefined]> {
  return written().map(
    (entry: LocationFindings): [string, string, string | undefined] => {
      return [
        entry.location,
        entry.classifications[0]!.dataTypeId,
        entry.classifications[0]!.aiReason,
      ];
    },
  );
}

function savedState(): FieldSuggestionState {
  expect(saveSpy).toHaveBeenCalledTimes(1);
  return readFieldSuggestionState(
    (saveSpy.mock.calls[0]![0] as { data: JSONObject }).data[
      "fieldSuggestionState"
    ],
  );
}

function suggest(): Promise<FieldSuggestionOutcome> {
  return DataSecurityFieldSuggestion.suggestForStore({
    projectId: PROJECT_ID,
    dataStoreId: STORE_ID,
  });
}

beforeEach(() => {
  findings = [];
  aiEnabled = true;
  answer = answerWith([]);
  disabledDataTypeIds = [];
  customTypes = new Map();
  store = storeWith({ pending: [], answers: {} });
  latestStore = null;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  let reads: number = 0;
  jest.spyOn(DataStoreService, "findOneById").mockImplementation((async () => {
    reads++;
    return reads > 1 && latestStore ? latestStore : store;
  }) as never);
  saveSpy = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest.spyOn(AIService, "isProjectAIEnabled").mockImplementation((async () => {
    return aiEnabled;
  }) as never);
  executeSpy = jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async () => {
      if (answer instanceof Error) {
        throw answer;
      }
      return { content: answer };
    }) as never);
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockImplementation((async () => {
      return {
        setting: { disabledDataTypeIds },
        options: {},
        customTypes,
      };
    }) as never);
  jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      expect(findBy.query).toEqual({
        dataStoreId: STORE_ID,
        isAiSuggested: true,
      });
      return findings;
    }) as never);
  deleteSpy = jest
    .spyOn(DataStoreFindingService, "deleteBy")
    .mockImplementation((async (deleteBy: { query: JSONObject }) => {
      return ((deleteBy.query["_id"] as Includes).values as Array<string>)
        .length;
    }) as never);
  writeSpy = jest
    .spyOn(DataSecurityFindingWriter, "recordFieldSuggestions")
    .mockImplementation((async (data: {
      locations: Array<LocationFindings>;
    }) => {
      return data.locations.length;
    }) as never);
  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined as never;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("asking OneUptime AI", () => {
  test("asks about the pending fields in one call, writes each type it names, and keeps every answer", async () => {
    const tax: UnplacedField = field(
      "public.customers.steuer_ref",
      "99/999/99999",
    );
    const kunde: UnplacedField = field("public.customers.kundennr");
    const code: UnplacedField = field("public.customers.promo", "AAAA99");
    store = storeWith({ pending: [tax, kunde, code], answers: {} });
    answer = answerWith([
      {
        ref: "F1",
        dataTypeId: "de-tax-id",
        reason: "Steuer is German for tax; the shape is a tax number.",
      },
      { ref: "F2", dataTypeId: null, reason: "Nothing points to a type." },
    ]);

    const outcome: FieldSuggestionOutcome = await suggest();

    expect(outcome).toEqual({ asked: 3, written: 1, removed: 0 });
    expect(askedLocations()).toEqual([
      "public.customers.steuer_ref",
      "public.customers.kundennr",
      "public.customers.promo",
    ]);
    expect(writtenTypes()).toEqual([
      [
        "public.customers.steuer_ref",
        "de-tax-id",
        "Steuer is German for tax; the shape is a tax number.",
      ],
    ]);

    // Every field asked is answered for a month, the unanswered one as no type.
    const saved: FieldSuggestionState = savedState();

    expect(saved.answers[getFieldAnswerKey(tax)]).toEqual({
      at: NOW.toISOString(),
      dataTypeId: "de-tax-id",
      reason: "Steuer is German for tax; the shape is a tax number.",
    });
    expect(saved.answers[getFieldAnswerKey(kunde)]).toEqual({
      at: NOW.toISOString(),
    });
    expect(saved.answers[getFieldAnswerKey(code)]).toEqual({
      at: NOW.toISOString(),
    });
    expect(saved.pending).toEqual([tax, kunde, code]);

    // The store's evaluation follows what was written.
    expect(
      queueSpy.mock.calls.map((call: Array<unknown>) => {
        return call[2];
      }),
    ).toEqual([DATA_SECURITY_EVALUATE_PROJECT_JOB]);
  });

  test("one constrained call: no retries, no previews in the AI Logs, the system message first", async () => {
    store = storeWith({ pending: [field("t.kundennr")], answers: {} });

    await suggest();

    const sent: AILogRequest = request();

    expect(sent).toMatchObject({
      projectId: PROJECT_ID,
      feature: AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
      storeContentPreviews: false,
      storeErrorDetails: false,
      temperature: 0,
      maxTokens: FIELD_SUGGESTION_MAX_COMPLETION_TOKENS,
      requestTimeoutInMs: FIELD_SUGGESTION_TIMEOUT_IN_MS,
      requestRetries: 0,
      protectRequestParameters: true,
    });
    expect(sent.messages).toHaveLength(2);
    expect(sent.messages[0]).toEqual({
      role: "system",
      content: FIELD_SUGGESTION_SYSTEM_PROMPT,
    });
    expect(sent.messages[1]!.role).toBe("user");
    // No person started it, and it is about no incident or alert.
    expect(sent.userId).toBeUndefined();
    expect(sent.incidentId).toBeUndefined();
    expect(prompt()["store"]).toBe(DataStoreKind.PostgreSql);
  });

  test("asks about at most MAX_FIELDS_PER_SUGGESTION_REQUEST fields; the rest after the next scan", async () => {
    const pending: Array<UnplacedField> = Array.from(
      { length: MAX_FIELDS_PER_SUGGESTION_REQUEST + 5 },
      (_value: unknown, index: number) => {
        return field(`t.c${index}`);
      },
    );
    store = storeWith({ pending, answers: {} });

    const outcome: FieldSuggestionOutcome = await suggest();

    expect(outcome.asked).toBe(MAX_FIELDS_PER_SUGGESTION_REQUEST);
    expect(askedLocations()).toHaveLength(MAX_FIELDS_PER_SUGGESTION_REQUEST);
    expect(Object.keys(savedState().answers)).toHaveLength(
      MAX_FIELDS_PER_SUGGESTION_REQUEST,
    );

    // The next run asks about the five left, and only them.
    store = storeWith(savedState());
    executeSpy.mockClear();
    saveSpy.mockClear();

    await suggest();

    expect(askedLocations()).toEqual([
      `t.c${MAX_FIELDS_PER_SUGGESTION_REQUEST}`,
      `t.c${MAX_FIELDS_PER_SUGGESTION_REQUEST + 1}`,
      `t.c${MAX_FIELDS_PER_SUGGESTION_REQUEST + 2}`,
      `t.c${MAX_FIELDS_PER_SUGGESTION_REQUEST + 3}`,
      `t.c${MAX_FIELDS_PER_SUGGESTION_REQUEST + 4}`,
    ]);
  });

  test("names only the project's types, less those it turned off; its own types by their names", async () => {
    disabledDataTypeIds = ["iban"];
    customTypes = new Map([
      [
        CUSTOM_TYPE,
        {
          name: "Kundennummer",
          category: DataCategory.ContactAndIdentity,
          sensitivity: DataSensitivity.Confidential,
        },
      ],
    ]);
    store = storeWith({
      pending: [field("t.kundennr"), field("t.konto", "AA99 9999")],
      answers: {},
    });
    answer = answerWith([
      { ref: "F1", dataTypeId: CUSTOM_TYPE, reason: "Kunde is customer." },
      { ref: "F2", dataTypeId: "iban", reason: "Konto is account." },
    ]);

    await suggest();

    const types: Array<Array<string>> = prompt()["dataTypes"] as Array<
      Array<string>
    >;
    const ids: Array<string> = types.map((type: Array<string>) => {
      return type[0]!;
    });

    expect(ids).not.toContain("iban");
    expect(ids).toContain(CUSTOM_TYPE);
    expect(ids).toHaveLength(DATA_TYPE_CATALOG.length);
    expect(
      types.find((type: Array<string>) => {
        return type[0] === CUSTOM_TYPE;
      }),
    ).toEqual([CUSTOM_TYPE, "Kundennummer"]);
    // A type it may not name is no type.
    expect(writtenTypes()).toEqual([
      ["t.kundennr", CUSTOM_TYPE, "Kunde is customer."],
    ]);
    expect(
      (writeSpy.mock.calls[0]![0] as { customDataTypes: unknown })
        .customDataTypes,
    ).toBe(customTypes);
  });

  test("a type that comes with a country is named with it", async () => {
    store = storeWith({ pending: [field("t.x")], answers: {} });

    await suggest();

    const withCountry: (typeof DATA_TYPE_CATALOG)[number] | undefined =
      DATA_TYPE_CATALOG.find((type: (typeof DATA_TYPE_CATALOG)[number]) => {
        return Boolean(type.country);
      });
    const types: Array<Array<string>> = prompt()["dataTypes"] as Array<
      Array<string>
    >;

    expect(
      types.find((type: Array<string>) => {
        return type[0] === withCountry!.id;
      }),
    ).toEqual([
      withCountry!.id,
      `${withCountry!.name} (${withCountry!.country})`,
    ]);
  });
});

describe("answers that stand", () => {
  test("the next scan asks nothing about fields whose answers stand, and writes their types again", async () => {
    const tax: UnplacedField = field("t.steuer_ref", "99/999/99999");
    const kunde: UnplacedField = field("t.kundennr");
    store = storeWith({
      pending: [tax, kunde],
      answers: {
        [getFieldAnswerKey(tax)]: {
          at: new Date(NOW.getTime() - 5 * DAY_IN_MS).toISOString(),
          dataTypeId: "de-tax-id",
          reason: "Steuer.",
        },
        [getFieldAnswerKey(kunde)]: {
          at: new Date(NOW.getTime() - 5 * DAY_IN_MS).toISOString(),
        },
      },
    });

    const outcome: FieldSuggestionOutcome = await suggest();

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome).toEqual({ asked: 0, written: 1, removed: 0 });
    expect(writtenTypes()).toEqual([["t.steuer_ref", "de-tax-id", "Steuer."]]);
  });

  test("a field whose answer is a month old, or that looks different now, is asked again", async () => {
    const old: UnplacedField = field("t.old");
    const changed: UnplacedField = field("t.changed");
    store = storeWith({
      pending: [old, { ...changed, shapes: [{ shape: "9999", share: 1 }] }],
      answers: {
        [getFieldAnswerKey(old)]: {
          at: new Date(NOW.getTime() - 31 * DAY_IN_MS).toISOString(),
          dataTypeId: "iban",
        },
        [getFieldAnswerKey(changed)]: { at: NOW.toISOString() },
      },
    });

    await suggest();

    expect(askedLocations()).toEqual(["t.old", "t.changed"]);
  });
});

describe("what a person judged", () => {
  test("a field a person confirmed or turned down is not asked about; the confirmed one is written again", async () => {
    store = storeWith({
      pending: [field("t.confirmed"), field("t.declined"), field("t.new")],
      answers: {},
    });
    aiFinding("t.confirmed", "de-tax-id", { isConfirmed: true });
    aiFinding("t.declined", "iban", { isSuppressed: true });

    await suggest();

    expect(askedLocations()).toEqual(["t.new"]);
    // Written again so it stays counted; with no reason, its own is kept.
    expect(writtenTypes()).toEqual([["t.confirmed", "de-tax-id", undefined]]);
  });

  test("a confirmed suggestion later turned down is not written again", async () => {
    store = storeWith({ pending: [field("t.both")], answers: {} });
    aiFinding("t.both", "de-tax-id", { isConfirmed: true, isSuppressed: true });

    await suggest();

    expect(executeSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test("a suggestion nobody judged goes when its field's answer names another type, or none", async () => {
    const renamed: UnplacedField = field("t.renamed");
    const cleared: UnplacedField = field("t.cleared");
    const same: UnplacedField = field("t.same");
    store = storeWith({ pending: [renamed, cleared, same], answers: {} });
    const wrongType: DataStoreFinding = aiFinding("t.renamed", "iban");
    const noType: DataStoreFinding = aiFinding("t.cleared", "iban");
    aiFinding("t.same", "de-tax-id");
    answer = answerWith([
      { ref: "F1", dataTypeId: "de-tax-id", reason: "Tax." },
      { ref: "F2", dataTypeId: null },
      { ref: "F3", dataTypeId: "de-tax-id", reason: "Tax." },
    ]);

    const outcome: FieldSuggestionOutcome = await suggest();

    expect(outcome.removed).toBe(2);
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    const deleted: { query: JSONObject; props: JSONObject } = deleteSpy.mock
      .calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect((deleted.query["_id"] as Includes).values).toEqual([
      wrongType.id!.toString(),
      noType.id!.toString(),
    ]);
    // Only a suggestion nobody judged is ever taken away.
    expect(deleted.query).toMatchObject({
      isAiSuggested: true,
      isConfirmed: false,
      isSuppressed: false,
    });
    expect(deleted.props).toEqual({ isRoot: true });
    expect(writtenTypes()).toEqual([
      ["t.renamed", "de-tax-id", "Tax."],
      ["t.same", "de-tax-id", "Tax."],
    ]);
  });
});

describe("when nothing is asked", () => {
  test("with Enable AI off, nothing is asked, written or kept", async () => {
    aiEnabled = false;
    store = storeWith({ pending: [field("t.kundennr")], answers: {} });

    const outcome: FieldSuggestionOutcome = await suggest();

    expect(outcome).toEqual({
      asked: 0,
      written: 0,
      removed: 0,
      skipped: FieldSuggestionSkip.AiOff,
    });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a store that is gone, archived or another project's is left alone", async () => {
    for (const row of [
      null,
      (() => {
        const archived: DataStore = storeWith({
          pending: [field("t.a")],
          answers: {},
        });
        archived.isArchived = true;
        return archived;
      })(),
      (() => {
        const other: DataStore = storeWith({
          pending: [field("t.a")],
          answers: {},
        });
        other.projectId = ObjectID.generate();
        return other;
      })(),
    ]) {
      store = row;

      await expect(suggest()).resolves.toEqual({
        asked: 0,
        written: 0,
        removed: 0,
        skipped: FieldSuggestionSkip.StoreGone,
      });
    }

    expect(executeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("a store with nothing pending asks nothing, and does not read the switch", async () => {
    const aiSpy: jest.SpyInstance = jest.spyOn(AIService, "isProjectAIEnabled");

    await expect(suggest()).resolves.toMatchObject({
      skipped: FieldSuggestionSkip.NothingPending,
    });
    expect(aiSpy).not.toHaveBeenCalled();
  });

  test("a refusal - no provider, no credits, a daily limit - is a line in the log; nothing new is kept", async () => {
    const tax: UnplacedField = field("t.steuer_ref");
    const standing: UnplacedField = field("t.iban_ref", "AA99");
    store = storeWith({
      pending: [tax, standing],
      answers: {
        [getFieldAnswerKey(standing)]: {
          at: NOW.toISOString(),
          dataTypeId: "iban",
          reason: "Bank.",
        },
      },
    });
    answer = new Error("No LLM provider is set up for this project.");

    const outcome: FieldSuggestionOutcome = await suggest();

    expect(outcome).toEqual({
      asked: 0,
      written: 1,
      removed: 0,
      skipped: FieldSuggestionSkip.NoAnswer,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      `DataSecurity: OneUptime AI did not suggest data types for store ${STORE_ID.toString()}: No LLM provider is set up for this project.`,
    );
    // The standing answer is still written; the refused field is asked after the next scan.
    expect(writtenTypes()).toEqual([["t.iban_ref", "iban", "Bank."]]);
    expect(Object.keys(savedState().answers)).toEqual([
      getFieldAnswerKey(standing),
    ]);
  });

  test("an answer that is not the JSON asked for keeps nothing, and is noted", async () => {
    store = storeWith({ pending: [field("t.kundennr")], answers: {} });
    answer = "I am not able to classify these fields.";

    const outcome: FieldSuggestionOutcome = await suggest();

    expect(outcome.skipped).toBe(FieldSuggestionSkip.NoAnswer);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(savedState().answers).toEqual({});
    expect(writeSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });
});

describe("saving the answers", () => {
  test("they join whatever the latest scan left pending", async () => {
    const asked: UnplacedField = field("t.asked");
    const newer: UnplacedField = field("t.newer");
    store = storeWith({ pending: [asked], answers: {} });
    latestStore = storeWith({ pending: [newer], answers: {} });

    await suggest();

    const saved: FieldSuggestionState = savedState();

    expect(saved.pending).toEqual([newer]);
    expect(Object.keys(saved.answers)).toEqual([getFieldAnswerKey(asked)]);
  });
});

describe("toSuggestedLocation", () => {
  test("a suggestion is Low, matched no value, has no sample, and is OneUptime AI's", () => {
    expect(
      toSuggestedLocation({
        field: field("t.kundennr"),
        dataTypeId: CUSTOM_TYPE,
        reason: "Kunde is customer.",
      }),
    ).toEqual({
      location: "t.kundennr",
      locationKind: DataStoreLocationKind.Column,
      classifications: [
        {
          dataTypeId: CUSTOM_TYPE,
          matchCount: 0,
          testValueCount: 0,
          confidence: DataConfidence.Low,
          maskedSamples: [],
          distinctValues: 0,
          distinctValuesCapped: false,
          matchRatio: 0,
          valueCount: 25,
          valuesWithMatch: 0,
          isFreeText: false,
          nameHinted: false,
          foundByName: false,
          isAiSuggested: true,
          aiReason: "Kunde is customer.",
        },
      ],
    });
  });
});
