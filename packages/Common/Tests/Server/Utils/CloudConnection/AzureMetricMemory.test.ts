import { describe, expect, test } from "@jest/globals";
import { AzureArmError } from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import {
  AZURE_ALL_BATCHES_KEY,
  AZURE_MAX_METRIC_STATUSES,
  AZURE_METRIC_STATUS_MAX_AGE_MS,
  describeAzureMetricNotRead,
  describeAzureMetricReadFailure,
  getAzureMetricBatchOffKeys,
  getNextAzureMetricStatus,
  isAzureMetricBatchOff,
  isAzureMetricUnsupportedNow,
  pruneAzureMetricStatuses,
  readAzureMetricBatchesOff,
  readAzureMetricStatuses,
  rememberAzureMetricBatchRefusals,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureMetricMemory";
import {
  AzureMetricPlace,
  AzureMetricResourceRead,
  AzureMetricToRead,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureMetricReads";
import { readAzureRateLimit } from "../../../../Server/Utils/CloudConnection/Azure/AzureRateLimit";
import { CloudReadBudgetSpent } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  CloudMetricNotReadKind,
  CloudResourceMetricStatus,
} from "../../../../Types/Cloud/CloudResourceMetricCollection";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  BAD_REQUEST,
  FAKE_SUBSCRIPTION,
  SERVER_BUSY,
  armIdOf,
  samplingTypeNotFound,
} from "./FakeAzureMonitor";

/*
 * What an Azure connection keeps of its metric reads from one read to the
 * next (#10291): each resource's metrics it could not read - one Azure does
 * not serve left out for a day, one Azure was busy for asked again at the
 * next read - and who Azure refused to read in batches.
 */

const NOW: Date = new Date("2026-10-21T12:07:00Z");
const EARLIER: string = "2026-10-21T11:07:00.000Z";
const DAY_MS: number = 24 * 60 * 60 * 1000;

const PLACE: AzureMetricPlace = {
  armId: armIdOf({ type: "Microsoft.Cdn/profiles", name: "fd-prod" }),
  subscriptionId: FAKE_SUBSCRIPTION,
  region: "global",
  type: "Microsoft.Cdn/profiles",
};

const BYTE_HIT_RATIO: AzureMetricToRead = {
  name: "ByteHitRatio",
  aggregation: "Average",
  supportedAggregations: ["Average"],
};
const REQUEST_COUNT: AzureMetricToRead = {
  name: "RequestCount",
  aggregation: "Total",
};
const PERCENTAGE_5XX: AzureMetricToRead = {
  name: "Percentage5XX",
  aggregation: "Average",
};

function readOf(
  data: Partial<AzureMetricResourceRead<AzureMetricToRead>> = {},
): AzureMetricResourceRead<AzureMetricToRead> {
  return {
    place: PLACE,
    series: [],
    read: [],
    notRead: [],
    capped: [],
    answeredCalls: 1,
    isCutShort: false,
    ...data,
  };
}

