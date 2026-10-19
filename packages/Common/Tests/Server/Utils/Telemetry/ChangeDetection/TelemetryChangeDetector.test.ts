import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import type { TelemetryServiceMetadata } from "../../../../../Server/Services/OpenTelemetryIngestService";
import logger from "../../../../../Server/Utils/Logger";
import TelemetryChangeDetector, {
  CHANGE_DETECTION_COUNT_NAMESPACE,
  CHANGE_DETECTION_LATEST_NAMESPACE,
  CHANGE_DETECTION_SEEN_NAMESPACE,
  MAX_CHANGES_PER_SCOPE_PER_HOUR,
  ObserveResourceData,
  SEEN_TTL_IN_DAYS,
} from "../../../../../Server/Utils/Telemetry/ChangeDetection/TelemetryChangeDetector";
import TelemetryFanInWriter from "../../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import OneUptimeDate from "../../../../../Types/Date";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";

/*
 * Which changes in the telemetry OneUptime records: the first value a
 * scope reports is its baseline, a value seen before (a rolling deploy's
 * old pods, another worker) is nothing new, and only a value new to Redis
 * is a change - recorded once, however many workers see it at once.
 *
 * Redis is replaced by an in-memory store with the same semantics for the
 * three calls the detector makes (SET NX, the atomic swap, INCR with
 * expiry), so "two workers at once" is two detectors sharing that store
 * with their in-process memos cleared between them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1c9e5a20-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "1c9e5a20-0000-4000-8000-000000000002",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "1c9e5a20-0000-4000-8000-000000000003",
);
const HOST_ID: ObjectID = new ObjectID("1c9e5a20-0000-4000-8000-000000000004");
const NOW: Date = new Date("2026-10-19T10:15:00.000Z");

interface StoredValue {
  value: string;
}

interface Submission {
  rows: Array<JSONObject>;
  dedupToken: string | undefined;
}

let store: Map<string, StoredValue>;
let submissions: Array<Submission>;
let cacheCalls: Array<string>;
let now: Date;

function storeKey(namespace: string, key: string): string {
  return `${namespace}-${key}`;
}

function mockRedis(): void {
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        cacheCalls.push(`setStringIfNotExists:${namespace}`);
        const full: string = storeKey(namespace, key);
        if (store.has(full)) {
          return false;
        }
        store.set(full, { value });
        return true;
      },
    );

  jest
    .spyOn(GlobalCache, "swapString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        cacheCalls.push(`swapString:${namespace}`);
        const full: string = storeKey(namespace, key);
        const previous: StoredValue | undefined = store.get(full);
        store.set(full, { value });
        return previous ? previous.value : null;
      },
    );

  jest
    .spyOn(GlobalCache, "incrementWithExpiry")
    .mockImplementation(async (namespace: string, key: string) => {
      cacheCalls.push(`incrementWithExpiry:${namespace}`);
      const full: string = storeKey(namespace, key);
      const count: number = Number(store.get(full)?.value || "0") + 1;
      store.set(full, { value: String(count) });
      return count;
    });
}

function resource(values: Record<string, string>): JSONArray {
  return Object.keys(values).map((key: string) => {
    return { key, value: { stringValue: values[key]! } };
  });
}

function serviceMetadata(
  overrides: Partial<TelemetryServiceMetadata> = {},
): TelemetryServiceMetadata {
  return {
    serviceName: "checkout",
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
    ...overrides,
  };
}

async function observe(
  attributes: Record<string, string>,
  overrides: Partial<ObserveResourceData> = {},
): Promise<void> {
  await TelemetryChangeDetector.observe({
    projectId: PROJECT_ID,
    metadata: serviceMetadata(),
    attributes: resource(attributes),
    observedAt: now,
    ...overrides,
  });
}

// What a version report from checkout looks like.
function version(
  value: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "service.name": "checkout",
    "service.version": value,
    "deployment.environment.name": "production",
    ...extra,
  };
}

// What a pod of the api Deployment reports.
function rollout(
  replicaSet: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "k8s.cluster.name": "prod-eu",
    "k8s.namespace.name": "web",
    "k8s.deployment.name": "api",
    "k8s.replicaset.name": replicaSet,
    ...extra,
  };
}

function rows(): Array<JSONObject> {
  return submissions.flatMap((submission: Submission) => {
    return submission.rows;
  });
}

function attributesOf(row: JSONObject): Dictionary<string> {
  return row["attributes"] as Dictionary<string>;
}

// Another ingest worker: same Redis, its own (empty) in-process memo.
function anotherWorker(): void {
  TelemetryChangeDetector.resetMemo();
}

beforeEach(() => {
  store = new Map<string, StoredValue>();
  submissions = [];
  cacheCalls = [];
  now = NOW;
  TelemetryChangeDetector.resetMemo();
  mockRedis();
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    _target: unknown,
    submitted: Array<JSONObject>,
    options?: { dedupToken?: string | undefined },
  ) => {
    submissions.push({ rows: submitted, dedupToken: options?.dedupToken });
    return { flushed: Promise.resolve() };
  }) as never);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return now;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a service's new version", () => {
  test("the first version a service reports is its baseline, not a deploy", async () => {
    await observe(version("2.3.0"));

    expect(rows()).toEqual([]);
    // Claimed and remembered, so the next version has something to follow.
    expect(cacheCalls).toEqual([
      `setStringIfNotExists:${CHANGE_DETECTION_SEEN_NAMESPACE}`,
      `swapString:${CHANGE_DETECTION_LATEST_NAMESPACE}`,
    ]);
  });

  test("a version after the baseline is recorded as a deploy of the service", async () => {
    await observe(version("2.3.0"));
    now = new Date("2026-10-19T10:20:00.000Z");
    await observe(
      version("2.3.1", {
        "vcs.ref.head.revision": "1a2b3c4d5e6f",
        "vcs.repository.url.full": "https://github.com/acme/checkout",
      }),
    );

    expect(rows()).toHaveLength(1);
    const row: JSONObject = rows()[0]!;

    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
    expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
    expect(row["eventType"]).toBe("deployment");
    expect(row["title"]).toBe("Deployed checkout 2.3.1");
    expect(row["time"]).toBe("2026-10-19 10:20:00.000000000");
    expect(attributesOf(row)).toEqual({
      "oneuptime.change.source": "service-version",
      "service.version": "2.3.1",
      "oneuptime.change.previous_version": "2.3.0",
      "deployment.environment.name": "production",
      "vcs.ref.head.revision": "1a2b3c4d5e6f",
      "vcs.repository.url.full": "https://github.com/acme/checkout",
    });
    /*
     * Kept as long as the service's metrics are (15 days here). The day,
     * not the hour: day arithmetic runs in the host's time zone, and a
     * daylight-saving change in the window moves the clock time.
     */
    expect(String(row["retentionDate"])).toMatch(/^2026-11-03 /);
  });

  test("its row carries a token of its own, not the ingest job's", async () => {
    await observe(version("1"));
    await observe(version("2"));

    expect(submissions).toHaveLength(1);
    expect(submissions[0]!.dedupToken).toMatch(/^change-detection:/);
  });

  test("a version this worker checked lately costs no Redis call", async () => {
    await observe(version("2.3.0"));
    cacheCalls = [];

    for (let i: number = 0; i < 50; i++) {
      await observe(version("2.3.0"));
    }

    expect(cacheCalls).toEqual([]);
    expect(rows()).toEqual([]);
  });

  test("a rolling deploy's old pods reporting the old version again record nothing", async () => {
    await observe(version("2.3.0"));
    await observe(version("2.3.1"));
    anotherWorker();
    await observe(version("2.3.0"));
    await observe(version("2.3.1"));

    expect(rows()).toHaveLength(1);
  });

  test("two workers seeing the new version at once record it once", async () => {
    await observe(version("2.3.0"));

    anotherWorker();
    await observe(version("2.3.1"));
    anotherWorker();
    await observe(version("2.3.1"));
    anotherWorker();
    await Promise.all([observe(version("2.3.2")), observe(version("2.3.2"))]);

    expect(
      rows().map((row: JSONObject) => {
        return attributesOf(row)["service.version"];
      }),
    ).toEqual(["2.3.1", "2.3.2"]);
  });

  test("each deploy names the version it replaced", async () => {
    await observe(version("1.0.0"));
    await observe(version("1.1.0"));
    await observe(version("1.2.0"));

    expect(
      rows().map((row: JSONObject) => {
        return attributesOf(row)["oneuptime.change.previous_version"];
      }),
    ).toEqual(["1.0.0", "1.1.0"]);
  });

  test("environments are tracked apart", async () => {
    await observe(version("1.0.0"));
    await observe(
      version("2.0.0", { "deployment.environment.name": "staging" }),
    );

    // staging's first version is its own baseline, not a deploy to production.
    expect(rows()).toEqual([]);

    await observe(version("2.0.0"));

    expect(rows()).toHaveLength(1);
    expect(attributesOf(rows()[0]!)).toMatchObject({
      "service.version": "2.0.0",
      "oneuptime.change.previous_version": "1.0.0",
      "deployment.environment.name": "production",
    });
  });

  test("a service with no environment is tracked as one", async () => {
    await observe({ "service.version": "1" });
    await observe({ "service.version": "2" });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]!["title"]).toBe("Deployed checkout 2");
    expect(
      attributesOf(rows()[0]!)["deployment.environment.name"],
    ).toBeUndefined();
  });

  test("services are tracked apart", async () => {
    const otherService: TelemetryServiceMetadata = serviceMetadata({
      serviceName: "billing",
      primaryEntityId: ObjectID.generate(),
    });

    await observe(version("1"));
    await observe(version("2"), { metadata: otherService });

    expect(rows()).toEqual([]);
  });

  test("a placeholder version is never tracked", async () => {
    for (const placeholder of ["unknown", "latest", "dev", ""]) {
      await observe(version(placeholder));
    }

    expect(cacheCalls).toEqual([]);
    expect(rows()).toEqual([]);
  });

  test("only a service has versions: a host's block is not tracked", async () => {
    await observe(version("1"), {
      metadata: serviceMetadata({
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
      }),
    });
    await observe(version("2"), {
      metadata: serviceMetadata({
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
      }),
    });

    expect(cacheCalls).toEqual([]);
    expect(rows()).toEqual([]);
  });

  test("the time the telemetry arrived is the deploy's time", async () => {
    await observe(version("1"));
    await observe(version("2"), { observedAt: "2026-10-19T09:58:30.000Z" });

    expect(rows()[0]!["time"]).toBe("2026-10-19 09:58:30.000000000");
  });

  test("an unreadable arrival time falls back to now", async () => {
    await observe(version("1"));
    await observe(version("2"), { observedAt: "not a date" });

    expect(rows()[0]!["time"]).toBe("2026-10-19 10:15:00.000000000");
  });
});

