import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../../Models/DatabaseModels/SecurityTelemetrySource";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import DashboardService from "../../../../Server/Services/DashboardService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import ExceptionSavedViewService from "../../../../Server/Services/ExceptionSavedViewService";
import LogRecordingRuleService from "../../../../Server/Services/LogRecordingRuleService";
import LogSavedViewService from "../../../../Server/Services/LogSavedViewService";
import MonitorService from "../../../../Server/Services/MonitorService";
import SecurityLogSourceService from "../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../Server/Services/SecurityTelemetrySourceService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import TraceRecordingRuleService from "../../../../Server/Services/TraceRecordingRuleService";
import TraceSavedViewService from "../../../../Server/Services/TraceSavedViewService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import { OPENSTACK_DEFAULT_DROP_FILTERS } from "../../../../Server/Utils/OpenStack/OpenStackLogDefaults";
import {
  findDropFilterImpact,
  readDropFilterImpactRequest,
} from "../../../../Server/Utils/Telemetry/DropFilterImpact";
import * as DropFilterRecordCountModule from "../../../../Server/Utils/Telemetry/DropFilterRecordCount";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import {
  DropFilterImpact,
  DropFilterImpactAction,
  DropFilterImpactHeadline,
  DropFilterRecordCount,
  DropFilterRecordCountState,
  DropFilterImpactRequest,
  getDropFilterImpactHeadline,
  isDropFilterImpactRead,
} from "../../../../Types/Telemetry/DropFilterImpact";
import {
  SecurityEventsTelemetrySource,
  TelemetryFieldReader,
  TelemetryFieldReaderKind,
} from "../../../../Types/Telemetry/TelemetryFieldReaders";
import { SecurityTelemetrySourceKind } from "../../../../Types/SecurityEvent/SecurityTelemetrySource";

/*
 * WHAT A DROP OR SAMPLE FILTER WOULD TAKE (#10436).
 *
 * The impact a filter's form, its Enable and the API show: the readers
 * lookup asked of each query whether the filter reaches it, Security
 * Events' scans, and for a sample the rules that fire at a count. The
 * records' count is stood in for here; it runs in a real ClickHouse in
 * DropFilterCountClickhouseIntegration.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000104370",
);
const USER_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-000000104371");
const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010437a";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000010437b";
const PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

type AnyFindBy = FindBy<any>;

// The ids a person's own read asked for (QueryHelper.any's parameter).
function idsAsked(findBy: AnyFindBy): Array<string> {
  const operator: { objectLiteralParameters?: Record<string, Array<string>> } =
    (findBy.query as Record<string, unknown>)["_id"] as {
      objectLiteralParameters?: Record<string, Array<string>>;
    };

  return Object.values(operator?.objectLiteralParameters || {})
    .flat()
    .map((id: string): string => {
      return id.toString().toLowerCase();
    });
}

/*
 * A table's records as the server reads them (isRoot), and the ones the
 * person may read, as their own read answers.
 */
function serve<T extends { id?: ObjectID | null }>(
  service: unknown,
  data: { all: Array<T>; visible?: (record: T) => boolean },
): jest.SpiedFunction<never> {
  return jest
    .spyOn(service as never, "findBy" as never)
    .mockImplementation((async (findBy: AnyFindBy): Promise<Array<T>> => {
      if (findBy.props.isRoot) {
        return data.all;
      }

      const asked: Array<string> = idsAsked(findBy);

      return data.all.filter((record: T): boolean => {
        return (
          asked.includes(record.id!.toString().toLowerCase()) &&
          (data.visible ? data.visible(record) : true)
        );
      });
    }) as never);
}

function logMonitor(name: string, step: Record<string, unknown>): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());

  monitor.name = name;
  (monitor as unknown as { monitorSteps: unknown }).monitorSteps = {
    _type: "MonitorSteps",
    value: { monitorStepsInstanceArray: [{ data: { logMonitor: step } }] },
  };

  return monitor;
}

function requestSlo(name: string, service: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(
    ObjectID.generate(),
  );

  slo.name = name;
  slo.sliType = SliType.RequestSuccess;
  slo.services = [new Service(new ObjectID(service))];

  return slo;
}

