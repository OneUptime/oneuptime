import {
  ALERTING_PAGES,
  ALERTMANAGER,
  DATADOG,
  GRAFANA,
  GROUPING_VARIABLES,
} from "./IntegrationsDocsPages";
import { scanMarkdown } from "./DocsContentSupport";
import {
  bold,
  codeIn,
  englishPage,
  englishSection,
  lineStartingWith,
  readRepoFile,
  rowStartingWith,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import IncomingRequestCriteria from "Common/Server/Utils/Monitor/Criteria/IncomingRequestCriteria";
import DataToProcess from "Common/Server/Utils/Monitor/DataToProcess";
import IncomingRequestIncidentGrouping, {
  IncomingRequestGroupingItem,
} from "Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import MonitorTemplateUtil from "Common/Server/Utils/Monitor/MonitorTemplateUtil";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * Docs overhaul task 28b: what the Prometheus Alertmanager, Grafana and
 * Datadog pages say, held to the code that makes it true. Each page sets up
 * an Incoming Request monitor that opens one incident per alert and
 * resolves it on recovery, so this suite takes what the page writes - its
 * filters, its grouping settings, its incident title and the payload it
 * tests with - and runs them through the monitor's own criteria, incident
 * grouping and templates. The workflow each page builds is read the same
 * way: its references are resolved against what a Webhook trigger returns.
 *
 * IntegrationsDocsFacts holds what every integration page shares (the
 * workflow steps' names, the references a page may write, the blocks'
 * identifiers), and IntegrationsDocsTranslations holds the 16 translations
 * to these English pages, line for line.
 */

const MONITOR_SECTION: string = "## Receive alerts with a monitor";
const WORKFLOW_SECTION: string = "## Receive alerts with a workflow";
const TEST_SECTION: string = "## Test it";

// "Set its filter to **Request Body**, **Contains**, `"status":"firing"`."
const FILTER_SENTENCE: RegExp =
  /[Ss]et its filter to \*\*Request Body\*\*, \*\*Contains\*\*, `([^`]+)`\./g;
// The JSON a curl command posts: -d '{...}'.
const CURL_BODY: RegExp = /-d '(\{[\s\S]*\})'/;
// A Datadog template variable: $ALERT_ID.
const DATADOG_VARIABLE: RegExp = /\$[A-Z_]+/g;
// A {{...}} reference.
const REFERENCE: RegExp = /\{\{([^{}]+?)\}\}/g;
// Whether a text still holds a {{...}} reference.
const HOLDS_REFERENCE: RegExp = /\{\{[^{}]+?\}\}/;

/*
 * js-yaml from Common/node_modules, as StorageArrayDocs and
 * OpenTelemetryCollectorExampleDocs load it: Common declares js-yaml 4, App
 * declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(__dirname, "../../../../Common/node_modules/js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

interface Grouping {
  groupByJSONPath: string;
  resolvedWhenJSONPath: string;
  resolvedWhenValue: string;
  maxKeysPerPayload?: number | undefined;
}

// The fences of a section, by language, in order.
function fencesIn(
  section: string,
  language: string,
): Array<{ code: string; info: string }> {
  return scanMarkdown(section).fences.filter(
    (fence: { lang: string }): boolean => {
      return fence.lang === language;
    },
  );
}

// The only fence of a language in a section.
function fenceIn(section: string, language: string): string {
  const fences: Array<{ code: string }> = fencesIn(section, language);

  if (fences.length !== 1) {
    throw new Error(
      `Expected one ${language} block in the section, found ${fences.length}`,
    );
  }

  return (fences[0] as { code: string }).code;
}

// The grouping settings the page's table gives the criteria.
function groupingOf(page: string): Grouping {
  const rows: Array<Array<string>> = tableWithHeader(
    englishSection(page, MONITOR_SECTION),
    "Field",
  );
  const value: (label: string) => string = (label: string): string => {
    const code: string | undefined = codeIn(
      rowStartingWith(rows, bold(label))[1] as string,
    )[0];

    if (code === undefined) {
      throw new Error(`The row "${label}" holds no value as code`);
    }

    return code;
  };

  return {
    groupByJSONPath: value("Open a separate incident for each…"),
    resolvedWhenJSONPath: value("Field that signals recovery"),
    resolvedWhenValue: value("Value that means recovered"),
  };
}

/*
 * The two filters the page gives the monitor's criteria, in order: the
 * first criteria's (it marks the monitor offline and declares an incident)
 * and the second's (it marks the monitor online).
 */
function filtersOf(page: string): { offline: string; online: string } {
  const values: Array<string> = Array.from(
    englishSection(page, MONITOR_SECTION).matchAll(FILTER_SENTENCE),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  if (values.length !== 2) {
    throw new Error(`Expected two criteria filters, found ${values.length}`);
  }

  return { offline: values[0] as string, online: values[1] as string };
}

// The incident title the page gives the first criteria.
function incidentTitleOf(page: string): string {
  const line: string = lineStartingWith(
    englishSection(page, MONITOR_SECTION),
    `- ${bold("Incident Title")}: `,
  );

  return codeIn(line)[0] as string;
}

// The JSON the page's test sends, as the monitor receives it.
function testPayloadOf(page: string): JSONObject {
  const body: RegExpMatchArray | null = fencesIn(
    englishSection(page, TEST_SECTION),
    "bash",
  )
    .map((fence: { code: string }): string => {
      return fence.code;
    })
    .join("\n")
    .match(CURL_BODY);

  if (!body) {
    throw new Error("The page's test posts no JSON body");
  }

  return JSON.parse(body[1] as string) as JSONObject;
}

// The payload with every value of one key replaced, at any depth.
function withEvery(value: unknown, key: string, replacement: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return withEvery(item, key, replacement);
    });
  }

  if (value && typeof value === "object") {
    const copy: JSONObject = {};

    for (const [name, inner] of Object.entries(value as JSONObject)) {
      copy[name] =
        name === key
          ? replacement
          : (withEvery(inner, key, replacement) as JSONObject);
    }

    return copy;
  }

  return value;
}

function itemsOf(
  requestBody: JSONObject,
  grouping: Grouping,
): Array<IncomingRequestGroupingItem> {
  return IncomingRequestIncidentGrouping.extractItems({
    requestBody,
    grouping,
  });
}

function request(requestBody: JSONObject): DataToProcess {
  const now: Date = OneUptimeDate.getCurrentDate();
  const incoming: IncomingMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    requestBody,
    requestHeaders: { "content-type": "application/json" },
    incomingRequestReceivedAt: now,
    checkedAt: now,
  };

  return incoming as DataToProcess;
}

// Whether a Request Body / Contains filter matches a request.
async function bodyContains(
  requestBody: JSONObject,
  value: string,
): Promise<boolean> {
  const filter: CriteriaFilter = {
    checkOn: CheckOn.RequestBody,
    filterType: FilterType.Contains,
    value,
  };

  return Boolean(
    await IncomingRequestCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: request(requestBody),
      criteriaFilter: filter,
    }),
  );
}

// An incident title, rendered as the monitor renders one for a grouped key.
function renderTitle(
  title: string,
  requestBody: JSONObject,
  item: IncomingRequestGroupingItem,
): string {
  const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.IncomingRequest,
    dataToProcess: request(requestBody),
    seriesLabels: item.labels,
  });

  return MonitorTemplateUtil.processTemplateString({
    value: title,
    storageMap: MonitorTemplateUtil.buildTitleStorageMap({
      monitorType: MonitorType.IncomingRequest,
      storageMap,
    }),
  });
}

// A workflow reference resolved against what a Webhook trigger returns.
function resolveWorkflowText(text: string, requestBody: JSONObject): string {
  return VMUtil.replaceValueInPlace(
    {
      local: {
        components: {
          "webhook-1": { returnValues: { "request-body": requestBody } },
        },
      },
    } as JSONObject,
    text,
    false,
  ) as string;
}

/*
 * A Grafana webhook notification of two firing alerts of one rule, in the
 * shape Grafana's webhook contact point documents: the Alertmanager fields,
 * plus title and message. The Grafana page sends none of its own.
 */
const GRAFANA_NOTIFICATION: JSONObject = {
  receiver: "OneUptime",
  status: "firing",
  orgId: 1,
  alerts: [
    {
      status: "firing",
      labels: {
        alertname: "HighLatency",
        grafana_folder: "Payments",
        instance: "api-1",
      },
      annotations: { summary: "p95 latency above 1s" },
      fingerprint: "6a5d5c1f04e4b2c3",
    },
    {
      status: "firing",
      labels: {
        alertname: "HighLatency",
        grafana_folder: "Payments",
        instance: "api-2",
      },
      annotations: { summary: "p95 latency above 1s" },
      fingerprint: "6a5d5c1f04e4b2c4",
    },
  ],
  groupLabels: { alertname: "HighLatency", grafana_folder: "Payments" },
  commonLabels: { alertname: "HighLatency", grafana_folder: "Payments" },
  commonAnnotations: { summary: "p95 latency above 1s" },
  externalURL: "https://grafana.example.com/",
  version: "1",
  groupKey: '{}:{alertname="HighLatency", grafana_folder="Payments"}',
  truncatedAlerts: 0,
  title: "[FIRING:2] HighLatency Payments",
  state: "alerting",
  message: "**Firing**\n\nValue: p95=1.4s",
};

function notificationOf(page: string): JSONObject {
  return page === GRAFANA ? GRAFANA_NOTIFICATION : testPayloadOf(page);
}

describe("each alerting page's monitor", () => {
  it.each(ALERTING_PAGES)(
    "%s starts from the monitor's default criteria: the first marks it offline and declares an incident that resolves itself, the second marks it online",
    (page: string) => {
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          monitorType: MonitorType.IncomingRequest,
          monitorName: "Alerts",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
        });
      const instances: Array<{ data?: JSONObject | undefined }> = criteria.data
        ?.monitorCriteriaInstanceArray as unknown as Array<{
        data?: JSONObject | undefined;
      }>;
      const offline: JSONObject = instances[0]?.data as JSONObject;
      const online: JSONObject = instances[1]?.data as JSONObject;
      const section: string = englishSection(page, MONITOR_SECTION);

      expect(instances).toHaveLength(2);
      expect(offline["createIncidents"]).toBe(true);
      expect(
        ((offline["incidents"] as Array<JSONObject>)[0] as JSONObject)[
          "autoResolveIncident"
        ],
      ).toBe(true);
      expect(online["createIncidents"]).toBe(false);
      // Both read the request body, which is what the page changes.
      expect((offline["filters"] as Array<JSONObject>)[0]?.["checkOn"]).toBe(
        CheckOn.RequestBody,
      );
      expect((online["filters"] as Array<JSONObject>)[0]?.["checkOn"]).toBe(
        CheckOn.RequestBody,
      );

      expect(section).toContain(
        "open the first criteria, the one that marks the monitor offline",
      );
      expect(section).toContain(
        "Open the second criteria, the one that marks the monitor online",
      );
      expect(section).toContain(
        `${bold("Auto Resolve Incident")}, under ${bold("More fields")}: leave it on, as it starts.`,
      );
    },
  );

  it.each(ALERTING_PAGES)(
    "%s names the criteria's grouping settings and incident fields as the forms draw them",
    (page: string) => {
      const criteriaForm: string = readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance.tsx",
      );
      const incidentForm: string = readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx",
      );
      const text: string = englishPage(page);

      for (const label of [
        "Group incidents and alerts by a payload field",
        "Open a separate incident for each…",
        "Field that signals recovery",
        "Value that means recovered",
      ]) {
        expect(criteriaForm).toContain(label);
        expect(text).toContain(bold(label));
      }

      for (const label of [
        "Incident Title",
        "Severity",
        "On-Call Policies",
        "Auto Resolve Incident",
      ]) {
        expect(incidentForm).toContain(`title="${label}"`);
        expect(text).toContain(bold(label));
      }

      expect(incidentForm).toContain('title="On-Call"');
    },
  );

  it.each([ALERTMANAGER, GRAFANA])(
    "%s says a notification opens at most 100 incidents unless Max incidents per request says otherwise, as grouping caps them",
    (page: string) => {
      const many: JSONObject = {
        alerts: Array.from({ length: 101 }, (_value: unknown, index: number) => {
          return { status: "firing", fingerprint: `alert-${index}` };
        }),
      };
      const grouping: Grouping = groupingOf(page);

      expect(itemsOf(many, grouping)).toHaveLength(100);
      expect(
        itemsOf(many, { ...grouping, maxKeysPerPayload: 2 }),
      ).toHaveLength(2);
      expect(englishPage(page)).toContain(
        `up to ${bold("Max incidents per request")} of them (\`100\` unless you change it)`,
      );
    },
  );

  it.each(ALERTING_PAGES)(
    "%s opens one incident per alert of its notification, and resolves each on that alert's recovery",
    async (page: string) => {
      const grouping: Grouping = groupingOf(page);
      const filters: { offline: string; online: string } = filtersOf(page);
      const firing: JSONObject = notificationOf(page);
      const recovery: JSONObject =
        page === DATADOG
          ? { ...firing, transition: grouping.resolvedWhenValue }
          : (withEvery(firing, "status", grouping.resolvedWhenValue) as JSONObject);
      const opened: Array<IncomingRequestGroupingItem> = itemsOf(
        firing,
        grouping,
      );
      const resolved: Array<IncomingRequestGroupingItem> = itemsOf(
        recovery,
        grouping,
      );

      // The first criteria matches the alert, and not its recovery.
      expect(await bodyContains(firing, filters.offline)).toBe(true);
      expect(await bodyContains(recovery, filters.offline)).toBe(false);
      // The second criteria brings the monitor back online on the recovery.
      expect(await bodyContains(recovery, filters.online)).toBe(true);

      expect(opened.length).toBeGreaterThan(0);
      expect(
        opened.every((item: IncomingRequestGroupingItem): boolean => {
          return !item.isResolved;
        }),
      ).toBe(true);
      // One incident per alert: every key is its own.
      expect(
        new Set(
          opened.map((item: IncomingRequestGroupingItem): string => {
            return item.fingerprint;
          }),
        ).size,
      ).toBe(opened.length);
      // The recovery names the same keys, each resolved.
      expect(
        resolved.map((item: IncomingRequestGroupingItem): string => {
          return item.fingerprint;
        }),
      ).toEqual(
        opened.map((item: IncomingRequestGroupingItem): string => {
          return item.fingerprint;
        }),
      );
      expect(
        resolved.every((item: IncomingRequestGroupingItem): boolean => {
          return item.isResolved;
        }),
      ).toBe(true);
    },
  );

  it.each([ALERTMANAGER, GRAFANA])(
    "%s reads every grouping path from requestBody., which grouping requires",
    (page: string) => {
      const grouping: Grouping = groupingOf(page);
      const notification: JSONObject = notificationOf(page);

      expect(grouping.groupByJSONPath.startsWith("requestBody.")).toBe(true);
      expect(grouping.resolvedWhenJSONPath.startsWith("requestBody.")).toBe(
        true,
      );
      // Without the prefix, a path matches nothing, and says nothing.
      expect(
        itemsOf(notification, {
          ...grouping,
          groupByJSONPath: grouping.groupByJSONPath.slice(
            "requestBody.".length,
          ),
        }),
      ).toEqual([]);
    },
  );

  it.each([ALERTMANAGER, GRAFANA])(
    "%s names the grouping variable its path gives the incident templates",
    (page: string) => {
      const [item]: Array<IncomingRequestGroupingItem> = itemsOf(
        notificationOf(page),
        groupingOf(page),
      );

      expect(Object.keys(item?.labels || {})).toEqual(
        GROUPING_VARIABLES[page],
      );

      for (const variable of GROUPING_VARIABLES[page] || []) {
        expect(englishPage(page)).toContain(`\`{{${variable}}}\``);
      }
    },
  );

  it("Alertmanager: one resolved alert closes only its own incident while the others fire on", () => {
    const grouping: Grouping = groupingOf(ALERTMANAGER);
    const notification: JSONObject = testPayloadOf(ALERTMANAGER);
    const alerts: Array<JSONObject> = notification["alerts"] as Array<JSONObject>;
    const mixed: JSONObject = {
      ...notification,
      alerts: [
        { ...(alerts[0] as JSONObject), status: "resolved" },
        alerts[1] as JSONObject,
        { ...(alerts[1] as JSONObject), fingerprint: "a1b2c3d4e5f60003" },
      ],
    };
    const items: Array<IncomingRequestGroupingItem> = itemsOf(mixed, grouping);

    expect(
      items.map((item: IncomingRequestGroupingItem): boolean => {
        return item.isResolved;
      }),
    ).toEqual([true, false, false]);
    expect(englishPage(ALERTMANAGER)).toContain(
      "when one alert of a notification is resolved and two still fire, only the resolved alert's incident is closed",
    );
  });

  it("Alertmanager and Grafana: grouping by a label the notification's alerts share folds them into one incident, which takes the first alert's status", () => {
    for (const page of [ALERTMANAGER, GRAFANA]) {
      const notification: JSONObject = notificationOf(page);
      const alerts: Array<JSONObject> =
        notification["alerts"] as Array<JSONObject>;
      const byAlertName: Grouping = {
        ...groupingOf(page),
        groupByJSONPath: "requestBody.alerts[*].labels.alertname",
      };
      const firstResolved: JSONObject = {
        ...notification,
        alerts: [
          { ...(alerts[0] as JSONObject), status: "resolved" },
          ...alerts.slice(1),
        ],
      };
      const folded: Array<IncomingRequestGroupingItem> = itemsOf(
        firstResolved,
        byAlertName,
      );

      expect(folded).toHaveLength(1);
      expect(folded[0]?.isResolved).toBe(true);
      expect(englishPage(page)).toContain(
        "`requestBody.alerts[*].labels.alertname`",
      );
    }
  });

  it("Alertmanager and Grafana: only the first [*] of a path reads a list", () => {
    const nested: JSONObject = {
      groups: [{ alerts: [{ status: "firing", fingerprint: "a" }] }],
    };

    expect(
      itemsOf(nested, {
        groupByJSONPath: "requestBody.groups[*].alerts[*].fingerprint",
        resolvedWhenJSONPath: "requestBody.groups[*].alerts[*].status",
        resolvedWhenValue: "resolved",
      }),
    ).toEqual([]);

    for (const page of [ALERTMANAGER, GRAFANA]) {
      expect(englishPage(page)).toContain(
        "only the first `[*]` of a path reads a list",
      );
    }
  });

  it("Alertmanager: alerts past Max incidents per request are not read, so their recoveries are missed too", () => {
    const grouping: Grouping = {
      ...groupingOf(ALERTMANAGER),
      maxKeysPerPayload: 1,
    };
    const resolvedNotification: JSONObject = withEvery(
      testPayloadOf(ALERTMANAGER),
      "status",
      "resolved",
    ) as JSONObject;

    expect(itemsOf(resolvedNotification, grouping)).toHaveLength(1);
    expect(englishPage(ALERTMANAGER)).toContain(
      `The alerts of a notification past ${bold("Max incidents per request")} are not read at all, so their recoveries are missed too.`,
    );
  });
});