describe("a noisy version", () => {
  test(`at most ${MAX_CHANGES_PER_SCOPE_PER_HOUR} changes a scope an hour are recorded, with one warning`, async () => {
    await observe(version("build-0"));

    for (let i: number = 1; i <= MAX_CHANGES_PER_SCOPE_PER_HOUR + 4; i++) {
      await observe(version(`build-${i}`));
    }

    expect(rows()).toHaveLength(MAX_CHANGES_PER_SCOPE_PER_HOUR);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(cacheCalls).toContain(
      `incrementWithExpiry:${CHANGE_DETECTION_COUNT_NAMESPACE}`,
    );
  });

  test("the next hour records again", async () => {
    await observe(version("build-0"));

    for (let i: number = 1; i <= MAX_CHANGES_PER_SCOPE_PER_HOUR + 1; i++) {
      await observe(version(`build-${i}`));
    }

    expect(rows()).toHaveLength(MAX_CHANGES_PER_SCOPE_PER_HOUR);

    now = new Date(NOW.getTime() + 60 * 60 * 1000);
    await observe(version("build-next-hour"));

    expect(rows()).toHaveLength(MAX_CHANGES_PER_SCOPE_PER_HOUR + 1);
  });

  test("a noisy service does not use up another's budget", async () => {
    await observe(version("build-0"));
    for (let i: number = 1; i <= MAX_CHANGES_PER_SCOPE_PER_HOUR + 2; i++) {
      await observe(version(`build-${i}`));
    }

    const billing: TelemetryServiceMetadata = serviceMetadata({
      serviceName: "billing",
      primaryEntityId: ObjectID.generate(),
    });
    await observe(version("1"), { metadata: billing });
    await observe(version("2"), { metadata: billing });

    expect(
      rows().filter((row: JSONObject) => {
        return row["title"] === "Deployed billing 2";
      }),
    ).toHaveLength(1);
  });
});