function bruteForce(name: string, threshold: number): DetectionRule {
  const rule: DetectionRule = new DetectionRule(ObjectID.generate());

  rule.name = name;
  rule.matchCountThreshold = threshold;
  rule.evaluationIntervalInMinutes = 5;

  return rule;
}

function countOf(data: Partial<DropFilterRecordCount>): DropFilterRecordCount {
  return {
    state: DropFilterRecordCountState.Counted,
    lookbackInHours: 24,
    total: 1000,
    matched: 0,
    securityEventsRead: null,
    isScoped: false,
    timeLimitInSeconds: 10,
    ...data,
  };
}

function names(readers: Array<TelemetryFieldReader>): Array<string> {
  return readers.map((reader: TelemetryFieldReader): string => {
    return reader.name;
  });
}

let countSpy: jest.SpiedFunction<
  typeof DropFilterRecordCountModule.countDropFilterRecords
>;
let monitorSpy: jest.SpiedFunction<never>;
let ruleSpy: jest.SpiedFunction<never>;
let logSource: SecurityLogSource | null;
let traceSource: SecurityTelemetrySource | null;

beforeEach(() => {
  logSource = null;
  traceSource = null;
  monitorSpy = serve(MonitorService, {
    all: [
      logMonitor("Checkout errors", {
        telemetryServiceIds: [CHECKOUT],
        severityTexts: ["Error"],
      }),
      logMonitor("Payments warnings", {
        telemetryServiceIds: [PAYMENTS],
        severityTexts: ["Warning"],
      }),
    ],
  });

  for (const service of [
    DashboardService,
    LogSavedViewService,
    TraceSavedViewService,
    ExceptionSavedViewService,
    LogRecordingRuleService,
    TraceRecordingRuleService,
  ]) {
    serve(service, { all: [] });
  }

  serve(ServiceLevelObjectiveService, {
    all: [requestSlo("Checkout success", CHECKOUT)],
  });
  ruleSpy = serve(DetectionRuleService, {
    all: [
      bruteForce("Brute force from one IP address", 10),
      bruteForce("Repeated failed sign-ins for one account", 15),
    ],
  });

  jest
    .spyOn(SecurityLogSourceService, "findOneBy")
    .mockImplementation((async (): Promise<SecurityLogSource | null> => {
      return logSource;
    }) as never);
  jest
    .spyOn(SecurityTelemetrySourceService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { kind?: string };
    }): Promise<SecurityTelemetrySource | null> => {
      return findBy.query.kind === SecurityTelemetrySourceKind.Traces
        ? traceSource
        : null;
    }) as never);
  countSpy = jest
    .spyOn(DropFilterRecordCountModule, "countDropFilterRecords")
    .mockResolvedValue(countOf({ matched: 40 }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function impactOf(
  request: Partial<DropFilterImpactRequest> & { filterQuery: string },
): Promise<DropFilterImpact> {
  return await findDropFilterImpact({
    projectId: PROJECT_ID,
    request: {
      signal: "log",
      action: DropFilterImpactAction.Drop,
      ...request,
    },
    props: PROPS,
  });
}

describe("the monitors, SLOs and dashboards whose queries keep what the filter takes", () => {
  test("a filter whose query overlaps a log monitor's names the monitor", async () => {
    const impact: DropFilterImpact = await impactOf({
      filterQuery: `primaryEntityId = '${CHECKOUT}'`,
    });

    expect(
      names(impact.readers[TelemetryFieldReaderKind.Monitor].readers),
    ).toEqual(["Checkout errors"]);
    expect(isDropFilterImpactRead(impact)).toBe(true);
    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.Readers,
    );
  });

  test("a filter of Debug logs leaves monitors of errors and warnings alone: nothing reads it, and it saves without a prompt", async () => {
    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = 'Debug'",
    });

    expect(impact.readers[TelemetryFieldReaderKind.Monitor].readers).toEqual(
      [],
    );
    expect(impact.readers[TelemetryFieldReaderKind.Monitor].hiddenCount).toBe(
      0,
    );
    expect(isDropFilterImpactRead(impact)).toBe(false);
    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.Unread,
    );
  });

  test("a monitor the person may not open is counted, never named", async () => {
    monitorSpy.mockRestore();
    serve(MonitorService, {
      all: [
        logMonitor("Checkout errors", {
          telemetryServiceIds: [CHECKOUT],
          severityTexts: ["Error"],
        }),
      ],
      visible: (): boolean => {
        return false;
      },
    });

    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = 'Error'",
    });

    expect(impact.readers[TelemetryFieldReaderKind.Monitor].readers).toEqual(
      [],
    );
    expect(impact.readers[TelemetryFieldReaderKind.Monitor].hiddenCount).toBe(
      1,
    );
    // Counted, so the save still asks.
    expect(isDropFilterImpactRead(impact)).toBe(true);
  });

  test("a log filter leaves a request SLO, which reads spans, alone; a span filter of its service reaches it", async () => {
    const logFilter: DropFilterImpact = await impactOf({
      filterQuery: `primaryEntityId = '${CHECKOUT}'`,
    });

    expect(
      logFilter.readers[TelemetryFieldReaderKind.ServiceLevelObjective].readers,
    ).toEqual([]);

    const spanFilter: DropFilterImpact = await impactOf({
      signal: "trace",
      filterQuery: `primaryEntityId = '${CHECKOUT}'`,
    });

    expect(
      names(
        spanFilter.readers[TelemetryFieldReaderKind.ServiceLevelObjective]
          .readers,
      ),
    ).toEqual(["Checkout success"]);

    // A filter of child spans leaves it alone: the SLO counts entry spans only.
    const childSpans: DropFilterImpact = await impactOf({
      signal: "trace",
      filterQuery: `primaryEntityId = '${CHECKOUT}' AND isEntrySpan = 'false'`,
    });

    expect(
      childSpans.readers[TelemetryFieldReaderKind.ServiceLevelObjective]
        .readers,
    ).toEqual([]);
  });

  test("the lookup is asked with the person's own props, and every kind says it was checked", async () => {
    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = 'Debug'",
    });

    for (const kind of Object.values(TelemetryFieldReaderKind)) {
      expect(impact.readers[kind].isChecked).toBe(true);
    }

    const ownRead: AnyFindBy | undefined = (
      monitorSpy.mock.calls as unknown as Array<[AnyFindBy]>
    )
      .map((call: [AnyFindBy]): AnyFindBy => {
        return call[0];
      })
      .find((findBy: AnyFindBy): boolean => {
        return !findBy.props.isRoot;
      });

    // Nothing reads it, so the person's own read was never needed.
    expect(ownRead).toBeUndefined();
  });
});

