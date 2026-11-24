import DataSecuritySetting from "../../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import Project from "../../../../../Models/DatabaseModels/Project";
import DataSecuritySettingService from "../../../../../Server/Services/DataSecuritySettingService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import {
  AddScanExclusionAction,
  TurnOffDataTypeAction,
} from "../../../../../Server/Utils/AI/DataSecurity/Actions/ScanTuningActions";
import DataSecurityAiProposals from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import DataSecurityScanTuning, {
  ScanTuningOutcome,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityScanTuning";
import logger from "../../../../../Server/Utils/Logger";
import { DataSecurityAiWithoutAskingVerdict } from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  getDataTypesToTurnOff,
  getLocationsToExclude,
  getScanExclusionFor,
  readAddScanExclusionPlan,
  readTurnOffDataTypePlan,
  SCAN_TUNING_LIMITS,
  TuningFinding,
} from "../../../../../Types/DataSecurity/DataSecurityScanTuning";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THE TEAM'S DECISIONS SAY OF ITS SCANS (#10372): a built-in type
 * every finding of which was marked not sensitive - enough of them, on
 * enough stores - is proposed for turning off; a location of a store where
 * every finding was is proposed for leaving out, where its scanner can.
 * Each always asks, and Never Sensitive is never proposed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

let counter: number = 0;