describe("a Kubernetes rollout", () => {
  test("the first ReplicaSet a Deployment reports is its baseline", async () => {
    await observe(rollout("api-5b8c2d"), {
      kubernetesClusterId: CLUSTER_ID,
    });

    expect(rows()).toEqual([]);
  });

  test("a new ReplicaSet is recorded as a rollout of the service", async () => {
    await observe(rollout("api-5b8c2d"), { kubernetesClusterId: CLUSTER_ID });
    await observe(rollout("api-7d4f9c"), { kubernetesClusterId: CLUSTER_ID });

    expect(rows()).toHaveLength(1);
    const row: JSONObject = rows()[0]!;

    expect(row["title"]).toBe("Rolled out web/api");
    expect(row["eventType"]).toBe("deployment");
    expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
    expect(attributesOf(row)).toEqual({
      "oneuptime.change.source": "kubernetes",
      "k8s.deployment.name": "api",
      "k8s.replicaset.name": "api-7d4f9c",
      "oneuptime.change.previous_replicaset": "api-5b8c2d",
      "k8s.namespace.name": "web",
      "k8s.cluster.name": "prod-eu",
      "oneuptime.kubernetes.cluster.id": CLUSTER_ID.toString(),
    });
  });

  test("a block that resolved to the cluster records a project-wide rollout", async () => {
    const clusterMetadata: TelemetryServiceMetadata = serviceMetadata({
      serviceName: "kubernetes-agent-prod-eu",
      primaryEntityId: CLUSTER_ID,
      primaryEntityType: ServiceType.KubernetesCluster,
    });

    await observe(rollout("api-1"), {
      metadata: clusterMetadata,
      kubernetesClusterId: CLUSTER_ID,
    });
    await observe(rollout("api-2"), {
      metadata: clusterMetadata,
      kubernetesClusterId: CLUSTER_ID,
    });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]!["primaryEntityId"]).toBeUndefined();
    expect(attributesOf(rows()[0]!)["oneuptime.kubernetes.cluster.id"]).toBe(
      CLUSTER_ID.toString(),
    );
  });

  test("the same Deployment name in two clusters is two Deployments", async () => {
    await observe(rollout("api-1"), { kubernetesClusterId: CLUSTER_ID });
    await observe(rollout("api-2"), {
      kubernetesClusterId: ObjectID.generate(),
    });

    expect(rows()).toEqual([]);
  });

  test("an old ReplicaSet's pods reporting again record nothing", async () => {
    await observe(rollout("api-1"), { kubernetesClusterId: CLUSTER_ID });
    await observe(rollout("api-2"), { kubernetesClusterId: CLUSTER_ID });
    anotherWorker();
    await observe(rollout("api-1"), { kubernetesClusterId: CLUSTER_ID });

    expect(rows()).toHaveLength(1);
  });

  test("a rollout and a new version in one block are both recorded", async () => {
    await observe({ ...version("2.3.0"), ...rollout("api-1") });
    await observe({ ...version("2.3.1"), ...rollout("api-2") });

    expect(
      rows()
        .map((row: JSONObject) => {
          return row["title"];
        })
        .sort(),
    ).toEqual(["Deployed checkout 2.3.1", "Rolled out web/api"]);
    const rolloutRow: JSONObject = rows().find((row: JSONObject) => {
      return row["title"] === "Rolled out web/api";
    })!;
    expect(attributesOf(rolloutRow)["service.version"]).toBe("2.3.1");
  });
});

