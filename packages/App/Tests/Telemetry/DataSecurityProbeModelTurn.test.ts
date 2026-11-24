import { mockRouter } from "Common/Tests/Server/API/Helpers";
import DataSecuritySetting from "Common/Models/DatabaseModels/DataSecuritySetting";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import { DataSecurityProbeStoreWork } from "Common/Server/Utils/DataSecurity/DataSecurityProbeScan";
import { MODEL_TURN_STATE_KEY } from "Common/Server/Utils/DataSecurity/Model/ModelTurns";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import ObjectID from "Common/Types/ObjectID";
import { buildStoreWork } from "../../FeatureSet/Telemetry/API/ProbeIngest/DataSecurity";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

/*
 * THE TABLE A PROBE'S MODEL STARTS AT (#10928).
 *
 * A database only a probe can reach takes turns at the model's time as a
 * worker's does: the server hands the probe, with each store's work, the
 * table the store's last scan's model stopped at - kept in the store's
 * content scan state from the probe's last report - and nothing when the
 * store has none.
 */

function storeWith(contentScanState: unknown): DataStore {
  const store: DataStore = new DataStore(
    new ObjectID("0192f1a0-0000-7000-8000-000000109281"),
  );

  store.projectId = new ObjectID("0192f1a0-0000-7000-8000-000000109282");
  store.kind = DataStoreKind.PostgreSql;
  store.probeConnectionVariable = "ORDERS_DB";
  store.scanExclusions = [];
  store.contentScanState = contentScanState as never;

  return store;
}

function workOf(contentScanState: unknown): DataSecurityProbeStoreWork {
  const settings: DataSecuritySetting = new DataSecuritySetting();

  settings.isModelScanEnabled = true;

  return buildStoreWork({
    store: storeWith(contentScanState),
    settings,
    customDataTypes: [],
  })!;
}

describe("a probe's work", () => {
  test("names the table its store's last scan's model stopped at", () => {
    const work: DataSecurityProbeStoreWork = workOf({
      [MODEL_TURN_STATE_KEY]: { resumeAt: "public.tickets" },
      plaintextPasswordFields: [],
    });

    expect(work.modelResumeAt).toBe("public.tickets");
    expect(work.findNamesAndAddresses).toBe(true);
  });

  test("names none when the store has no turn: its model starts at the first table", () => {
    for (const state of [
      undefined,
      null,
      {},
      { plaintextPasswordFields: [] },
    ]) {
      expect("modelResumeAt" in workOf(state)).toBe(false);
    }
  });

  test("never hands the probe anything else of the store's state", () => {
    const work: DataSecurityProbeStoreWork = workOf({
      [MODEL_TURN_STATE_KEY]: { resumeAt: "public.tickets" },
      plaintextPasswordFields: ["public.users.password"],
      etags: { "a.csv": { etag: "1" } },
    });

    expect(JSON.stringify(work)).not.toContain("public.users.password");
    expect(JSON.stringify(work)).not.toContain("etags");
  });
});
