import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import SecurityLogSource from "../../../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../../../Models/DatabaseModels/SecurityTelemetrySource";
import Service from "../../../../../Models/DatabaseModels/Service";
import TraceScrubRule from "../../../../../Models/DatabaseModels/TraceScrubRule";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../../Server/Services/MetricPipelineRuleService";
import SecurityLogSourceService from "../../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../../Server/Services/SecurityTelemetrySourceService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import CreateBy from "../../../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../../../Server/Types/Database/FindOneBy";
import {
  createScrubRuleForFinding,
  getScrubTarget,
  isAddressLostToSecurityEvents,
  planScrubItRule,
  planScrubRule,
  ScrubItRule,
  ScrubRulePlan,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { ScrubTarget } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { SecurityEventsTelemetrySource } from "../../../../../Types/Telemetry/TelemetryFieldReaders";
import TraceScrubField from "../../../../../Types/Trace/TraceScrubField";

/*
 * SCRUB IT HASHES AN IP ADDRESS WHERE SECURITY EVENTS READS IT (#10396).
 *
 * A Redact rule on IP addresses, in logs or traces Security Events reads,
 * left every attack's event without an address to block. Scrub It now
 * hashes the address exactly where a Redact rule would take it from
 * Security Events - the records one of its scans reads, in the parts it
 * reads the address from - and keeps Redact everywhere else. Other data
 * types never change. The rule's description says why it hashes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000103960",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010396a";

function targetOf(kind: DataStoreKind, location: string): ScrubTarget {
  const target: ScrubTarget | null = getScrubTarget(kind, location);

  expect(target).not.toBeNull();

  return target!;
}

function plan(data: {
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  sources?: Array<SecurityEventsTelemetrySource>;
}): ScrubRulePlan {
  return planScrubRule({
    dataTypeId: data.dataTypeId,
    location: data.location,
    target: targetOf(data.kind, data.location),
    securityEventsSources: data.sources,
    serviceId: CHECKOUT,
  });
}

describe("the rule Scrub It plans for an IP address", () => {
  test("in log attributes Security Events reads: Hash, and it says why", () => {
    expect(
      plan({
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "ip-address",
        location: "attributes.client.address",
        sources: [SecurityEventsTelemetrySource.Logs],
      }),
    ).toEqual({
      patternType: LogScrubPatternType.IPAddress,
      scrubAction: LogScrubAction.Hash,
      fieldsToScrub: LogScrubField.Attributes,
      hashesForSecurityEvents: true,
    });
  });

  test("in a log body Security Events reads: Hash too", () => {
    expect(
      plan({
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "ip-address",
        location: "body",
        sources: [SecurityEventsTelemetrySource.Logs],
      }).scrubAction,
    ).toBe(LogScrubAction.Hash);
  });

  test("in logs Security Events does not read: Redact, as nothing needs the address", () => {
    expect(
      plan({
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId: "ip-address",
        location: "attributes.client.address",
        sources: [],
      }),
    ).toEqual({
      patternType: LogScrubPatternType.IPAddress,
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Attributes,
    });

    // Left out altogether, as a caller that could not tell: Redact.
    expect(
      planScrubRule({
        dataTypeId: "ip-address",
        location: "attributes.client.address",
        target: targetOf(
          DataStoreKind.TelemetryLogs,
          "attributes.client.address",
        ),
      }).scrubAction,
    ).toBe(LogScrubAction.Redact);
  });

  test("in span attributes the Traces source reads: Hash", () => {
    expect(
      plan({
        kind: DataStoreKind.TelemetryTraces,
        dataTypeId: "ip-address",
        location: "attributes.client.address",
        sources: [SecurityEventsTelemetrySource.Traces],
      }),
    ).toEqual({
      patternType: LogScrubPatternType.IPAddress,
      scrubAction: LogScrubAction.Hash,
      fieldsToScrub: TraceScrubField.Attributes,
      hashesForSecurityEvents: true,
    });
  });

  test("in span attributes when only Your logs is on: Hash, since it follows a line into its request's span", () => {
    expect(
      plan({
        kind: DataStoreKind.TelemetryTraces,
        dataTypeId: "ip-address",
        location: "attributes.net.peer.ip",
        sources: [SecurityEventsTelemetrySource.Logs],
      }).scrubAction,
    ).toBe(LogScrubAction.Hash);
  });

  test("in a span event, which Security Events never reads: Redact", () => {
    expect(
      plan({
        kind: DataStoreKind.TelemetryTraces,
        dataTypeId: "ip-address",
        location: "events.retry.peer",
        sources: [
          SecurityEventsTelemetrySource.Logs,
          SecurityEventsTelemetrySource.Traces,
        ],
      }),
    ).toEqual({
      patternType: LogScrubPatternType.IPAddress,
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: TraceScrubField.Events,
    });
  });

  test("other data types do not change, whoever reads them", () => {
    const sources: Array<SecurityEventsTelemetrySource> = [
      SecurityEventsTelemetrySource.Logs,
      SecurityEventsTelemetrySource.Traces,
    ];

    for (const dataTypeId of [
      "email-address",
      "credit-card-number",
      "us-ssn",
      "phone-number",
    ]) {
      const read: ScrubRulePlan = plan({
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId,
        location: "attributes.user.value",
        sources,
      });
      const notRead: ScrubRulePlan = plan({
        kind: DataStoreKind.TelemetryLogs,
        dataTypeId,
        location: "attributes.user.value",
        sources: [],
      });

      expect(read).toEqual(notRead);
      expect(read.hashesForSecurityEvents).toBeUndefined();
      expect(read.scrubAction).not.toBe(LogScrubAction.Hash);
    }
  });

  test("the question is the readers lookup's own: a Redact rule there loses the client's address", () => {
    expect(
      isAddressLostToSecurityEvents({
        signal: "log",
        fieldsToScrub: LogScrubField.Body,
        sources: [SecurityEventsTelemetrySource.Logs],
      }),
    ).toBe(true);
    expect(
      isAddressLostToSecurityEvents({
        signal: "trace",
        fieldsToScrub: TraceScrubField.Name,
        sources: [SecurityEventsTelemetrySource.Traces],
      }),
    ).toBe(false);
    expect(
      isAddressLostToSecurityEvents({
        signal: "log",
        fieldsToScrub: LogScrubField.Attributes,
        sources: [],
      }),
    ).toBe(false);
  });
});

describe("Scrub It's rule for an IP address, read from the project", () => {
  let logSource: SecurityLogSource | null;
  let traceSource: SecurityTelemetrySource | null;
  let logCreate: ReturnType<typeof jest.spyOn>;
  let traceCreate: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSource = null;
    traceSource = null;

    jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(MetricPipelineRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(ServiceService, "findOneBy").mockImplementation((async (
      findOneBy: FindOneBy<Service>,
    ): Promise<Service | null> => {
      const id: string = String(
        (findOneBy.query as Record<string, unknown>)["_id"],
      );
      const service: Service = new Service(new ObjectID(id));

      service.name = "checkout";

      return service;
    }) as never);
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockImplementation((async () => {
        return logSource;
      }) as never);
    jest
      .spyOn(SecurityTelemetrySourceService, "findOneBy")
      .mockImplementation((async () => {
        return traceSource;
      }) as never);
    logCreate = jest
      .spyOn(LogScrubRuleService, "create")
      .mockImplementation((async (
        createBy: CreateBy<LogScrubRule>,
      ): Promise<LogScrubRule> => {
        createBy.data._id = "0192f1a0-0000-7000-8000-0000001039a1";
        return createBy.data;
      }) as never);
    traceCreate = jest
      .spyOn(TraceScrubRuleService, "create")
      .mockImplementation((async (
        createBy: CreateBy<TraceScrubRule>,
      ): Promise<TraceScrubRule> => {
        createBy.data._id = "0192f1a0-0000-7000-8000-0000001039a2";
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function scrubItRule(
    kind: DataStoreKind,
    location: string,
  ): Promise<ScrubItRule> {
    return await planScrubItRule({
      projectId: PROJECT_ID,
      kind,
      dataTypeId: "ip-address",
      location,
      target: targetOf(kind, location) as ScrubTarget & {
        signal: "log" | "trace";
      },
      serviceId: CHECKOUT,
    });
  }

  test("with Your logs on, Scrub It makes a Hash rule, and its description says why", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());

    const rule: ScrubItRule = await scrubItRule(
      DataStoreKind.TelemetryLogs,
      "attributes.client.address",
    );

    expect(rule.plan.scrubAction).toBe(LogScrubAction.Hash);
    expect(rule.description).toContain(
      "It hashes every ip address in log attribute values from now on, rather than redacting it",
    );
    expect(rule.description).toContain(
      "people see a token instead of the address, and Security Events, which reads these logs, still sees the address behind it, so it can say which one to block.",
    );
    expect(rule.description.length).toBeLessThanOrEqual(500);

    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "ip-address",
      location: "attributes.client.address",
      serviceId: CHECKOUT,
    });

    const saved: LogScrubRule = (
      logCreate.mock.calls[0]![0] as CreateBy<LogScrubRule>
    ).data;

    expect(saved.scrubAction).toBe(LogScrubAction.Hash);
    expect(saved.patternType).toBe(LogScrubPatternType.IPAddress);
    expect(saved.description).toContain("still sees the address behind it");
  });

  test("with the Traces source on, a span attribute's address is hashed", async () => {
    traceSource = new SecurityTelemetrySource(ObjectID.generate());
    traceSource.kind = SecurityTelemetrySourceKind.Traces;

    await createScrubRuleForFinding({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryTraces,
      dataTypeId: "ip-address",
      location: "attributes.client.address",
      serviceId: CHECKOUT,
    });

    const saved: TraceScrubRule = (
      traceCreate.mock.calls[0]![0] as CreateBy<TraceScrubRule>
    ).data;

    expect(saved.scrubAction).toBe(LogScrubAction.Hash);
    expect(saved.description).toContain("which reads these spans");
  });

  test("with no source on, the rule redacts and says nothing of Security Events", async () => {
    const rule: ScrubItRule = await scrubItRule(
      DataStoreKind.TelemetryLogs,
      "attributes.client.address",
    );

    expect(rule.plan.scrubAction).toBe(LogScrubAction.Redact);
    expect(rule.description).toContain(
      "It redacts every ip address in log attribute values from now on.",
    );
    expect(rule.description).not.toContain("Security Events");
  });

  test("sources that cannot be read leave the rule as Scrub It always made it", async () => {
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockRejectedValue(new Error("Postgres is away") as never);

    const rule: ScrubItRule = await scrubItRule(
      DataStoreKind.TelemetryLogs,
      "attributes.client.address",
    );

    expect(rule.plan.scrubAction).toBe(LogScrubAction.Redact);
  });

  test("Security Events' sources are read only for an IP address", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityLogSourceService,
      "findOneBy",
    );

    await planScrubItRule({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "email-address",
      location: "attributes.user.email",
      target: targetOf(
        DataStoreKind.TelemetryLogs,
        "attributes.user.email",
      ) as ScrubTarget & { signal: "log" | "trace" },
      serviceId: CHECKOUT,
    });

    expect(read).not.toHaveBeenCalled();
  });
});
