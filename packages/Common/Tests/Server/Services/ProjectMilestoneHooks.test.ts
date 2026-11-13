import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * Where each activation milestone is set (issue #6830): at the moment it
 * happens, and never by a refused or failed action.
 *
 * Each hook is driven where it can be driven on its own - a stored check
 * result, a status page resource created, a subscriber confirmed, an
 * on-call page delivered, a person accepting to be in a project - with
 * ProjectMilestoneService.reachInBackground as the spy the milestones land
 * in. For the hooks that sit deep inside a create's success path (a
 * monitor, a state timeline, an on-call run), the source is read to pin the
 * call to its place: after the checks that refuse, and under the condition
 * that makes it the milestone. The keeping itself is
 * ProjectMilestoneService's (ProjectMilestoneService.test.ts) and Postgres'
 * (ProjectMilestonePostgres.test.ts).
 */

import ProjectMilestoneService, {
  ReachMilestoneData,
} from "../../../Server/Services/ProjectMilestoneService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import MonitorLogUtil from "../../../Server/Utils/Monitor/MonitorLogUtil";
import DataToProcess from "../../../Server/Utils/Monitor/DataToProcess";
import logger from "../../../Server/Utils/Logger";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-2222-4222-8222-222222222222",
);

const SERVER: string = path.join(__dirname, "../../../Server");

const readSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(SERVER, relativePath), "utf8");
};

// The body of a method, from its signature to the matching closing brace.
const methodBody: (source: string, signature: string) => string = (
  source: string,
  signature: string,
): string => {
  const start: number = source.indexOf(signature);

  if (start < 0) {
    throw new Error(`No ${signature}`);
  }

  const open: number = source.indexOf("{", source.indexOf(")", start));
  let depth: number = 0;

  for (let i: number = open; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(open, i + 1);
      }
    }
  }

  throw new Error(`Unclosed ${signature}`);
};