describe("failures", () => {
  test("a Redis that is down records nothing and never throws into ingest", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("Cache is not connected"));

    await expect(observe(version("1"))).rejects.toThrow(
      "Cache is not connected",
    );

    expect(() => {
      TelemetryChangeDetector.observeResource({
        projectId: PROJECT_ID,
        metadata: serviceMetadata(),
        attributes: resource(version("2")),
      });
    }).not.toThrow();

    // Let the fire-and-forget check settle.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });

    expect(rows()).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Change detection skipped a resource block"),
    );
  });

  test("a failed write is reported to the caller of observe", async () => {
    jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async () => {
      return { flushed: Promise.reject(new Error("ClickHouse is down")) };
    }) as never);

    await observe(version("1"));
    await expect(observe(version("2"))).rejects.toThrow("ClickHouse is down");
  });

  test("seen values are kept for the days the detector says", async () => {
    const ttls: Array<number | undefined> = [];
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (
          _namespace: string,
          _key: string,
          _value: string,
          options?: { expiresInSeconds?: number | undefined },
        ) => {
          ttls.push(options?.expiresInSeconds);
          return true;
        },
      );

    await observe(version("1"));

    expect(ttls).toEqual([OneUptimeDate.getSecondsInDays(SEEN_TTL_IN_DAYS)]);
  });
});

describe("the rows it writes", () => {
  test("are written to the change events table", async () => {
    await observe(version("1"));
    await observe(version("2"));

    expect(
      (TelemetryFanInWriter.submit as unknown as jest.Mock).mock.calls[0]![0],
    ).toBe(ChangeEventService);
  });
});
