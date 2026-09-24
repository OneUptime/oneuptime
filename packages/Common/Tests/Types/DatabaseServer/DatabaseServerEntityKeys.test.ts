import {
  DatabaseServerMemberKeys,
  DEFAULT_MEMBER_KEY_MAX_AGE_DAYS,
  DEFAULT_MEMBER_KEY_MAX_COUNT,
  getDatabaseServerTelemetryEntityKeys,
  MAX_DATABASE_SERVER_ENTITY_KEYS,
  mergeDatabaseServerMemberKeys,
} from "../../../Utils/Telemetry/DatabaseServerEntityKeys";
import {
  keyForContainer,
  keyForDatabaseEndpoint,
  keyForKubernetesDeployment,
  keyForKubernetesPod,
} from "../../../Utils/Telemetry/EntityKey";
import {
  buildKubernetesDatabaseAliases,
  canonicalizeDatabaseEndpoint,
  DatabaseCallerContext,
  DatabaseEndpoint,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import { resolveDatabaseCallTarget } from "../../../Types/DatabaseServer/DatabaseTelemetryResolver";
import EntityType from "../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";

const PROJECT: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";
const NOW: Date = new Date("2026-09-23T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

/*
 * Independent reimplementation of the documented preimage, so these tests
 * break if the key construction ever silently changes (a read-side key that
 * does not byte-match the ingest stamp finds nothing).
 */
function expectedKey(
  projectId: string,
  entityType: EntityType,
  identifyingAttributes: Record<string, string>,
): string {
  const escape: (token: string) => string = (token: string): string => {
    return token.replace(/([\\|=])/g, "\\$1");
  };
  const parts: Array<string> = Object.keys(identifyingAttributes)
    .sort()
    .map((key: string): string => {
      return `${escape(key)}=${escape(
        identifyingAttributes[key]!.trim().toLowerCase(),
      )}`;
    });
  return createHash("sha256")
    .update(`${projectId}|${entityType}|${parts.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

function hexKey(seed: number): string {
  return seed.toString(16).padStart(16, "0");
}

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

describe("keyForDatabaseEndpoint", () => {
  test("hashes server.address + server.port under the database.server type", () => {
    expect(
      keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: 5432 }),
    ).toBe(
      expectedKey(PROJECT, EntityType.DatabaseServer, {
        "server.address": "db.prod",
        "server.port": "5432",
      }),
    );
    expect(EntityType.DatabaseServer).toBe("database.server");
  });

  test("a cluster qualifier becomes k8s.cluster.name in the identity", () => {
    expect(
      keyForDatabaseEndpoint(PROJECT, {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod",
      }),
    ).toBe(
      expectedKey(PROJECT, EntityType.DatabaseServer, {
        "server.address": "pg.shop.svc.cluster.local",
        "server.port": "5432",
        "k8s.cluster.name": "prod",
      }),
    );
  });

  test("a null port leaves server.port out (it is not hashed as '')", () => {
    expect(keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: null })).toBe(
      expectedKey(PROJECT, EntityType.DatabaseServer, {
        "server.address": "db.prod",
      }),
    );
  });

  test("a blank cluster is no cluster", () => {
    const unqualified: string = keyForDatabaseEndpoint(PROJECT, {
      host: "10.0.0.5",
      port: 5432,
    });
    for (const blank of ["", "  ", null, undefined]) {
      expect(
        keyForDatabaseEndpoint(PROJECT, {
          host: "10.0.0.5",
          port: 5432,
          kubernetesClusterName: blank,
        }),
      ).toBe(unqualified);
    }
  });

  test("cluster-qualified ≠ unqualified; clusters ≠ each other", () => {
    const unqualified: string = keyForDatabaseEndpoint(PROJECT, {
      host: "10.0.0.5",
      port: 5432,
    });
    const prod: string = keyForDatabaseEndpoint(PROJECT, {
      host: "10.0.0.5",
      port: 5432,
      kubernetesClusterName: "prod",
    });
    const staging: string = keyForDatabaseEndpoint(PROJECT, {
      host: "10.0.0.5",
      port: 5432,
      kubernetesClusterName: "staging",
    });
    expect(new Set([unqualified, prod, staging]).size).toBe(3);
  });

  test("different ports and projects are different keys", () => {
    const base: string = keyForDatabaseEndpoint(PROJECT, {
      host: "db.prod",
      port: 5432,
    });
    expect(
      keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: 5433 }),
    ).not.toBe(base);
    expect(
      keyForDatabaseEndpoint("another-project", { host: "db.prod", port: 5432 }),
    ).not.toBe(base);
  });

  test("casing and padding never fork the key", () => {
    expect(
      keyForDatabaseEndpoint(PROJECT, {
        host: " DB.Prod ",
        port: 5432,
        kubernetesClusterName: " PROD ",
      }),
    ).toBe(
      keyForDatabaseEndpoint(PROJECT, {
        host: "db.prod",
        port: 5432,
        kubernetesClusterName: "prod",
      }),
    );
  });

  test("is a 16-char lowercase hex key", () => {
    expect(
      keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: 5432 }),
    ).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("keys are engine-agnostic", () => {
  const VM: DatabaseCallerContext = { hostName: "app-7", isEphemeral: false };

  test("the same endpoint under postgresql and cockroachdb is ONE key", () => {
    const asPostgres: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system: "postgresql",
      address: "crdb.prod",
      port: 26257,
      caller: VM,
      purpose: "client-call",
    });
    const asCockroach: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system: "cockroachdb",
      address: "crdb.prod",
      caller: VM,
      purpose: "collector",
    });
    expect(asPostgres).toEqual(asCockroach);
    expect(keyForDatabaseEndpoint(PROJECT, asPostgres!)).toBe(
      keyForDatabaseEndpoint(PROJECT, asCockroach!),
    );
  });

  test("OpenSearch reached by an Elasticsearch client joins its row", () => {
    const span: ReturnType<typeof resolveDatabaseCallTarget> =
      resolveDatabaseCallTarget({
        getAttribute: (key: string): unknown => {
          return (
            {
              "db.system.name": "elasticsearch",
              "server.address": "search.prod",
            } as Record<string, unknown>
          )[key];
        },
        caller: VM,
      });
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: ["search.prod:9200"],
        dbSystem: "opensearch",
        memberEntityKeys: null,
      }),
    ).toContain(keyForDatabaseEndpoint(PROJECT, span!.endpoint));
  });
});

describe("member key helpers (shape)", () => {
  test("keyForKubernetesPod / keyForKubernetesDeployment / keyForContainer hash their semconv identity", () => {
    expect(
      keyForKubernetesPod(PROJECT, {
        clusterName: "prod",
        namespace: "shop",
        podName: "pg-0",
      }),
    ).toBe(
      expectedKey(PROJECT, EntityType.KubernetesPod, {
        "k8s.cluster.name": "prod",
        "k8s.namespace.name": "shop",
        "k8s.pod.name": "pg-0",
      }),
    );
    expect(
      keyForKubernetesDeployment(PROJECT, {
        clusterName: "prod",
        namespace: "shop",
        deploymentName: "cache",
      }),
    ).toBe(
      expectedKey(PROJECT, EntityType.KubernetesDeployment, {
        "k8s.cluster.name": "prod",
        "k8s.namespace.name": "shop",
        "k8s.deployment.name": "cache",
      }),
    );
    expect(keyForContainer(PROJECT, "ABC123def456")).toBe(
      expectedKey(PROJECT, EntityType.Container, {
        "container.id": "abc123def456",
      }),
    );
  });

  test("blank cluster / namespace are left out, not hashed as ''", () => {
    expect(
      keyForKubernetesPod(PROJECT, {
        clusterName: "  ",
        namespace: null,
        podName: "pg-0",
      }),
    ).toBe(
      expectedKey(PROJECT, EntityType.KubernetesPod, { "k8s.pod.name": "pg-0" }),
    );
    expect(
      keyForKubernetesDeployment(PROJECT, { deploymentName: "cache" }),
    ).toBe(
      expectedKey(PROJECT, EntityType.KubernetesDeployment, {
        "k8s.deployment.name": "cache",
      }),
    );
  });

  test("a pod and a deployment of the same name never collide", () => {
    expect(
      keyForKubernetesPod(PROJECT, { namespace: "a", podName: "x" }),
    ).not.toBe(
      keyForKubernetesDeployment(PROJECT, { namespace: "a", deploymentName: "x" }),
    );
  });
});

describe("mergeDatabaseServerMemberKeys", () => {
  const A: string = hexKey(0xa);
  const B: string = hexKey(0xb);
  const C: string = hexKey(0xc);

  test("defaults are 30 days / 200 keys", () => {
    expect(DEFAULT_MEMBER_KEY_MAX_AGE_DAYS).toBe(30);
    expect(DEFAULT_MEMBER_KEY_MAX_COUNT).toBe(200);
  });

  test("seen keys are stamped now", () => {
    expect(mergeDatabaseServerMemberKeys(null, [A, B], NOW)).toEqual({
      [A]: NOW.toISOString(),
      [B]: NOW.toISOString(),
    });
  });

  test("after a rollout both the old and the new pod key are in scope", () => {
    const beforeRollout: DatabaseServerMemberKeys =
      mergeDatabaseServerMemberKeys(
        {},
        [A],
        new Date(NOW.getTime() - 2 * DAY),
      );
    const afterRollout: DatabaseServerMemberKeys =
      mergeDatabaseServerMemberKeys(beforeRollout, [B], NOW);
    expect(Object.keys(afterRollout).sort()).toEqual([A, B].sort());
    expect(afterRollout[A]).toBe(isoDaysAgo(2));
    expect(afterRollout[B]).toBe(NOW.toISOString());
  });

  test("a re-seen key moves to now", () => {
    expect(
      mergeDatabaseServerMemberKeys({ [A]: isoDaysAgo(5) }, [A], NOW),
    ).toEqual({ [A]: NOW.toISOString() });
  });

  test("keys not seen for longer than the retention are dropped", () => {
    expect(
      mergeDatabaseServerMemberKeys(
        { [A]: isoDaysAgo(29), [B]: isoDaysAgo(31), [C]: isoDaysAgo(30) },
        [],
        NOW,
      ),
    ).toEqual({ [A]: isoDaysAgo(29), [C]: isoDaysAgo(30) });
  });

  test("a custom retention is honoured", () => {
    expect(
      mergeDatabaseServerMemberKeys(
        { [A]: isoDaysAgo(2), [B]: isoDaysAgo(8) },
        [],
        NOW,
        { maxAgeDays: 7 },
      ),
    ).toEqual({ [A]: isoDaysAgo(2) });
  });

  test("the cap keeps the most recent, and keys seen now always survive", () => {
    const existing: Record<string, string> = {};
    for (let index: number = 1; index <= 10; index++) {
      existing[hexKey(0x100 + index)] = isoDaysAgo(index);
    }
    const merged: DatabaseServerMemberKeys = mergeDatabaseServerMemberKeys(
      existing,
      [A],
      NOW,
      { max: 4 },
    );
    expect(Object.keys(merged)).toEqual([
      A,
      hexKey(0x101),
      hexKey(0x102),
      hexKey(0x103),
    ]);
  });

  test("the default cap is 200", () => {
    const existing: Record<string, string> = {};
    for (let index: number = 0; index < 250; index++) {
      existing[hexKey(0x1000 + index)] = new Date(
        NOW.getTime() - index * 1000,
      ).toISOString();
    }
    expect(
      Object.keys(mergeDatabaseServerMemberKeys(existing, [], NOW)).length,
    ).toBe(200);
  });

  test("ties in recency are broken by key, so the result is stable", () => {
    const seen: Array<string> = [C, A, B];
    const merged: DatabaseServerMemberKeys = mergeDatabaseServerMemberKeys(
      {},
      seen,
      NOW,
      { max: 2 },
    );
    expect(Object.keys(merged)).toEqual([A, B]);
    expect(
      mergeDatabaseServerMemberKeys({}, [...seen].reverse(), NOW, { max: 2 }),
    ).toEqual(merged);
  });

  test("the result is ordered most recent first", () => {
    const merged: DatabaseServerMemberKeys = mergeDatabaseServerMemberKeys(
      { [A]: isoDaysAgo(3), [B]: isoDaysAgo(1) },
      [C],
      NOW,
    );
    expect(Object.keys(merged)).toEqual([C, B, A]);
  });

  test("malformed keys and timestamps are dropped, not thrown on", () => {
    expect(
      mergeDatabaseServerMemberKeys(
        {
          [A]: "not a date",
          "not-a-key": NOW.toISOString(),
          [B.toUpperCase()]: isoDaysAgo(1),
          [C]: 12345,
        },
        [
          "short",
          "zzzzzzzzzzzzzzzz",
          42 as unknown as string,
          `  ${A.toUpperCase()} `,
        ],
        NOW,
      ),
    ).toEqual({ [A]: NOW.toISOString(), [B]: isoDaysAgo(1) });
  });

  test("the { key, lastSeenAt } array form is accepted too", () => {
    expect(
      mergeDatabaseServerMemberKeys(
        [
          { key: A, lastSeenAt: isoDaysAgo(1) },
          { key: A, lastSeenAt: isoDaysAgo(3) },
          { key: B, lastSeenAt: isoDaysAgo(2) },
          null,
          "bare-string",
        ],
        [],
        NOW,
      ),
    ).toEqual({ [A]: isoDaysAgo(1), [B]: isoDaysAgo(2) });
  });

  test("a timestamp in the future is clamped to now", () => {
    expect(
      mergeDatabaseServerMemberKeys(
        { [A]: new Date(NOW.getTime() + 365 * DAY).toISOString() },
        [],
        NOW,
      ),
    ).toEqual({ [A]: NOW.toISOString() });
  });

  test("garbage existing values are an empty set", () => {
    for (const existing of [null, undefined, "x", 42, true]) {
      expect(mergeDatabaseServerMemberKeys(existing, [A], NOW)).toEqual({
        [A]: NOW.toISOString(),
      });
    }
  });

  test("invalid options fall back to the defaults", () => {
    expect(
      mergeDatabaseServerMemberKeys(
        { [A]: isoDaysAgo(20) },
        [],
        NOW,
        { maxAgeDays: 0, max: 0 },
      ),
    ).toEqual({ [A]: isoDaysAgo(20) });
    expect(
      mergeDatabaseServerMemberKeys({ [A]: isoDaysAgo(20) }, [], NOW, {
        maxAgeDays: Number.NaN,
        max: -3,
      }),
    ).toEqual({ [A]: isoDaysAgo(20) });
  });

  test("an invalid `now` falls back to the current time instead of throwing", () => {
    const merged: DatabaseServerMemberKeys = mergeDatabaseServerMemberKeys(
      {},
      [A],
      new Date("nope"),
    );
    expect(Object.keys(merged)).toEqual([A]);
    expect(Number.isFinite(Date.parse(merged[A]!))).toBe(true);
  });

  test("a non-array seenNow is ignored", () => {
    expect(
      mergeDatabaseServerMemberKeys(
        { [A]: isoDaysAgo(1) },
        null as unknown as Array<string>,
        NOW,
      ),
    ).toEqual({ [A]: isoDaysAgo(1) });
  });
});

describe("getDatabaseServerTelemetryEntityKeys", () => {
  const M1: string = hexKey(0x1);
  const M2: string = hexKey(0x2);

  test("MAX_DATABASE_SERVER_ENTITY_KEYS is 200", () => {
    expect(MAX_DATABASE_SERVER_ENTITY_KEYS).toBe(200);
  });

  test("one key per stored endpoint (strings or { endpoint } rows), then members", () => {
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: [
          "db.prod:5432",
          { endpoint: "pg.shop.svc.cluster.local:5432@prod" },
        ],
        dbSystem: "postgresql",
        memberEntityKeys: {
          [M1]: isoDaysAgo(3),
          [M2]: isoDaysAgo(1),
        },
      }),
    ).toEqual([
      keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: 5432 }),
      keyForDatabaseEndpoint(PROJECT, {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod",
      }),
      M2,
      M1,
    ]);
  });

  test("no twin derivation: a qualified alias yields ONLY the qualified key", () => {
    const keys: Array<string> = getDatabaseServerTelemetryEntityKeys({
      projectId: PROJECT,
      endpoints: ["pg.shop.svc.cluster.local:5432@prod"],
      dbSystem: "postgresql",
      memberEntityKeys: null,
    });
    expect(keys).toEqual([
      keyForDatabaseEndpoint(PROJECT, {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod",
      }),
    ]);
    expect(keys).not.toContain(
      keyForDatabaseEndpoint(PROJECT, {
        host: "pg.shop.svc.cluster.local",
        port: 5432,
      }),
    );
  });

  test("a port-less stored endpoint gets the engine default, like ingest", () => {
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: ["db.prod"],
        dbSystem: "postgres",
        memberEntityKeys: null,
      }),
    ).toEqual([keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: 5432 })]);
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: ["db.prod"],
        memberEntityKeys: null,
      }),
    ).toEqual([keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: null })]);
  });

  test("unparseable endpoints are skipped; duplicates collapse", () => {
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: [
          "[REDACTED]",
          "localhost:5432",
          "",
          { endpoint: undefined },
          {},
          "db.prod:5432",
          "DB.PROD:5432",
          null as unknown as string,
        ],
        dbSystem: "postgresql",
        memberEntityKeys: null,
      }),
    ).toEqual([keyForDatabaseEndpoint(PROJECT, { host: "db.prod", port: 5432 })]);
  });

  test("member keys: only 16-hex keys, any stored shape, most recent first", () => {
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: [],
        memberEntityKeys: {
          [M1]: isoDaysAgo(2),
          "not-a-key": isoDaysAgo(1),
          [M2.toUpperCase()]: isoDaysAgo(1),
        },
      }),
    ).toEqual([M2, M1]);
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: null,
        memberEntityKeys: [M1, "nope", { key: M2, lastSeenAt: isoDaysAgo(1) }],
      }),
    ).toEqual([M2, M1]);
  });

  test("capped at 200 with endpoint keys first", () => {
    const members: Record<string, string> = {};
    for (let index: number = 0; index < 300; index++) {
      members[hexKey(0x5000 + index)] = isoDaysAgo(1);
    }
    const endpointKey: string = keyForDatabaseEndpoint(PROJECT, {
      host: "db.prod",
      port: 5432,
    });
    const keys: Array<string> = getDatabaseServerTelemetryEntityKeys({
      projectId: PROJECT,
      endpoints: ["db.prod:5432"],
      dbSystem: "postgresql",
      memberEntityKeys: members,
    });
    expect(keys.length).toBe(200);
    expect(keys[0]).toBe(endpointKey);
    expect(new Set(keys).size).toBe(200);
  });

  test("nothing to scope by → [] (callers must then refuse to query)", () => {
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: null,
        memberEntityKeys: null,
      }),
    ).toEqual([]);
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: PROJECT,
        endpoints: undefined,
        memberEntityKeys: "garbage",
      }),
    ).toEqual([]);
    expect(
      getDatabaseServerTelemetryEntityKeys({
        projectId: "  ",
        endpoints: ["db.prod:5432"],
        memberEntityKeys: { [M1]: isoDaysAgo(1) },
      }),
    ).toEqual([]);
  });

  test("keys are project-scoped", () => {
    const a: Array<string> = getDatabaseServerTelemetryEntityKeys({
      projectId: PROJECT,
      endpoints: ["db.prod:5432"],
      memberEntityKeys: null,
    });
    const b: Array<string> = getDatabaseServerTelemetryEntityKeys({
      projectId: "another-project",
      endpoints: ["db.prod:5432"],
      memberEntityKeys: null,
    });
    expect(a[0]).not.toBe(b[0]);
  });

  test("end to end: a Kubernetes app's span lands on the workload row's page", () => {
    // Worker side: the row's aliases for a CNPG cluster in a 1-cluster project.
    const aliases: Array<string> = buildKubernetesDatabaseAliases({
      system: "postgresql",
      namespace: "shop",
      clusterName: "prod-eu",
      serviceNames: ["pg-main-rw", "pg-main-ro"],
      ports: [5432],
      includeUnqualified: true,
    });
    const podKey: string = keyForKubernetesPod(PROJECT, {
      clusterName: "prod-eu",
      namespace: "shop",
      podName: "pg-main-1",
    });
    const pageKeys: Array<string> = getDatabaseServerTelemetryEntityKeys({
      projectId: PROJECT,
      endpoints: aliases,
      dbSystem: "postgresql",
      memberEntityKeys: mergeDatabaseServerMemberKeys(null, [podKey], NOW),
    });

    // Ingest side: an app in the same namespace calls "pg-main-rw".
    const inCluster: ReturnType<typeof resolveDatabaseCallTarget> =
      resolveDatabaseCallTarget({
        getAttribute: (key: string): unknown => {
          return (
            {
              "db.system.name": "postgresql",
              "server.address": "pg-main-rw",
            } as Record<string, unknown>
          )[key];
        },
        caller: {
          kubernetesNamespace: "shop",
          kubernetesClusterName: "prod-eu",
          isEphemeral: true,
        },
      });
    // A direct exporter without k8s attributes uses the FQDN.
    const direct: ReturnType<typeof resolveDatabaseCallTarget> =
      resolveDatabaseCallTarget({
        getAttribute: (key: string): unknown => {
          return (
            {
              "db.system.name": "postgresql",
              "server.address": "pg-main-ro.shop.svc.cluster.local",
            } as Record<string, unknown>
          )[key];
        },
        caller: { isEphemeral: true },
      });

    expect(pageKeys).toContain(
      keyForDatabaseEndpoint(PROJECT, inCluster!.endpoint),
    );
    expect(pageKeys).toContain(keyForDatabaseEndpoint(PROJECT, direct!.endpoint));
    expect(pageKeys).toContain(podKey);
  });

  test("end to end: another cluster's same-named Service does not land here", () => {
    const pageKeys: Array<string> = getDatabaseServerTelemetryEntityKeys({
      projectId: PROJECT,
      endpoints: buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "shop",
        clusterName: "prod-eu",
        serviceNames: ["pg"],
        ports: [],
        includeUnqualified: false,
      }),
      dbSystem: "postgresql",
      memberEntityKeys: null,
    });
    const fromStaging: ReturnType<typeof resolveDatabaseCallTarget> =
      resolveDatabaseCallTarget({
        getAttribute: (key: string): unknown => {
          return (
            {
              "db.system.name": "postgresql",
              "server.address": "pg",
            } as Record<string, unknown>
          )[key];
        },
        caller: {
          kubernetesNamespace: "shop",
          kubernetesClusterName: "staging",
          isEphemeral: true,
        },
      });
    expect(pageKeys).not.toContain(
      keyForDatabaseEndpoint(PROJECT, fromStaging!.endpoint),
    );
  });

  test("same input, same output", () => {
    const input: Parameters<typeof getDatabaseServerTelemetryEntityKeys>[0] = {
      projectId: PROJECT,
      endpoints: ["a.prod:5432", "b.prod:5432"],
      dbSystem: "postgresql",
      memberEntityKeys: { [M1]: isoDaysAgo(1), [M2]: isoDaysAgo(1) },
    };
    expect(getDatabaseServerTelemetryEntityKeys(input)).toEqual(
      getDatabaseServerTelemetryEntityKeys(input),
    );
    expect(getDatabaseServerTelemetryEntityKeys(input).slice(2)).toEqual([
      M1,
      M2,
    ]);
  });
});