describe("a resource's status after a read", () => {
  test("a metric Azure does not serve is kept with Azure's words, and left out for a day", () => {
    const status: CloudResourceMetricStatus | null = getNextAzureMetricStatus({
      previous: undefined,
      read: readOf({
        read: [REQUEST_COUNT],
        notRead: [
          {
            metric: BYTE_HIT_RATIO,
            kind: CloudMetricNotReadKind.Unsupported,
            code: "BadRequest",
            message: samplingTypeNotFound("ByteHitRatio", "Sum").errorMessage,
          },
        ],
      }),
      now: NOW,
    });

    expect(status).toEqual({
      metrics: {
        bytehitratio: {
          name: "ByteHitRatio",
          kind: CloudMetricNotReadKind.Unsupported,
          error:
            "Sampling type is not found. Metric: AzureFrontdoorShoebox/ByteHitRatio. Sampling type requested: Sum.",
          since: NOW.toISOString(),
          at: NOW.toISOString(),
          until: new Date(NOW.getTime() + DAY_MS).toISOString(),
        },
      },
    });
    expect(
      isAzureMetricUnsupportedNow({
        status: status!,
        metricName: "bytehitratio",
        now: NOW,
      }),
    ).toBe(true);
    // A day on, it is asked again.
    expect(
      isAzureMetricUnsupportedNow({
        status: status!,
        metricName: "ByteHitRatio",
        now: new Date(NOW.getTime() + DAY_MS),
      }),
    ).toBe(false);
    expect(
      isAzureMetricUnsupportedNow({
        status: status!,
        metricName: "RequestCount",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a metric Azure was busy for is kept since it was first, and is not left out", () => {
    const previous: CloudResourceMetricStatus = {
      metrics: {
        cpupercentage: {
          name: "CpuPercentage",
          kind: CloudMetricNotReadKind.Throttled,
          error: "earlier",
          since: EARLIER,
          at: EARLIER,
        },
      },
    };
    const status: CloudResourceMetricStatus | null = getNextAzureMetricStatus({
      previous,
      read: readOf({
        notRead: [
          {
            metric: { name: "CpuPercentage", aggregation: "Average" },
            kind: CloudMetricNotReadKind.Throttled,
            code: SERVER_BUSY.errorCode,
            message: SERVER_BUSY.errorMessage,
          },
        ],
      }),
      now: NOW,
    });

    expect(status?.metrics?.["cpupercentage"]).toEqual({
      name: "CpuPercentage",
      kind: CloudMetricNotReadKind.Throttled,
      error: SERVER_BUSY.errorMessage,
      since: EARLIER,
      at: NOW.toISOString(),
    });
    expect(
      isAzureMetricUnsupportedNow({
        status: status!,
        metricName: "CpuPercentage",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("a metric read again is cleared; one this read did not ask about stays; nothing left, nothing kept", () => {
    const previous: CloudResourceMetricStatus = {
      metrics: {
        bytehitratio: {
          name: "ByteHitRatio",
          kind: CloudMetricNotReadKind.Unsupported,
          error: "Sampling type is not found.",
          since: EARLIER,
          at: EARLIER,
          until: new Date(NOW.getTime() + DAY_MS).toISOString(),
        },
        percentage5xx: {
          name: "Percentage5XX",
          kind: CloudMetricNotReadKind.Throttled,
          error: "busy",
          since: EARLIER,
          at: EARLIER,
        },
      },
    };
    const next: CloudResourceMetricStatus | null = getNextAzureMetricStatus({
      previous,
      read: readOf({ read: [PERCENTAGE_5XX] }),
      now: NOW,
    });

    // Left out of this read, ByteHitRatio still says why.
    expect(Object.keys(next?.metrics || {})).toEqual(["bytehitratio"]);
    expect(
      getNextAzureMetricStatus({
        previous: next!,
        read: readOf({ read: [BYTE_HIT_RATIO, PERCENTAGE_5XX] }),
        now: NOW,
      }),
    ).toBeNull();
  });

  test("no call of it answered: the resource as a whole, since it first was, with Azure's words - and only what Azure does not serve of its metrics", () => {
    const previous: CloudResourceMetricStatus = {
      failed: { error: "earlier", since: EARLIER, at: EARLIER },
      metrics: {
        bytehitratio: {
          name: "ByteHitRatio",
          kind: CloudMetricNotReadKind.Unsupported,
          error: "Sampling type is not found.",
          since: EARLIER,
          at: EARLIER,
          until: new Date(NOW.getTime() + DAY_MS).toISOString(),
        },
        percentage5xx: {
          name: "Percentage5XX",
          kind: CloudMetricNotReadKind.Throttled,
          error: "busy",
          since: EARLIER,
          at: EARLIER,
        },
      },
    };
    const busy: LlmProviderError = new LlmProviderError({
      message: `Azure metrics request failed with HTTP 529: ${SERVER_BUSY.errorMessage}`,
      kind: CloudConnectionFailureKind.Unavailable,
      statusCode: 529,
    });
    const status: CloudResourceMetricStatus | null = getNextAzureMetricStatus({
      previous,
      read: readOf({
        answeredCalls: 0,
        failure: busy,
        notRead: [
          {
            metric: PERCENTAGE_5XX,
            kind: CloudMetricNotReadKind.Throttled,
            code: "529",
            message: busy.message,
          },
        ],
      }),
      now: NOW,
    });

    expect(status?.failed).toEqual({
      error: busy.message,
      since: EARLIER,
      at: NOW.toISOString(),
    });
    expect(Object.keys(status?.metrics || {})).toEqual(["bytehitratio"]);
  });

  test("cut short by the read's limit, it says so; a later read that answers clears it", () => {
    const cut: CloudResourceMetricStatus | null = getNextAzureMetricStatus({
      previous: undefined,
      read: readOf({ answeredCalls: 0, isCutShort: true }),
      now: NOW,
    });

    expect(cut?.failed?.error).toBe(
      "The read reached its limit before this resource. The next read reads it.",
    );
    expect(
      getNextAzureMetricStatus({
        previous: cut!,
        read: readOf({ read: [REQUEST_COUNT] }),
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a read that asked nothing of it - nothing due - keeps what was said", () => {
    const previous: CloudResourceMetricStatus = {
      failed: { error: "earlier", since: EARLIER, at: EARLIER },
    };

    expect(
      getNextAzureMetricStatus({
        previous,
        read: readOf({ answeredCalls: 0 }),
        now: NOW,
      }),
    ).toEqual(previous);
  });

  test("Azure's words are kept on one line, 300 characters at most", () => {
    const status: CloudResourceMetricStatus | null = getNextAzureMetricStatus({
      previous: undefined,
      read: readOf({
        notRead: [
          {
            metric: REQUEST_COUNT,
            kind: CloudMetricNotReadKind.Failed,
            code: "InternalServerError",
            message: `first line\n${"x".repeat(1000)}`,
          },
        ],
      }),
      now: NOW,
    });
    const error: string = status!.metrics!["requestcount"]!.error;

    expect(error.startsWith("first line x")).toBe(true);
    expect(error).toHaveLength(300);
    expect(error.endsWith("…")).toBe(true);
  });
});

describe("the statuses a connection keeps", () => {
  test("read defensively: what is not a status is dropped, keys in lower case", () => {
    expect(readAzureMetricStatuses(undefined)).toEqual({});
    expect(readAzureMetricStatuses([])).toEqual({});
    expect(
      readAzureMetricStatuses({
        "/Subscriptions/X/Resource": {
          failed: { error: "e", since: EARLIER, at: EARLIER },
        },
        broken: { metrics: { a: { name: "A", kind: "nonsense" } } },
        empty: {},
      }),
    ).toEqual({
      "/subscriptions/x/resource": {
        failed: { error: "e", since: EARLIER, at: EARLIER },
      },
    });
  });

  test("none older than a week, the newest kept when there are too many", () => {
    const old: string = new Date(
      NOW.getTime() - AZURE_METRIC_STATUS_MAX_AGE_MS - 1,
    ).toISOString();
    const statuses: Record<string, CloudResourceMetricStatus> = {
      stale: { failed: { error: "e", since: old, at: old } },
      fresh: { failed: { error: "e", since: EARLIER, at: EARLIER } },
    };

    expect(
      Object.keys(pruneAzureMetricStatuses({ statuses, now: NOW })),
    ).toEqual(["fresh"]);

    const many: Record<string, CloudResourceMetricStatus> = {};

    for (
      let index: number = 0;
      index < AZURE_MAX_METRIC_STATUSES + 5;
      index++
    ) {
      const at: string = new Date(NOW.getTime() - index * 1000).toISOString();

      many[`resource-${index}`] = { failed: { error: "e", since: at, at } };
    }

    const kept: Record<string, CloudResourceMetricStatus> =
      pruneAzureMetricStatuses({ statuses: many, now: NOW });

    expect(Object.keys(kept)).toHaveLength(AZURE_MAX_METRIC_STATUSES);
    expect(kept["resource-0"]).toBeDefined();
    expect(kept[`resource-${AZURE_MAX_METRIC_STATUSES + 4}`]).toBeUndefined();
  });
});

function refusal(status: number, body: string): AzureArmError {
  return new AzureArmError(
    new LlmProviderError({
      message: `Azure metrics batch request failed with HTTP ${status}: ${body}`,
      kind: LlmProviderError.kindFromStatus(status),
      statusCode: status,
      responseBody: body,
    }),
    readAzureRateLimit({}, NOW.getTime()),
  );
}

const PLAN: AzureMetricPlace = {
  armId: armIdOf({ type: "Microsoft.Web/serverFarms", name: "plan-1" }),
  subscriptionId: FAKE_SUBSCRIPTION,
  region: "southcentralus",
  type: "Microsoft.Web/serverFarms",
};

describe("batches Azure refused", () => {
  test("refused for the subscription (401, 403): its resources are read one at a time for a day, and the role it takes is named", () => {
    const batchesOff: Record<string, string> = {};
    const warnings: Array<string> = rememberAzureMetricBatchRefusals({
      batchesOff,
      refusals: [
        {
          place: PLAN,
          error: refusal(
            401,
            '{"error":{"code":"AuthorizationFailed","message":"The client does not have authorization to perform action Microsoft.Insights/Metrics/Read over the subscription."}}',
          ),
        },
        // The same subscription again: said once.
        { place: { ...PLAN, region: "eastus" }, error: refusal(401, "{}") },
      ],
      now: NOW,
    });

    expect(batchesOff).toEqual({
      [FAKE_SUBSCRIPTION]: new Date(NOW.getTime() + DAY_MS).toISOString(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^Azure Monitor refused to read the metrics of subscription d0cfe6b2-9ac0-4464-9919-dccaee2e48c0 in batches: Azure metrics batch request failed with HTTP 401: .*\. They are read a resource at a time until 2026-10-22\. Reading them in batches takes the Monitoring Reader role on the subscription itself\.$/,
    );
    expect(isAzureMetricBatchOff({ batchesOff, place: PLAN })).toBe(true);
    expect(
      isAzureMetricBatchOff({
        batchesOff,
        place: { ...PLAN, subscriptionId: "other" },
      }),
    ).toBe(false);
  });

  test("refused for a type in a Region (400): that type there alone", () => {
    const batchesOff: Record<string, string> = {};

    rememberAzureMetricBatchRefusals({
      batchesOff,
      refusals: [{ place: PLAN, error: refusal(400, '{"error":{}}') }],
      now: NOW,
    });

    expect(Object.keys(batchesOff)).toEqual([
      getAzureMetricBatchOffKeys(PLAN).type,
    ]);
    expect(getAzureMetricBatchOffKeys(PLAN).type).toBe(
      `${FAKE_SUBSCRIPTION}|southcentralus|microsoft.web/serverfarms`,
    );
    expect(isAzureMetricBatchOff({ batchesOff, place: PLAN })).toBe(true);
    expect(
      isAzureMetricBatchOff({
        batchesOff,
        place: { ...PLAN, region: "eastus" },
      }),
    ).toBe(false);
  });

  test("refused because a resource does not publish a metric of its type's: nothing remembered, nothing said - that resource is read with its own definitions", () => {
    const batchesOff: Record<string, string> = {};
    const warnings: Array<string> = rememberAzureMetricBatchRefusals({
      batchesOff,
      refusals: [
        {
          place: PLAN,
          error: refusal(
            400,
            '{"error":{"code":"BadRequest","message":"Failed to find metric configuration for provider: Microsoft.Web, resource Type: serverFarms, metric: HttpQueueLength, Valid metrics: CpuPercentage"}}',
          ),
        },
      ],
      now: NOW,
    });

    expect(batchesOff).toEqual({});
    expect(warnings).toEqual([]);
  });

  test("a batch that did not get through is read one at a time this read only", () => {
    const batchesOff: Record<string, string> = {};
    const warnings: Array<string> = rememberAzureMetricBatchRefusals({
      batchesOff,
      refusals: [{ place: PLAN, error: new Error("socket hang up") }],
      now: NOW,
    });

    expect(batchesOff).toEqual({});
    expect(warnings).toEqual([
      "Azure Monitor could not read the metrics of Microsoft.Web/serverFarms in southcentralus of subscription d0cfe6b2-9ac0-4464-9919-dccaee2e48c0 in batches: socket hang up. They are read a resource at a time this time.",
    ]);
  });

  test("the data plane's sign-in refused: every batch of the connection, for a day; a sign-in that did not get through, this read", () => {
    const refused: Record<string, string> = {};
    const refusedWarnings: Array<string> = rememberAzureMetricBatchRefusals({
      batchesOff: refused,
      refusals: [],
      signInFailure: new LlmProviderError({
        message: "Azure sign-in failed with HTTP 400: AADSTS70011.",
        kind: CloudConnectionFailureKind.Authentication,
        statusCode: 400,
      }),
      now: NOW,
    });

    expect(Object.keys(refused)).toEqual([AZURE_ALL_BATCHES_KEY]);
    expect(isAzureMetricBatchOff({ batchesOff: refused, place: PLAN })).toBe(
      true,
    );
    expect(refusedWarnings).toEqual([
      "Could not sign in to Azure Monitor's metrics API, which reads the metrics of many resources at once: Azure sign-in failed with HTTP 400: AADSTS70011. Metrics are read a resource at a time until 2026-10-22.",
    ]);

    const unreached: Record<string, string> = {};

    expect(
      rememberAzureMetricBatchRefusals({
        batchesOff: unreached,
        refusals: [],
        signInFailure: new Error("getaddrinfo ENOTFOUND"),
        now: NOW,
      }),
    ).toEqual([
      "Could not sign in to Azure Monitor's metrics API, which reads the metrics of many resources at once: getaddrinfo ENOTFOUND. Metrics are read a resource at a time this time.",
    ]);
    expect(unreached).toEqual({});
  });

  test("kept until they end: an ended one, or one that is not a time, is dropped", () => {
    expect(
      readAzureMetricBatchesOff({
        kept: {
          [FAKE_SUBSCRIPTION]: new Date(NOW.getTime() + 1000).toISOString(),
          ended: new Date(NOW.getTime() - 1000).toISOString(),
          broken: "soon",
        },
        now: NOW,
      }),
    ).toEqual({
      [FAKE_SUBSCRIPTION]: new Date(NOW.getTime() + 1000).toISOString(),
    });
    expect(readAzureMetricBatchesOff({ kept: "x", now: NOW })).toEqual({});
  });
});

describe("the read's warnings", () => {
  test("say the metric and how many resources, as a resource's page matches them, then why and what comes next", () => {
    expect(
      describeAzureMetricNotRead({
        notRead: {
          metric: { name: "CpuPercentage", aggregation: "Average" },
          kind: CloudMetricNotReadKind.Throttled,
          code: SERVER_BUSY.errorCode,
          message: "Query was throttled with reason: ServerBusy.",
        },
        resources: 3,
        now: NOW,
      }),
    ).toBe(
      "Azure Monitor could not read CpuPercentage of 3 resources: it was busy (Query was throttled with reason: ServerBusy.). The next read asks again.",
    );
    expect(
      describeAzureMetricNotRead({
        notRead: {
          metric: BYTE_HIT_RATIO,
          kind: CloudMetricNotReadKind.Unsupported,
          code: "BadRequest",
          message: "Sampling type is not found.",
        },
        resources: 1,
        now: NOW,
      }),
    ).toBe(
      "Azure Monitor could not read ByteHitRatio of 1 resource: it does not serve it for it (Sampling type is not found.). It is not asked for again until 2026-10-22.",
    );
    expect(
      describeAzureMetricNotRead({
        notRead: {
          metric: {
            name: "ThrottledRequestPercentage",
            aggregation: "Average",
          },
          kind: CloudMetricNotReadKind.Failed,
          code: BAD_REQUEST.errorCode,
          message: "",
        },
        resources: 2,
        now: NOW,
      }),
    ).toBe(
      "Azure Monitor could not read ThrottledRequestPercentage of 2 resources: BadRequest",
    );
  });

  test("a resource not read at all says why, busy or not", () => {
    expect(
      describeAzureMetricReadFailure(
        new LlmProviderError({
          message: "Azure metrics request failed with HTTP 529: busy",
          kind: CloudConnectionFailureKind.Unavailable,
          statusCode: 529,
        }),
      ),
    ).toBe(
      "Azure Monitor was busy (Azure metrics request failed with HTTP 529: busy). The next read asks again.",
    );
    expect(
      describeAzureMetricReadFailure(
        new LlmProviderError({
          message: "Azure metrics request failed with HTTP 403: denied",
          kind: CloudConnectionFailureKind.Permission,
          statusCode: 403,
        }),
      ),
    ).toBe("Azure metrics request failed with HTTP 403: denied");
    expect(describeAzureMetricReadFailure(new CloudReadBudgetSpent())).toBe(
      "The read reached its limit for this run.",
    );
  });
});