describe("Security Events", () => {
  test("a filter of SSH lines, in a project with Your logs on, says how many of the day's matching lines Security Events read", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    countSpy.mockResolvedValue(
      countOf({ matched: 120, securityEventsRead: 45 }),
    );

    const impact: DropFilterImpact = await impactOf({
      filterQuery: "attributes.process.name = 'sshd'",
    });

    // The count was asked to count what Security Events read.
    expect(countSpy.mock.calls[0]![0].countSecurityEvents).toBe(true);
    expect(impact.securityEvents.sources).toEqual([
      SecurityEventsTelemetrySource.Logs,
    ]);
    expect(impact.count.securityEventsRead).toBe(45);
    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.SecurityEvents,
    );
    expect(isDropFilterImpactRead(impact)).toBe(true);
  });

  test("where Security Events reads no logs, it is not counted, and asks nothing", async () => {
    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = 'Debug'",
    });

    expect(countSpy.mock.calls[0]![0].countSecurityEvents).toBe(false);
    expect(impact.securityEvents.sources).toEqual([]);
    expect(impact.securityEvents.isChecked).toBe(true);
  });

  test("the trace side counts what the trace scan reads where its Traces source is on", async () => {
    traceSource = new SecurityTelemetrySource(ObjectID.generate());
    countSpy.mockResolvedValue(countOf({ matched: 30, securityEventsRead: 3 }));

    const impact: DropFilterImpact = await impactOf({
      signal: "trace",
      filterQuery: "kind = 'SPAN_KIND_SERVER'",
    });

    expect(countSpy.mock.calls[0]![0].countSecurityEvents).toBe(true);
    expect(impact.securityEvents.sources).toEqual([
      SecurityEventsTelemetrySource.Traces,
    ]);
    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.SecurityEvents,
    );
  });

  test("with only Your logs on, a span filter is not counted against the trace scan, and Your logs is named", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());

    const impact: DropFilterImpact = await impactOf({
      signal: "trace",
      filterQuery: "kind = 'SPAN_KIND_CLIENT'",
    });

    expect(countSpy.mock.calls[0]![0].countSecurityEvents).toBe(false);
    expect(impact.securityEvents.sources).toEqual([
      SecurityEventsTelemetrySource.Logs,
    ]);
  });
});

