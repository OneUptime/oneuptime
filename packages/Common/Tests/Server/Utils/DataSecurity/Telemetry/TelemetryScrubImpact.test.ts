import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import LogRecordingRule from "../../../../../Models/DatabaseModels/LogRecordingRule";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import SecurityLogSource from "../../../../../Models/DatabaseModels/SecurityLogSource";
import Service from "../../../../../Models/DatabaseModels/Service";
import DashboardService from "../../../../../Server/Services/DashboardService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import ExceptionSavedViewService from "../../../../../Server/Services/ExceptionSavedViewService";
import LogRecordingRuleService from "../../../../../Server/Services/LogRecordingRuleService";
import LogSavedViewService from "../../../../../Server/Services/LogSavedViewService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../../Server/Services/MetricPipelineRuleService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import SecurityLogSourceService from "../../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../../Server/Services/SecurityTelemetrySourceService";
import ServiceLevelObjectiveService from "../../../../../Server/Services/ServiceLevelObjectiveService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TraceRecordingRuleService from "../../../../../Server/Services/TraceRecordingRuleService";
import TraceSavedViewService from "../../../../../Server/Services/TraceSavedViewService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import FindBy from "../../../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../../../Server/Types/Database/FindOneBy";
import { getScrubItImpact } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubImpact";
import { SCRUB_SERVICE_GONE } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityScrubImpact } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../../Types/ObjectID";
import {
  isAnyTelemetryFieldRead,
  isEveryTelemetryFieldReaderChecked,
  SecurityEventsFieldNeed,
  SecurityEventsTelemetrySource,
  TelemetryFieldPart,
  TelemetryFieldReader,
  TelemetryFieldReaderKind,
  TelemetryFieldReaders,
  TelemetryFieldUse,
} from "../../../../../Types/Telemetry/TelemetryFieldReaders";