function storeId(index: number): string {
  return `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
}

function tuning(more: Partial<TuningFinding>): TuningFinding {
  counter++;

  return {
    id: `f${counter}`,
    dataStoreId: storeId(1),
    dataTypeId: "uk-nino",
    location: `public.t${counter}.ref`,
    locationKind: "Column",
    isSuppressed: true,
    isAiSuggested: false,
    ...more,
  };
}

describe("which built-in types to turn off", () => {
  test("one every finding of which was marked not sensitive, on enough stores", () => {
    expect(
      getDataTypesToTurnOff({
        findings: [
          tuning({ dataStoreId: storeId(1) }),
          tuning({ dataStoreId: storeId(2) }),
          tuning({ dataStoreId: storeId(3) }),
          tuning({ dataStoreId: storeId(3) }),
        ],
        disabledDataTypeIds: new Set(),
      }),
    ).toEqual([{ dataTypeId: "uk-nino", findings: 4, stores: 3 }]);
  });

  test("never one a finding of which still counts, or waits", () => {
    expect(
      getDataTypesToTurnOff({
        findings: [
          tuning({ dataStoreId: storeId(1) }),
          tuning({ dataStoreId: storeId(2) }),
          tuning({ dataStoreId: storeId(3) }),
          tuning({ dataStoreId: storeId(4), isSuppressed: false }),
        ],
        disabledDataTypeIds: new Set(),
      }),
    ).toEqual([]);
  });

  test("never on too few findings, or on one store", () => {
    expect(
      getDataTypesToTurnOff({
        findings: [
          tuning({ dataStoreId: storeId(1) }),
          tuning({ dataStoreId: storeId(2) }),
        ],
        disabledDataTypeIds: new Set(),
      }),
    ).toEqual([]);
    expect(
      getDataTypesToTurnOff({
        findings: [tuning({}), tuning({}), tuning({}), tuning({})],
        disabledDataTypeIds: new Set(),
      }),
    ).toEqual([]);
    expect(SCAN_TUNING_LIMITS.minFindingsToTurnOff).toBe(3);
    expect(SCAN_TUNING_LIMITS.minStoresToTurnOff).toBe(2);
  });

  test("never a project's own type, one turned off already, or for OneUptime AI's turned-down suggestions", () => {
    const three: (more: Partial<TuningFinding>) => Array<TuningFinding> = (
      more: Partial<TuningFinding>,
    ): Array<TuningFinding> => {
      return [1, 2, 3].map((index: number): TuningFinding => {
        return tuning({ dataStoreId: storeId(index), ...more });
      });
    };

    expect(
      getDataTypesToTurnOff({
        findings: three({ dataTypeId: "custom:employee-id" }),
        disabledDataTypeIds: new Set(),
      }),
    ).toEqual([]);
    expect(
      getDataTypesToTurnOff({
        findings: three({}),
        disabledDataTypeIds: new Set(["uk-nino"]),
      }),
    ).toEqual([]);
    expect(
      getDataTypesToTurnOff({
        findings: three({ isAiSuggested: true }),
        disabledDataTypeIds: new Set(),
      }),
    ).toEqual([]);
  });
});

describe("which locations to leave out", () => {
  const stores: Map<string, { kind: string; scanExclusions?: unknown }> =
    new Map([
      [storeId(1), { kind: DataStoreKind.PostgreSql, scanExclusions: [] }],
      [storeId(2), { kind: DataStoreKind.TelemetryLogs, scanExclusions: [] }],
      [storeId(3), { kind: DataStoreKind.AwsS3Bucket, scanExclusions: [] }],
    ]);

  test("a column every finding at which was marked not sensitive", () => {
    expect(
      getLocationsToExclude({
        findings: [
          tuning({
            location: "public.test_cards.card",
            dataTypeId: "credit-card-number",
          }),
          tuning({
            location: "public.test_cards.card",
            dataTypeId: "card-verification-code",
          }),
        ],
        stores,
      }),
    ).toEqual([
      {
        dataStoreId: storeId(1),
        location: "public.test_cards.card",
        exclusion: "public.test_cards.card",
        findings: 2,
        dataTypeIds: ["card-verification-code", "credit-card-number"],
      },
    ]);
  });

  test("a telemetry attribute, named whole", () => {
    const [proposed] = getLocationsToExclude({
      findings: ["email-address", "phone-number"].map(
        (dataTypeId: string): TuningFinding => {
          return tuning({
            dataStoreId: storeId(2),
            location: "attributes.debug.payload",
            locationKind: "Attribute",
            dataTypeId,
          });
        },
      ),
      stores,
    });

    expect(proposed?.exclusion).toBe("attributes.debug.payload");
  });

  test("never where a finding still counts or waits, nor on one finding", () => {
    expect(
      getLocationsToExclude({
        findings: [
          tuning({ location: "public.users.notes", dataTypeId: "email-address" }),
          tuning({
            location: "public.users.notes",
            dataTypeId: "phone-number",
            isSuppressed: false,
          }),
        ],
        stores,
      }),
    ).toEqual([]);
    expect(
      getLocationsToExclude({
        findings: [tuning({ location: "public.users.ref" })],
        stores,
      }),
    ).toEqual([]);
  });

  test("never on an object store, whose exclusions leave out whole objects", () => {
    expect(
      getLocationsToExclude({
        findings: ["email-address", "phone-number"].map(
          (dataTypeId: string): TuningFinding => {
            return tuning({
              dataStoreId: storeId(3),
              location: "exports/*/users-*.csv › email",
              locationKind: "Field",
              dataTypeId,
            });
          },
        ),
        stores,
      }),
    ).toEqual([]);
  });

  test("never one left out already, whatever its case", () => {
    expect(
      getLocationsToExclude({
        findings: ["email-address", "phone-number"].map(
          (dataTypeId: string): TuningFinding => {
            return tuning({ location: "public.seed.contact", dataTypeId });
          },
        ),
        stores: new Map([
          [
            storeId(1),
            {
              kind: DataStoreKind.PostgreSql,
              scanExclusions: ["PUBLIC.SEED.CONTACT"],
            },
          ],
        ]),
      }),
    ).toEqual([]);
  });

  test("the exclusion each kind of store reads", () => {
    expect(
      getScanExclusionFor({
        storeKind: DataStoreKind.MySql,
        location: "shop.orders.card",
        locationKind: "Column",
      }),
    ).toBe("shop.orders.card");
    expect(
      getScanExclusionFor({
        storeKind: DataStoreKind.TelemetryTraces,
        location: "attributes.http.request.body",
        locationKind: "Attribute",
      }),
    ).toBe("attributes.http.request.body");
    // A log body, a warehouse, a bucket: no one place to leave out.
    expect(
      getScanExclusionFor({
        storeKind: DataStoreKind.TelemetryLogs,
        location: "body",
        locationKind: "Body",
      }),
    ).toBeNull();
    expect(
      getScanExclusionFor({
        storeKind: DataStoreKind.GcpBigQueryDataset,
        location: "ds.t.c",
        locationKind: "Column",
      }),
    ).toBeNull();
  });
});

describe("the plans, read back", () => {
  test("a type to turn off is only a built-in one", () => {
    expect(
      readTurnOffDataTypePlan({ dataTypeId: "uk-nino", findings: 3, stores: 2 }),
    ).toMatchObject({ dataTypeId: "uk-nino", findings: 3, stores: 2 });
    expect(readTurnOffDataTypePlan({ dataTypeId: "custom:x" })).toBeNull();
    expect(readTurnOffDataTypePlan("uk-nino")).toBeNull();
  });

  test("a location to leave out names its store and its exclusion", () => {
    expect(readAddScanExclusionPlan({ dataStoreId: "s" })).toBeNull();
    expect(
      readAddScanExclusionPlan({
        dataStoreId: "s",
        exclusion: "attributes.debug",
        dataTypeIds: ["email-address", 3],
      }),
    ).toMatchObject({ exclusion: "attributes.debug", dataTypeIds: ["email-address"] });
  });
});

describe("the look over the project's decisions", () => {
  let project: Project;
  let dismissed: Array<DataStoreFinding>;
  let all: Array<DataStoreFinding>;
  let setting: DataSecuritySetting;
  let stores: Array<DataStore>;
  let proposeSpy: jest.SpyInstance;

  function row(more: Partial<DataStoreFinding>): DataStoreFinding {
    const finding: DataStoreFinding = new DataStoreFinding(ObjectID.generate());
    finding.dataTypeId = "uk-nino";
    finding.locationKind = "Column";
    finding.isSuppressed = true;
    finding.isAiSuggested = false;
    Object.assign(finding, more);
    all.push(finding);

    if (finding.isSuppressed && !finding.isAiSuggested) {
      dismissed.push(finding);
    }

    return finding;
  }

  beforeEach(() => {
    dismissed = [];
    all = [];
    project = new Project(PROJECT_ID);
    project.enableAi = true;
    project.enableAutomaticDataSecurityAi = true;
    setting = new DataSecuritySetting(ObjectID.generate());
    setting.disabledDataTypeIds = [];
    stores = [1, 2, 3].map((index: number): DataStore => {
      const store: DataStore = new DataStore(new ObjectID(storeId(index)));
      store.name = `store-${index}`;
      store.kind = DataStoreKind.PostgreSql;
      store.scanExclusions = [];
      return store;
    });

    jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
      return project;
    }) as never);
    jest
      .spyOn(DataSecuritySettingService, "getOrCreateForProject")
      .mockImplementation((async () => {
        return setting;
      }) as never);
    jest
      .spyOn(DataStoreFindingService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        if (findBy.query["isSuppressed"] === true) {
          return dismissed;
        }

        return all.filter((finding: DataStoreFinding): boolean => {
          return (
            (!findBy.query["dataTypeId"] ||
              finding.dataTypeId === findBy.query["dataTypeId"]) &&
            (!findBy.query["location"] ||
              finding.location === findBy.query["location"]) &&
            (!findBy.query["dataStoreId"] ||
              finding.dataStoreId?.toString() ===
                String(findBy.query["dataStoreId"]))
          );
        });
      }) as never);
    jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
      return stores;
    }) as never);
    proposeSpy = jest
      .spyOn(DataSecurityAiProposals, "propose")
      .mockResolvedValue({ work: "Judge", reason: "Proposed" } as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function propose(): Promise<ScanTuningOutcome> {
    return DataSecurityScanTuning.proposeForProject({ projectId: PROJECT_ID });
  }

  test("a built-in type the project always dismisses is proposed for turning off, and asks", async () => {
    for (const index of [1, 2, 3, 3]) {
      row({
        dataStoreId: new ObjectID(storeId(index)),
        location: `public.t${index}_${all.length}.ref`,
      });
    }

    const outcome: ScanTuningOutcome = await propose();

    expect(outcome).toEqual({
      skipped: null,
      typesProposed: 1,
      exclusionsProposed: 0,
    });
    expect(proposeSpy).toHaveBeenCalledTimes(1);

    const call: {
      action: unknown;
      issue: unknown;
      store: unknown;
      change: { plan: JSONObject; title: string };
      verdict: DataSecurityAiWithoutAskingVerdict;
    } = proposeSpy.mock.calls[0]![0];

    expect(call.action).toBe(TurnOffDataTypeAction);
    expect(call.issue).toBeNull();
    expect(call.store).toBeNull();
    expect(call.verdict.runWithoutAsking).toBe(false);
    expect(call.change.plan).toEqual({
      dataTypeId: "uk-nino",
      dataTypeName: "UK National Insurance number",
      findings: 4,
      stores: 3,
    });
  });

  test("a type with one finding that still counts is not", async () => {
    for (const index of [1, 2, 3]) {
      row({
        dataStoreId: new ObjectID(storeId(index)),
        location: `public.t${index}.ref`,
      });
    }

    row({
      dataStoreId: new ObjectID(storeId(1)),
      location: "public.people.nino",
      isSuppressed: false,
    });

    expect((await propose()).typesProposed).toBe(0);
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  test("a column always dismissed is proposed for leaving out of its store's scans", async () => {
    for (const dataTypeId of ["email-address", "phone-number"]) {
      row({
        dataStoreId: new ObjectID(storeId(1)),
        location: "public.seed_users.contact",
        dataTypeId,
      });
    }

    const outcome: ScanTuningOutcome = await propose();

    expect(outcome.exclusionsProposed).toBe(1);

    const call: {
      action: unknown;
      store: DataStore;
      change: { plan: JSONObject };
    } = proposeSpy.mock.calls[0]![0];

    expect(call.action).toBe(AddScanExclusionAction);
    expect(call.store.id!.toString()).toBe(storeId(1));
    expect(call.change.plan).toMatchObject({
      storeName: "store-1",
      exclusion: "public.seed_users.contact",
      findings: 2,
    });
  });

  test("never touches Never Sensitive, whatever it proposes", async () => {
    for (const index of [1, 2, 3]) {
      row({
        dataStoreId: new ObjectID(storeId(index)),
        location: `public.t${index}.ref`,
      });
    }

    await propose();

    for (const call of proposeSpy.mock.calls) {
      const text: string = JSON.stringify(call[0]);

      expect(text).not.toContain("allowedValues");
      expect(text.toLowerCase()).not.toContain("never sensitive");
    }
  });

  test("with OneUptime AI off, nothing is read or proposed", async () => {
    project.enableAutomaticDataSecurityAi = false;

    expect((await propose()).skipped).toBe("ai-off");
    expect(proposeSpy).not.toHaveBeenCalled();
  });
});