describe("a sample's effect on a rule that fires at a count", () => {
  test("keeping 10% of sign-in lines, a brute-force rule that fires at 10 needs about 100", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    countSpy.mockResolvedValue(
      countOf({ matched: 200, securityEventsRead: 150 }),
    );

    const impact: DropFilterImpact = await impactOf({
      filterQuery: "attributes.process.name = 'sshd'",
      action: DropFilterImpactAction.Sample,
      samplePercentage: 10,
    });

    expect(impact.keepPercentage).toBe(10);
    expect(impact.securityEvents.thresholdRules.isChecked).toBe(true);
    expect(
      impact.securityEvents.thresholdRules.rules.map(
        (rule: {
          name: string;
          threshold: number;
          neededWhenSampled: number;
        }) => {
          return [rule.name, rule.threshold, rule.neededWhenSampled];
        },
      ),
    ).toEqual([
      ["Brute force from one IP address", 10, 100],
      ["Repeated failed sign-ins for one account", 15, 150],
    ]);

    // Only the rules that fire at a count above one are read.
    const rootRead: AnyFindBy = (
      ruleSpy.mock.calls as unknown as Array<[AnyFindBy]>
    ).find((call: [AnyFindBy]): boolean => {
      return Boolean(call[0].props.isRoot);
    })![0];

    expect(rootRead.query["isEnabled"]).toBe(true);
    expect(rootRead.query["matchCountThreshold"]).toBeDefined();
  });

  test("a rule the person may not read is counted, never named", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    countSpy.mockResolvedValue(
      countOf({ matched: 200, securityEventsRead: 9 }),
    );
    ruleSpy.mockRestore();
    serve(DetectionRuleService, {
      all: [bruteForce("Brute force from one IP address", 10)],
      visible: (): boolean => {
        return false;
      },
    });

    const impact: DropFilterImpact = await impactOf({
      filterQuery: "attributes.process.name = 'sshd'",
      action: DropFilterImpactAction.Sample,
      samplePercentage: 25,
    });

    expect(impact.securityEvents.thresholdRules.rules).toEqual([]);
    expect(impact.securityEvents.thresholdRules.hiddenCount).toBe(1);
  });

  test("a sample of lines Security Events reads none of asks about no rule", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    countSpy.mockResolvedValue(
      countOf({ matched: 200, securityEventsRead: 0 }),
    );

    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = 'Debug'",
      action: DropFilterImpactAction.Sample,
      samplePercentage: 10,
    });

    expect(impact.securityEvents.thresholdRules.rules).toEqual([]);
    expect(ruleSpy).not.toHaveBeenCalled();
  });

  test("a drop asks about no rule: the rules get none of those events at all", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    countSpy.mockResolvedValue(
      countOf({ matched: 200, securityEventsRead: 9 }),
    );

    await impactOf({ filterQuery: "attributes.process.name = 'sshd'" });

    expect(ruleSpy).not.toHaveBeenCalled();
  });
});

