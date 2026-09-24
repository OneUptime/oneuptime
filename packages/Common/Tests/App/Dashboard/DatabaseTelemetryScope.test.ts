import { describe, expect, test } from "@jest/globals";
import {
  DATABASE_ENDPOINT_CHIP_KEY,
  DATABASE_MEMBER_CHIP_KEY,
  DATABASE_SERVER_CHIP_KEY,
  buildDatabaseServerEntityKeyDisplays,
  getDatabaseServerEndpointScopeKeys,
  getDatabaseServerEntityKeysQueryValue,
  getDatabaseServerFormattedEndpoints,
  getDatabaseServerMemberScopeKeys,
  getDatabaseServerScopeKeys,
  isDatabaseServerScoped,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseTelemetryScope";
import { LockedEntityKeyDisplayMap } from "../../../../App/FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { getDatabaseServerSignalEntityKeys } from "../../../Utils/Telemetry/DatabaseServerEntityKeys";
import {
  keyForContainer,
  keyForDatabaseEndpoint,
  keyForDatabaseServerRow,
  keyForKubernetesPod,
} from "../../../Utils/Telemetry/EntityKey";

/*
 * Every Databases tab scopes telemetry through this helper. The behaviour
 * that matters most is the negative one: a database with no parseable
 * endpoint and no members must come back UNSCOPED — never as an empty
 * Includes, which the analytics layer turns into "the whole project".
 */

const PROJECT_ID: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";
const OTHER_PROJECT_ID: string = "7d2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const POD_KEY: string = keyForKubernetesPod(PROJECT_ID, {
  clusterName: "prod",
  namespace: "payments",
  podName: "postgres-0",
});
const CONTAINER_KEY: string = keyForContainer(PROJECT_ID, "abc123def456");

describe("getDatabaseServerScopeKeys", () => {
  test("is the shared isomorphic key set, not a re-derivation", () => {
    const input: {
      endpoints: Array<string>;
      dbSystem: string;
      memberEntityKeys: Record<string, string>;
    } = {
      endpoints: ["db.prod.internal:5432", "db-replica.prod.internal"],
      dbSystem: "postgresql",
      memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
    };

    expect(
      getDatabaseServerScopeKeys({ projectId: PROJECT_ID, ...input }),
    ).toEqual(
      getDatabaseServerSignalEntityKeys({ projectId: PROJECT_ID, ...input }),
    );
  });

  test("endpoint keys come first, then member keys", () => {
    const keys: Array<string> = getDatabaseServerScopeKeys({
      projectId: PROJECT_ID,
      endpoints: ["db.prod.internal:5432"],
      dbSystem: "postgresql",
      memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
    });

    expect(keys).toEqual([
      keyForDatabaseEndpoint(PROJECT_ID, {
        host: "db.prod.internal",
        port: 5432,
      }),
      POD_KEY,
    ]);
  });

  test("applies the engine's default port before keying, like ingest does", () => {
    expect(
      getDatabaseServerScopeKeys({
        projectId: PROJECT_ID,
        endpoints: ["cache.prod.internal"],
        dbSystem: "redis",
        memberEntityKeys: null,
      }),
    ).toEqual([
      keyForDatabaseEndpoint(PROJECT_ID, {
        host: "cache.prod.internal",
        port: 6379,
      }),
    ]);
  });

  test("accepts partially selected endpoint models as well as strings", () => {
    const fromModels: Array<string> = getDatabaseServerScopeKeys({
      projectId: PROJECT_ID,
      endpoints: [{ endpoint: "db.prod.internal:5432" }, { endpoint: null }],
      dbSystem: "postgresql",
    });
    const fromStrings: Array<string> = getDatabaseServerScopeKeys({
      projectId: PROJECT_ID,
      endpoints: ["db.prod.internal:5432"],
      dbSystem: "postgresql",
    });

    expect(fromModels).toEqual(fromStrings);
    expect(fromModels).toHaveLength(1);
  });

  test("an ObjectID project id keys exactly like its string form", () => {
    const fromObjectId: Array<string> = getDatabaseServerScopeKeys({
      projectId: new ObjectID(PROJECT_ID),
      endpoints: ["db.prod.internal:5432"],
      dbSystem: "postgresql",
    });

    expect(fromObjectId).toEqual(
      getDatabaseServerScopeKeys({
        projectId: PROJECT_ID,
        endpoints: ["db.prod.internal:5432"],
        dbSystem: "postgresql",
      }),
    );
  });

  test("keys are tenant-unique: another project gets different keys", () => {
    const mine: Array<string> = getDatabaseServerScopeKeys({
      projectId: PROJECT_ID,
      endpoints: ["db.prod.internal:5432"],
      dbSystem: "postgresql",
    });
    const theirs: Array<string> = getDatabaseServerScopeKeys({
      projectId: OTHER_PROJECT_ID,
      endpoints: ["db.prod.internal:5432"],
      dbSystem: "postgresql",
    });

    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(mine[0]).not.toBe(theirs[0]);
  });

  test("is empty without a project, a source or anything parseable", () => {
    expect(getDatabaseServerScopeKeys(null)).toEqual([]);
    expect(getDatabaseServerScopeKeys(undefined)).toEqual([]);
    expect(
      getDatabaseServerScopeKeys({
        projectId: null,
        endpoints: ["db.prod.internal:5432"],
        dbSystem: "postgresql",
      }),
    ).toEqual([]);
    expect(
      getDatabaseServerScopeKeys({
        projectId: "   ",
        endpoints: ["db.prod.internal:5432"],
        dbSystem: "postgresql",
      }),
    ).toEqual([]);
    expect(
      getDatabaseServerScopeKeys({
        projectId: PROJECT_ID,
        endpoints: ["", "   ", "localhost:5432", "127.0.0.1"],
        dbSystem: "postgresql",
        memberEntityKeys: { "not-a-key": "2026-09-23T10:00:00.000Z" },
      }),
    ).toEqual([]);
  });
});

