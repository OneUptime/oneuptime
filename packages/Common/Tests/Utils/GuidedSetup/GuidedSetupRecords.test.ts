import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY } from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import {
  FirstOnCallPolicyCreate,
  GUIDED_SETUP_POLICY_NAME,
  WhoIsToldMode,
  buildFirstOnCallPolicy,
  getWhoIsToldMode,
} from "../../../Utils/GuidedSetup/OnCallPolicyRecords";
import {
  GUIDED_SETUP_RESOURCE_OPTIONS,
  STATUS_PAGE_NAME_MIN_LENGTH,
  buildGuidedStatusPage,
  buildGuidedStatusPageMonitor,
  buildStatusPageResource,
} from "../../../Utils/GuidedSetup/StatusPageRecords";
import {
  GUIDED_SETUP_MONITORING_INTERVAL,
  MONITOR_NAME_MAX_LENGTH,
  WEBSITE_MONITOR_SEEDS_MISSING,
  WebsiteAddress,
  WebsiteMonitorSeeds,
  buildWebsiteMonitor,
  parseWebsiteAddress,
  pickWebsiteMonitorSeeds,
} from "../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * THE GUIDED SETUPS' RECORDS, ONE COPY FOR EVERY WAY IN (issue #6829).
 *
 * The website guided setup (#6804), the status page guided setup (#6806)
 * and Ask AI's setup actions build their records here, so they cannot
 * drift: the address and the monitor's name, Create Monitor's defaults for
 * the criteria and the interval, who is told and the project's first
 * on-call policy, the status page and each monitor on it.
 */

const id: (n: number) => ObjectID = (n: number): ObjectID => {
  return new ObjectID(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
};

const SEEDS: WebsiteMonitorSeeds = {
  operationalStatusId: id(1),
  offlineStatusId: id(2),
  incidentSeverityId: id(3),
  alertSeverityId: id(4),
};

describe("the address", () => {
  test.each([
    ["example.com", "https://example.com", "example.com", "example.com"],
    [
      "https://www.example.com/",
      "https://www.example.com/",
      "www.example.com",
      "example.com",
    ],
    [
      "http://example.com:8080/health/",
      "http://example.com:8080/health/",
      "example.com",
      "example.com:8080/health",
    ],
    ["localhost:3000", "https://localhost:3000", "localhost", "localhost:3000"],
    ["10.0.0.5", "https://10.0.0.5", "10.0.0.5", "10.0.0.5"],
  ])(
    "%s is checked at %s and named after its host and path",
    (input: string, url: string, host: string, name: string) => {
      const address: WebsiteAddress | null = parseWebsiteAddress(input);

      expect(address).toEqual({ url: url, host: host, monitorName: name });
    },
  );

  test.each([
    [""],
    ["my website"],
    ["ftp://example.com"],
    ["https://user:secret@example.com"],
    ["mailto:ana@example.com"],
    ["intranet"],
  ])("%j is no address a website monitor checks", (input: string) => {
    expect(parseWebsiteAddress(input)).toBeNull();
  });

  test("a long path is cut to the longest name a monitor takes", () => {
    const address: WebsiteAddress | null = parseWebsiteAddress(
      `example.com/${"a".repeat(200)}`,
    );

    expect(address?.monitorName).toHaveLength(MONITOR_NAME_MAX_LENGTH);
  });
});

describe("the monitor's seeds", () => {
  test("are the operational and offline statuses and the most severe live severities", () => {
    expect(
      pickWebsiteMonitorSeeds({
        statuses: [
          { id: id(1), isOperationalState: true },
          { id: id(9) },
          { id: id(2), isOfflineState: true },
        ],
        incidentSeverities: [
          { id: id(8), isArchived: true },
          { id: id(3) },
          { id: id(7) },
        ],
        alertSeverities: [{ id: id(4), isArchived: false }],
      }),
    ).toEqual(SEEDS);
  });

  test("a project missing any of them gets none, and the reason is Create Monitor's way in", () => {
    expect(
      pickWebsiteMonitorSeeds({
        statuses: [{ id: id(1), isOperationalState: true }],
        incidentSeverities: [{ id: id(3) }],
        alertSeverities: [{ id: id(4) }],
      }),
    ).toBeNull();
    expect(
      pickWebsiteMonitorSeeds({
        statuses: [
          { id: id(1), isOperationalState: true },
          { id: id(2), isOfflineState: true },
        ],
        incidentSeverities: [{ id: id(3), isArchived: true }],
        alertSeverities: [{ id: id(4) }],
      }),
    ).toBeNull();
    expect(WEBSITE_MONITOR_SEEDS_MISSING).toContain("Create Monitor");
  });
});

describe("the monitor", () => {
  test("is a Website monitor with Create Monitor's criteria, checked at the address, every five minutes by default", () => {
    const monitor: Monitor = buildWebsiteMonitor({
      address: parseWebsiteAddress("example.com")!,
      isApi: false,
      seeds: SEEDS,
      monitoringInterval: GUIDED_SETUP_MONITORING_INTERVAL,
    });

    expect(GUIDED_SETUP_MONITORING_INTERVAL).toBe("*/5 * * * *");
    expect(monitor.name).toBe("example.com");
    expect(monitor.monitorType).toBe(MonitorType.Website);
    expect(monitor.monitoringInterval).toBe("*/5 * * * *");
    expect(monitor.monitorSteps?.data?.defaultMonitorStatusId).toBe(
      SEEDS.operationalStatusId,
    );

    const step: MonitorStep =
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
    expect(step.data?.monitorDestination?.toString()).toBe(
      "https://example.com/",
    );

    const criteria: Array<MonitorCriteriaInstance> =
      step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray;
    const opensIncident: MonitorCriteriaInstance | undefined = criteria.find(
      (instance: MonitorCriteriaInstance) => {
        return instance.data?.createIncidents === true;
      },
    );
    expect(opensIncident?.data?.monitorStatusId?.toString()).toBe(
      SEEDS.offlineStatusId.toString(),
    );
    expect(
      opensIncident?.data?.incidents?.[0]?.incidentSeverityId?.toString(),
    ).toBe(SEEDS.incidentSeverityId.toString());
    // No probes named: the server adds the ones a new monitor starts with.
    expect(
      (monitor as unknown as Record<string, unknown>)["monitorProbes"],
    ).toBeUndefined();
  });

  test("is an API monitor when the person says so, checked as often as they asked", () => {
    const monitor: Monitor = buildWebsiteMonitor({
      address: parseWebsiteAddress("https://api.example.com/v1/health")!,
      isApi: true,
      seeds: SEEDS,
      monitoringInterval: "* * * * *",
    });

    expect(monitor.monitorType).toBe(MonitorType.API);
    expect(monitor.name).toBe("api.example.com/v1/health");
    expect(monitor.monitoringInterval).toBe("* * * * *");
  });
});

describe("who is told", () => {
  const facts: {
    policyCount: number | null;
    incidentRuleCount: number | null;
    alertRuleCount: number | null;
    mayCreatePolicy: boolean;
    mayAddEscalationRules: boolean;
    mayAddRules: boolean;
  } = {
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  };

  test("a project that pages nobody, set up by someone who may: a policy is made", () => {
    expect(getWhoIsToldMode(facts)).toBe(WhoIsToldMode.CreatePolicy);
  });

  test.each([
    ["a policy", { policyCount: 1 }],
    ["an incident on-call rule", { incidentRuleCount: 1 }],
    ["an alert on-call rule", { alertRuleCount: 2 }],
  ])(
    "a project with %s pages people already: its own decide",
    (_what: string, extra: Record<string, number>) => {
      expect(getWhoIsToldMode({ ...facts, ...extra })).toBe(
        WhoIsToldMode.ExistingPolicy,
      );
    },
  );

  test.each([
    ["who may not create a policy", { mayCreatePolicy: false }],
    ["who may not add its escalation rule", { mayAddEscalationRules: false }],
    ["who may not add the on-call rules", { mayAddRules: false }],
    ["who may not count the policies", { policyCount: null }],
  ])(
    "someone %s is told as the monitor's owner",
    (_who: string, extra: Record<string, unknown>) => {
      expect(getWhoIsToldMode({ ...facts, ...extra })).toBe(
        WhoIsToldMode.OwnerEmailOnly,
      );
    },
  );

  test("the project's first policy pages who was picked first, for every new incident and alert", () => {
    const create: FirstOnCallPolicyCreate = buildFirstOnCallPolicy({
      userIds: ["u1", "u2"],
      teamIds: ["t1"],
    });

    expect(create.policy).toBeInstanceOf(OnCallDutyPolicy);
    expect(create.policy.name).toBe(GUIDED_SETUP_POLICY_NAME);
    expect(GUIDED_SETUP_POLICY_NAME).toBe("Default on-call policy");
    expect(create.miscDataProps).toEqual({
      users: ["u1", "u2"],
      teams: ["t1"],
      [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true,
    });
  });
});

describe("the status page", () => {
  test("is its name, trimmed, in its project: everything else the server's defaults", () => {
    const page: StatusPage = buildGuidedStatusPage({
      name: "  Acme Status ",
      projectId: id(5),
    });

    expect(page.name).toBe("Acme Status");
    expect(page.projectId?.toString()).toBe(id(5).toString());
    expect(page.isPublicStatusPage).toBeUndefined();
    expect(STATUS_PAGE_NAME_MIN_LENGTH).toBe(2);
  });

  test("shows each monitor with its status, uptime and history, named after it", () => {
    const resource: StatusPageResource = buildGuidedStatusPageMonitor({
      projectId: id(5),
      statusPageId: id(6),
      monitorId: id(7),
      monitorName: "example.com",
    });

    expect(GUIDED_SETUP_RESOURCE_OPTIONS).toEqual({
      showCurrentStatus: true,
      showUptimePercent: true,
      showStatusHistoryChart: true,
    });
    expect(resource.projectId?.toString()).toBe(id(5).toString());
    expect(resource.statusPageId?.toString()).toBe(id(6).toString());
    expect(resource.monitorId?.toString()).toBe(id(7).toString());
    expect(resource.displayName).toBe("example.com");
    expect(resource.displayDescription).toBeUndefined();
    expect(resource.showCurrentStatus).toBe(true);
    expect(resource.showUptimePercent).toBe(true);
    expect(resource.showStatusHistoryChart).toBe(true);
  });

  test("a bulk add's placement and options are each set only when given", () => {
    const placed: StatusPageResource = buildStatusPageResource({
      placement: {
        projectId: id(5),
        statusPageId: id(6),
        statusPageGroupId: id(8),
        rowAxisValue: "EU",
        columnAxisValue: "API",
        resourceOptions: {
          displayTooltip: "Our API",
          uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
          showCurrentStatus: false,
        },
      },
      displayName: "API",
      displayDescription: "The public API",
    });

    expect(placed.statusPageGroupId?.toString()).toBe(id(8).toString());
    expect(placed.rowAxisValue).toBe("EU");
    expect(placed.columnAxisValue).toBe("API");
    expect(placed.displayTooltip).toBe("Our API");
    expect(placed.uptimePercentPrecision).toBe(UptimePrecision.TWO_DECIMAL);
    expect(placed.showCurrentStatus).toBe(false);
    expect(placed.showUptimePercent).toBeUndefined();
    expect(placed.displayDescription).toBe("The public API");

    const bare: StatusPageResource = buildStatusPageResource({
      placement: { projectId: id(5), statusPageId: id(6) },
      displayName: "API",
      displayDescription: undefined,
    });
    expect(bare.statusPageGroupId).toBeUndefined();
    expect(bare.showCurrentStatus).toBeUndefined();
    expect(bare.displayDescription).toBeUndefined();
  });
});
