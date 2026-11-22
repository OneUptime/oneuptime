import GroupedMonitorRecovery, {
  GroupedCriteriaRole,
  GroupedRecoveryJudgement,
  MAX_SERIES_BEHIND_STATUS,
  RecoveryCriteriaCheck,
} from "../../../../Server/Utils/Monitor/GroupedMonitorRecovery";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import ObjectID from "../../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE RULE A GROUPED MONITOR COMES BACK BY (issue #10061), on its own:
 * which criteria bring a monitor back, and which series a recovery criteria
 * waits for. The criteria evaluator and MonitorResource apply it
 * (GroupedMonitorRecoveryEvaluation.test.ts, MonitorResourceGroupedRecovery
 * .test.ts).
 */

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const DEGRADED: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function criteria(
  data: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    name: "A criteria",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [],
    incidents: [],
    alerts: [],
    ...data,
  };
  return instance;
}

function check(data: {
  criteriaId?: string;
  judged: Array<string>;
  met: Array<string>;
}): RecoveryCriteriaCheck {
  return {
    criteriaId: data.criteriaId || "healthy",
    judgedSeries: new Set<string>(data.judged),
    metSeries: new Set<string>(data.met),
  };
}

function judge(data: {
  behind: Array<string>;
  problems: Array<string>;
  recovery: Array<RecoveryCriteriaCheck>;
}): GroupedRecoveryJudgement {
  return GroupedMonitorRecovery.judge({
    seriesBehindStatus: new Set<string>(data.behind),
    problemSeries: new Set<string>(data.problems),
    recoveryCriteria: data.recovery,
  });
}

describe("GroupedMonitorRecovery.getRole: which criteria bring a monitor back", () => {
  test("the High Filesystem Usage template's pair: the offline criteria reports a problem, the healthy one recovers", () => {
    const step: MonitorStep = getHostAlertTemplateById(
      "host-high-filesystem",
    )!.getMonitorStep({
      hostIdentifier: "web-01",
      onlineMonitorStatusId: ONLINE,
      offlineMonitorStatusId: OFFLINE,
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "web-01",
    });

    const [offline, online] =
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;

    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: offline!,
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Problem);
    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: online!,
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Recovery);
  });

  test("a criteria written by hand is read by what it does, whatever its threshold", () => {
    // A status-only warning band, as a person writes one.
    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: DEGRADED,
        }),
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Problem);

    // A healthy criteria with no margin at all is a recovery all the same.
    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: ONLINE,
        }),
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Recovery);
  });

  test("a criteria that sets the default status and opens an alert is not one that only brings the monitor back", () => {
    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: ONLINE,
          createAlerts: true,
          alerts: [
            {
              id: ObjectID.generate().toString(),
              title: "Back",
              description: "",
              alertSeverityId: ObjectID.generate(),
              onCallPolicyIds: [],
            },
          ],
        }),
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Other);
  });

  test("a criteria switched to create alerts with none to create still only brings the monitor back", () => {
    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: ONLINE,
          createAlerts: true,
          alerts: [],
        }),
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Recovery);
  });

  test("a criteria that changes no status, is off, or a monitor with no default status plays no part", () => {
    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: false,
          monitorStatusId: OFFLINE,
        }),
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Other);

    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: ONLINE,
          isEnabled: false,
        }),
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Other);

    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: ONLINE,
        }),
        defaultMonitorStatusId: undefined,
      }),
    ).toBe(GroupedCriteriaRole.Other);

    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({ changeMonitorStatus: true }),
        defaultMonitorStatusId: ONLINE,
      }),
    ).toBe(GroupedCriteriaRole.Other);
  });

  test("ids are compared as ids, not as objects", () => {
    expect(
      GroupedMonitorRecovery.getRole({
        criteriaInstance: criteria({
          changeMonitorStatus: true,
          monitorStatusId: new ObjectID(ONLINE.toString()),
        }),
        defaultMonitorStatusId: new ObjectID(ONLINE.toString()),
      }),
    ).toBe(GroupedCriteriaRole.Recovery);
  });
});