describe("each alerting page's incident title", () => {
  it("Alertmanager titles each incident from the labels its notification's alerts share", () => {
    const notification: JSONObject = testPayloadOf(ALERTMANAGER);
    const titles: Array<string> = itemsOf(
      notification,
      groupingOf(ALERTMANAGER),
    ).map((item: IncomingRequestGroupingItem): string => {
      return renderTitle(incidentTitleOf(ALERTMANAGER), notification, item);
    });

    expect(titles).toEqual(["DiskFull on web-1", "DiskFull on web-1"]);
    expect(englishPage(ALERTMANAGER)).toContain(
      "Two incidents open, one per `fingerprint`, each titled `DiskFull on web-1`.",
    );
  });

  it("Grafana titles an incident from the alert rule its notification is about", () => {
    const [item]: Array<IncomingRequestGroupingItem> = itemsOf(
      GRAFANA_NOTIFICATION,
      groupingOf(GRAFANA),
    );

    expect(
      renderTitle(
        incidentTitleOf(GRAFANA),
        GRAFANA_NOTIFICATION,
        item as IncomingRequestGroupingItem,
      ),
    ).toBe("HighLatency");
  });

  it("Datadog titles an incident with the event's title", () => {
    const payload: JSONObject = testPayloadOf(DATADOG);
    const [item]: Array<IncomingRequestGroupingItem> = itemsOf(
      payload,
      groupingOf(DATADOG),
    );
    const title: string = renderTitle(
      incidentTitleOf(DATADOG),
      payload,
      item as IncomingRequestGroupingItem,
    );

    expect(title).toBe(payload["title"]);
    expect(englishPage(DATADOG)).toContain(
      `An incident opens, titled \`${title}\`.`,
    );
  });

  it("Alertmanager and Grafana: a reference to a field the notification does not have is left as written", () => {
    const notification: JSONObject = testPayloadOf(ALERTMANAGER);
    const [item]: Array<IncomingRequestGroupingItem> = itemsOf(
      notification,
      groupingOf(ALERTMANAGER),
    );

    expect(
      renderTitle(
        "{{requestBody.commonLabels.nothing}}",
        notification,
        item as IncomingRequestGroupingItem,
      ),
    ).toBe("{{requestBody.commonLabels.nothing}}");

    for (const page of [ALERTMANAGER, GRAFANA]) {
      expect(englishPage(page)).toContain("is left as written, braces and all");
    }
  });
});

