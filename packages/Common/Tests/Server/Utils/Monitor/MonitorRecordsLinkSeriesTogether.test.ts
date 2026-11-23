/*
 * The record creation paths pull the native isolated-vm addon through their
 * template renderer. Nothing under test here touches the sandbox, and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/PasswordHash", () => {
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

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import UUIDColumnFilter from "../../../../Server/Types/Database/UUIDColumnFilter";
import logger from "../../../../Server/Utils/Logger";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil, {
  MonitorRecordResources,
} from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import OwnerRuleAssignment from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import Includes from "../../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { DependencySuppressionResult } from "../../../../Utils/Monitor/MonitorDependencyRule";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A GROUPED MONITOR'S NEW RECORDS LINK THEIR SERIES' RESOURCES IN ONE READ
 * (issue #10315).
 *
 * An evaluation that opened alerts for 700 series of a fleet read the Host
 * table 700 times, one series after another, to link each alert to its
 * host. The create passes now hand every series they will open a record
 * for to the evaluation's series resources first (MonitorRecordResources
 * .seriesResources), which read them in one read per resource kind, and
 * each record is linked from the answer. These tests drive the real alert
 * and incident creators over a fleet of containers on a table of hosts read
 * as Postgres reads it, and hold them to: one read, whatever the number of
 * series; every record linked to its own host, as each series' own read
 * linked it; the incidents and the alerts of an evaluation sharing the
 * read; nothing read for a series the pass will not open a record for; and
 * a series that fails its own read failing alone, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const CRITERIA_ID: string = "criteria-too-many-tasks";

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: new Date("2026-11-17T10:04:00.000Z"),
} as unknown as ProbeMonitorResponse;

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "Containers by host";
  return model;
}

function criteriaInstance(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = CRITERIA_ID;
  instance.data!.name = "Too many tasks";
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = true;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "Too many tasks",
      description: "A container runs too many tasks.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: true,
    },
  ];
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "Too many tasks",
      description: "A container runs too many tasks.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: true,
      onCallPolicyIds: [],
    },
  ];
  return instance;
}

interface HostRow {
  _id: string;
  name: string;
  createdAt: Date;
}

let hosts: Array<HostRow>;
// What each read of the Host table asked for: the names, or the ids.
let hostReads: Array<Array<string>>;
let failNextHostReads: number;
let createdAlerts: Array<Alert>;
let createdIncidents: Array<Incident>;

function hostId(index: number): string {
  return `0c000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function seedHosts(count: number): void {
  hosts = [];

  for (let index: number = 0; index < count; index++) {
    hosts.push({
      _id: hostId(index),
      name: `docker-host-${String(index).padStart(4, "0")}.prod.fleet.internal`,
      createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
    });
  }
}

// A container on a host: the #10108 fleet's labels.
function containerSeries(
  index: number,
  hostIndex: number,
): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: CRITERIA_ID,
    fingerprint: `fp-${index}`,
    labels: {
      "resource.host.name": hosts[hostIndex]!.name,
      "resource.container.name": `container-${index}`,
    },
    rootCause: `container-${index} runs too many tasks`,
  };
}

function fleet(count: number): Array<PerSeriesCriteriaMatch> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return containerSeries(index, index % hosts.length);
  });
}

function hostNameOf(match: PerSeriesCriteriaMatch): string {
  return String(match.labels["resource.host.name"]);
}

function hostIdsOn(record: Alert | Incident): Array<string> {
  return (record.hosts || []).map((host: { _id?: string | undefined }) => {
    return String(host._id);
  });
}

function hostIdNamed(name: string): string {
  return hosts.find((host: HostRow): boolean => {
    return host.name === name;
  })!._id;
}

beforeEach(() => {
  mockProjectStates();
  seedHosts(20);
  hostReads = [];
  failNextHostReads = 0;
  createdAlerts = [];
  createdIncidents = [];

  // The Host table, read as Postgres reads it.
  jest
    .spyOn(HostService, "findBy")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      await Promise.resolve();

      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());

      const asked: Includes = (query["_id"] ||
        query["hostIdentifier"]) as Includes;
      hostReads.push(
        asked.values.map((value: unknown): string => {
          return String(value);
        }),
      );

      if (failNextHostReads > 0) {
        failNextHostReads--;
        throw new Error("Connection terminated unexpectedly");
      }

      if (query["_id"]) {
        const ids: Array<string> = hostReads[hostReads.length - 1]!;

        for (const id of ids) {
          if (!UUIDColumnFilter.isUUIDText(id)) {
            throw new BadDataException(
              `Invalid ID for "_id" in the query: "${id}".`,
            );
          }
        }

        return hosts.filter((host: HostRow): boolean => {
          return ids.includes(host._id);
        }) as never;
      }

      const names: Array<string> = hostReads[hostReads.length - 1]!;

      return hosts
        .filter((host: HostRow): boolean => {
          return names.includes(host.name);
        })
        .sort((a: HostRow, b: HostRow): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .map((host: HostRow): JSONObject => {
          return {
            _id: host._id,
            createdAt: host.createdAt,
            hostIdentifier: host.name,
          };
        }) as never;
    });

  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
  jest
    .spyOn(AlertService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Alert> => {
      const alert: Alert = (createBy as { data: Alert }).data;
      alert._id = ObjectID.generate().toString();
      createdAlerts.push(alert);
      return alert;
    });
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Incident> => {
      const incident: Incident = (createBy as { data: Incident }).data;
      incident._id = ObjectID.generate().toString();
      createdIncidents.push(incident);
      return incident;
    });
  jest
    .spyOn(AlertService, "addOwners")
    .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());
  jest
    .spyOn(IncidentService, "addOwners")
    .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function alertPass(input: {
  series: Array<PerSeriesCriteriaMatch>;
  openAlerts?: Array<Alert> | undefined;
  recordResources?: MonitorRecordResources | undefined;
  summary?: MonitorEvaluationSummary | undefined;
  suppressedSeriesFingerprints?: Set<string> | undefined;
  dependencySuppression?: DependencySuppressionResult | undefined;
}): Promise<void> {
  await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
    criteriaInstance: criteriaInstance(),
    monitor: monitor(),
    dataToProcess: dataToProcess,
    rootCause: "A container runs too many tasks",
    autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
    props: {},
    matchesPerSeries: input.series,
    openAlerts: input.openAlerts || [],
    recordResources: input.recordResources,
    evaluationSummary: input.summary,
    suppressedSeriesFingerprints: input.suppressedSeriesFingerprints,
    dependencySuppression: input.dependencySuppression,
  });
}

async function incidentPass(input: {
  series: Array<PerSeriesCriteriaMatch>;
  openIncidents?: Array<Incident> | undefined;
  recordResources?: MonitorRecordResources | undefined;
}): Promise<void> {
  await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
    criteriaInstance: criteriaInstance(),
    monitor: monitor(),
    dataToProcess: dataToProcess,
    rootCause: "A container runs too many tasks",
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
    props: {},
    matchesPerSeries: input.series,
    openIncidents: input.openIncidents || [],
    recordResources: input.recordResources,
  });
}

function emptySummary(): MonitorEvaluationSummary {
  return {
    evaluatedAt: new Date("2026-11-17T10:04:00.000Z"),
    criteriaResults: [],
    events: [],
  };
}

describe("a grouped monitor's create pass links its series' resources in one read", () => {
  it.each([1, 35, 700])(
    "%s alerts over the fleet's hosts: the Host table is read once, and each alert links its own host",
    async (count: number) => {
      const series: Array<PerSeriesCriteriaMatch> = fleet(count);

      await alertPass({ series });

      expect(hostReads).toHaveLength(1);
      // Each host once, in the order the series name them.
      expect(hostReads[0]).toEqual(Array.from(new Set(series.map(hostNameOf))));
      expect(createdAlerts).toHaveLength(count);

      createdAlerts.forEach((alert: Alert, index: number): void => {
        expect(alert.seriesFingerprint).toBe(series[index]!.fingerprint);
        expect(hostIdsOn(alert)).toEqual([
          hostIdNamed(hostNameOf(series[index]!)),
        ]);
      });
    },
  );

  it("every incident links its own host the same way", async () => {
    const series: Array<PerSeriesCriteriaMatch> = fleet(300);

    await incidentPass({ series });

    expect(hostReads).toHaveLength(1);
    expect(createdIncidents).toHaveLength(300);
    createdIncidents.forEach((incident: Incident, index: number): void => {
      expect(hostIdsOn(incident)).toEqual([
        hostIdNamed(hostNameOf(series[index]!)),
      ]);
    });
  });

  it("the incidents and the alerts of one evaluation share the read", async () => {
    const series: Array<PerSeriesCriteriaMatch> = fleet(200);
    const recordResources: MonitorRecordResources =
      MonitorResourceContextUtil.forEvaluation({ monitor: monitor() });

    await incidentPass({ series, recordResources });
    await alertPass({ series, recordResources });

    expect(hostReads).toHaveLength(1);
    expect(createdIncidents).toHaveLength(200);
    expect(createdAlerts).toHaveLength(200);

    for (let index: number = 0; index < 200; index++) {
      expect(hostIdsOn(createdAlerts[index]!)).toEqual(
        hostIdsOn(createdIncidents[index]!),
      );
    }
  });

  it("reads nothing for a series the pass opens no record for", async () => {
    seedHosts(400);
    const random: SeededRandom = seededRandom(10315);
    // A host a container, so the read says exactly whose series it read.
    const series: Array<PerSeriesCriteriaMatch> = Array.from(
      { length: 400 },
      (_value: unknown, index: number) => {
        return containerSeries(index, index);
      },
    );

    const openAlerts: Array<Alert> = [];
    const suppressed: Set<string> = new Set<string>();
    const parentSpeaksFor: Set<string> = new Set<string>();

    for (const match of series) {
      const pick: number = random(4);

      if (pick === 0) {
        const alert: Alert = new Alert();
        alert._id = ObjectID.generate().toString();
        alert.createdCriteriaId = CRITERIA_ID;
        alert.seriesFingerprint = match.fingerprint;
        openAlerts.push(alert);
      } else if (pick === 1) {
        suppressed.add(match.fingerprint);
      } else if (pick === 2 && random(2) === 0) {
        parentSpeaksFor.add(String(match.labels["resource.container.name"]));
      }
    }

    await alertPass({
      series,
      openAlerts,
      summary: emptySummary(),
      suppressedSeriesFingerprints: suppressed,
      dependencySuppression: {
        isSuppressed: true,
        suppressingParents: [
          {
            monitorId: "33333333-3333-4333-8333-333333333333",
            monitorName: "Region broker",
            statusName: "Offline",
          },
        ],
        coversSeries: (labels: JSONObject): boolean => {
          return parentSpeaksFor.has(String(labels["resource.container.name"]));
        },
      },
    });

    const opened: Array<string> = createdAlerts.map((alert: Alert) => {
      return String(alert.seriesFingerprint);
    });
    const openedHosts: Array<string> = series
      .filter((match: PerSeriesCriteriaMatch): boolean => {
        return opened.includes(match.fingerprint);
      })
      .map(hostNameOf);

    expect(opened.length).toBeGreaterThan(50);
    expect(opened.length).toBeLessThan(300);
    expect(hostReads).toEqual([openedHosts]);
  });

  it("an alert open already for every series reads nothing", async () => {
    const series: Array<PerSeriesCriteriaMatch> = fleet(50);
    const openAlerts: Array<Alert> = series.map(
      (match: PerSeriesCriteriaMatch): Alert => {
        const alert: Alert = new Alert();
        alert._id = ObjectID.generate().toString();
        alert.createdCriteriaId = CRITERIA_ID;
        alert.seriesFingerprint = match.fingerprint;
        return alert;
      },
    );

    await alertPass({ series, openAlerts });

    expect(createdAlerts).toHaveLength(0);
    expect(hostReads).toHaveLength(0);
  });
});

describe("a series that fails its own read still fails alone", () => {
  it("a series whose host id is no uuid fails its own alert; the others open, linked, from the one read", async () => {
    const series: Array<PerSeriesCriteriaMatch> = fleet(40);
    series[17] = {
      ...series[17]!,
      labels: { "oneuptime.host.id": "not-a-uuid" },
    };
    const summary: MonitorEvaluationSummary = emptySummary();

    await alertPass({ series, summary });

    expect(createdAlerts).toHaveLength(39);
    expect(
      createdAlerts.some((alert: Alert): boolean => {
        return alert.seriesFingerprint === "fp-17";
      }),
    ).toBe(false);

    const failed: Array<MonitorEvaluationEvent> = summary.events.filter(
      (event: MonitorEvaluationEvent): boolean => {
        return event.type === "alert-skipped";
      },
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.message).toBe(
      'Could not create an alert for series fp-17: Invalid ID for "_id" in the query: "not-a-uuid".',
    );

    // The others' one read, then the failing series' own.
    expect(hostReads).toHaveLength(2);
    expect(hostReads[1]).toEqual(["not-a-uuid"]);
  });

  it("a read of them all that fails leaves each alert to read its own, linked as always", async () => {
    const series: Array<PerSeriesCriteriaMatch> = fleet(60);
    failNextHostReads = 1;

    await alertPass({ series });

    expect(createdAlerts).toHaveLength(60);
    createdAlerts.forEach((alert: Alert, index: number): void => {
      expect(hostIdsOn(alert)).toEqual([
        hostIdNamed(hostNameOf(series[index]!)),
      ]);
    });
    expect(hostReads).toHaveLength(1 + 60);
    expect(logger.error).toHaveBeenCalled();
  });
});
