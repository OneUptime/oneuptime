import ExternalStatusPageMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ExternalStatusPageMonitorCriteria";
import FilterCondition from "../../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "../../../../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "../../../../../Types/Monitor/ExternalStatusPageProviderType";
import MonitorCriteria from "../../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import StatusPageSummaryUtil, {
  StatusPageSummary,
  StatusPageSummaryResource,
} from "../../../../../Types/StatusPage/StatusPageSummary";
import ExternalStatusPageComponentStatusUtil, {
  ExternalStatusPageComponentStatusValue,
} from "../../../../../Utils/Monitor/ExternalStatusPageComponentStatusUtil";
import {
  FAKE_STATUSES,
  FakeStatusPage,
  fakeSummaryJSON,
} from "../../../../Helpers/FakeStatusPageOverview";
import { describe, expect, test } from "@jest/globals";

/*
 * A monitor watching another OneUptime's status page, judged by the criteria
 * every new External Status Page monitor starts with: offline - and an
 * incident - when the page cannot be read, has an active incident, or a
 * component reports Degraded Performance, Partial Outage, Major Outage or
 * Full Outage; online when the page is read and has no active incident.
 *
 * The case issue #5176 is about: the upstream project's scheduled
 * maintenance. Its monitors are not checked while an event holds them, and
 * the event often leaves them in whatever status they had - or changes them
 * to Offline. The resource reports Under Maintenance however its monitors
 * read, so planned work never becomes an outage downstream, and a criterion
 * on Under Maintenance can show it.
 *
 * The responses are made as the probe makes them from the page's summary
 * (ExternalStatusPageComponentStatusUtil), from a page FakeStatusPageOverview
 * builds the way the server builds its overview.
 */

const id: (suffix: string) => string = (suffix: string): string => {
  return `5e200000-0000-4000-8000-${suffix.padStart(12, "0")}`;
};

const M_DB: string = id("a01");
const M_API: string = id("a02");
const R_DB: string = id("d01");
const R_API: string = id("d02");
const NOW: Date = new Date("2026-10-23T12:00:00.000Z");

function upstreamPage(overrides: Partial<FakeStatusPage> = {}): FakeStatusPage {
  return {
    resources: [
      {
        id: R_DB,
        name: "Database",
        monitorId: M_DB,
        statusId: FAKE_STATUSES.operational.id,
      },
      {
        id: R_API,
        name: "API",
        monitorId: M_API,
        statusId: FAKE_STATUSES.operational.id,
      },
    ],
    ...overrides,
  };
}

const DATABASE_UPGRADE: FakeStatusPage["maintenance"] = [
  {
    id: id("e01"),
    title: "Database upgrade",
    state: "ongoing",
    startsAt: new Date(NOW.getTime() - 30 * 60 * 1000),
    endsAt: new Date(NOW.getTime() + 90 * 60 * 1000),
    monitorIds: [M_DB],
  },
];

// The probe's reading of the page, unscoped.
function readPage(page: FakeStatusPage): ProbeMonitorResponse {
  const summary: StatusPageSummary = StatusPageSummaryUtil.fromJSON(
    fakeSummaryJSON(page),
  )!;

  const componentStatuses: Array<ExternalStatusPageComponentStatus> =
    summary.resources.map(
      (
        resource: StatusPageSummaryResource,
      ): ExternalStatusPageComponentStatus => {
        return {
          name: resource.name,
          status: ExternalStatusPageComponentStatusUtil.fromStatusPageStatus({
            status: resource.currentStatus,
            isUnderMaintenance: resource.isUnderMaintenance,
          }),
        };
      },
    );

  const response: ExternalStatusPageMonitorResponse = {
    isOnline: true,
    overallStatus: "operational",
    componentStatuses: componentStatuses,
    activeIncidentCount: summary.activeIncidents.length,
    responseTimeInMs: 120,
    failureCause: "",
    provider: ExternalStatusPageProviderType.OneUptime,
  };

  return probeResponse(response);
}

function probeResponse(
  response: ExternalStatusPageMonitorResponse,
): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: response.failureCause,
    isOnline: response.isOnline,
    responseTimeInMs: response.responseTimeInMs,
    externalStatusPageResponse: response,
    monitoredAt: NOW,
  };
}

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();