describe("each alerting page's workflow", () => {
  it.each(ALERTING_PAGES)(
    "%s checks the field its tool sends, and builds the incident from fields its notification has",
    (page: string) => {
      const section: string = englishSection(page, WORKFLOW_SECTION);
      const valueToCheck: string = codeIn(
        lineStartingWith(section, `Click ${bold("Add Component")}`),
      )[0] as string;
      const compareWith: string = codeIn(
        lineStartingWith(section, `Click ${bold("Add Component")}`),
      )[1] as string;
      const notification: JSONObject = notificationOf(page);
      const jsonObject: JSONObject = JSON.parse(
        fenceIn(section, "json"),
      ) as JSONObject;

      // The If / Else block's value reads what the notification says.
      expect(resolveWorkflowText(valueToCheck, notification)).toBe(compareWith);

      // Every reference of the JSON Object resolves, to text.
      for (const [field, template] of Object.entries(jsonObject)) {
        const resolved: string = resolveWorkflowText(
          template as string,
          notification,
        );

        expect({ field, unresolved: HOLDS_REFERENCE.test(resolved) }).toEqual(
          {
            field,
            unresolved: false,
          },
        );
      }
    },
  );

  it.each(ALERTING_PAGES)(
    "%s says a workflow that is off answers 400, as the webhook route does",
    (page: string) => {
      expect(
        readRepoFile("App/FeatureSet/Workflow/Services/QueueWorkflow.ts"),
      ).toContain("throw new BadDataException(WORKFLOW_TURNED_OFF_MESSAGE)");
      expect(englishSection(page, WORKFLOW_SECTION)).toContain(
        "A workflow that is off answers",
      );
      expect(englishSection(page, WORKFLOW_SECTION)).toContain("with `400`.");
    },
  );
});