/*
 * SCRUB IT, SAID BEFORE IT IS DONE (#10433).
 *
 * The rule Scrub It would make - its action, the parts it scrubs and the
 * service it is for - and what it would take away from what reads the
 * data: the issue's own cases, an email rule naming the log monitor that
 * filters on user.email and an IP Address rule the recording rule grouped
 * by client.address, and nothing more said when nothing reads it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000104340",
);
const USER_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-000000104341");
const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010434a";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000010434b";
const LOGS_STORE: string = "0192f1a0-0000-7000-8000-00000010434c";
const PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

type AnyFindBy = FindBy<any>;

// A table's records, every one of which the person may read.
function serve<T>(
  service: { findBy: (findBy: AnyFindBy) => Promise<Array<T>> },
  all: Array<T>,
): void {
  jest
    .spyOn(service as never, "findBy" as never)
    .mockImplementation((async (): Promise<Array<T>> => {
      return all;
    }) as never);
}

function logMonitor(
  name: string,
  logMonitorStep: Record<string, unknown>,
): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());

  monitor.name = name;
  (monitor as unknown as { monitorSteps: unknown }).monitorSteps = {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [{ data: { logMonitor: logMonitorStep } }],
    },
  };

  return monitor;
}

function logRecordingRule(
  name: string,
  groupByAttributes: Array<string>,
): LogRecordingRule {
  const rule: LogRecordingRule = new LogRecordingRule(ObjectID.generate());

  rule.name = name;
  rule.definition = {
    filter: {},
    aggregationType: AggregationType.Count,
    groupByAttributes,
  };

  return rule;
}

let monitors: Array<Monitor>;
let logRules: Array<LogRecordingRule>;
let findings: Array<DataStoreFinding>;
let securityLogSource: SecurityLogSource | null;
let scrubRules: Array<LogScrubRule>;

beforeEach(() => {
  monitors = [];
  logRules = [];
  findings = [];
  securityLogSource = null;
  scrubRules = [];

  jest.spyOn(LogScrubRuleService, "findBy").mockImplementation((async () => {
    return scrubRules;
  }) as never);
  jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MetricPipelineRuleService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ServiceService, "findOneBy")
    .mockImplementation((async (
      findOneBy: FindOneBy<Service>,
    ): Promise<Service | null> => {
      const id: string = String(
        (findOneBy.query as Record<string, unknown>)["_id"],
      ).toLowerCase();

      if (id !== CHECKOUT) {
        return null;
      }

      const service: Service = new Service(new ObjectID(id));
      service.name = "checkout";

      return service;
    }) as never);
  jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
    const store: DataStore = new DataStore(new ObjectID(LOGS_STORE));
    store.kind = DataStoreKind.TelemetryLogs;

    return [store];
  }) as never);
  jest.spyOn(DataStoreFindingService, "findBy").mockImplementation((async () => {
    return findings;
  }) as never);
  jest
    .spyOn(SecurityLogSourceService, "findOneBy")
    .mockImplementation((async () => {
      return securityLogSource;
    }) as never);
  jest
    .spyOn(SecurityTelemetrySourceService, "findOneBy")
    .mockResolvedValue(null as never);

  jest.spyOn(MonitorService, "findBy").mockImplementation((async () => {
    return monitors;
  }) as never);
  jest
    .spyOn(LogRecordingRuleService, "findBy")
    .mockImplementation((async () => {
      return logRules;
    }) as never);
  serve(DashboardService, []);
  serve(LogSavedViewService, []);
  serve(TraceSavedViewService, []);
  serve(ExceptionSavedViewService, []);
  serve(TraceRecordingRuleService, []);
  serve(ServiceLevelObjectiveService, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function impactOf(data: {
  kind?: DataStoreKind;
  dataTypeId: string;
  location: string;
  serviceId?: string | null;
}): Promise<DataSecurityScrubImpact> {
  return await getScrubItImpact({
    projectId: PROJECT_ID,
    kind: data.kind || DataStoreKind.TelemetryLogs,
    dataTypeId: data.dataTypeId,
    location: data.location,
    serviceId: data.serviceId === undefined ? CHECKOUT : data.serviceId,
    props: PROPS,
  });
}

function namesOf(
  readers: TelemetryFieldReaders | undefined,
  kind: TelemetryFieldReaderKind,
): Array<string> {
  return (readers?.kinds[kind].readers || []).map(
    (reader: TelemetryFieldReader): string => {
      return reader.name;
    },
  );
}

describe("the rule Scrub It would make", () => {
  test("its action, the parts it scrubs, its name and the service it is for", async () => {
    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(impact.isAvailable).toBe(true);
    expect(impact.rule).toEqual({
      signal: "log",
      name: "Data Security: Email address in log attributes of checkout",
      scrubAction: "redact",
      patternType: "email",
      fieldsToScrub: "attributes",
      dataTypeName: "Email address",
      serviceId: CHECKOUT,
      serviceName: "checkout",
    });
  });

  test("a card is masked, not redacted: the plan says which", async () => {
    const impact: DataSecurityScrubImpact = await impactOf({
      kind: DataStoreKind.TelemetryTraces,
      dataTypeId: "credit-card-number",
      location: "attributes.payment.card",
    });

    expect(impact.rule?.scrubAction).toBe("mask");
    expect(impact.rule?.signal).toBe("trace");
  });

  test("a RUM application's replays: a rule for every service and app", async () => {
    const impact: DataSecurityScrubImpact = await impactOf({
      kind: DataStoreKind.TelemetrySessionReplays,
      dataTypeId: "email-address",
      location: "logs.attributes.user.email",
      serviceId: null,
    });

    expect(impact.rule?.serviceId).toBeUndefined();
    expect(impact.rule?.serviceName).toBeUndefined();
    expect(impact.rule?.name).toBe(
      "Data Security: Email address in log attributes",
    );
  });

  test("a finding a rule already hides: that rule, and nothing to make", async () => {
    const existing: LogScrubRule = new LogScrubRule(
      new ObjectID("0192f1a0-0000-7000-8000-0000001043e1"),
    );
    existing.name = "Emails everywhere";
    existing.patternType = "email";
    existing.fieldsToScrub = "both";
    scrubRules = [existing];

    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(impact).toEqual({
      isAvailable: true,
      existingRule: {
        id: "0192f1a0-0000-7000-8000-0000001043e1",
        name: "Emails everywhere",
        signal: "log",
      },
    });
  });

  test("a finding no rule can hide, or of a service that is gone: why, in Scrub It's words", async () => {
    const nameOnly: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "person-name",
      location: "attributes.customer.first_name",
    });
    const gone: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "body",
      serviceId: PAYMENTS,
    });

    expect(nameOnly.isAvailable).toBe(false);
    expect(nameOnly.unavailableReason).toContain("found by field names");
    expect(gone).toEqual({
      isAvailable: false,
      unavailableReason: SCRUB_SERVICE_GONE,
    });
  });

  test("a metric's attribute: its service's metric rule, with no log or span reader to ask", async () => {
    const impact: DataSecurityScrubImpact = await impactOf({
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(impact.rule).toEqual(
      expect.objectContaining({
        signal: "metric",
        scrubAction: "redact",
        serviceId: CHECKOUT,
      }),
    );
    expect(impact.readers).toBeUndefined();
  });
});

describe("what the rule would take away", () => {
  test("the issue's case: an email rule names the log monitor that filters on user.email", async () => {
    monitors = [
      logMonitor("VIP sign-in failures", {
        attributes: { "user.email": "vip@example.com" },
      }),
      logMonitor("Checkout errors", { attributes: { "http.route": "/pay" } }),
    ];

    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(namesOf(impact.readers, TelemetryFieldReaderKind.Monitor)).toEqual([
      "VIP sign-in failures",
    ]);
    expect(
      impact.readers!.kinds[TelemetryFieldReaderKind.Monitor].readers[0]!.reads,
    ).toEqual([
      {
        part: TelemetryFieldPart.Attributes,
        key: "user.email",
        use: TelemetryFieldUse.Filter,
      },
    ]);
  });

  test("the issue's case: an IP Address rule names the recording rule grouped by client.address", async () => {
    logRules = [
      logRecordingRule("Requests per client", ["client.address"]),
      logRecordingRule("Requests per route", ["http.route"]),
    ];

    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "ip-address",
      location: "attributes.client.address",
    });

    expect(
      namesOf(impact.readers, TelemetryFieldReaderKind.RecordingRule),
    ).toEqual(["Requests per client"]);
  });

  test("the issue's case: with nothing that reads it, nothing more is said", async () => {
    monitors = [
      logMonitor("Checkout errors", { attributes: { "http.route": "/pay" } }),
    ];

    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(isAnyTelemetryFieldRead(impact.readers!)).toBe(false);
    expect(isEveryTelemetryFieldReaderChecked(impact.readers!)).toBe(true);
  });

  test("a reader of another service's logs keeps reading: the rule is the finding's service's", async () => {
    monitors = [
      logMonitor("Payments' VIPs", {
        telemetryServiceIds: [PAYMENTS],
        attributes: { "user.email": "vip@example.com" },
      }),
      logMonitor("Checkout's VIPs", {
        telemetryServiceIds: [CHECKOUT],
        attributes: { "user.email": "vip@example.com" },
      }),
    ];

    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(namesOf(impact.readers, TelemetryFieldReaderKind.Monitor)).toEqual([
      "Checkout's VIPs",
    ]);
  });

  test("where Data Security found the type, a group-by of that attribute is named", async () => {
    const found: DataStoreFinding = new DataStoreFinding(ObjectID.generate());
    found.location = "attributes.customer.contact";
    found.dataStoreId = new ObjectID(LOGS_STORE);
    findings = [found];
    monitors = [
      logMonitor("Errors per contact", {
        groupByAttributes: ["customer.contact"],
      }),
      logMonitor("Errors per tenant", { groupByAttributes: ["tenant"] }),
    ];

    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "body",
    });

    // The body rule reaches no attribute: nothing it groups by is taken.
    expect(namesOf(impact.readers, TelemetryFieldReaderKind.Monitor)).toEqual(
      [],
    );

    const attributes: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });

    expect(
      namesOf(attributes.readers, TelemetryFieldReaderKind.Monitor),
    ).toEqual(["Errors per contact"]);
  });

  test("Security Events, reading the project's logs, loses the address to block to an IP Address rule", async () => {
    securityLogSource = new SecurityLogSource(ObjectID.generate());

    const ip: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "ip-address",
      location: "attributes.client.address",
    });

    expect(ip.readers!.securityEvents).toEqual({
      isChecked: true,
      sources: [SecurityEventsTelemetrySource.Logs],
      loses: [SecurityEventsFieldNeed.ClientAddresses],
    });
    expect(isAnyTelemetryFieldRead(ip.readers!)).toBe(true);

    const card: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "credit-card-number",
      location: "attributes.payment.card",
    });

    expect(card.readers!.securityEvents.loses).toEqual([]);
  });

  test("Security Events that reads none of the project's logs loses nothing", async () => {
    const impact: DataSecurityScrubImpact = await impactOf({
      dataTypeId: "ip-address",
      location: "attributes.client.address",
    });

    expect(impact.readers!.securityEvents).toEqual({
      isChecked: true,
      sources: [],
      loses: [],
    });
  });
});