function defaultCriteria(): Array<MonitorCriteriaInstance> {
  return (
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: MonitorType.ExternalStatusPage,
      monitorName: "Upstream department",
      onlineMonitorStatusId: ONLINE_STATUS_ID,
      offlineMonitorStatusId: OFFLINE_STATUS_ID,
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || []
  );
}

async function isMet(
  instance: MonitorCriteriaInstance,
  dataToProcess: ProbeMonitorResponse,
): Promise<boolean> {
  const results: Array<boolean> = [];

  for (const filter of instance.data?.filters || []) {
    results.push(
      Boolean(
        await ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet(
          { dataToProcess: dataToProcess, criteriaFilter: filter },
        ),
      ),
    );
  }

  return instance.data?.filterCondition === FilterCondition.Any
    ? results.some(Boolean)
    : results.every(Boolean);
}

// The status the monitor ends up in: the first criteria that matches wins.
async function statusAfter(
  dataToProcess: ProbeMonitorResponse,
  criteria: Array<MonitorCriteriaInstance> = defaultCriteria(),
): Promise<string> {
  for (const instance of criteria) {
    if (await isMet(instance, dataToProcess)) {
      if (instance.data?.monitorStatusId?.toString() === ONLINE_STATUS_ID.toString()) {
        return "online";
      }

      if (instance.data?.monitorStatusId?.toString() === OFFLINE_STATUS_ID.toString()) {
        return "offline, with an incident";
      }

      return instance.data?.name || "matched";
    }
  }

  return "no criteria matched";
}