describe("what the monitor answers, and when it evaluates", () => {
  it("the monitor answers 200 before it checks anything, as the alerting pages say", () => {
    const route: string = readRepoFile(
      "App/FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest.ts",
    );

    expect(route.indexOf("Response.sendEmptySuccessResponse(req, res);")).toBeLessThan(
      route.indexOf("TelemetryQueueService.addIncomingRequestIngestJob("),
    );

    for (const page of ALERTING_PAGES) {
      expect(englishPage(page)).toContain(
        "The monitor answers `200` at once, before it checks anything, even for a wrong secret key.",
      );
    }
  });

  it("Alertmanager names the switch that evaluates every request, which is on unless set to false", () => {
    const config: string = readRepoFile("App/FeatureSet/Telemetry/Config.ts");

    expect(config).toContain(
      'process.env["INCOMING_REQUEST_INGEST_COALESCE_ENABLED"] !== "false"',
    );
    expect(englishPage(ALERTMANAGER)).toContain(
      "set `INCOMING_REQUEST_INGEST_COALESCE_ENABLED=false`",
    );
  });
});

describe("Prometheus Alertmanager", () => {
  const configureSection: () => string = (): string => {
    return englishSection(ALERTMANAGER, "## Configure Alertmanager");
  };
  const watchdogSection: () => string = (): string => {
    return englishSection(ALERTMANAGER, "## Watch Alertmanager itself");
  };

  interface WebhookReceiver {
    name: string;
    webhook_configs: Array<{ url: string; send_resolved?: boolean }>;
  }

  interface AlertmanagerConfig {
    route: {
      receiver: string;
      group_by?: Array<string>;
      routes?: Array<{
        receiver: string;
        matchers: Array<string>;
        repeat_interval?: string;
      }>;
    };
    receivers: Array<WebhookReceiver>;
  }

  it("posts every alert to the monitor's URL with its recoveries, from a receiver its route uses", () => {
    const config: AlertmanagerConfig = jsYaml.load(
      fenceIn(configureSection(), "yaml"),
    ) as AlertmanagerConfig;
    const receiver: WebhookReceiver = config.receivers[0] as WebhookReceiver;

    expect(config.route.receiver).toBe(receiver.name);
    expect(config.route.group_by).toEqual(["alertname", "instance"]);
    expect(receiver.webhook_configs[0]?.url).toBe(
      "https://oneuptime.com/heartbeat/<secret key>",
    );
    expect(receiver.webhook_configs[0]?.send_resolved).toBe(true);
  });

  it("titles incidents from labels its route groups by, which commonLabels then holds", () => {
    const config: AlertmanagerConfig = jsYaml.load(
      fenceIn(configureSection(), "yaml"),
    ) as AlertmanagerConfig;
    const titleLabels: Array<string> = Array.from(
      incidentTitleOf(ALERTMANAGER).matchAll(REFERENCE),
    ).map((match: RegExpMatchArray): string => {
      return (match[1] as string).replace("requestBody.commonLabels.", "");
    });

    for (const label of titleLabels) {
      expect(config.route.group_by).toContain(label);
    }
  });

  it("routes the always-firing watchdog alert to a second monitor, every five minutes, keeping the first route", () => {
    const config: AlertmanagerConfig = jsYaml.load(
      fenceIn(watchdogSection(), "yaml"),
    ) as AlertmanagerConfig;
    const first: AlertmanagerConfig = jsYaml.load(
      fenceIn(configureSection(), "yaml"),
    ) as AlertmanagerConfig;
    const child: { receiver: string; matchers: Array<string>; repeat_interval?: string } =
      config.route.routes?.[0] as {
        receiver: string;
        matchers: Array<string>;
        repeat_interval?: string;
      };
    const watchdog: WebhookReceiver = config.receivers.find(
      (receiver: WebhookReceiver): boolean => {
        return receiver.name === child.receiver;
      },
    ) as WebhookReceiver;

    expect(config.route.receiver).toBe(first.route.receiver);
    expect(config.receivers[0]).toEqual(first.receivers[0]);
    expect(child.matchers).toEqual(['alertname = "Watchdog"']);
    expect(child.repeat_interval).toBe("5m");
    expect(watchdog.webhook_configs[0]?.url).toBe(
      "https://oneuptime.com/heartbeat/<watchdog secret key>",
    );
  });

  it("watches for the watchdog with the Incoming Request filter's own conditions, misspelling included", () => {
    const filterOptions: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter.ts",
    );
    const incomingRequestStart: number = filterOptions.indexOf(
      "if (checkOn === CheckOn.IncomingRequest) {",
    );
    // The block that narrows the conditions the Incoming Request filter offers.
    const incomingRequestOptions: string = filterOptions.slice(
      incomingRequestStart,
      filterOptions.indexOf("});", incomingRequestStart),
    );
    const section: string = watchdogSection();

    expect(FilterType.NotRecievedInMinutes).toBe("Not Recieved In Minutes");
    expect(FilterType.RecievedInMinutes).toBe("Recieved In Minutes");
    expect(CheckOn.IncomingRequest).toBe("Incoming Request");
    expect(incomingRequestStart).toBeGreaterThan(-1);
    expect(incomingRequestOptions).toContain("FilterType.NotRecievedInMinutes");
    expect(incomingRequestOptions).toContain("FilterType.RecievedInMinutes");
    expect(section).toContain(
      `${bold("Incoming Request")}, ${bold(FilterType.NotRecievedInMinutes)}, \`10\``,
    );
    expect(section).toContain(
      `${bold("Incoming Request")}, ${bold(FilterType.RecievedInMinutes)}, \`10\``,
    );
  });

  it("names the timing defaults the route keeps", () => {
    expect(englishPage(ALERTMANAGER)).toContain(
      "It waits `30s` before it sends a new group (`group_wait`), `5m` before it sends a group again with new alerts in it (`group_interval`), and `4h` before it repeats a notification that has not changed (`repeat_interval`).",
    );
  });
});