describe("endpoint-only and member-only key sets", () => {
  const source: {
    projectId: string;
    endpoints: Array<string>;
    dbSystem: string;
    memberEntityKeys: Record<string, string>;
  } = {
    projectId: PROJECT_ID,
    endpoints: ["db.prod.internal:5432"],
    dbSystem: "postgresql",
    memberEntityKeys: {
      [POD_KEY]: "2026-09-23T10:00:00.000Z",
      [CONTAINER_KEY]: "2026-09-23T11:00:00.000Z",
    },
  };

  test("partition the full key set", () => {
    const all: Array<string> = getDatabaseServerScopeKeys(source);
    const endpoints: Array<string> = getDatabaseServerEndpointScopeKeys(source);
    const members: Array<string> = getDatabaseServerMemberScopeKeys(source);

    expect(endpoints).toEqual([
      keyForDatabaseEndpoint(PROJECT_ID, {
        host: "db.prod.internal",
        port: 5432,
      }),
    ]);
    // Most recent member first.
    expect(members).toEqual([CONTAINER_KEY, POD_KEY]);
    expect([...endpoints, ...members]).toEqual(all);
  });

  test("a workload-only database has member keys and no endpoint keys", () => {
    const workloadOnly: {
      projectId: string;
      endpoints: Array<string>;
      memberEntityKeys: Record<string, string>;
    } = {
      projectId: PROJECT_ID,
      endpoints: [],
      memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
    };

    expect(getDatabaseServerEndpointScopeKeys(workloadOnly)).toEqual([]);
    expect(getDatabaseServerMemberScopeKeys(workloadOnly)).toEqual([POD_KEY]);
    expect(
      isDatabaseServerScoped(getDatabaseServerScopeKeys(workloadOnly)),
    ).toBe(true);
  });

  test("both are empty for a missing source", () => {
    expect(getDatabaseServerEndpointScopeKeys(null)).toEqual([]);
    expect(getDatabaseServerMemberScopeKeys(undefined)).toEqual([]);
  });
});

describe("isDatabaseServerScoped / getDatabaseServerEntityKeysQueryValue", () => {
  test("an empty key set is unscoped and yields NO query value", () => {
    expect(isDatabaseServerScoped([])).toBe(false);
    expect(isDatabaseServerScoped(null)).toBe(false);
    expect(isDatabaseServerScoped(undefined)).toBe(false);
    expect(getDatabaseServerEntityKeysQueryValue([])).toBeNull();
    expect(getDatabaseServerEntityKeysQueryValue(null)).toBeNull();
    expect(getDatabaseServerEntityKeysQueryValue(undefined)).toBeNull();
  });

  test("a non-empty key set becomes an Includes of exactly those keys", () => {
    const value: Includes | null = getDatabaseServerEntityKeysQueryValue([
      POD_KEY,
      CONTAINER_KEY,
    ]);

    expect(value).toBeInstanceOf(Includes);
    expect(value!.values).toEqual([POD_KEY, CONTAINER_KEY]);
  });

  test("the Includes is a copy, so later mutation of the input cannot widen it", () => {
    const keys: Array<string> = [POD_KEY];
    const value: Includes | null = getDatabaseServerEntityKeysQueryValue(keys);
    keys.push(CONTAINER_KEY);

    expect(value!.values).toEqual([POD_KEY]);
  });
});