describe("GroupedMonitorRecovery.judge: disks at 70%, 96% and 14%, firing above 90%, recovering at or below 81%", () => {
  const disks: Array<string> = ["root", "data", "boot"];

  test("the 96% disk fires and is behind the status; the recovery criteria, met by the other two, waits for it", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: [],
      problems: ["data"],
      recovery: [check({ judged: disks, met: ["root", "boot"] })],
    });

    expect(judgement.waitingFor.get("healthy")).toEqual(["data"]);
    expect(judgement.seriesBehindStatus).toEqual(["data"]);
  });

  test("at 89% no disk fires, and the recovery criteria still waits for the full disk", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: ["data"],
      problems: [],
      recovery: [check({ judged: disks, met: ["root", "boot"] })],
    });

    expect(judgement.waitingFor.get("healthy")).toEqual(["data"]);
    expect(judgement.seriesKeepingStatus).toEqual(["data"]);
    expect(judgement.seriesBehindStatus).toEqual(["data"]);
  });

  test("at 81% the full disk meets the recovery criteria: nothing waits, and nothing is behind the status", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: ["data"],
      problems: [],
      recovery: [check({ judged: disks, met: disks })],
    });

    expect(judgement.waitingFor.size).toBe(0);
    expect(judgement.seriesKeepingStatus).toEqual([]);
    expect(judgement.seriesBehindStatus).toEqual([]);
  });

  test("when every disk sits between 81% and 90%, the full one still keeps the status, and the others count for nothing", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: ["data"],
      problems: [],
      recovery: [check({ judged: disks, met: [] })],
    });

    expect(judgement.waitingFor.get("healthy")).toEqual(["data"]);
    expect(judgement.seriesKeepingStatus).toEqual(["data"]);
  });

  test("a disk that was never behind the status never holds it, even sitting in the margin for good", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: [],
      problems: [],
      // The root disk sits at 85%: it meets neither criteria.
      recovery: [check({ judged: disks, met: ["data", "boot"] })],
    });

    expect(judgement.waitingFor.size).toBe(0);
    expect(judgement.seriesKeepingStatus).toEqual([]);
    expect(judgement.seriesBehindStatus).toEqual([]);
  });
});

describe("GroupedMonitorRecovery.judge: series that appear, disappear, or are not read at all", () => {
  test("a series that is new counts only once it meets a problem criteria", () => {
    const quiet: GroupedRecoveryJudgement = judge({
      behind: ["a"],
      problems: [],
      recovery: [check({ judged: ["a", "new"], met: ["a"] })],
    });

    // The new series sits in the margin; "a" recovered: nothing waits.
    expect(quiet.waitingFor.size).toBe(0);
    expect(quiet.seriesBehindStatus).toEqual([]);

    const breaching: GroupedRecoveryJudgement = judge({
      behind: ["a"],
      problems: ["new"],
      recovery: [check({ judged: ["a", "new"], met: ["a"] })],
    });

    expect(breaching.waitingFor.get("healthy")).toEqual(["new"]);
    expect(breaching.seriesBehindStatus).toEqual(["new"]);
  });

  test("a series that is gone from a check that read others lets go of the status, as its incident resolves", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: ["unmounted", "data"],
      problems: [],
      recovery: [check({ judged: ["data", "boot"], met: ["boot"] })],
    });

    expect(judgement.waitingFor.get("healthy")).toEqual(["data"]);
    expect(judgement.seriesKeepingStatus).toEqual(["data"]);
    expect(judgement.seriesBehindStatus).toEqual(["data"]);
  });

  test("once the last series behind the status is gone, nothing keeps the status", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: ["unmounted"],
      problems: [],
      recovery: [check({ judged: ["boot"], met: ["boot"] })],
    });

    expect(judgement.waitingFor.size).toBe(0);
    expect(judgement.seriesKeepingStatus).toEqual([]);
    expect(judgement.seriesBehindStatus).toEqual([]);
  });

  test("a check that read no series at all keeps what is behind the status: silence is not recovery", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: ["data", "var"],
      problems: [],
      recovery: [check({ judged: [], met: [] })],
    });

    expect(judgement.waitingFor.size).toBe(0);
    expect(judgement.seriesKeepingStatus).toEqual([]);
    expect(judgement.seriesBehindStatus).toEqual(["data", "var"]);
  });

  test("the whole monitor, which a criteria judging it as a whole matches, is never a series behind the status", () => {
    const whole: string = MetricSeriesFingerprint.WholeMonitorFingerprint;

    const judgement: GroupedRecoveryJudgement = judge({
      behind: [whole],
      problems: [whole],
      recovery: [check({ judged: ["disk"], met: [] })],
    });

    expect(judgement.waitingFor.size).toBe(0);
    expect(judgement.seriesBehindStatus).toEqual([]);
    expect(GroupedMonitorRecovery.isSeries(whole)).toBe(false);
    expect(GroupedMonitorRecovery.isSeries("")).toBe(false);
    expect(GroupedMonitorRecovery.isSeries(undefined)).toBe(false);
    expect(GroupedMonitorRecovery.isSeries("disk")).toBe(true);
  });
});

