/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * CloudPlatformNormalization.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService, {
  ServerlessFunctionIdentity,
} from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ServerlessFunctionInstanceService from "Common/Server/Services/ServerlessFunctionInstanceService";
import LabelService from "Common/Server/Services/LabelService";
import SpanService from "Common/Server/Services/SpanService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import ProfileService from "Common/Server/Services/ProfileService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { ExpressRequest } from "Common/Server/Utils/Express";
import InventoryItem, {
  EntityExtractionResult,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import {
  CLOUD_PLATFORM_ALIASES,
  FAAS_CLOUD_PLATFORM_VALUES,
  FaasCloudPlatform,
  MANAGED_CLOUD_PLATFORM_VALUES,
  normalizeCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import fs from "fs";
import path from "path";
/*
 * `jest` is deliberately taken from the ambient global rather than from
 * "@jest/globals" — see OtelIngestMaintenanceFenceRelease.test.ts for why
 * the two spell a spy type differently.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A Serverless Function is keyed on its identity — faas.name, or on a FaaS
 * cloud.platform the service.name — and every Serverless page, the resource
 * facet and the AI resource tools scope its telemetry by
 * `resource.faas.name` = that identity. The Azure Functions host, the .NET
 * isolated worker and the Node Azure detector describe a Function App by
 * service.name and never set faas.name, so the function was discovered but
 * its rows carried no faas.name and every page stayed empty.
 *
 * The fix: one identity rule (resolveServerlessFunctionIdentity) shared by
 * discovery and by a stamp in the ingest pre-pass
 * (stampServerlessFunctionNameAttribute) that writes the identity onto the
 * wire-shaped resource list as faas.name before anything reads or stores
 * it. This suite pins the rule, the stamp, where every signal service calls
 * it, that discovery and the stored rows agree for every input shape, and
 * that real Azure-Functions-shaped batches come out of all four ingest
 * paths carrying `resource.faas.name`.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const FUNCTION_ROW_ID: string = "66666666-6666-4666-8666-666666666666";
const AZURE_APP: string = "contoso-orders";
const AZURE_RESOURCE_ID: string = `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/orders-rg/providers/Microsoft.Web/sites/${AZURE_APP}`;
const AZURE_INSTANCE_ID: string =
  "2c0a0b1e5c8d4b6f9e7a3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const SERVICES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "Services",
);

const SIGNAL_SERVICE_FILES: ReadonlyArray<string> = [
  "OtelTracesIngestService.ts",
  "OtelLogsIngestService.ts",
  "OtelMetricsIngestService.ts",
  "OtelProfilesIngestService.ts",
];

const NORMALIZE_CALL: string =
  "this.normalizeCloudPlatformAttribute(resourceAttributes_raw);";
const STAMP_CALL: string =
  "this.stampServerlessFunctionNameAttribute(resourceAttributes_raw);";

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): JSONObject {
  return { key: key, value: { intValue: value } };
}

function attributes(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(
    ([key, value]: [string, string]): JSONObject => {
      return stringAttribute(key, value);
    },
  );
}

function clone(list: JSONArray): JSONArray {
  return JSON.parse(JSON.stringify(list)) as JSONArray;
}

function entriesFor(list: JSONArray, key: string): Array<JSONObject> {
  return (list as Array<JSONObject | null>).filter(
    (attribute: JSONObject | null): boolean => {
      return Boolean(attribute) && (attribute as JSONObject)["key"] === key;
    },
  ) as Array<JSONObject>;
}

function withoutKey(list: JSONArray, key: string): Array<unknown> {
  return (list as Array<JSONObject | null>).filter(
    (attribute: JSONObject | null): boolean => {
      return !attribute || attribute["key"] !== key;
    },
  );
}

function stamp(list: unknown): void {
  baseService["stampServerlessFunctionNameAttribute"](list);
}

function resolveIdentity(list: unknown): ServerlessFunctionIdentity | null {
  return baseService["resolveServerlessFunctionIdentity"](list);
}

function normalize(list: JSONArray): void {
  baseService["normalizeCloudPlatformAttribute"](list);
}

/* What each signal service stores as `resource.*` on every row. */
function storedResource(
  list: JSONArray,
): Dictionary<AttributeType | Array<AttributeType>> {
  return TelemetryUtil.getAttributes({
    items: list,
    prefixKeysWithString: "resource",
  });
}

/*
 * The identity rule as autoDiscoverServerless wrote it before the rule was
 * shared, over the same getStringAttribute reads — the parity target for
 * well-formed input, so the refactor provably changed no discovery.
 */
function legacyFunctionIdentifier(list: JSONArray): string | null {
  const faasName: string | null = baseService["getStringAttribute"](
    list,
    "faas.name",
  );
  const cloudPlatform: string | null = normalizeCloudPlatform(
    baseService["getStringAttribute"](list, "cloud.platform"),
  );
  const isFaasPlatform: boolean = cloudPlatform
    ? FAAS_CLOUD_PLATFORM_VALUES.has(cloudPlatform)
    : false;

  let functionIdentifier: string | null = faasName;
  if (!functionIdentifier && isFaasPlatform) {
    functionIdentifier = baseService["getStringAttribute"](
      list,
      "service.name",
    );
  }

  if (!functionIdentifier || (!faasName && !isFaasPlatform)) {
    return null;
  }
  return functionIdentifier;
}

/* The fields of the heartbeat discovery writes (updateLastSeen's `extra`). */
type Heartbeat = {
  agentVersion: string | undefined;
  cloudPlatform: string | undefined;
  cloudProvider: string | undefined;
  cloudRegion: string | undefined;
  cloudAccountId: string | undefined;
  functionVersion: string | undefined;
  runtimeName: string | undefined;
  runtimeVersion: string | undefined;
};

/*
 * The heartbeat as autoDiscoverServerless wrote it before its reads went
 * through the shared null-safe reader: each field read with
 * getStringAttribute from the key it has always come from — the parity
 * target for every read the refactor rewrote.
 */
function legacyHeartbeat(list: JSONArray): Heartbeat {
  const read: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    return baseService["getStringAttribute"](list, key) || undefined;
  };
  return {
    agentVersion: read("oneuptime.agent.version"),
    cloudPlatform:
      normalizeCloudPlatform(
        baseService["getStringAttribute"](list, "cloud.platform"),
      ) || undefined,
    cloudProvider: read("cloud.provider"),
    cloudRegion: read("cloud.region"),
    cloudAccountId: read("cloud.account.id"),
    functionVersion: read("faas.version"),
    runtimeName: read("process.runtime.name"),
    runtimeVersion: read("process.runtime.version"),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Real resource shapes, attribute for attribute.
 * ---------------------------------------------------------------------------
 */

/*
 * The Functions host with "telemetryMode": "OpenTelemetry" — its
 * FunctionsResourceDetector (Microsoft.Azure.WebJobs.Script) in Azure, plus
 * the .NET SDK's default telemetry.sdk.* attributes. service.name is
 * WEBSITE_SITE_NAME; there is no faas.name.
 */
function azureFunctionsHostResource(appName: string = AZURE_APP): JSONArray {
  return [
    stringAttribute("telemetry.sdk.name", "opentelemetry"),
    stringAttribute("telemetry.sdk.language", "dotnet"),
    stringAttribute("telemetry.sdk.version", "1.12.0"),
    stringAttribute("ai.sdk.prefix", "azurefunctions:4.1041.200.0"),
    intAttribute("process.pid", 4242),
    stringAttribute("service.name", appName),
    stringAttribute("service.version", "4.1041.200.0"),
    stringAttribute("cloud.provider", "azure"),
    stringAttribute("cloud.platform", "azure_functions"),
    stringAttribute("cloud.region", "West Europe"),
    stringAttribute("cloud.resource_id", AZURE_RESOURCE_ID),
    stringAttribute("deployment.environment.name", "Production"),
    stringAttribute("azure.functions.site.update_id", "638912345678901234"),
  ];
}

/*
 * The .NET isolated worker with UseFunctionsWorkerDefaults() — the worker
 * package's own FunctionsResourceDetector. Same identity attributes, still
 * no faas.name.
 */
function dotnetIsolatedWorkerResource(appName: string = AZURE_APP): JSONArray {
  return [
    stringAttribute("telemetry.sdk.name", "opentelemetry"),
    stringAttribute("telemetry.sdk.language", "dotnet"),
    stringAttribute("telemetry.sdk.version", "1.12.0"),
    stringAttribute("ai.sdk.prefix", "dotnetiso:2.0.0.0"),
    intAttribute("process.pid", 5151),
    stringAttribute("service.name", appName),
    stringAttribute("service.version", "1.0.0.0"),
    stringAttribute("cloud.provider", "azure"),
    stringAttribute("cloud.platform", "azure_functions"),
    stringAttribute("cloud.region", "West Europe"),
    stringAttribute("cloud.resource_id", AZURE_RESOURCE_ID),
  ];
}

/*
 * A Node.js worker with @opentelemetry/resource-detector-azure's
 * AzureFunctionsDetector (plus the SDK's own detectors): the DOTTED
 * "azure.functions" platform, faas.instance from WEBSITE_INSTANCE_ID,
 * faas.max_memory — and no faas.name.
 */
function nodeAzureDetectorResource(appName: string = AZURE_APP): JSONArray {
  return [
    stringAttribute("telemetry.sdk.language", "nodejs"),
    stringAttribute("telemetry.sdk.name", "opentelemetry"),
    stringAttribute("telemetry.sdk.version", "2.0.1"),
    stringAttribute("cloud.provider", "azure"),
    stringAttribute("cloud.platform", "azure.functions"),
    stringAttribute("cloud.region", "West Europe"),
    intAttribute("process.pid", 88),
    stringAttribute("service.name", appName),
    stringAttribute("faas.instance", AZURE_INSTANCE_ID),
    stringAttribute("faas.max_memory", "1536"),
    stringAttribute("cloud.resource_id", AZURE_RESOURCE_ID),
    stringAttribute("host.name", "10-0-0-12"),
    stringAttribute("os.type", "linux"),
  ];
}

/* An AWS Lambda with the OpenTelemetry layer: the layer sets faas.name. */
function lambdaLayerResource(): JSONArray {
  return attributes({
    "service.name": "checkout",
    "faas.name": "checkout-handler",
    "faas.version": "$LATEST",
    "cloud.provider": "aws",
    "cloud.platform": "aws_lambda",
    "cloud.region": "us-east-1",
    "cloud.account.id": "123456789012",
  });
}

type ResourceBuilder = (appName?: string) => JSONArray;

interface NamedResource {
  name: string;
  build: ResourceBuilder;
}

const AZURE_RESOURCES: ReadonlyArray<NamedResource> = [
  { name: "the Functions host", build: azureFunctionsHostResource },
  {
    name: "the .NET isolated worker",
    build: dotnetIsolatedWorkerResource,
  },
  { name: "the Node.js Azure detector", build: nodeAzureDetectorResource },
];

// test.each rows: [name for the title, builder].
const AZURE_RESOURCE_CASES: Array<[string, ResourceBuilder]> =
  AZURE_RESOURCES.map((resource: NamedResource): [string, ResourceBuilder] => {
    return [resource.name, resource.build];
  });

describe("resolveServerlessFunctionIdentity — the one identity rule", () => {
  test("an explicit faas.name is the identity on any platform, trimmed", () => {
    for (const platform of [
      null,
      "aws_lambda",
      "azure_functions",
      "gcp_cloud_run",
      "some_future_platform",
    ]) {
      const list: JSONArray = attributes({
        "faas.name": "  checkout-handler  ",
        "service.name": "checkout",
        ...(platform ? { "cloud.platform": platform } : {}),
      });

      expect({ platform, identity: resolveIdentity(list) }).toEqual({
        platform,
        identity: {
          functionIdentifier: "checkout-handler",
          source: "faas.name",
          cloudPlatform: platform,
        },
      });
    }
  });

  test.each(Array.from(FAAS_CLOUD_PLATFORM_VALUES))(
    "on %s without faas.name, service.name is the identity",
    (platform: string) => {
      const list: JSONArray = attributes({
        "cloud.platform": platform,
        "service.name": "  orders-api ",
      });

      expect(resolveIdentity(list)).toEqual({
        functionIdentifier: "orders-api",
        source: "service.name",
        cloudPlatform: platform,
      });
    },
  );

  test("every cloud.platform alias of a FaaS platform counts, and reports the canonical platform", () => {
    const faasAliases: Array<[string, string]> = Object.entries(
      CLOUD_PLATFORM_ALIASES,
    ).filter(([, canonical]: [string, string]): boolean => {
      return FAAS_CLOUD_PLATFORM_VALUES.has(canonical);
    });

    // The Node detector's dotted Azure Functions spelling is among them.
    expect(faasAliases).toContainEqual([
      "azure.functions",
      FaasCloudPlatform.AzureFunctions,
    ]);

    for (const [alias, canonical] of faasAliases) {
      expect(
        resolveIdentity(
          attributes({ "cloud.platform": alias, "service.name": "app" }),
        ),
      ).toEqual({
        functionIdentifier: "app",
        source: "service.name",
        cloudPlatform: canonical,
      });
    }
  });

  test("a padded FaaS platform still counts: the platform is trimmed", () => {
    expect(
      resolveIdentity(
        attributes({ "cloud.platform": "  aws_lambda ", "service.name": "a" }),
      ),
    ).toEqual({
      functionIdentifier: "a",
      source: "service.name",
      cloudPlatform: "aws_lambda",
    });
  });

  test("without faas.name, a non-FaaS or missing platform is not a function", () => {
    const notFaas: Array<string> = [
      ...Array.from(MANAGED_CLOUD_PLATFORM_VALUES),
      ...Object.entries(CLOUD_PLATFORM_ALIASES)
        .filter(([, canonical]: [string, string]): boolean => {
          return !FAAS_CLOUD_PLATFORM_VALUES.has(canonical);
        })
        .map(([alias]: [string, string]): string => {
          return alias;
        }),
      "aws_ec2",
      "azure_vm",
      "gcp_compute_engine",
      "some_future_platform",
      // normalizeCloudPlatform does not fold case, and neither does ingest.
      "AZURE_FUNCTIONS",
      "Aws_Lambda",
      // Object.prototype member names are strings, not platforms.
      "constructor",
      "__proto__",
      "toString",
    ];

    for (const platform of notFaas) {
      expect({
        platform,
        identity: resolveIdentity(
          attributes({ "cloud.platform": platform, "service.name": "app" }),
        ),
      }).toEqual({ platform, identity: null });
    }

    expect(resolveIdentity(attributes({ "service.name": "app" }))).toBeNull();
  });

  test("a FaaS platform without a usable service.name is not a function", () => {
    const unusable: Array<JSONArray> = [
      attributes({ "cloud.platform": "azure_functions" }),
      attributes({ "cloud.platform": "azure_functions", "service.name": "" }),
      attributes({ "cloud.platform": "azure_functions", "service.name": "  " }),
      [
        stringAttribute("cloud.platform", "azure_functions"),
        intAttribute("service.name", 5),
      ],
      [
        stringAttribute("cloud.platform", "azure_functions"),
        { key: "service.name", value: { stringValue: null } },
      ],
      [
        stringAttribute("cloud.platform", "azure_functions"),
        { key: "service.name" },
      ],
    ];

    for (const list of unusable) {
      expect(resolveIdentity(list)).toBeNull();
    }
  });

  test("an unusable faas.name counts as missing, so the service.name fallback applies", () => {
    const unusableFaasNames: Array<JSONObject> = [
      stringAttribute("faas.name", ""),
      stringAttribute("faas.name", "   "),
      intAttribute("faas.name", 7),
      { key: "faas.name", value: { boolValue: true } },
      { key: "faas.name", value: { stringValue: null } },
      { key: "faas.name", value: null },
      { key: "faas.name" },
      /*
       * getStringAttribute reads camelCase only (the decoders produce it),
       * so a snake_case value is not an identity — and the stamp replaces
       * it, which is what keeps the stored value equal to the identity.
       */
      { key: "faas.name", value: { string_value: "snake" } },
    ];

    for (const faasName of unusableFaasNames) {
      expect(
        resolveIdentity([
          faasName,
          stringAttribute("cloud.platform", "gcp_cloud_functions"),
          stringAttribute("service.name", "fallback"),
        ]),
      ).toEqual({
        functionIdentifier: "fallback",
        source: "service.name",
        cloudPlatform: "gcp_cloud_functions",
      });
    }
  });

  test("the first usable entry wins, as getStringAttribute reads it", () => {
    expect(
      resolveIdentity([
        stringAttribute("faas.name", " "),
        stringAttribute("faas.name", "first"),
        stringAttribute("faas.name", "second"),
      ])?.functionIdentifier,
    ).toBe("first");

    expect(
      resolveIdentity([
        stringAttribute("cloud.platform", "aws_lambda"),
        stringAttribute("service.name", ""),
        stringAttribute("service.name", "svc-first"),
        stringAttribute("service.name", "svc-second"),
      ])?.functionIdentifier,
    ).toBe("svc-first");
  });

  test("is null-safe: a null list, a non-array and malformed entries never throw", () => {
    for (const list of [null, undefined, {}, "faas.name", 42]) {
      expect(() => {
        return resolveIdentity(list);
      }).not.toThrow();
      expect(resolveIdentity(list)).toBeNull();
    }

    const malformed: JSONArray = [
      null as unknown as JSONObject,
      undefined as unknown as JSONObject,
      7 as unknown as JSONObject,
      "service.name" as unknown as JSONObject,
      { key: "faas.name", value: "not-an-object" },
      { key: "cloud.platform", value: 3 },
      stringAttribute("cloud.platform", "azure_functions"),
      stringAttribute("service.name", "survivor"),
    ];

    expect(resolveIdentity(malformed)).toEqual({
      functionIdentifier: "survivor",
      source: "service.name",
      cloudPlatform: "azure_functions",
    });
  });

  test("the header is not an attribute: a header-only service name is no identity", () => {
    /*
     * x-oneuptime-service-name names a Service in resolveTelemetryResource;
     * the identity reads attributes only, so a batch that carries its name
     * only in the header is not a function (and gets no stamp).
     */
    expect(
      resolveIdentity(attributes({ "cloud.platform": "azure_functions" })),
    ).toBeNull();
  });
});

describe("stampServerlessFunctionNameAttribute", () => {
  test.each(AZURE_RESOURCE_CASES)(
    "stamps the Function App's name as faas.name on %s's resource",
    (_name: string, build: ResourceBuilder) => {
      const list: JSONArray = build();
      normalize(list);
      const before: JSONArray = clone(list);

      stamp(list);

      // Appended once, at the end, in the wire shape the decoders produce.
      expect(list.length).toBe(before.length + 1);
      expect(list[list.length - 1]).toEqual({
        key: "faas.name",
        value: { stringValue: AZURE_APP },
      });
      // Nothing else moved or changed.
      expect(list.slice(0, before.length)).toEqual(before);
      expect(storedResource(list)["resource.faas.name"]).toBe(AZURE_APP);
    },
  );

  test("stamps the trimmed identity, not the raw service.name", () => {
    const list: JSONArray = attributes({
      "cloud.platform": "aws_lambda",
      "service.name": "  padded-fn \t",
    });
    stamp(list);
    expect(entriesFor(list, "faas.name")).toEqual([
      { key: "faas.name", value: { stringValue: "padded-fn" } },
    ]);
    // service.name itself is left exactly as sent.
    expect(entriesFor(list, "service.name")).toEqual([
      stringAttribute("service.name", "  padded-fn \t"),
    ]);
  });

  test("rewrites an unusable faas.name entry in place instead of adding a second one", () => {
    const unusableValues: Array<JSONObject | null | undefined> = [
      { stringValue: "" },
      { stringValue: "   " },
      { intValue: 7 },
      { boolValue: false },
      { arrayValue: { values: [{ stringValue: "a" }] } },
      { stringValue: null },
      { string_value: "snake" },
      null,
      undefined,
    ];

    for (const value of unusableValues) {
      const faasName: JSONObject =
        value === undefined
          ? { key: "faas.name" }
          : { key: "faas.name", value };
      const list: JSONArray = [
        stringAttribute("service.name", "app"),
        faasName,
        stringAttribute("cloud.platform", "azure_functions"),
      ];

      stamp(list);

      expect({ value, list }).toEqual({
        value,
        list: [
          stringAttribute("service.name", "app"),
          { key: "faas.name", value: { stringValue: "app" } },
          stringAttribute("cloud.platform", "azure_functions"),
        ],
      });
    }
  });

  test("rewrites every unusable faas.name entry, because the flatten keeps the last one", () => {
    const list: JSONArray = [
      stringAttribute("faas.name", ""),
      stringAttribute("cloud.platform", "azure_functions"),
      stringAttribute("service.name", "app"),
      intAttribute("faas.name", 1),
    ];
    // Unstamped, the flatten would store the LAST entry: 1, not "app".
    expect(storedResource(clone(list))["resource.faas.name"]).toBe(1);

    stamp(list);

    expect(entriesFor(list, "faas.name")).toEqual([
      { key: "faas.name", value: { stringValue: "app" } },
      { key: "faas.name", value: { stringValue: "app" } },
    ]);
    expect(list.length).toBe(4);
    expect(storedResource(list)["resource.faas.name"]).toBe("app");
  });

  test("replaces the value object rather than mutating it, so a shared value is untouched", () => {
    const sharedEmpty: JSONObject = { stringValue: "" };
    const list: JSONArray = [
      { key: "faas.name", value: sharedEmpty },
      { key: "custom.empty", value: sharedEmpty },
      stringAttribute("cloud.platform", "azure_functions"),
      stringAttribute("service.name", "app"),
    ];

    stamp(list);

    expect(sharedEmpty).toEqual({ stringValue: "" });
    expect(entriesFor(list, "custom.empty")[0]!["value"]).toBe(sharedEmpty);
    expect(entriesFor(list, "faas.name")[0]!["value"]).toEqual({
      stringValue: "app",
    });
  });

  test("never touches a usable faas.name, even one that differs from service.name", () => {
    const shapes: Array<JSONArray> = [
      lambdaLayerResource(),
      attributes({
        "faas.name": "checkout-handler",
        "service.name": "checkout",
        "cloud.platform": "azure_functions",
      }),
      // faas.name alone is a FaaS signal on any platform.
      attributes({ "faas.name": "cron-job", "service.name": "jobs" }),
      /*
       * Surrounding whitespace: the identity is trimmed ("padded") while the
       * rows keep the value as sent. A usable faas.name is the producer's
       * own value and is never rewritten — the stamp only ever fills in a
       * missing one.
       */
      attributes({
        "faas.name": "  padded  ",
        "cloud.platform": "azure_functions",
        "service.name": "svc",
      }),
    ];

    for (const list of shapes) {
      const before: JSONArray = clone(list);
      stamp(list);
      expect(list).toEqual(before);
    }
  });

  test("leaves a resource that is not a function exactly as it was", () => {
    const shapes: Array<JSONArray> = [
      // A plain service.
      attributes({ "service.name": "checkout", "host.name": "vm-1" }),
      // Managed, non-FaaS platforms belong to Cloud Environments.
      attributes({
        "service.name": "checkout-api",
        "cloud.platform": "azure_container_apps",
      }),
      attributes({
        "service.name": "checkout-api",
        "cloud.platform": "azure.app_service",
      }),
      attributes({ "service.name": "web", "cloud.platform": "gcp_cloud_run" }),
      // Case is not folded.
      attributes({
        "service.name": "app",
        "cloud.platform": "AZURE_FUNCTIONS",
      }),
      // A FaaS platform with no usable service.name.
      attributes({ "cloud.platform": "azure_functions" }),
      attributes({ "cloud.platform": "azure_functions", "service.name": " " }),
      [
        stringAttribute("cloud.platform", "aws_lambda"),
        intAttribute("service.name", 3),
      ],
      // Nothing at all.
      [],
    ];

    for (const list of shapes) {
      const before: JSONArray = clone(list);
      stamp(list);
      expect(list).toEqual(before);
    }
  });

  test("works on the dotted spelling too, without rewriting the platform itself", () => {
    const list: JSONArray = attributes({
      "cloud.platform": "azure.functions",
      "service.name": "app",
    });

    stamp(list);

    expect(entriesFor(list, "faas.name")).toEqual([
      { key: "faas.name", value: { stringValue: "app" } },
    ]);
    // Canonicalising cloud.platform stays normalizeCloudPlatformAttribute's job.
    expect(entriesFor(list, "cloud.platform")).toEqual([
      stringAttribute("cloud.platform", "azure.functions"),
    ]);
  });

  test("is idempotent", () => {
    const once: JSONArray = azureFunctionsHostResource();
    stamp(once);
    const twice: JSONArray = clone(once);
    stamp(twice);
    expect(twice).toEqual(once);
    expect(entriesFor(twice, "faas.name")).toHaveLength(1);
  });

  test("is null-safe and still stamps from the entries it can read", () => {
    for (const list of [null, undefined, {}, "x", 5]) {
      expect(() => {
        stamp(list);
      }).not.toThrow();
    }

    const list: JSONArray = [
      null as unknown as JSONObject,
      stringAttribute("cloud.platform", "azure_functions"),
      undefined as unknown as JSONObject,
      "stray" as unknown as JSONObject,
      stringAttribute("service.name", "app"),
    ];

    expect(() => {
      stamp(list);
    }).not.toThrow();

    // The malformed entries stay where they were; the stamp is appended.
    expect(list).toEqual([
      null,
      stringAttribute("cloud.platform", "azure_functions"),
      undefined,
      "stray",
      stringAttribute("service.name", "app"),
      { key: "faas.name", value: { stringValue: "app" } },
    ]);
  });

  test("is synchronous, and neither helper is an autoDiscover* method", () => {
    const list: JSONArray = azureFunctionsHostResource();
    expect(
      baseService["stampServerlessFunctionNameAttribute"](list),
    ).toBeUndefined();

    for (const name of [
      "stampServerlessFunctionNameAttribute",
      "resolveServerlessFunctionIdentity",
    ]) {
      expect(typeof baseService[name]).toBe("function");
      /*
       * OtelIngestMaintenanceFenceRelease and OtelIngestEntityIdL1Memo
       * enumerate every static named autoDiscover* and demand a fence and
       * memo case for it; a pure pre-pass helper must not be swept in.
       */
      expect(name.startsWith("autoDiscover")).toBe(false);
    }

    const autoDiscoverMethods: Array<string> = Object.getOwnPropertyNames(
      OtelIngestBaseService,
    ).filter((property: string): boolean => {
      return property.startsWith("autoDiscover");
    });
    expect(autoDiscoverMethods).toContain("autoDiscoverServerless");
    expect(autoDiscoverMethods).not.toContain(
      "stampServerlessFunctionNameAttribute",
    );
  });
});

describe("every signal service stamps right after canonicalising cloud.platform", () => {
  /*
   * The stamp has to run on the wire-shaped list, once, after the platform
   * is canonical and before the discovery gates and the `resource.*`
   * flatten read it. Pinned by reading the source with block comments
   * stripped and whitespace collapsed, like CloudPlatformNormalization.
   */
  function flattenedSource(file: string): string {
    return fs
      .readFileSync(path.join(SERVICES_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\s+/g, " ");
  }

  test.each(SIGNAL_SERVICE_FILES)("%s", (file: string) => {
    const source: string = flattenedSource(file);

    const extraction: number = source.indexOf(
      "const resourceAttributes_raw: JSONArray =",
    );
    const rewrite: number = source.indexOf(NORMALIZE_CALL);
    const stampCall: number = source.indexOf(STAMP_CALL);

    expect(extraction).toBeGreaterThan(-1);
    expect(rewrite).toBeGreaterThan(extraction);
    // Directly after the rewrite — nothing in between.
    expect(source).toContain(`${NORMALIZE_CALL} ${STAMP_CALL}`);
    // Exactly once per service.
    expect(source.split(STAMP_CALL).length - 1).toBe(1);

    // Nothing reads the list between the extraction and the stamp.
    const between: string = source.slice(extraction, stampCall);
    for (const reader of [
      "autoDiscover",
      "resolveTelemetryResource",
      "getStringAttribute",
      "TelemetryUtil.getAttributes(",
      "getEntityRefsFromResource",
    ]) {
      expect({ file, reader, found: between.includes(reader) }).toEqual({
        file,
        reader,
        found: false,
      });
    }

    // And it runs before discovery, routing and the resource flatten.
    for (const later of [
      "this.autoDiscoverServerless(",
      "this.resolveTelemetryResource(",
      'prefixKeysWithString: "resource"',
    ]) {
      const position: number = source.indexOf(later);
      expect({ file, later, found: position > -1 }).toEqual({
        file,
        later,
        found: true,
      });
      expect(position).toBeGreaterThan(stampCall);
    }
  });

  test("every ingest path that canonicalises cloud.platform stamps, and nothing else calls the stamp", () => {
    const listTypeScriptFiles: (dir: string) => Array<string> = (
      dir: string,
    ): Array<string> => {
      const found: Array<string> = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          found.push(...listTypeScriptFiles(full));
        } else if (entry.name.endsWith(".ts")) {
          found.push(full);
        }
      }
      return found;
    };

    const normalizing: Array<string> = [];
    const stamping: Array<string> = [];

    for (const file of listTypeScriptFiles(SERVICES_DIR)) {
      const source: string = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\s+/g, " ");
      const relative: string = path.relative(SERVICES_DIR, file);
      if (source.includes("this.normalizeCloudPlatformAttribute(")) {
        normalizing.push(relative);
        expect({ relative, stamps: source.includes(STAMP_CALL) }).toEqual({
          relative,
          stamps: true,
        });
      }
      if (source.includes("this.stampServerlessFunctionNameAttribute(")) {
        stamping.push(relative);
      }
    }

    expect(normalizing.sort()).toEqual([...SIGNAL_SERVICE_FILES].sort());
    // Not called from inside the base class (autoDiscoverServerless included).
    expect(stamping.sort()).toEqual([...SIGNAL_SERVICE_FILES].sort());
  });

  test("discovery and the stamp both take their identity from the one resolver", () => {
    const base: string = fs.readFileSync(
      path.join(SERVICES_DIR, "OtelIngestBaseService.ts"),
      "utf8",
    );

    /*
     * A class member's body: from its signature to the first closing brace
     * at member indentation (Prettier puts nested blocks deeper).
     */
    const memberBody: (signature: string) => string = (
      signature: string,
    ): string => {
      const start: number = base.indexOf(signature);
      expect({ signature, found: start > -1 }).toEqual({
        signature,
        found: true,
      });
      const end: number = base.indexOf("\n  }\n", start);
      expect(end).toBeGreaterThan(start);
      return base.slice(start, end);
    };

    const discovery: string = memberBody(
      "static async autoDiscoverServerless(",
    );
    const stampBody: string = memberBody(
      "static stampServerlessFunctionNameAttribute(",
    );
    const resolver: string = memberBody(
      "static resolveServerlessFunctionIdentity(",
    );

    expect(discovery).toContain(
      "this.resolveServerlessFunctionIdentity(data.attributes)",
    );
    expect(stampBody).toContain(
      "this.resolveServerlessFunctionIdentity(attributes)",
    );

    /*
     * Neither carries a copy of the rule. Discovery never names an identity
     * attribute; the stamp reads no attribute at all — it only writes the
     * resolver's answer (it names "service.name" solely as that answer's
     * source, and "faas.name" as the key it writes).
     */
    const copiesOfTheRule: Array<[string, string, Array<string>]> = [
      [
        "autoDiscoverServerless",
        discovery,
        [
          '"faas.name"',
          '"service.name"',
          '"cloud.platform"',
          "normalizeCloudPlatform(",
          "FAAS_CLOUD_PLATFORM_VALUES",
          "getStringAttribute(",
        ],
      ],
      [
        "stampServerlessFunctionNameAttribute",
        stampBody,
        [
          '"cloud.platform"',
          "normalizeCloudPlatform(",
          "FAAS_CLOUD_PLATFORM_VALUES",
          "getStringAttribute(",
          "readTrimmedStringAttribute(",
        ],
      ],
    ];
    for (const [member, body, forbidden] of copiesOfTheRule) {
      for (const ruleToken of forbidden) {
        expect({ member, ruleToken, found: body.includes(ruleToken) }).toEqual({
          member,
          ruleToken,
          found: false,
        });
      }
    }

    // The rule lives in the resolver.
    for (const ruleToken of [
      '"faas.name"',
      '"service.name"',
      '"cloud.platform"',
      "normalizeCloudPlatform(",
      "FAAS_CLOUD_PLATFORM_VALUES",
    ]) {
      expect(resolver).toContain(ruleToken);
    }
  });
});

describe("discovery and the stored rows agree on the function's identity", () => {
  let cachedEntityIds: Map<string, string>;

  beforeEach(() => {
    cachedEntityIds = new Map();
    /*
     * The entity-id L1 memo is process-wide: an identity another test
     * already resolved would be served from it before find-or-create ran.
     */
    OtelIngestBaseService.clearInProcessMemos();

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(
        async (namespace: string, key: string): Promise<string | null> => {
          return cachedEntityIds.get(`${namespace}:${key}`) || null;
        },
      );
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<void> => {
          cachedEntityIds.set(`${namespace}:${key}`, value);
        },
      );
    // Every maintenance fence is granted, so the gated writes are visible.
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (): Promise<boolean> => {
        return true;
      });
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (): Promise<void> => {});

    jest
      .spyOn(ServerlessFunctionService, "findOrCreateByFunctionIdentifier")
      .mockImplementation(async (): Promise<ServerlessFunction> => {
        const row: ServerlessFunction = new ServerlessFunction();
        row._id = FUNCTION_ROW_ID;
        return row;
      });
    jest
      .spyOn(ServerlessFunctionService, "updateLastSeen")
      .mockImplementation(async (): Promise<void> => {});
    jest
      .spyOn(ServerlessFunctionService, "attachLabels")
      .mockImplementation(async (): Promise<void> => {});
    jest
      .spyOn(ServerlessFunctionInstanceService, "recordInstance")
      .mockImplementation(async (): Promise<void> => {});
    jest
      .spyOn(LabelService, "findOrCreateLabelsByNames")
      .mockImplementation(async (): Promise<Array<ObjectID>> => {
        return [];
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  });

  /*
   * What one resource block goes through in every signal service: the
   * platform rewrite, the stamp, discovery — then the flatten that stores
   * `resource.*` on every row.
   */
  async function ingestResource(list: JSONArray): Promise<{
    discoveredId: unknown;
    functionIdentifier: string | null;
    stored: Dictionary<AttributeType | Array<AttributeType>>;
  }> {
    normalize(list);
    stamp(list);
    const discoveredId: unknown = await baseService["autoDiscoverServerless"]({
      projectId: PROJECT_ID,
      attributes: list,
    });
    const calls: Array<Array<unknown>> = (
      ServerlessFunctionService.findOrCreateByFunctionIdentifier as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;
    const lastCall: Array<unknown> | undefined = calls[calls.length - 1];
    return {
      discoveredId,
      functionIdentifier: lastCall
        ? (lastCall[0] as { functionIdentifier: string }).functionIdentifier
        : null,
      stored: storedResource(list),
    };
  }

  test.each(AZURE_RESOURCE_CASES)(
    "a Function App reported by %s: resource.faas.name equals the discovered functionIdentifier",
    async (_name: string, build: ResourceBuilder) => {
      const result: Awaited<ReturnType<typeof ingestResource>> =
        await ingestResource(build());

      expect(String(result.discoveredId)).toBe(FUNCTION_ROW_ID);
      expect(
        ServerlessFunctionService.findOrCreateByFunctionIdentifier,
      ).toHaveBeenCalledTimes(1);
      expect(
        ServerlessFunctionService.findOrCreateByFunctionIdentifier,
      ).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        functionIdentifier: AZURE_APP,
      });
      // The value every Serverless page filters by is on the rows.
      expect(result.stored["resource.faas.name"]).toBe(
        result.functionIdentifier,
      );
      expect(result.stored["resource.faas.name"]).toBe(AZURE_APP);
      // The platform is stored canonical too, whatever the detector sent.
      expect(result.stored["resource.cloud.platform"]).toBe(
        FaasCloudPlatform.AzureFunctions,
      );
      // service.name still routes the batch to the app's Service, unchanged.
      expect(result.stored["resource.service.name"]).toBe(AZURE_APP);

      expect(ServerlessFunctionService.updateLastSeen).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          cloudPlatform: FaasCloudPlatform.AzureFunctions,
          cloudProvider: "azure",
          cloudRegion: "West Europe",
        }),
      );
    },
  );

  test("the Node detector's faas.instance is still recorded as the instance", async () => {
    await ingestResource(nodeAzureDetectorResource());

    expect(
      ServerlessFunctionInstanceService.recordInstance,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: AZURE_INSTANCE_ID }),
    );
  });

  test("a Lambda that names itself keeps its own faas.name on both sides", async () => {
    const result: Awaited<ReturnType<typeof ingestResource>> =
      await ingestResource(lambdaLayerResource());

    expect(result.functionIdentifier).toBe("checkout-handler");
    expect(result.stored["resource.faas.name"]).toBe("checkout-handler");
    expect(result.stored["resource.service.name"]).toBe("checkout");
  });

  test("a batch whose name is only in the header is no function and gets no faas.name", async () => {
    const result: Awaited<ReturnType<typeof ingestResource>> =
      await ingestResource(
        attributes({
          "cloud.platform": "azure_functions",
          "cloud.region": "x",
        }),
      );

    expect(result.discoveredId).toBeNull();
    expect(
      ServerlessFunctionService.findOrCreateByFunctionIdentifier,
    ).not.toHaveBeenCalled();
    expect(result.stored).not.toHaveProperty("resource.faas.name");
  });

  test("a malformed entry stops neither the stamp nor discovery half-way", async () => {
    const list: JSONArray = [
      null as unknown as JSONObject,
      ...azureFunctionsHostResource(),
    ];

    normalize(list);
    stamp(list);
    const discoveredId: unknown = await baseService["autoDiscoverServerless"]({
      projectId: PROJECT_ID,
      attributes: list,
    });

    expect(String(discoveredId)).toBe(FUNCTION_ROW_ID);
    expect(
      ServerlessFunctionService.findOrCreateByFunctionIdentifier,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      functionIdentifier: AZURE_APP,
    });
    // The heartbeat is written too, not skipped by a throw after the create.
    expect(ServerlessFunctionService.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(entriesFor(list, "faas.name")).toEqual([
      { key: "faas.name", value: { stringValue: AZURE_APP } },
    ]);
  });

  /*
   * Everything the heartbeat carries, each field from the key it has always
   * been read from. Sharing the identity rule rewrote every one of these
   * reads; a value that no other key shares catches a misspelt or swapped
   * key as well as a dropped one.
   */
  test.each([
    [
      "a Lambda named by its layer's faas.name",
      (): JSONArray => {
        return [
          ...lambdaLayerResource(),
          ...attributes({
            "oneuptime.agent.version": "7.4.1",
            "process.runtime.name": "nodejs",
            "process.runtime.version": "20.11.1",
          }),
        ];
      },
      {
        agentVersion: "7.4.1",
        cloudPlatform: FaasCloudPlatform.AwsLambda,
        cloudProvider: "aws",
        cloudRegion: "us-east-1",
        cloudAccountId: "123456789012",
        functionVersion: "$LATEST",
        runtimeName: "nodejs",
        runtimeVersion: "20.11.1",
      },
    ],
    [
      "a Function App named by its service.name",
      (): JSONArray => {
        return [
          ...azureFunctionsHostResource(),
          ...attributes({
            "oneuptime.agent.version": "7.4.2",
            "cloud.account.id": "0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0",
            "faas.version": "2026.09.30.1",
            "process.runtime.name": ".NET",
            "process.runtime.version": "8.0.10",
          }),
        ];
      },
      {
        agentVersion: "7.4.2",
        cloudPlatform: FaasCloudPlatform.AzureFunctions,
        cloudProvider: "azure",
        cloudRegion: "West Europe",
        cloudAccountId: "0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0",
        functionVersion: "2026.09.30.1",
        runtimeName: ".NET",
        runtimeVersion: "8.0.10",
      },
    ],
  ] as Array<[string, () => JSONArray, Heartbeat]>)(
    "the heartbeat of %s carries every field, each from its own key",
    async (_name: string, build: () => JSONArray, expected: Heartbeat) => {
      const list: JSONArray = build();
      await ingestResource(list);

      expect(ServerlessFunctionService.updateLastSeen).toHaveBeenCalledTimes(1);
      const call: Array<unknown> = (
        ServerlessFunctionService.updateLastSeen as unknown as jest.Mock
      ).mock.calls[0] as Array<unknown>;
      expect(String(call[0])).toBe(FUNCTION_ROW_ID);
      // Exactly these fields, every one set.
      expect(call[1]).toStrictEqual(expected);
      // What the reads before the refactor made of the same list.
      expect(call[1]).toStrictEqual(legacyHeartbeat(list));
    },
  );

  /*
   * Every value shape of every attribute discovery reads after the
   * identity: the heartbeat and the instance it records are exactly what
   * the reads before the refactor produced (legacyHeartbeat). The shapes
   * are the identity matrix's below, plus a key sent twice.
   */
  test("for every value shape of every attribute it reads, the heartbeat is what it always was", async () => {
    const readKeys: ReadonlyArray<string> = [
      "oneuptime.agent.version",
      "cloud.platform",
      "cloud.provider",
      "cloud.region",
      "cloud.account.id",
      "faas.version",
      "process.runtime.name",
      "process.runtime.version",
      "faas.instance",
    ];

    interface Shape {
      label: string;
      entries: (key: string) => Array<JSONObject>;
    }

    const shapes: Array<Shape> = [
      {
        label: "absent",
        entries: (): Array<JSONObject> => {
          return [];
        },
      },
      {
        label: "usable",
        entries: (key: string): Array<JSONObject> => {
          return [stringAttribute(key, `v-${key}`)];
        },
      },
      {
        label: "padded",
        entries: (key: string): Array<JSONObject> => {
          return [stringAttribute(key, `  v-${key} `)];
        },
      },
      {
        label: "empty",
        entries: (key: string): Array<JSONObject> => {
          return [stringAttribute(key, "")];
        },
      },
      {
        label: "blank",
        entries: (key: string): Array<JSONObject> => {
          return [stringAttribute(key, "   ")];
        },
      },
      {
        label: "int",
        entries: (key: string): Array<JSONObject> => {
          return [intAttribute(key, 3)];
        },
      },
      {
        label: "bool",
        entries: (key: string): Array<JSONObject> => {
          return [{ key: key, value: { boolValue: true } }];
        },
      },
      {
        label: "null string",
        entries: (key: string): Array<JSONObject> => {
          return [{ key: key, value: { stringValue: null } }];
        },
      },
      {
        label: "no value",
        entries: (key: string): Array<JSONObject> => {
          return [{ key: key }];
        },
      },
      {
        label: "snake_case",
        entries: (key: string): Array<JSONObject> => {
          return [{ key: key, value: { string_value: "snake" } }];
        },
      },
      {
        label: "unusable, then usable",
        entries: (key: string): Array<JSONObject> => {
          return [
            stringAttribute(key, " "),
            stringAttribute(key, `second-${key}`),
          ];
        },
      },
      {
        label: "two usable",
        entries: (key: string): Array<JSONObject> => {
          return [
            stringAttribute(key, `first-${key}`),
            stringAttribute(key, `second-${key}`),
          ];
        },
      },
    ];

    /*
     * A function named by its own faas.name, so discovery runs whatever
     * shape the attribute under test takes, with every read attribute set.
     */
    const base: JSONArray = [
      ...lambdaLayerResource(),
      ...attributes({
        "oneuptime.agent.version": "7.4.1",
        "process.runtime.name": "nodejs",
        "process.runtime.version": "20.11.1",
        "faas.instance": "2026/09/30/[$LATEST]0123456789abcdef",
      }),
    ];

    let runs: number = 0;
    for (const key of readKeys) {
      for (const shape of shapes) {
        const label: string = `${key}=${shape.label}`;
        const list: JSONArray = [
          ...(clone(withoutKey(base, key) as JSONArray) as Array<JSONObject>),
          ...shape.entries(key),
        ];

        cachedEntityIds.clear();
        OtelIngestBaseService.clearInProcessMemos();
        (
          ServerlessFunctionService.updateLastSeen as unknown as jest.Mock
        ).mockClear();
        (
          ServerlessFunctionInstanceService.recordInstance as unknown as jest.Mock
        ).mockClear();

        await ingestResource(list);
        runs++;

        const heartbeats: Array<Array<unknown>> = (
          ServerlessFunctionService.updateLastSeen as unknown as jest.Mock
        ).mock.calls as Array<Array<unknown>>;
        expect({ label, heartbeats: heartbeats.length }).toEqual({
          label,
          heartbeats: 1,
        });
        expect({ label, heartbeat: heartbeats[0]![1] }).toStrictEqual({
          label,
          heartbeat: legacyHeartbeat(list),
        });

        const instance: string | null = baseService["getStringAttribute"](
          list,
          "faas.instance",
        );
        const recorded: Array<Array<unknown>> = (
          ServerlessFunctionInstanceService.recordInstance as unknown as jest.Mock
        ).mock.calls as Array<Array<unknown>>;
        expect({
          label,
          instances: recorded.map((call: Array<unknown>): unknown => {
            return (call[0] as { instanceName: string }).instanceName;
          }),
        }).toEqual({ label, instances: instance ? [instance] : [] });
      }
    }

    expect(runs).toBe(readKeys.length * shapes.length);
  });

  /*
   * Every combination of faas.name, cloud.platform and service.name shapes:
   * the shared rule equals the rule discovery used before it was shared,
   * the stamp touches exactly what it may, and — the invariant the pages
   * depend on — the stored `resource.faas.name` is the identifier discovery
   * keyed the function on.
   */
  test("for every attribute shape, discovery, the stamp and the stored rows agree", async () => {
    interface Variant {
      label: string;
      entry: JSONObject | null;
    }

    const faasNames: Array<Variant> = [
      { label: "absent", entry: null },
      { label: "usable", entry: stringAttribute("faas.name", "fn-explicit") },
      { label: "padded", entry: stringAttribute("faas.name", "  fn-padded ") },
      { label: "empty", entry: stringAttribute("faas.name", "") },
      { label: "blank", entry: stringAttribute("faas.name", "   ") },
      { label: "int", entry: intAttribute("faas.name", 9) },
      {
        label: "bool",
        entry: { key: "faas.name", value: { boolValue: true } },
      },
      {
        label: "null string",
        entry: { key: "faas.name", value: { stringValue: null } },
      },
      { label: "no value", entry: { key: "faas.name" } },
      {
        label: "snake_case",
        entry: { key: "faas.name", value: { string_value: "fn-snake" } },
      },
    ];

    const platforms: Array<Variant> = [
      { label: "absent", entry: null },
      ...Array.from(FAAS_CLOUD_PLATFORM_VALUES).map(
        (platform: string): Variant => {
          return {
            label: platform,
            entry: stringAttribute("cloud.platform", platform),
          };
        },
      ),
      ...[
        "azure.functions",
        "  azure_functions ",
        "AZURE_FUNCTIONS",
        "azure_container_apps",
        "azure.container_apps",
        "gcp_cloud_run",
        "aws_ecs",
        "azure_vm",
        "some_future_platform",
        "",
        "constructor",
      ].map((platform: string): Variant => {
        return {
          label: JSON.stringify(platform),
          entry: stringAttribute("cloud.platform", platform),
        };
      }),
      { label: "int", entry: intAttribute("cloud.platform", 1) },
    ];

    const serviceNames: Array<Variant> = [
      { label: "absent", entry: null },
      { label: "usable", entry: stringAttribute("service.name", "svc") },
      { label: "padded", entry: stringAttribute("service.name", " svc-pad  ") },
      { label: "empty", entry: stringAttribute("service.name", "") },
      { label: "blank", entry: stringAttribute("service.name", "  ") },
      { label: "int", entry: intAttribute("service.name", 4) },
    ];

    let combinations: number = 0;
    let stamped: number = 0;

    for (const faasName of faasNames) {
      for (const platform of platforms) {
        for (const serviceName of serviceNames) {
          const list: JSONArray = [
            stringAttribute("telemetry.sdk.language", "nodejs"),
            ...[faasName.entry, platform.entry, serviceName.entry]
              .filter((entry: JSONObject | null): boolean => {
                return entry !== null;
              })
              .map((entry: JSONObject | null): JSONObject => {
                return clone([entry as JSONObject])[0] as JSONObject;
              }),
          ];
          const label: string = `faas.name=${faasName.label} cloud.platform=${platform.label} service.name=${serviceName.label}`;
          combinations++;

          normalize(list);
          const normalized: JSONArray = clone(list);

          // 1. The shared rule is the rule discovery always applied.
          const identity: ServerlessFunctionIdentity | null =
            resolveIdentity(list);
          expect({
            label,
            identifier: identity ? identity.functionIdentifier : null,
          }).toEqual({ label, identifier: legacyFunctionIdentifier(list) });
          if (identity) {
            expect({ label, cloudPlatform: identity.cloudPlatform }).toEqual({
              label,
              cloudPlatform: normalizeCloudPlatform(
                baseService["getStringAttribute"](list, "cloud.platform"),
              ),
            });
          }

          // 2. The stamp touches exactly what it may.
          stamp(list);
          if (!identity || identity.source === "faas.name") {
            expect({ label, list }).toEqual({ label, list: normalized });
          } else {
            stamped++;
            const faasEntries: Array<JSONObject> = entriesFor(
              list,
              "faas.name",
            );
            expect({ label, faasEntries }).toEqual({
              label,
              faasEntries: [
                {
                  key: "faas.name",
                  value: { stringValue: identity.functionIdentifier },
                },
              ],
            });
            expect({ label, rest: withoutKey(list, "faas.name") }).toEqual({
              label,
              rest: withoutKey(normalized, "faas.name"),
            });
          }

          // 3. After the stamp, discovery keys on the value the rows store.
          cachedEntityIds.clear();
          OtelIngestBaseService.clearInProcessMemos();
          (
            ServerlessFunctionService.findOrCreateByFunctionIdentifier as unknown as jest.Mock
          ).mockClear();

          const discoveredId: unknown = await baseService[
            "autoDiscoverServerless"
          ]({ projectId: PROJECT_ID, attributes: list });
          const calls: Array<Array<unknown>> = (
            ServerlessFunctionService.findOrCreateByFunctionIdentifier as unknown as jest.Mock
          ).mock.calls as Array<Array<unknown>>;
          const stored: Dictionary<AttributeType | Array<AttributeType>> =
            storedResource(list);

          if (!identity) {
            expect({ label, discoveredId, calls: calls.length }).toEqual({
              label,
              discoveredId: null,
              calls: 0,
            });
            // Nothing was added for the rows either.
            expect({ label, list }).toEqual({ label, list: normalized });
            continue;
          }

          expect({ label, calls: calls.length }).toEqual({ label, calls: 1 });
          const functionIdentifier: string = (
            calls[0]![0] as { functionIdentifier: string }
          ).functionIdentifier;
          expect({ label, functionIdentifier }).toEqual({
            label,
            functionIdentifier: identity.functionIdentifier,
          });

          /*
           * The pages filter `resource.faas.name` = functionIdentifier. The
           * one input where they differ is a producer's own faas.name with
           * surrounding whitespace: the identifier is trimmed, the stored
           * value is the producer's, which the stamp never rewrites.
           */
          const expectedStored: unknown =
            faasName.label === "padded"
              ? "  fn-padded "
              : identity.functionIdentifier;
          expect({ label, stored: stored["resource.faas.name"] }).toEqual({
            label,
            stored: expectedStored,
          });
        }
      }
    }

    // The matrix really exercised both branches.
    expect(combinations).toBe(
      faasNames.length * platforms.length * serviceNames.length,
    );
    expect(stamped).toBeGreaterThan(50);
  });
});

