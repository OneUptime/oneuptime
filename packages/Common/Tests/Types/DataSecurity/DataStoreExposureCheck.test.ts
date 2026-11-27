import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CLOUD_POSTURE_READ_DATA_STORE_KINDS,
  DATA_STORE_KINDS,
  DataStoreExposureCheck,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  ENDPOINT_CHECKED_DATA_STORE_KINDS,
  getDataStoreExposureCheck,
  isSearchEngineDataStoreKind,
  PROBE_SCANNABLE_DATA_STORE_KINDS,
  PROBE_SCANNABLE_DATABASE_KINDS,
  SEARCH_ENGINE_DATA_STORE_KINDS,
  WORKER_CLAIMED_DATA_STORE_KINDS,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  ALL_DATA_STORE_EXPOSURES,
  DATA_STORE_EXPOSURE_DESCRIPTION,
  DATA_STORE_EXPOSURE_WEIGHT,
  DataStoreExposure,
  DataStorePostureFacts,
  DataStorePostureReadFrom,
  getDataStoreExposure,
  isDataStoreExposure,
  isPostureFactUnknowable,
  isPostureFromCloudApi,
  UNKNOWN_DATA_STORE_EXPOSURES,
} from "../../../Types/DataSecurity/DataStorePosture";

/*
 * HOW ONEUPTIME LEARNS HOW EXPOSED A STORE IS, AND WHAT IT SAYS WHEN IT
 * CANNOT (#11140).
 *
 * A store's exposure was Unknown whenever nothing had read its posture -
 * a cloud store whose connection had not been read yet, and a store
 * nothing could ever read alike - so a self-managed store looked forever
 * like one about to be checked. Now each kind says how its exposure is
 * learnt (getDataStoreExposureCheck), and a store with nothing read is Not
 * checked yet, or Can't be checked for a kind nothing reads; Unknown is a
 * read that could not tell. OneUptime's own telemetry is Private.
 *
 * The cloud readers' kinds are read from their source here: a kind one
 * reads that the list does not name would be called Can't be checked
 * while it is checked, and one the list names that no reader reads would
 * wait for a check that never comes - Athena, Firestore, Spanner and
 * Bigtable were both, before.
 */

const CLOUD_READERS: Array<string> = [
  "Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityReader.ts",
  "Server/Utils/DataSecurity/Cloud/Azure/AzureDataSecurityReader.ts",
  "Server/Utils/DataSecurity/Cloud/Gcp/GcpDataSecurityReader.ts",
];

const COMMON_ROOT: string = path.resolve(__dirname, "../../..");

const READ_AT: string = "2026-11-27T10:00:00.000Z";

describe("CLOUD_POSTURE_READ_DATA_STORE_KINDS", () => {
  test("names exactly the kinds the AWS, Azure and Google Cloud readers write posture for", () => {
    const named: Set<string> = new Set();

    for (const file of CLOUD_READERS) {
      const source: string = fs.readFileSync(
        path.join(COMMON_ROOT, file),
        "utf8",
      );

      for (const match of source.matchAll(/DataStoreKind\.([A-Za-z0-9]+)/g)) {
        named.add(
          (DataStoreKind as unknown as Record<string, string>)[match[1]!]!,
        );
      }
    }

    expect([...named].sort()).toEqual(
      [...CLOUD_POSTURE_READ_DATA_STORE_KINDS].sort(),
    );
  });

  test("leaves out the cloud kinds no reader reads", () => {
    for (const kind of [
      DataStoreKind.AwsAthena,
      DataStoreKind.GcpFirestoreDatabase,
      DataStoreKind.GcpSpannerInstance,
      DataStoreKind.GcpBigtableInstance,
    ]) {
      expect(CLOUD_POSTURE_READ_DATA_STORE_KINDS).not.toContain(kind);
      expect(getDataStoreExposureCheck(kind)).toBe(DataStoreExposureCheck.None);
    }
  });
});