describe("OneUptime's own OpenStack filters", () => {
  test("as OneUptime made one, it keeps what Security Events reads, and so takes none of it", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    countSpy.mockResolvedValue(
      countOf({ matched: 900, securityEventsRead: 7 }),
    );

    const filter: { name: string; filterQuery: string } =
      OPENSTACK_DEFAULT_DROP_FILTERS[0]!;
    const impact: DropFilterImpact = await impactOf({
      name: filter.name,
      filterQuery: filter.filterQuery,
    });

    expect(impact.securityEvents.keepsWhatSecurityEventsReads).toBe(true);
    expect(getDropFilterImpactHeadline(impact)).not.toBe(
      DropFilterImpactHeadline.SecurityEvents,
    );
  });

  test("changed by a person, it is theirs: it takes what it matches", async () => {
    logSource = new SecurityLogSource(ObjectID.generate());
    countSpy.mockResolvedValue(
      countOf({ matched: 900, securityEventsRead: 7 }),
    );

    const filter: { name: string; filterQuery: string } =
      OPENSTACK_DEFAULT_DROP_FILTERS[0]!;
    const impact: DropFilterImpact = await impactOf({
      name: filter.name,
      filterQuery: `${filter.filterQuery} OR severityText = 'Information'`,
    });

    expect(impact.securityEvents.keepsWhatSecurityEventsReads).toBe(false);
    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.SecurityEvents,
    );
  });

  test("where Security Events reads no logs, there is nothing to keep", async () => {
    const filter: { name: string; filterQuery: string } =
      OPENSTACK_DEFAULT_DROP_FILTERS[0]!;
    const impact: DropFilterImpact = await impactOf({
      name: filter.name,
      filterQuery: filter.filterQuery,
    });

    expect(impact.securityEvents.keepsWhatSecurityEventsReads).toBe(false);
  });
});

describe("a filter that takes nothing", () => {
  test("a query ingest cannot read takes nothing, and nothing is read for it", async () => {
    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = = 'Debug'",
    });

    expect(impact.isQueryReadable).toBe(false);
    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.Unreadable,
    );
    expect(isDropFilterImpactRead(impact)).toBe(false);
    expect(countSpy).not.toHaveBeenCalled();
    expect(monitorSpy).not.toHaveBeenCalled();
  });

  test("a sample with no share to keep is refused, as its save refuses it", async () => {
    await expect(
      impactOf({
        filterQuery: "severityText = 'Debug'",
        action: DropFilterImpactAction.Sample,
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("a count that could not be made", () => {
  test("a count that timed out is not known: the line says so, and nothing is said to read it", async () => {
    countSpy.mockResolvedValue(
      countOf({ state: DropFilterRecordCountState.TimedOut }),
    );

    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = 'Debug'",
    });

    expect(getDropFilterImpactHeadline(impact)).toBe(
      DropFilterImpactHeadline.Uncounted,
    );
    // Never blocks: an unknown count asks nothing.
    expect(isDropFilterImpactRead(impact)).toBe(false);
  });

  test("a reader found still asks, whatever the count", async () => {
    countSpy.mockResolvedValue(
      countOf({ state: DropFilterRecordCountState.TimedOut }),
    );

    const impact: DropFilterImpact = await impactOf({
      filterQuery: "severityText = 'Error'",
    });

    expect(isDropFilterImpactRead(impact)).toBe(true);
  });
});

describe("the request", () => {
  test("a filter as its form holds it, held to what a saved one may say", () => {
    expect(
      readDropFilterImpactRequest(
        {
          filterQuery: "severityText = 'Debug'",
          action: "sample",
          samplePercentage: 5,
          name: "Debug lines",
          extra: "ignored",
        },
        "log",
      ),
    ).toEqual({
      signal: "log",
      filterQuery: "severityText = 'Debug'",
      action: "sample",
      samplePercentage: 5,
      name: "Debug lines",
    });
    // A drop needs no percentage; one sent with it is left out.
    expect(
      readDropFilterImpactRequest(
        { filterQuery: "severityText = 'Debug'", samplePercentage: 5 },
        "trace",
      ),
    ).toEqual({
      signal: "trace",
      filterQuery: "severityText = 'Debug'",
      action: "drop",
    });
  });

  test.each([undefined, null, "drop", [], { filterQuery: 5 }])(
    "refuses %p",
    (body: unknown) => {
      expect(() => {
        return readDropFilterImpactRequest(body, "log");
      }).toThrow(BadDataException);
    },
  );
});