describe("the stamp changes neither routing nor entity membership", () => {
  /*
   * The stamp only ever fills in faas.name next to a service.name, so the
   * batch still routes to the Function App's OpenTelemetry Service (the
   * service.name branch of selectPrimaryEntity comes first), and no entity
   * resolver reads faas.* — the rows' entityKeys are what they were.
   */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function metadataFor(
    serviceName: string,
    primaryEntityType: ServiceType,
  ): TelemetryServiceMetadata {
    return {
      serviceName: serviceName,
      primaryEntityId: ObjectID.generate(),
      primaryEntityType: primaryEntityType,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  }

  function selectPrimaryEntity(
    list: JSONArray,
  ): Promise<TelemetryServiceMetadata> {
    return baseService["selectPrimaryEntity"]({
      req: { headers: {} } as unknown as ExpressRequest,
      attributes: list,
      projectId: PROJECT_ID,
      serverlessFunctionId: new ObjectID(FUNCTION_ROW_ID),
    });
  }

  test.each(AZURE_RESOURCE_CASES)(
    "%s: a stamped Function App still routes to its Service by service.name",
    async (_name: string, build: ResourceBuilder) => {
      const list: JSONArray = build();
      normalize(list);
      stamp(list);

      const fromName: jest.SpyInstance = jest
        .spyOn(OTelIngestService, "telemetryServiceFromName")
        .mockImplementation(
          async (data: {
            serviceName: string;
          }): Promise<TelemetryServiceMetadata> => {
            return metadataFor(data.serviceName, ServiceType.OpenTelemetry);
          },
        );
      const nonService: jest.SpyInstance = jest
        .spyOn(OTelIngestService, "buildResourceMetadataForNonService")
        .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
          throw new Error("a Function App with a service.name is a Service");
        });

      const routed: TelemetryServiceMetadata = await selectPrimaryEntity(list);

      expect(routed.primaryEntityType).toBe(ServiceType.OpenTelemetry);
      expect(fromName).toHaveBeenCalledTimes(1);
      expect(fromName).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: AZURE_APP,
          projectId: PROJECT_ID,
        }),
      );
      expect(nonService).not.toHaveBeenCalled();
    },
  );

  test("only a batch with no service.name is primary-keyed on the function, and the stamp never makes one", async () => {
    const fromName: jest.SpyInstance = jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
        throw new Error("no service.name, no Service");
      });
    const nonService: jest.SpyInstance = jest
      .spyOn(OTelIngestService, "buildResourceMetadataForNonService")
      .mockImplementation(
        async (data: {
          serviceName: string;
          primaryEntityType: ServiceType;
        }): Promise<TelemetryServiceMetadata> => {
          return metadataFor(data.serviceName, data.primaryEntityType);
        },
      );

    // A function that names itself only by faas.name (unchanged behavior).
    const list: JSONArray = attributes({
      "faas.name": "nightly-report",
      "cloud.platform": "aws_lambda",
    });
    const before: JSONArray = clone(list);
    stamp(list);
    expect(list).toEqual(before);

    const routed: TelemetryServiceMetadata = await selectPrimaryEntity(list);

    expect(routed.primaryEntityType).toBe(ServiceType.ServerlessFunction);
    expect(nonService).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: "serverless/nightly-report",
        primaryEntityType: ServiceType.ServerlessFunction,
      }),
    );
    expect(fromName).not.toHaveBeenCalled();
  });

  test.each(AZURE_RESOURCE_CASES)(
    "%s: the stamp adds no entity and changes no entity key",
    (_name: string, build: ResourceBuilder) => {
      const unstamped: JSONArray = build();
      normalize(unstamped);
      const stamped: JSONArray = clone(unstamped);
      stamp(stamped);
      expect(entriesFor(stamped, "faas.name")).toHaveLength(1);

      const extract: (list: JSONArray) => EntityExtractionResult = (
        list: JSONArray,
      ): EntityExtractionResult => {
        // The flatten ingest hands the extractor: semconv-native keys.
        return InventoryItem.extractEntitiesWithRetirements({
          projectId: PROJECT_ID.toString(),
          attributes: TelemetryUtil.getAttributes({
            items: list,
            prefixKeysWithString: "",
          }),
        });
      };

      const before: EntityExtractionResult = extract(unstamped);
      expect(before.entities.length).toBeGreaterThan(0);
      expect(extract(stamped)).toEqual(before);
    },
  );
});