describe("buildDatabaseServerEntityKeyDisplays", () => {
  test("names every endpoint key by its formatted endpoint", () => {
    const displays: LockedEntityKeyDisplayMap =
      buildDatabaseServerEntityKeyDisplays({
        projectId: PROJECT_ID,
        endpoints: ["DB.Prod.Internal:5432", "[2001:db8::1]:5433"],
        dbSystem: "postgresql",
        name: "PostgreSQL db.prod.internal:5432",
      });

    const endpointKey: string = keyForDatabaseEndpoint(PROJECT_ID, {
      host: "db.prod.internal",
      port: 5432,
    });
    const ipv6Key: string = keyForDatabaseEndpoint(PROJECT_ID, {
      host: "2001:db8::1",
      port: 5433,
    });

    expect(displays[endpointKey]).toEqual({
      displayKey: DATABASE_ENDPOINT_CHIP_KEY,
      displayValue: "db.prod.internal:5432",
    });
    expect(displays[ipv6Key]).toEqual({
      displayKey: DATABASE_ENDPOINT_CHIP_KEY,
      displayValue: "[2001:db8::1]:5433",
    });
  });

  test("names member keys after the database with a short key suffix", () => {
    const displays: LockedEntityKeyDisplayMap =
      buildDatabaseServerEntityKeyDisplays({
        projectId: PROJECT_ID,
        endpoints: [],
        dbSystem: "postgresql",
        memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
        name: "orders-db",
      });

    expect(displays[POD_KEY]).toEqual({
      displayKey: DATABASE_MEMBER_CHIP_KEY,
      displayValue: `orders-db (${POD_KEY.substring(0, 8)})`,
    });
  });

  test("falls back to the engine name when the database has no name", () => {
    const displays: LockedEntityKeyDisplayMap =
      buildDatabaseServerEntityKeyDisplays({
        projectId: PROJECT_ID,
        endpoints: [],
        dbSystem: "redis",
        memberEntityKeys: { [CONTAINER_KEY]: "2026-09-23T10:00:00.000Z" },
      });

    expect(displays[CONTAINER_KEY]!.displayValue).toBe(
      `Redis (${CONTAINER_KEY.substring(0, 8)})`,
    );
  });

  test("covers exactly the keys the viewers are scoped by", () => {
    const source: {
      projectId: string;
      endpoints: Array<string>;
      dbSystem: string;
      memberEntityKeys: Record<string, string>;
      name: string;
    } = {
      projectId: PROJECT_ID,
      endpoints: ["db.prod.internal:5432", "db.prod.internal:5432"],
      dbSystem: "postgresql",
      memberEntityKeys: {
        [POD_KEY]: "2026-09-23T10:00:00.000Z",
        [CONTAINER_KEY]: "2026-09-23T11:00:00.000Z",
      },
      name: "orders-db",
    };

    expect(
      Object.keys(buildDatabaseServerEntityKeyDisplays(source)).sort(),
    ).toEqual([...getDatabaseServerScopeKeys(source)].sort());
  });

  test("attaches no search syntax: no single attribute search reproduces an endpoint key", () => {
    const displays: LockedEntityKeyDisplayMap =
      buildDatabaseServerEntityKeyDisplays({
        projectId: PROJECT_ID,
        endpoints: ["db.prod.internal:5432"],
        dbSystem: "postgresql",
      });

    for (const key of Object.keys(displays)) {
      expect(displays[key]!.searchAttributes).toBeUndefined();
    }
  });

  test("is empty without a source or a project", () => {
    expect(buildDatabaseServerEntityKeyDisplays(null)).toEqual({});
    expect(
      buildDatabaseServerEntityKeyDisplays({
        projectId: "",
        endpoints: ["db.prod.internal:5432"],
        dbSystem: "postgresql",
      }),
    ).toEqual({});
  });
});

describe("getDatabaseServerFormattedEndpoints", () => {
  test("canonicalizes, applies the default port and de-duplicates", () => {
    expect(
      getDatabaseServerFormattedEndpoints({
        projectId: PROJECT_ID,
        endpoints: [
          "DB.Prod.Internal",
          "db.prod.internal:5432",
          { endpoint: "replica.prod.internal:5433" },
          "localhost:5432",
          "",
        ],
        dbSystem: "postgresql",
      }),
    ).toEqual(["db.prod.internal:5432", "replica.prod.internal:5433"]);
  });

  test("is empty for a missing source", () => {
    expect(getDatabaseServerFormattedEndpoints(null)).toEqual([]);
  });
});

/*
 * The row's id in the source adds its ROW key: what ingest stamps on every
 * batch that resolved to the row — the Database Agent linked by
 * DATABASE_SERVER_ID whatever address it reports, a memcached receiver with
 * no address at all. Every tab and the Overview must include it, or linked
 * telemetry reaches the database and is never shown.
 */
