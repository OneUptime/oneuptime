import GroupedMonitorRecovery, {
  GroupedRecoveryJudgement,
  WholeMonitorRecoveryJudgement,
} from "../../../../Server/Utils/Monitor/GroupedMonitorRecovery";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The recovery rule beyond grouped monitors (#10743), and a criteria's own
 * recovery condition letting its series go (#10355).
 */

const ONLINE: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const OFFLINE: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const DEGRADED: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

const CPU_ABOVE_90: CriteriaFilter = {
  checkOn: CheckOn.CPUUsagePercent,
  filterType: FilterType.GreaterThan,
  value: 90,
};

const CPU_AT_MOST_81: CriteriaFilter = {
  checkOn: CheckOn.CPUUsagePercent,
  filterType: FilterType.LessThanOrEqualTo,
  value: 81,
};

function criteria(input: {
  id: string;
  statusId?: ObjectID | undefined;
  opensIncident?: boolean;
  isEnabled?: boolean;
  recoveryFilters?: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.id,
    monitorStatusId: input.statusId,
    filterCondition: FilterCondition.All,
    filters: [CPU_ABOVE_90],
    incidents: input.opensIncident
      ? [
          {
            id: "incident",
            title: "CPU high",
            description: "",
            incidentSeverityId: ObjectID.generate(),
          } as never,
        ]
      : [],
    alerts: [],
    name: input.id,
    description: "",
    changeMonitorStatus: Boolean(input.statusId),
    createIncidents: Boolean(input.opensIncident),
    createAlerts: false,
    isEnabled: input.isEnabled ?? true,
    ...(input.recoveryFilters
      ? {
          recoveryFilters: input.recoveryFilters,
          recoveryFilterCondition: FilterCondition.All,
        }
      : {}),
  };
  return instance;
}

// The templates' pair: offline above 90%, back online at or below 81%.
const TEMPLATE_PAIR: Array<MonitorCriteriaInstance> = [
  criteria({ id: "High CPU", statusId: OFFLINE, opensIncident: true }),
  criteria({ id: "CPU back to normal", statusId: ONLINE }),
];

function keeps(input: {
  criteriaInstances: Array<MonitorCriteriaInstance>;
  currentStatus: ObjectID | undefined;
}): WholeMonitorRecoveryJudgement {
  return GroupedMonitorRecovery.judgeWholeMonitor({
    criteriaInstances: input.criteriaInstances,
    defaultMonitorStatusId: ONLINE,
    currentMonitorStatusId: input.currentStatus,
  });
}

describe("GroupedMonitorRecovery.judgeWholeMonitor (#10743)", () => {
  test("inside the margin a monitor a problem criteria took offline stays offline", () => {
    expect(
      keeps({ criteriaInstances: TEMPLATE_PAIR, currentStatus: OFFLINE }),
    ).toEqual({
      isStatusKept: true,
      recoveryCriteriaIds: ["CPU back to normal"],
    });
  });

  test("a monitor already at its default status has nothing to keep", () => {
    expect(
      keeps({ criteriaInstances: TEMPLATE_PAIR, currentStatus: ONLINE })
        .isStatusKept,
    ).toBe(false);
  });

  test("without a recovery criteria, no criteria matched still means the default status", () => {
    expect(
      keeps({
        criteriaInstances: [
          criteria({ id: "High CPU", statusId: OFFLINE, opensIncident: true }),
        ],
        currentStatus: OFFLINE,
      }).isStatusKept,
    ).toBe(false);
  });

  test("a status no problem criteria of the step sets is not kept", () => {
    // Set by hand, or by a criteria since deleted.
    expect(
      keeps({ criteriaInstances: TEMPLATE_PAIR, currentStatus: DEGRADED })
        .isStatusKept,
    ).toBe(false);
  });

  test("a recovery criteria that is off brings nothing back, so nothing waits for it", () => {
    expect(
      keeps({
        criteriaInstances: [
          TEMPLATE_PAIR[0]!,
          criteria({
            id: "CPU back to normal",
            statusId: ONLINE,
            isEnabled: false,
          }),
        ],
        currentStatus: OFFLINE,
      }).isStatusKept,
    ).toBe(false);
  });

  test("a problem criteria with a recovery condition of its own is not waited for", () => {
    expect(
      keeps({
        criteriaInstances: [
          criteria({
            id: "High CPU",
            statusId: OFFLINE,
            opensIncident: true,
            recoveryFilters: [CPU_AT_MOST_81],
          }),
          criteria({ id: "CPU back to normal", statusId: ONLINE }),
        ],
        currentStatus: OFFLINE,
      }).isStatusKept,
    ).toBe(false);
  });

  test("every recovery criteria is named, in order", () => {
    expect(
      keeps({
        criteriaInstances: [
          TEMPLATE_PAIR[0]!,
          criteria({ id: "Back up", statusId: ONLINE }),
          criteria({ id: "Quiet", statusId: ONLINE }),
        ],
        currentStatus: OFFLINE,
      }).recoveryCriteriaIds,
    ).toEqual(["Back up", "Quiet"]);
  });

  test("a monitor with no default status keeps nothing", () => {
    expect(
      GroupedMonitorRecovery.judgeWholeMonitor({
        criteriaInstances: TEMPLATE_PAIR,
        defaultMonitorStatusId: undefined,
        currentMonitorStatusId: OFFLINE,
      }).isStatusKept,
    ).toBe(false);
  });
});

describe("GroupedMonitorRecovery.judge: a criteria's own recovery condition (#10355)", () => {
  test("a series that met its own criteria's recovery condition is let go, though no recovery criteria met it", () => {
    const judgement: GroupedRecoveryJudgement = GroupedMonitorRecovery.judge({
      seriesBehindStatus: new Set<string>(["disk-a", "disk-b"]),
      problemSeries: new Set<string>(),
      recoveryCriteria: [
        {
          criteriaId: "CPU back to normal",
          judgedSeries: new Set<string>(["disk-a", "disk-b"]),
          metSeries: new Set<string>(),
        },
      ],
      recoveredSeries: new Set<string>(["disk-a"]),
    });

    // disk-a recovered on its own condition: the recovery criteria waits for disk-b only.
    expect(judgement.waitingFor.get("CPU back to normal")).toEqual(["disk-b"]);
    expect(judgement.seriesKeepingStatus).toEqual(["disk-b"]);
    expect(judgement.seriesBehindStatus).toEqual(["disk-b"]);
  });

  test("once every series behind the status recovered on its own condition, the recovery criteria stands", () => {
    const judgement: GroupedRecoveryJudgement = GroupedMonitorRecovery.judge({
      seriesBehindStatus: new Set<string>(["disk-a"]),
      problemSeries: new Set<string>(),
      recoveryCriteria: [
        {
          criteriaId: "CPU back to normal",
          judgedSeries: new Set<string>(["disk-a"]),
          metSeries: new Set<string>(),
        },
      ],
      recoveredSeries: new Set<string>(["disk-a"]),
    });

    expect(judgement.waitingFor.size).toBe(0);
    expect(judgement.seriesKeepingStatus).toEqual([]);
    expect(judgement.seriesBehindStatus).toEqual([]);
  });

  test("without recovered series, judge is exactly what it was", () => {
    const input: Parameters<typeof GroupedMonitorRecovery.judge>[0] = {
      seriesBehindStatus: new Set<string>(["disk-a"]),
      problemSeries: new Set<string>(["disk-b"]),
      recoveryCriteria: [
        {
          criteriaId: "back",
          judgedSeries: new Set<string>(["disk-a", "disk-b", "disk-c"]),
          metSeries: new Set<string>(["disk-c"]),
        },
      ],
    };

    expect(GroupedMonitorRecovery.judge(input)).toEqual(
      GroupedMonitorRecovery.judge({
        ...input,
        recoveredSeries: new Set<string>(),
      }),
    );
  });
});