describe("every ingest path stores resource.faas.name on the rows it writes", () => {
  /*
   * The real signal walks and row builders, with the persistence edges
   * replaced: discovery (autoDiscoverServerless included — the stamp does
   * not depend on it, which is the point of keeping it in the pre-pass),
   * service resolution, pipeline rule loads and the fan-in writer, which
   * captures the rows instead of inserting them.
   */
  const SERVICE_ID: ObjectID = ObjectID.generate();
  let rowsByTarget: Map<FanInInsertTarget, Array<JSONObject>>;

  function nowNano(): string {
    return `${Date.now()}000000`;
  }

  function serviceMetadata(): TelemetryServiceMetadata {
    return {
      serviceName: AZURE_APP,
      primaryEntityId: new ObjectID(SERVICE_ID.toString()),
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  }

  function telemetryRequest(body: JSONObject): TelemetryRequest {
    return {
      projectId: PROJECT_ID,
      body: body,
      headers: {},
    } as unknown as TelemetryRequest;
  }

  function rowsFor(target: FanInInsertTarget): Array<JSONObject> {
    return rowsByTarget.get(target) || [];
  }

  function rowAttributes(row: JSONObject): JSONObject {
    return row["attributes"] as JSONObject;
  }

  beforeEach(() => {
    rowsByTarget = new Map();

    const discoveryMethods: Array<string> = Object.getOwnPropertyNames(
      OtelIngestBaseService,
    ).filter((property: string): boolean => {
      return (
        property.startsWith("autoDiscover") &&
        typeof baseService[property] === "function"
      );
    });

    for (const ingestService of [
      OtelTracesIngestService,
      OtelLogsIngestService,
      OtelMetricsIngestService,
      OtelProfilesIngestService,
    ]) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const service: Record<string, any> = ingestService as unknown as Record<
        string,
        any
      >;
      /* eslint-enable @typescript-eslint/no-explicit-any */
      for (const method of discoveryMethods) {
        jest.spyOn(service, method).mockResolvedValue(null);
      }
      jest
        .spyOn(service, "resolveTelemetryResource")
        .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
          return serviceMetadata();
        });
      if (ingestService === OtelMetricsIngestService) {
        // The batch-level host pass reads Postgres; nothing here is a host.
        jest
          .spyOn(service, "runBatchHostEnrichment")
          .mockResolvedValue(undefined);
      }
    }

    jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest.spyOn(TraceScrubRuleService, "loadScrubRules").mockResolvedValue([]);
    jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
    jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
    jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
    jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue([]);
    jest
      .spyOn(MetricPipelineRuleService, "loadRules")
      .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
      .mockResolvedValue(undefined);
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockImplementation(
        async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
          rowsByTarget.set(target, [...rowsFor(target), ...batch]);
          return { flushed: Promise.resolve() };
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function tracesBody(resource: JSONArray): JSONObject {
    return {
      resourceSpans: [
        {
          resource: { attributes: resource },
          scopeSpans: [
            {
              scope: { name: "Microsoft.Azure.WebJobs" },
              spans: [
                {
                  traceId: "5b8efff798038103d269b633813fc60c",
                  spanId: "eee19b7ec3c1b174",
                  parentSpanId: "",
                  name: "HttpTrigger1",
                  kind: 2,
                  startTimeUnixNano: nowNano(),
                  endTimeUnixNano: nowNano(),
                  status: { code: 1 },
                  attributes: [stringAttribute("faas.trigger", "http")],
                  events: [],
                  links: [],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  function logsBody(resource: JSONArray): JSONObject {
    return {
      resourceLogs: [
        {
          resource: { attributes: resource },
          scopeLogs: [
            {
              scope: {},
              logRecords: [
                {
                  timeUnixNano: nowNano(),
                  severityNumber: 9,
                  body: {
                    stringValue:
                      "Executed 'Functions.HttpTrigger1' (Succeeded, Duration=112ms)",
                  },
                  attributes: [],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  /*
   * The host's faas.invoke_duration: a histogram in seconds whose data
   * points name the function in their own faas.name attribute.
   */
  function metricsBody(resource: JSONArray): JSONObject {
    return {
      resourceMetrics: [
        {
          resource: { attributes: resource },
          scopeMetrics: [
            {
              scope: { name: "Microsoft.Azure.Functions.Host" },
              metrics: [
                {
                  name: "faas.invoke_duration",
                  unit: "s",
                  description:
                    "Measures the duration of the function's logic execution.",
                  histogram: {
                    aggregationTemporality: 2,
                    dataPoints: [
                      {
                        attributes: [
                          stringAttribute("faas.name", "HttpTrigger1"),
                        ],
                        startTimeUnixNano: nowNano(),
                        timeUnixNano: nowNano(),
                        count: "3",
                        sum: 0.42,
                        bucketCounts: ["0", "1", "2", "0"],
                        explicitBounds: [0.05, 0.1, 0.25],
                        min: 0.08,
                        max: 0.2,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
  }

  function profilesBody(resource: JSONArray): JSONObject {
    return {
      resourceProfiles: [
        {
          resource: { attributes: resource },
          scopeProfiles: [
            {
              scope: {},
              profiles: [
                {
                  timeUnixNano: nowNano(),
                  durationNano: "1000000000",
                  samples: [],
                },
              ],
            },
          ],
        },
      ],
      dictionary: { stringTable: [""] },
    };
  }

  interface SignalCase {
    signal: string;
    target: FanInInsertTarget;
    run: (resource: JSONArray) => Promise<void>;
  }

  const SIGNALS: ReadonlyArray<SignalCase> = [
    {
      signal: "traces",
      target: SpanService,
      run: async (resource: JSONArray): Promise<void> => {
        await OtelTracesIngestService.processTracesFromQueue(
          telemetryRequest(tracesBody(resource)),
        );
      },
    },
    {
      signal: "logs",
      target: LogService,
      run: async (resource: JSONArray): Promise<void> => {
        await OtelLogsIngestService.processLogsFromQueue(
          telemetryRequest(logsBody(resource)),
        );
      },
    },
    {
      signal: "metrics",
      target: MetricService,
      run: async (resource: JSONArray): Promise<void> => {
        await OtelMetricsIngestService.processMetricsFromQueue(
          telemetryRequest(metricsBody(resource)),
        );
      },
    },
    {
      signal: "profiles",
      target: ProfileService,
      run: async (resource: JSONArray): Promise<void> => {
        await OtelProfilesIngestService.processProfilesFromQueue(
          telemetryRequest(profilesBody(resource)),
        );
      },
    },
  ];

  const MATRIX: Array<[string, SignalCase, NamedResource]> = [];
  for (const signalCase of SIGNALS) {
    for (const resource of AZURE_RESOURCES) {
      MATRIX.push([
        `${signalCase.signal} from ${resource.name}`,
        signalCase,
        resource,
      ]);
    }
  }

  test.each(MATRIX)(
    "%s land with resource.faas.name = the Function App",
    async (_label: string, signalCase: SignalCase, resource: NamedResource) => {
      await signalCase.run(resource.build());

      const rows: Array<JSONObject> = rowsFor(signalCase.target);
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const stored: JSONObject = rowAttributes(row);
        expect(stored["resource.faas.name"]).toBe(AZURE_APP);
        expect(stored["resource.service.name"]).toBe(AZURE_APP);
        expect(stored["resource.cloud.platform"]).toBe(
          FaasCloudPlatform.AzureFunctions,
        );
        expect(row["attributeKeys"] as Array<string>).toContain(
          "resource.faas.name",
        );
      }
    },
  );

  test("the host's per-function duration keeps its own faas.name next to the resource's", async () => {
    await SIGNALS[2]!.run(azureFunctionsHostResource());

    const rows: Array<JSONObject> = rowsFor(MetricService);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row["name"]).toBe("faas.invoke_duration");
      const stored: JSONObject = rowAttributes(row);
      // The Function App — what the Serverless pages scope by…
      expect(stored["resource.faas.name"]).toBe(AZURE_APP);
      // …and the function inside it, to group per-function latency by.
      expect(stored["faas.name"]).toBe("HttpTrigger1");
    }
  });

  test.each(
    SIGNALS.map((signalCase: SignalCase): [string, SignalCase] => {
      return [signalCase.signal, signalCase];
    }),
  )(
    "%s: a Lambda's own faas.name is kept, and a plain service gets none",
    async (_signal: string, signalCase: SignalCase) => {
      await signalCase.run(lambdaLayerResource());
      const lambdaRows: Array<JSONObject> = rowsFor(signalCase.target);
      expect(lambdaRows.length).toBeGreaterThan(0);
      for (const row of lambdaRows) {
        expect(rowAttributes(row)["resource.faas.name"]).toBe(
          "checkout-handler",
        );
      }

      rowsByTarget.clear();

      await signalCase.run(
        attributes({ "service.name": "checkout-api", "host.name": "vm-1" }),
      );
      const serviceRows: Array<JSONObject> = rowsFor(signalCase.target);
      expect(serviceRows.length).toBeGreaterThan(0);
      for (const row of serviceRows) {
        expect(rowAttributes(row)).not.toHaveProperty("resource.faas.name");
      }
    },
  );
});