describe("the row key (telemetry linked by oneuptime.database.server.id)", () => {
  const ROW_ID: string = "66666666-6666-4666-8666-666666666666";
  const ROW_KEY: string = keyForDatabaseServerRow(PROJECT_ID, ROW_ID);

  const source: {
    projectId: string;
    id: string;
    endpoints: Array<string>;
    dbSystem: string;
    memberEntityKeys: Record<string, string>;
    name: string;
  } = {
    projectId: PROJECT_ID,
    id: ROW_ID,
    endpoints: ["postgres.prod.svc.cluster.local:5432@cluster-a"],
    dbSystem: "postgresql",
    memberEntityKeys: { [POD_KEY]: "2026-09-23T10:00:00.000Z" },
    name: "Orders DB",
  };

  test("the full scope starts with the row key, then endpoints, then members", () => {
    expect(getDatabaseServerScopeKeys(source)).toEqual([
      ROW_KEY,
      keyForDatabaseEndpoint(PROJECT_ID, {
        host: "postgres.prod.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "cluster-a",
      }),
      POD_KEY,
    ]);
  });

  test("the endpoint scope (queries, engine metrics) includes it; the member-only runtime scope does not", () => {
    expect(getDatabaseServerEndpointScopeKeys(source)).toEqual([
      ROW_KEY,
      keyForDatabaseEndpoint(PROJECT_ID, {
        host: "postgres.prod.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "cluster-a",
      }),
    ]);
    expect(getDatabaseServerMemberScopeKeys(source)).toEqual([POD_KEY]);
    expect(getDatabaseServerMemberScopeKeys(source)).not.toContain(ROW_KEY);
  });

  test("an ObjectID id keys exactly like its string form", () => {
    expect(
      getDatabaseServerScopeKeys({ ...source, id: new ObjectID(ROW_ID) }),
    ).toEqual(getDatabaseServerScopeKeys(source));
  });

  test("a row with no endpoint and no member is scoped by its row key alone — never unscoped, never the whole project", () => {
    const keys: Array<string> = getDatabaseServerScopeKeys({
      projectId: PROJECT_ID,
      id: ROW_ID,
      endpoints: [],
      dbSystem: "memcached",
      memberEntityKeys: null,
    });

    expect(keys).toEqual([ROW_KEY]);
    expect(isDatabaseServerScoped(keys)).toBe(true);
    expect(getDatabaseServerEntityKeysQueryValue(keys)!.values).toEqual([
      ROW_KEY,
    ]);
  });

  test("without an id (or a blank one) the scope is the endpoint and member keys only", () => {
    for (const id of [undefined, null, "", "   "]) {
      expect(
        getDatabaseServerScopeKeys({ ...source, id: id as string }),
      ).not.toContain(ROW_KEY);
    }
    expect(
      getDatabaseServerScopeKeys({
        projectId: PROJECT_ID,
        id: "",
        endpoints: [],
        memberEntityKeys: null,
      }),
    ).toEqual([]);
  });

  test("regression: the Documentation tab's prefilled agent address is LOCAL, but the linked batch still matches the page", () => {
    /*
     * The agent reports the Service FQDN without the cluster (the row owns
     * only the @cluster-a alias), so its endpoint key is not in scope — the
     * row key ingest stamps for the link is.
     */
    const keys: Array<string> = getDatabaseServerScopeKeys(source);
    expect(keys).not.toContain(
      keyForDatabaseEndpoint(PROJECT_ID, {
        host: "postgres.prod.svc.cluster.local",
        port: 5432,
      }),
    );
    expect(keys).toContain(ROW_KEY);
  });

  test("the row key's chip reads 'Database: <name>', falling back to the engine", () => {
    expect(buildDatabaseServerEntityKeyDisplays(source)[ROW_KEY]).toEqual({
      displayKey: DATABASE_SERVER_CHIP_KEY,
      displayValue: "Orders DB",
    });
    expect(
      buildDatabaseServerEntityKeyDisplays({ ...source, name: "  " })[ROW_KEY],
    ).toEqual({
      displayKey: DATABASE_SERVER_CHIP_KEY,
      displayValue: "PostgreSQL",
    });
    expect(
      buildDatabaseServerEntityKeyDisplays(source)[ROW_KEY],
    ).not.toHaveProperty("searchAttributes");
  });

  test("the chips still cover exactly the keys the viewers are scoped by", () => {
    expect(
      Object.keys(buildDatabaseServerEntityKeyDisplays(source)).sort(),
    ).toEqual([...getDatabaseServerScopeKeys(source)].sort());
  });
});