const flush: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("where each activation milestone is set", () => {
  let reached: Array<ReachMilestoneData>;

  beforeEach(() => {
    reached = [];

    jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation((data: ReachMilestoneData): void => {
        reached.push(data);
      });
    jest
      .spyOn(ProjectMilestoneService, "isKnownReached")
      .mockReturnValue(false);
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("first check result: a stored monitor result", () => {
    beforeEach(() => {
      // The row itself is not this test's: its retention is never answered.
      jest
        .spyOn(MonitorLogUtil, "getRetentionDays")
        .mockReturnValue(new Promise<number>(() => {}));
    });

    test("a result stored for a project's monitor reaches it", () => {
      MonitorLogUtil.saveMonitorLog({
        monitorId: ObjectID.generate(),
        projectId: PROJECT_A,
        dataToProcess: {} as DataToProcess,
        keepResponseContent: false,
      });

      expect(reached).toEqual([
        {
          projectId: PROJECT_A,
          milestone: ActivationMilestone.FirstCheckResultReceived,
        },
      ]);
    });

    test("nothing is reached when nothing is stored", () => {
      MonitorLogUtil.saveMonitorLog({
        monitorId: undefined as unknown as ObjectID,
        projectId: PROJECT_A,
        dataToProcess: {} as DataToProcess,
        keepResponseContent: false,
      });
      MonitorLogUtil.saveMonitorLog({
        monitorId: ObjectID.generate(),
        projectId: undefined as unknown as ObjectID,
        dataToProcess: {} as DataToProcess,
        keepResponseContent: false,
      });
      MonitorLogUtil.saveMonitorLog({
        monitorId: ObjectID.generate(),
        projectId: PROJECT_A,
        dataToProcess: undefined as unknown as DataToProcess,
        keepResponseContent: false,
      });

      expect(reached).toEqual([]);
    });

    test("results are stored only after monitorResource's refusals: every save comes after the last refusal", () => {
      const source: string = readSource("Utils/Monitor/MonitorResource.ts");
      const lastRefusal: number = Math.max(
        source.indexOf("ExceptionMessages.MonitorArchived"),
        source.indexOf("ExceptionMessages.MonitorDisabled"),
        source.indexOf("ExceptionMessages.ProbeNotAssignedToMonitor"),
        source.indexOf("ProjectService.isProjectBlocked"),
      );

      expect(lastRefusal).toBeGreaterThan(0);

      let at: number = source.indexOf("MonitorLogUtil.saveMonitorLog(");
      let saves: number = 0;

      while (at >= 0) {
        expect(at).toBeGreaterThan(lastRefusal);
        saves++;
        at = source.indexOf("MonitorLogUtil.saveMonitorLog(", at + 1);
      }

      expect(saves).toBeGreaterThan(0);
    });
  });

  describe("first status page that shows a monitor", () => {
    const createResource: (data: {
      monitorId?: ObjectID;
      monitorGroupId?: ObjectID;
    }) => Promise<void> = async (data: {
      monitorId?: ObjectID;
      monitorGroupId?: ObjectID;
    }): Promise<void> => {
      const resource: StatusPageResource = new StatusPageResource();
      resource.projectId = PROJECT_A;

      if (data.monitorId) {
        resource.monitorId = data.monitorId;
      }

      if (data.monitorGroupId) {
        resource.monitorGroupId = data.monitorGroupId;
      }

      await (
        StatusPageResourceService as unknown as {
          onCreateSuccess: (
            onCreate: unknown,
            item: StatusPageResource,
          ) => Promise<StatusPageResource>;
        }
      ).onCreateSuccess({}, resource);
    };

    test("a monitor put on a page reaches it", async () => {
      await createResource({ monitorId: ObjectID.generate() });

      expect(reached).toEqual([
        {
          projectId: PROJECT_A,
          milestone: ActivationMilestone.FirstStatusPageMonitorAdded,
        },
      ]);
    });

    test("so does a monitor group", async () => {
      await createResource({ monitorGroupId: ObjectID.generate() });

      expect(reached).toHaveLength(1);
    });

    test("a resource that shows no monitor does not", async () => {
      await createResource({});

      expect(reached).toEqual([]);
    });
  });

  describe("first status page subscriber who can be sent updates", () => {
    const noteConfirmed: (ids: Array<ObjectID>) => Promise<void> = async (
      ids: Array<ObjectID>,
    ): Promise<void> => {
      await (
        StatusPageSubscriberService as unknown as {
          noteSubscribersConfirmed: (ids: Array<ObjectID>) => Promise<void>;
        }
      ).noteSubscribersConfirmed(ids);
    };

    test("subscribers who confirm reach it for each of their projects, read as confirmed and subscribed", async () => {
      const findBySpy: SpyInstance<typeof StatusPageSubscriberService.findBy> =
        jest
          .spyOn(StatusPageSubscriberService, "findBy")
          .mockResolvedValue([
            Object.assign(new StatusPageSubscriber(), { projectId: PROJECT_A }),
            Object.assign(new StatusPageSubscriber(), { projectId: PROJECT_B }),
          ]);

      await noteConfirmed([ObjectID.generate(), ObjectID.generate()]);

      expect(reached).toEqual([
        {
          projectId: PROJECT_A,
          milestone: ActivationMilestone.FirstStatusPageSubscriberAdded,
        },
        {
          projectId: PROJECT_B,
          milestone: ActivationMilestone.FirstStatusPageSubscriberAdded,
        },
      ]);

      const query: Record<string, unknown> = findBySpy.mock.calls[0]![0]
        .query as Record<string, unknown>;

      expect(query["isSubscriptionConfirmed"]).toBe(true);
      expect(query["isUnsubscribed"]).toBe(false);
    });

    test("a read that fails is logged and never fails the confirmation", async () => {
      jest
        .spyOn(StatusPageSubscriberService, "findBy")
        .mockRejectedValue(new Error("database is down"));

      await expect(
        noteConfirmed([ObjectID.generate()]),
      ).resolves.toBeUndefined();
      expect(reached).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    test("only a confirmed, subscribed subscriber reaches it on create, and a confirmation reaches it on update", () => {
      const source: string = readSource(
        "Services/StatusPageSubscriberService.ts",
      );
      const onCreate: string = methodBody(
        source,
        "protected override async onCreateSuccess(",
      );
      const onUpdate: string = methodBody(
        source,
        "protected override async onUpdateSuccess(",
      );

      expect(onCreate).toMatch(
        /if \(createdItem\.isSubscriptionConfirmed && !createdItem\.isUnsubscribed\) \{\s*ProjectMilestoneService\.reachInBackground\(\{\s*projectId: createdItem\.projectId,\s*milestone: ActivationMilestone\.FirstStatusPageSubscriberAdded,/,
      );
      expect(onUpdate).toMatch(
        /onUpdate\.updateBy\.data\.isSubscriptionConfirmed === true &&\s*updatedItemIds\.length > 0\s*\) \{\s*await this\.noteSubscribersConfirmed\(updatedItemIds\);/,
      );
    });
  });

  describe("first notification delivered: an on-call page that reached a person", () => {
    const noteDelivered: (
      status: unknown,
      deliveries: Array<UserOnCallLogTimeline>,
    ) => void = (
      status: unknown,
      deliveries: Array<UserOnCallLogTimeline>,
    ): void => {
      (
        UserOnCallLogTimelineService as unknown as {
          noteDelivered: (
            status: unknown,
            deliveries: Array<UserOnCallLogTimeline>,
          ) => void;
        }
      ).noteDelivered(status, deliveries);
    };

    const delivery: (projectId: ObjectID) => UserOnCallLogTimeline = (
      projectId: ObjectID,
    ): UserOnCallLogTimeline => {
      return Object.assign(new UserOnCallLogTimeline(), {
        projectId: projectId,
      });
    };

    test("a page its provider accepted, answered, passed on or that rang reaches it, for each page's project", () => {
      for (const status of [
        UserNotificationStatus.Sent,
        UserNotificationStatus.Acknowledged,
        UserNotificationStatus.PassedOn,
        UserNotificationStatus.NotAnswered,
      ]) {
        reached = [];
        noteDelivered(status, [delivery(PROJECT_A), delivery(PROJECT_B)]);

        expect(reached).toEqual([
          {
            projectId: PROJECT_A,
            milestone: ActivationMilestone.FirstNotificationDelivered,
          },
          {
            projectId: PROJECT_B,
            milestone: ActivationMilestone.FirstNotificationDelivered,
          },
        ]);
      }
    });

    test("a page still on its way, one that failed or one skipped does not", () => {
      for (const status of [
        UserNotificationStatus.Sending,
        UserNotificationStatus.Error,
        UserNotificationStatus.Skipped,
        undefined,
        (): string => {
          return "Sent";
        },
      ]) {
        noteDelivered(status, [delivery(PROJECT_A)]);
      }

      expect(reached).toEqual([]);
    });

    test("both a page written as delivered and one updated to it are noted", () => {
      const source: string = readSource(
        "Services/UserOnCallLogTimelineService.ts",
      );
      const onCreate: string = methodBody(
        source,
        "protected override async onCreateSuccess(",
      );
      const onUpdate: string = methodBody(
        source,
        "protected override async onUpdateSuccess(",
      );

      expect(onCreate).toContain(
        "this.noteDelivered(createdItem.status, [createdItem]);",
      );
      expect(onUpdate).toContain(
        "this.noteDelivered(onUpdate.updateBy.data.status, deliveries);",
      );
      // The deliveries are read with their project.
      expect(onUpdate).toMatch(/select: \{[\s\S]*?projectId: true,[\s\S]*?\}/);
    });
  });

  describe("second person joined", () => {
    const noteJoined: (
      projectIds: Array<ObjectID | null | undefined>,
    ) => void = (projectIds: Array<ObjectID | null | undefined>): void => {
      (
        TeamMemberService as unknown as {
          noteSecondMemberJoined: (
            projectIds: Array<ObjectID | null | undefined>,
          ) => void;
        }
      ).noteSecondMemberJoined(projectIds);
    };

    test("a project two different people have accepted reaches it; one with one person does not", async () => {
      jest
        .spyOn(TeamMemberService, "hasTwoAcceptedMembers")
        .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
          return projectId.toString() === PROJECT_A.toString();
        });

      noteJoined([PROJECT_A, PROJECT_B, null]);
      await flush();

      expect(reached).toEqual([
        {
          projectId: PROJECT_A,
          milestone: ActivationMilestone.SecondMemberJoined,
        },
      ]);
    });

    test("each project is counted once however many of its rows changed, and not at all once it has the milestone", async () => {
      const countSpy: SpyInstance<
        typeof TeamMemberService.hasTwoAcceptedMembers
      > = jest
        .spyOn(TeamMemberService, "hasTwoAcceptedMembers")
        .mockResolvedValue(true);

      noteJoined([PROJECT_A, new ObjectID(PROJECT_A.toString()), PROJECT_A]);
      await flush();

      expect(countSpy).toHaveBeenCalledTimes(1);

      (ProjectMilestoneService.isKnownReached as jest.Mock).mockReturnValue(
        true,
      );
      countSpy.mockClear();

      noteJoined([PROJECT_A]);
      await flush();

      expect(countSpy).not.toHaveBeenCalled();
    });

    test("a count that fails is logged, never thrown", async () => {
      jest
        .spyOn(TeamMemberService, "hasTwoAcceptedMembers")
        .mockRejectedValue(new Error("database is down"));

      expect(() => {
        noteJoined([PROJECT_A]);
      }).not.toThrow();
      await flush();

      expect(reached).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    test("it is checked when somebody is added already accepted and when somebody accepts", () => {
      const source: string = readSource("Services/TeamMemberService.ts");
      const onCreate: string = methodBody(
        source,
        "protected override async onCreateSuccess(",
      );
      const onUpdate: string = methodBody(
        source,
        "protected override async onUpdateSuccess(",
      );

      expect(onCreate).toMatch(
        /if \(createdItem\.hasAcceptedInvitation\) \{\s*this\.noteSecondMemberJoined\(/,
      );
      expect(onUpdate).toMatch(
        /if \(updateBy\.data\.hasAcceptedInvitation\) \{\s*this\.noteSecondMemberJoined\(/,
      );
    });
  });

  describe("the hooks deep in a create's success path", () => {
    test("first monitor: in MonitorService.onCreateSuccess, after its required ids are checked", () => {
      const body: string = methodBody(
        readSource("Services/MonitorService.ts"),
        "protected override async onCreateSuccess(",
      );
      const reach: number = body.indexOf(
        "milestone: ActivationMilestone.FirstMonitorCreated",
      );

      expect(reach).toBeGreaterThan(0);
      expect(reach).toBeGreaterThan(
        body.indexOf(
          'throw new BadDataException("The new monitor has no status to start in.")',
        ),
      );
    });

    test("first acknowledgement: on an acknowledged state a person wrote, for incidents and alerts alike", () => {
      for (const file of [
        "Services/IncidentStateTimelineService.ts",
        "Services/AlertStateTimelineService.ts",
      ]) {
        const body: string = methodBody(
          readSource(file),
          "protected override async onCreateSuccess(",
        );

        expect(body).toMatch(
          /if \(\s*isAcknowledged &&\s*\(createdItem\.createdByUserId \|\| onCreate\.createBy\.props\.userId\)\s*\) \{\s*ProjectMilestoneService\.reachInBackground\(\{\s*projectId: createdItem\.projectId,\s*milestone: ActivationMilestone\.FirstIncidentOrAlertAcknowledged,/,
        );
        // isAcknowledged is the product's one rule, read before it.
        expect(body.indexOf("const isAcknowledged: boolean")).toBeLessThan(
          body.indexOf("ActivationMilestone.FirstIncidentOrAlertAcknowledged"),
        );
      }
    });

    test("first on-call policy run: after an archived policy's log and a direct page have returned", () => {
      const body: string = methodBody(
        readSource("Services/OnCallDutyPolicyExecutionLogService.ts"),
        "protected override async onCreateSuccess(",
      );
      const reach: number = body.indexOf(
        "milestone: ActivationMilestone.FirstOnCallPolicyExecuted",
      );

      expect(reach).toBeGreaterThan(0);
      expect(reach).toBeGreaterThan(body.indexOf("?.isPolicyArchived"));
      expect(reach).toBeGreaterThan(
        body.indexOf("isOnCallDirectPage(createdItem)"),
      );
    });

    test("first status page monitor: after the resource is created, under its monitor or group", () => {
      const body: string = methodBody(
        readSource("Services/StatusPageResourceService.ts"),
        "protected override async onCreateSuccess(",
      );

      expect(body).toMatch(
        /if \(createdItem\.monitorId \|\| createdItem\.monitorGroupId\) \{\s*ProjectMilestoneService\.reachInBackground\(/,
      );
    });

    test("first telemetry: collected when the rows are handed over, kept only once ClickHouse accepted them", () => {
      const body: string = methodBody(
        readSource("Utils/Telemetry/TelemetryFanInWriter.ts"),
        "public async submit(",
      );

      expect(body).toContain("TelemetryMilestones.collect(tableName, rows);");
      expect(body).toMatch(
        /flushed\.then\(\s*\(\): void => \{\s*TelemetryMilestones\.markReached\(pendingMilestones\);\s*\},\s*\(\): void => \{/,
      );
    });
  });
});