describe("GroupedMonitorRecovery.judge: several criteria", () => {
  test("a series that still fires stays behind the status, even when it also meets an overlapping recovery criteria", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: [],
      problems: ["both"],
      recovery: [check({ judged: ["both"], met: ["both"] })],
    });

    // It met the recovery criteria, so that one does not wait for it.
    expect(judgement.waitingFor.size).toBe(0);
    expect(judgement.seriesBehindStatus).toEqual(["both"]);
  });

  test("a series is let go by any recovery criteria it meets; each criteria waits only for the ones it judged and that did not meet it", () => {
    const judgement: GroupedRecoveryJudgement = judge({
      behind: ["a", "b"],
      problems: [],
      recovery: [
        check({ criteriaId: "cpu", judged: ["a", "b"], met: ["a"] }),
        check({ criteriaId: "memory", judged: ["a"], met: [] }),
      ],
    });

    expect(judgement.waitingFor.get("cpu")).toEqual(["b"]);
    expect(judgement.waitingFor.get("memory")).toEqual(["a"]);
    // "a" met the CPU recovery: only "b" keeps the status.
    expect(judgement.seriesKeepingStatus).toEqual(["b"]);
    expect(judgement.seriesBehindStatus).toEqual(["b"]);
  });

  test("what is kept is bounded, and in one stable order", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < MAX_SERIES_BEHIND_STATUS + 50; index++) {
      many.push(`series-${String(index).padStart(6, "0")}`);
    }

    const judgement: GroupedRecoveryJudgement = judge({
      behind: [],
      problems: [...many].reverse(),
      recovery: [check({ judged: many, met: [] })],
    });

    expect(judgement.seriesBehindStatus).toHaveLength(MAX_SERIES_BEHIND_STATUS);
    expect(judgement.seriesBehindStatus[0]).toBe("series-000000");
  });
});

describe("GroupedMonitorRecovery.judge: a series hovering at the threshold", () => {
  test("a disk that crosses 90% back and forth never lets the monitor come back, until it is at or below 81%", () => {
    const random: SeededRandom = seededRandom(10061);

    let behind: Array<string> = [];
    let wentBackOnline: boolean = false;

    for (let check_: number = 0; check_ < 500; check_++) {
      // 89.0% to 91.9%, around the 90% line, with two quiet disks.
      const fullDisk: number = 89 + random(30) / 10;
      const fires: boolean = fullDisk > 90;

      const judgement: GroupedRecoveryJudgement = judge({
        behind: behind,
        problems: fires ? ["data"] : [],
        recovery: [
          check({
            judged: ["root", "data", "boot"],
            met: fullDisk <= 81 ? ["root", "data", "boot"] : ["root", "boot"],
          }),
        ],
      });

      // The monitor comes back only when no criteria fires and none waits.
      if (!fires && !judgement.waitingFor.has("healthy")) {
        wentBackOnline = true;
      }

      behind = judgement.seriesBehindStatus;
    }

    expect(wentBackOnline).toBe(false);

    const recovered: GroupedRecoveryJudgement = judge({
      behind: behind,
      problems: [],
      recovery: [
        check({
          judged: ["root", "data", "boot"],
          met: ["root", "data", "boot"],
        }),
      ],
    });

    expect(recovered.waitingFor.size).toBe(0);
    expect(recovered.seriesBehindStatus).toEqual([]);
  });
});