describe("getDataStoreExposureCheck", () => {
  test("every kind is read by one way, or by none", () => {
    for (const info of DATA_STORE_KINDS) {
      const check: DataStoreExposureCheck = getDataStoreExposureCheck(
        info.kind,
      );

      if (info.provider === DataStoreProvider.OneUptime) {
        expect(check).toBe(DataStoreExposureCheck.HeldByOneUptime);
      } else if (CLOUD_POSTURE_READ_DATA_STORE_KINDS.includes(info.kind)) {
        expect(check).toBe(DataStoreExposureCheck.CloudApi);
      } else if (ENDPOINT_CHECKED_DATA_STORE_KINDS.includes(info.kind)) {
        expect(check).toBe(DataStoreExposureCheck.Endpoint);
      } else {
        expect(check).toBe(DataStoreExposureCheck.None);
      }
    }
  });

  test("Elasticsearch and OpenSearch are asked at their own address; other stores you run are not checked", () => {
    expect(getDataStoreExposureCheck(DataStoreKind.Elasticsearch)).toBe(
      DataStoreExposureCheck.Endpoint,
    );
    expect(getDataStoreExposureCheck(DataStoreKind.OpenSearch)).toBe(
      DataStoreExposureCheck.Endpoint,
    );

    for (const kind of [
      DataStoreKind.PostgreSql,
      DataStoreKind.MySql,
      DataStoreKind.SqlServer,
      DataStoreKind.MongoDb,
      DataStoreKind.Redis,
      DataStoreKind.Oracle,
      DataStoreKind.Snowflake,
    ]) {
      expect(getDataStoreExposureCheck(kind)).toBe(DataStoreExposureCheck.None);
    }
  });

  test("an unknown kind, or none, is not checked", () => {
    expect(getDataStoreExposureCheck("Floppy Disk")).toBe(
      DataStoreExposureCheck.None,
    );
    expect(getDataStoreExposureCheck(undefined)).toBe(
      DataStoreExposureCheck.None,
    );
  });
});

describe("the search kinds", () => {
  test("OpenSearch is a store you run, beside Elasticsearch, both sampled", () => {
    const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(
      DataStoreKind.OpenSearch,
    );

    expect(info?.provider).toBe(DataStoreProvider.SelfManaged);
    expect(info?.contentScannable).toBe(true);
    expect(getDataStoreKindInfo(DataStoreKind.Elasticsearch)?.contentScannable).toBe(true);
    expect(SEARCH_ENGINE_DATA_STORE_KINDS).toEqual([
      DataStoreKind.Elasticsearch,
      DataStoreKind.OpenSearch,
    ]);
    expect(isSearchEngineDataStoreKind("OpenSearch")).toBe(true);
    expect(isSearchEngineDataStoreKind(DataStoreKind.AwsOpenSearchDomain)).toBe(
      false,
    );
    expect(isSearchEngineDataStoreKind(null)).toBe(false);
  });

  test("a probe and the workers scan them; Data Observability's database kinds stay databases", () => {
    for (const kind of SEARCH_ENGINE_DATA_STORE_KINDS) {
      expect(PROBE_SCANNABLE_DATA_STORE_KINDS).toContain(kind);
      expect(WORKER_CLAIMED_DATA_STORE_KINDS).toContain(kind);
      expect(PROBE_SCANNABLE_DATABASE_KINDS).not.toContain(kind);
    }

    expect(PROBE_SCANNABLE_DATABASE_KINDS).toEqual([
      DataStoreKind.PostgreSql,
      DataStoreKind.MySql,
      DataStoreKind.SqlServer,
    ]);
  });
});

describe("the exposures", () => {
  test("every one is listed, described and weighed, and read as itself", () => {
    expect([...ALL_DATA_STORE_EXPOSURES].sort()).toEqual(
      Object.values(DataStoreExposure).sort(),
    );

    for (const exposure of ALL_DATA_STORE_EXPOSURES) {
      expect(DATA_STORE_EXPOSURE_DESCRIPTION[exposure].length).toBeGreaterThan(0);
      expect(isDataStoreExposure(exposure)).toBe(true);
    }

    expect(isDataStoreExposure("Maybe")).toBe(false);
    expect(isDataStoreExposure(undefined)).toBe(false);
  });

  test("not knowing weighs the same in a risk score, whatever the reason", () => {
    expect(UNKNOWN_DATA_STORE_EXPOSURES).toEqual([
      DataStoreExposure.Unknown,
      DataStoreExposure.NotChecked,
      DataStoreExposure.CannotBeChecked,
    ]);

    for (const exposure of UNKNOWN_DATA_STORE_EXPOSURES) {
      expect(DATA_STORE_EXPOSURE_WEIGHT[exposure]).toBe(
        DATA_STORE_EXPOSURE_WEIGHT[DataStoreExposure.Unknown],
      );
    }
  });

  test("the three kinds of not knowing say three different things", () => {
    const descriptions: Set<string> = new Set(
      UNKNOWN_DATA_STORE_EXPOSURES.map((exposure: DataStoreExposure) => {
        return DATA_STORE_EXPOSURE_DESCRIPTION[exposure];
      }),
    );

    expect(descriptions.size).toBe(3);
  });
});