describe("Datadog", () => {
  const configureSection: () => string = (): string => {
    return englishSection(DATADOG, "## Configure Datadog");
  };

  // The webhook's payload, with each Datadog variable as Datadog fills it in.
  function filledPayload(values: Record<string, string>): JSONObject {
    const template: string = fenceIn(configureSection(), "json");

    return JSON.parse(
      template.replace(DATADOG_VARIABLE, (variable: string): string => {
        const value: string | undefined = values[variable];

        if (value === undefined) {
          throw new Error(`No sample value for ${variable}`);
        }

        return value;
      }),
    ) as JSONObject;
  }

  const SAMPLE: Record<string, string> = {
    $ALERT_ID: "1234",
    $ALERT_SCOPE: "host:web-1",
    $ALERT_TRANSITION: "Triggered",
    $EVENT_TITLE: "[Triggered] High CPU",
    $TEXT_ONLY_MSG: "CPU is above 90% on web-1.",
    $HOSTNAME: "web-1",
    $PRIORITY: "normal",
    $LINK: "https://app.datadoghq.com/event/event?id=1",
  };

  it("posts the fields the monitor reads, and the page's test sends what Datadog would", () => {
    const posted: JSONObject = filledPayload(SAMPLE);
    const tested: JSONObject = testPayloadOf(DATADOG);

    expect(Object.keys(tested).sort()).toEqual(Object.keys(posted).sort());
    expect(tested["alert_key"]).toBe(posted["alert_key"]);
    expect(tested["transition"]).toBe(posted["transition"]);
  });

  it("gives each group of a multi alert monitor its own incident, from the monitor's ID and the group's tags", () => {
    const grouping: Grouping = groupingOf(DATADOG);
    const web1: JSONObject = filledPayload(SAMPLE);
    const web2: JSONObject = filledPayload({
      ...SAMPLE,
      $ALERT_SCOPE: "host:web-2",
    });
    const web1Recovered: JSONObject = filledPayload({
      ...SAMPLE,
      $ALERT_TRANSITION: "Recovered",
    });

    const [first]: Array<IncomingRequestGroupingItem> = itemsOf(
      web1,
      grouping,
    );
    const [second]: Array<IncomingRequestGroupingItem> = itemsOf(
      web2,
      grouping,
    );
    const [recovered]: Array<IncomingRequestGroupingItem> = itemsOf(
      web1Recovered,
      grouping,
    );

    expect(first?.fingerprint).not.toBe(second?.fingerprint);
    expect(recovered?.fingerprint).toBe(first?.fingerprint);
    expect(recovered?.isResolved).toBe(true);
    expect(fenceIn(configureSection(), "json")).toContain(
      '"alert_key": "$ALERT_ID $ALERT_SCOPE"',
    );
  });

  it("opens incidents on Triggered only: a warning, a re-trigger or no data opens none with the page's filter", async () => {
    const filters: { offline: string; online: string } = filtersOf(DATADOG);

    expect(await bodyContains(filledPayload(SAMPLE), filters.offline)).toBe(
      true,
    );

    for (const transition of ["Warn", "Re-Triggered", "No Data", "Renotify"]) {
      expect({
        transition,
        opens: await bodyContains(
          filledPayload({ ...SAMPLE, $ALERT_TRANSITION: transition }),
          filters.offline,
        ),
      }).toEqual({ transition, opens: false });
    }

    // The note's warning criteria matches a warning.
    expect(
      await bodyContains(
        filledPayload({ ...SAMPLE, $ALERT_TRANSITION: "Warn" }),
        '"transition":"Warn"',
      ),
    ).toBe(true);
    expect(englishPage(DATADOG)).toContain(
      `${bold("Request Body")}, ${bold("Contains")}, \`"transition":"Warn"\``,
    );
  });

  it("explains every variable of its table, and the table names only variables the payload sends", () => {
    const payload: string = fenceIn(configureSection(), "json");
    const explained: Array<string> = tableWithHeader(
      configureSection(),
      "Variable",
    ).map((row: Array<string>): string => {
      return codeIn(row[0] as string)[0] as string;
    });

    expect(explained.length).toBeGreaterThan(0);

    for (const variable of explained) {
      expect(payload).toContain(variable);
    }
  });
});