describe("a OneUptime status page, judged by the default External Status Page criteria", () => {
  test("starts with the offline criteria, then the online one", () => {
    const [offline, online] = defaultCriteria();

    expect(offline!.data?.monitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
    expect(offline!.data?.createIncidents).toBe(true);
    expect(online!.data?.monitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
  });

  test("everything operational: online", async () => {
    expect(await statusAfter(readPage(upstreamPage()))).toBe("online");
  });

  test.each([
    ["left Operational", FAKE_STATUSES.operational.id],
    ["changed to Offline", FAKE_STATUSES.offline.id],
    ["changed to Degraded", FAKE_STATUSES.degraded.id],
    ["changed to the project's Maintenance", FAKE_STATUSES.maintenance.id],
  ])(
    "upstream maintenance with its monitor %s: online, never an outage",
    async (_name: string, statusId: string) => {
      const page: FakeStatusPage = upstreamPage({
        resources: [
          { id: R_DB, name: "Database", monitorId: M_DB, statusId: statusId },
          {
            id: R_API,
            name: "API",
            monitorId: M_API,
            statusId: FAKE_STATUSES.operational.id,
          },
        ],
        maintenance: DATABASE_UPGRADE,
      });

      const reading: ProbeMonitorResponse = readPage(page);

      expect(
        reading.externalStatusPageResponse!.componentStatuses.map(
          (component: ExternalStatusPageComponentStatus) => {
            return [component.name, component.status];
          },
        ),
      ).toEqual([
        ["Database", ExternalStatusPageComponentStatusValue.UnderMaintenance],
        ["API", ExternalStatusPageComponentStatusValue.Operational],
      ]);
      expect(await statusAfter(reading)).toBe("online");
    },
  );

  test("the same monitor Offline without maintenance: offline, with an incident", async () => {
    const page: FakeStatusPage = upstreamPage({
      resources: [
        {
          id: R_DB,
          name: "Database",
          monitorId: M_DB,
          statusId: FAKE_STATUSES.offline.id,
        },
      ],
    });

    expect(await statusAfter(readPage(page))).toBe("offline, with an incident");
  });

  test("Degraded without maintenance: offline, with an incident", async () => {
    const page: FakeStatusPage = upstreamPage({
      resources: [
        {
          id: R_API,
          name: "API",
          monitorId: M_API,
          statusId: FAKE_STATUSES.degraded.id,
        },
      ],
    });

    expect(await statusAfter(readPage(page))).toBe("offline, with an incident");
  });

  test("maintenance that is only scheduled leaves the page's statuses as they are", async () => {
    const page: FakeStatusPage = upstreamPage({
      resources: [
        {
          id: R_DB,
          name: "Database",
          monitorId: M_DB,
          statusId: FAKE_STATUSES.offline.id,
        },
      ],
      maintenance: [{ ...DATABASE_UPGRADE![0]!, state: "scheduled" }],
    });

    expect(await statusAfter(readPage(page))).toBe("offline, with an incident");
  });

  test("an incident the page shows during maintenance still counts", async () => {
    const page: FakeStatusPage = upstreamPage({
      maintenance: DATABASE_UPGRADE,
      incidents: [
        {
          id: id("f01"),
          title: "Upgrade overran",
          declaredAt: NOW,
          state: "Investigating",
          severity: "SEV-2",
          monitorIds: [M_DB],
        },
      ],
    });

    expect(await statusAfter(readPage(page))).toBe("offline, with an incident");
  });

  test("a resource whose status the page hides is never an outage by itself", async () => {
    const page: FakeStatusPage = upstreamPage({
      resources: [
        {
          id: R_DB,
          name: "Database",
          monitorId: M_DB,
          statusId: FAKE_STATUSES.offline.id,
          showCurrentStatus: false,
        },
      ],
    });

    const reading: ProbeMonitorResponse = readPage(page);

    expect(reading.externalStatusPageResponse!.componentStatuses).toEqual([
      { name: "Database", status: ExternalStatusPageComponentStatusValue.Unknown },
    ]);
    expect(await statusAfter(reading)).toBe("online");
  });

  test("a page that cannot be read - private, or not letting the probe in - is offline", async () => {
    expect(
      await statusAfter(
        probeResponse({
          isOnline: false,
          overallStatus: "unknown",
          componentStatuses: [],
          activeIncidentCount: 0,
          responseTimeInMs: 80,
          failureCause: "This status page is private.",
        }),
      ),
    ).toBe("offline, with an incident");
  });
});

describe("showing upstream maintenance on the monitor", () => {
  const UNDER_MAINTENANCE: CriteriaFilter = {
    checkOn: CheckOn.ExternalStatusPageComponentStatus,
    filterType: FilterType.EqualTo,
    value: ExternalStatusPageComponentStatusValue.UnderMaintenance,
  };

  // A criteria a person adds first: Component Status is Under Maintenance.
  function withMaintenanceCriteria(): Array<MonitorCriteriaInstance> {
    const maintenance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

    maintenance.data = {
      id: ObjectID.generate().toString(),
      monitorStatusId: ObjectID.generate(),
      filterCondition: FilterCondition.Any,
      filters: [UNDER_MAINTENANCE],
      incidents: [],
      alerts: [],
      createAlerts: false,
      changeMonitorStatus: true,
      createIncidents: false,
      name: "Upstream maintenance",
      description: "",
    };

    return [maintenance, ...defaultCriteria()];
  }

  test("matches while the event is in progress, and names the component", async () => {
    const reading: ProbeMonitorResponse = readPage(
      upstreamPage({ maintenance: DATABASE_UPGRADE }),
    );

    expect(
      await ExternalStatusPageMonitorCriteria.isMonitorInstanceCriteriaFilterMet(
        { dataToProcess: reading, criteriaFilter: UNDER_MAINTENANCE },
      ),
    ).toBe(
      'Component "Database": External Status Page Component Status is equal to under_maintenance.',
    );
    expect(await statusAfter(reading, withMaintenanceCriteria())).toBe(
      "Upstream maintenance",
    );
  });

  test.each(["verifying", "ongoing"] as const)(
    "matches in a state of the project's own while in progress (%s)",
    async (state: "verifying" | "ongoing") => {
      const reading: ProbeMonitorResponse = readPage(
        upstreamPage({
          maintenance: [{ ...DATABASE_UPGRADE![0]!, state: state }],
        }),
      );

      expect(await statusAfter(reading, withMaintenanceCriteria())).toBe(
        "Upstream maintenance",
      );
    },
  );

  test.each(["scheduled", "confirmed", "ended", "completed"] as const)(
    "does not match before the event starts or after it is over (%s)",
    async (state: "scheduled" | "confirmed" | "ended" | "completed") => {
      const reading: ProbeMonitorResponse = readPage(
        upstreamPage({
          maintenance: [{ ...DATABASE_UPGRADE![0]!, state: state }],
        }),
      );

      expect(await statusAfter(reading, withMaintenanceCriteria())).toBe(
        "online",
      );
    },
  );
});