describe("getDataStoreExposure, by kind", () => {
  test("nothing read of a kind something reads: Not checked yet", () => {
    for (const kind of [
      DataStoreKind.AwsS3Bucket,
      DataStoreKind.AzureSqlDatabase,
      DataStoreKind.GcpCloudSqlInstance,
      DataStoreKind.Elasticsearch,
      DataStoreKind.OpenSearch,
    ]) {
      expect(getDataStoreExposure(undefined, kind)).toBe(
        DataStoreExposure.NotChecked,
      );
      expect(getDataStoreExposure({}, kind)).toBe(
        DataStoreExposure.NotChecked,
      );
    }
  });

  test("nothing read of a kind nothing reads: Can't be checked", () => {
    for (const kind of [
      DataStoreKind.PostgreSql,
      DataStoreKind.MongoDb,
      DataStoreKind.Redis,
      DataStoreKind.AwsAthena,
      DataStoreKind.GcpSpannerInstance,
    ]) {
      expect(getDataStoreExposure(null, kind)).toBe(
        DataStoreExposure.CannotBeChecked,
      );
    }
  });

  test("a store OneUptime holds is Private, read or not", () => {
    for (const kind of [
      DataStoreKind.TelemetryLogs,
      DataStoreKind.TelemetryMetrics,
      DataStoreKind.SecurityEvents,
    ]) {
      expect(getDataStoreExposure(undefined, kind)).toBe(
        DataStoreExposure.Private,
      );
    }
  });

  test("without a kind, nothing read is Not checked yet", () => {
    expect(getDataStoreExposure(undefined)).toBe(DataStoreExposure.NotChecked);
    expect(getDataStoreExposure(null)).toBe(DataStoreExposure.NotChecked);
  });

  test("facts read are worked out as ever, whatever the kind", () => {
    expect(
      getDataStoreExposure(
        { readAt: READ_AT, publicRead: true },
        DataStoreKind.AwsS3Bucket,
      ),
    ).toBe(DataStoreExposure.Public);
    expect(
      getDataStoreExposure(
        {
          readAt: READ_AT,
          publicRead: false,
          publicWrite: false,
          publicNetworkAccess: false,
        },
        DataStoreKind.AzureSqlDatabase,
      ),
    ).toBe(DataStoreExposure.Private);
  });

  test("a store you run asked from inside your network, credentials required: Unknown, as the internet's reach cannot be told", () => {
    const facts: DataStorePostureFacts = {
      readAt: READ_AT,
      readFrom: DataStorePostureReadFrom.Network,
      anonymousRead: false,
      anonymousWrite: false,
      publicRead: false,
      publicWrite: false,
      publicNetworkAccess: null,
      openToAllAddresses: null,
      unknowableFacts: ["publicNetworkAccess", "openToAllAddresses"],
    };

    expect(getDataStoreExposure(facts, DataStoreKind.Elasticsearch)).toBe(
      DataStoreExposure.Unknown,
    );
  });

  test("a store you run reached from OneUptime Cloud: Internet reachable", () => {
    expect(
      getDataStoreExposure(
        {
          readAt: READ_AT,
          readFrom: DataStorePostureReadFrom.Internet,
          publicRead: false,
          publicWrite: false,
          publicNetworkAccess: true,
          openToAllAddresses: null,
        },
        DataStoreKind.OpenSearch,
      ),
    ).toBe(DataStoreExposure.InternetReachable);
  });
});

describe("isPostureFromCloudApi and isPostureFactUnknowable", () => {
  test("a cloud's read says who can reach it; a store's own endpoint does not", () => {
    expect(isPostureFromCloudApi({ readAt: READ_AT })).toBe(true);
    expect(
      isPostureFromCloudApi({
        readAt: READ_AT,
        readFrom: DataStorePostureReadFrom.Network,
      }),
    ).toBe(false);
    expect(
      isPostureFromCloudApi({
        readAt: READ_AT,
        readFrom: DataStorePostureReadFrom.Internet,
      }),
    ).toBe(false);
    expect(isPostureFromCloudApi({})).toBe(false);
    expect(isPostureFromCloudApi(undefined)).toBe(false);
  });

  test("a fact is unknowable only when the facts name it so", () => {
    const facts: DataStorePostureFacts = {
      readAt: READ_AT,
      publicNetworkAccess: null,
      unknowableFacts: ["publicNetworkAccess"],
    };

    expect(isPostureFactUnknowable(facts, "publicNetworkAccess")).toBe(true);
    expect(isPostureFactUnknowable(facts, "publicRead")).toBe(false);
    expect(isPostureFactUnknowable({ readAt: READ_AT }, "publicRead")).toBe(
      false,
    );
    expect(isPostureFactUnknowable(null, "publicRead")).toBe(false);
  });
});
