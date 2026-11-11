/*
 * The record services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import UserService from "../../../../Server/Services/UserService";
import OnCallAcknowledgePageAnswerReader, {
  ACKNOWLEDGE_PAGE_RUN_SELECT,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgePageAnswer";
import OnCallAcknowledgementTimeout from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import {
  DashboardPathByResourceType,
  OnCallNotificationResourceReference,
  OnCallNotificationResourceType,
} from "../../../../Server/Utils/OnCallNotificationContext";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../../Types/ObjectID";
import { OnCallAcknowledgePageState } from "../../../../Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT A MESSAGE'S ACKNOWLEDGE PAGE READS TO KNOW WHETHER IT STILL OFFERS
 * ACKNOWLEDGE (OnCallAcknowledgePage, issue #6706): the run the page is part
 * of, where the record it shows stands, and who took it there and when
 * (issue #6711), with their names. Each read is best effort on its own - one
 * that fails never takes Acknowledge away - and the run is read with every
 * column that tells a page again, a person's page and an observer's page
 * apart, since those are not ended by the record being acknowledged.
 */

const RUN: ObjectID = new ObjectID("0f670601-0000-4000-8000-000000000001");
const RECORD: ObjectID = new ObjectID("0f670601-0000-4000-8000-000000000002");
const PERSON: ObjectID = new ObjectID("0f670601-0000-4000-8000-0000000000a0");
const ANA: ObjectID = new ObjectID("0f670601-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("0f670601-0000-4000-8000-0000000000a2");
const ACKNOWLEDGED_AT: Date = new Date("2026-11-11T02:15:00.000Z");
const RESOLVED_AT: Date = new Date("2026-11-11T04:40:00.000Z");
const ANSWERED_AT: Date = new Date("2026-11-11T03:01:35.000Z");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana Lopez",
  [BOB.toString()]: "Bob Smith",
  [PERSON.toString()]: "Sam Rivera",
};

function reference(
  resourceType: OnCallNotificationResourceType,
): OnCallNotificationResourceReference {
  return {
    resourceType: resourceType,
    dashboardPath: DashboardPathByResourceType[resourceType],
    resourceId: RECORD,
  };
}

function item(
  overrides: Partial<UserOnCallLogTimeline> = {},
): UserOnCallLogTimeline {
  const timelineItem: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  timelineItem.userId = PERSON;
  timelineItem.onCallDutyPolicyExecutionLogId = RUN;
  timelineItem.triggeredByIncidentId = RECORD;
  Object.assign(timelineItem, overrides);
  return timelineItem;
}

function run(
  overrides: Partial<OnCallDutyPolicyExecutionLog> = {},
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = RUN;
  log.onCallDutyPolicyId = new ObjectID("0f670601-0000-4000-8000-0000000000b1");
  Object.assign(log, overrides);
  return log;
}

// A message that is part of no run.
function withoutRun(
  timelineItem: UserOnCallLogTimeline,
): UserOnCallLogTimeline {
  delete timelineItem.onCallDutyPolicyExecutionLogId;
  return timelineItem;
}

let findRun: jest.SpyInstance;
let recordState: jest.SpyInstance;
let findUser: jest.SpyInstance;

beforeEach(() => {
  jest.restoreAllMocks();

  findRun = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockResolvedValue(run());

  recordState = jest
    .spyOn(OnCallAcknowledgementTimeout, "readRecordStanding")
    .mockResolvedValue({ isAcknowledged: false, isResolved: false });

  findUser = jest
    .spyOn(UserService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      const user: User = new User();
      user.id = data.id;
      user.name = NAMES[data.id.toString()] as never;
      return user;
    }) as never);
});

describe("readRun: the run a page is part of", () => {
  test("is read with every column that tells its kind and its answer apart", () => {
    /*
     * A page a person asked for is told apart by three columns together
     * (isOnCallPersonPage): a run read without one of them would look like
     * a responder's page, and lose its Acknowledge once its incident was
     * acknowledged.
     */
    expect(ACKNOWLEDGE_PAGE_RUN_SELECT).toEqual(
      expect.objectContaining({
        isObserverPage: true,
        pageAgainNumber: true,
        onCallDutyPolicyId: true,
        triggeredByUserId: true,
        triggeredByWorkflowId: true,
        acknowledgedAt: true,
        acknowledgedByUserId: true,
        acknowledgedByUser: { name: true, email: true },
      }),
    );
  });

  test("reads the run by its id, as OneUptime", async () => {
    await OnCallAcknowledgePageAnswerReader.readRun(RUN);

    expect(findRun).toHaveBeenCalledWith({
      id: RUN,
      select: ACKNOWLEDGE_PAGE_RUN_SELECT,
      props: { isRoot: true },
    });
  });

  test("reads nothing for a page with no run", async () => {
    expect(await OnCallAcknowledgePageAnswerReader.readRun(undefined)).toBe(
      null,
    );
    expect(await OnCallAcknowledgePageAnswerReader.readRun(null)).toBe(null);
    expect(findRun).not.toHaveBeenCalled();
  });

  test("is null, never a throw, when the run cannot be read", async () => {
    findRun.mockRejectedValue(new Error("the database is away"));

    await expect(
      OnCallAcknowledgePageAnswerReader.readRun(RUN),
    ).resolves.toBeNull();
  });
});

describe("readRecord: where the record the page shows stands", () => {
  test.each([
    [OnCallNotificationResourceType.Incident, "incident"],
    [OnCallNotificationResourceType.Alert, "alert"],
    [OnCallNotificationResourceType.IncidentEpisode, "incident episode"],
    [OnCallNotificationResourceType.AlertEpisode, "alert episode"],
  ])(
    "a page about an %s reads it as the %s it is",
    async (resourceType: OnCallNotificationResourceType, kind: string) => {
      await OnCallAcknowledgePageAnswerReader.readRecord(
        reference(resourceType),
      );

      expect(recordState).toHaveBeenCalledWith({
        kind: kind,
        recordId: RECORD,
      });
    },
  );

  test("hands on whether it is acknowledged and whether it is resolved", async () => {
    recordState.mockResolvedValue({ isAcknowledged: true, isResolved: true });

    expect(
      await OnCallAcknowledgePageAnswerReader.readRecord(
        reference(OnCallNotificationResourceType.Incident),
      ),
    ).toEqual({ isAcknowledged: true, isResolved: true });
  });

  test("is null for a page that points at nothing, with nothing read", async () => {
    expect(await OnCallAcknowledgePageAnswerReader.readRecord(null)).toBe(null);
    expect(recordState).not.toHaveBeenCalled();
  });

  test("hands on who acknowledged it and who resolved it, by name, and when", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: true,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
      resolution: { createdByUserId: BOB, startsAt: RESOLVED_AT },
    });

    expect(
      await OnCallAcknowledgePageAnswerReader.readRecord(
        reference(OnCallNotificationResourceType.Incident),
        PERSON,
      ),
    ).toEqual({
      isAcknowledged: true,
      isResolved: true,
      acknowledgement: {
        byUserId: ANA,
        byName: "Ana Lopez",
        at: ACKNOWLEDGED_AT,
      },
      resolution: { byUserId: BOB, byName: "Bob Smith", at: RESOLVED_AT },
    });
  });

  test("reads each name once, as OneUptime", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: true,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
      resolution: { createdByUserId: ANA, startsAt: RESOLVED_AT },
    });

    await OnCallAcknowledgePageAnswerReader.readRecord(
      reference(OnCallNotificationResourceType.Incident),
      PERSON,
    );

    expect(findUser).toHaveBeenCalledTimes(1);
    expect(findUser).toHaveBeenCalledWith({
      id: ANA,
      select: { name: true, email: true },
      props: { isRoot: true },
    });
  });

  test("never reads the name of the person the page is for: the page calls them you", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: PERSON, startsAt: ACKNOWLEDGED_AT },
    });

    expect(
      await OnCallAcknowledgePageAnswerReader.readRecord(
        reference(OnCallNotificationResourceType.Incident),
        PERSON,
      ),
    ).toEqual({
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { byUserId: PERSON, at: ACKNOWLEDGED_AT },
    });
    expect(findUser).not.toHaveBeenCalled();
  });

  test("a change by nobody by name reads no name, and says when", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: null, startsAt: ACKNOWLEDGED_AT },
    });

    expect(
      (
        await OnCallAcknowledgePageAnswerReader.readRecord(
          reference(OnCallNotificationResourceType.Incident),
          PERSON,
        )
      )?.acknowledgement,
    ).toEqual({ byUserId: null, at: ACKNOWLEDGED_AT });
    expect(findUser).not.toHaveBeenCalled();
  });

  test("a name that cannot be read is left out: when, without who - never a throw", async () => {
    findUser.mockRejectedValue(new Error("the database is away"));
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
    });

    expect(
      (
        await OnCallAcknowledgePageAnswerReader.readRecord(
          reference(OnCallNotificationResourceType.Incident),
          PERSON,
        )
      )?.acknowledgement,
    ).toEqual({ byUserId: ANA, at: ACKNOWLEDGED_AT });
  });

  test("a timeline that could not be read leaves who and when out, and the standing stands", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: true,
      acknowledgement: null,
      resolution: null,
    });

    expect(
      await OnCallAcknowledgePageAnswerReader.readRecord(
        reference(OnCallNotificationResourceType.Incident),
        PERSON,
      ),
    ).toEqual({ isAcknowledged: true, isResolved: true });
  });

  test("is null for a record that is gone", async () => {
    recordState.mockResolvedValue(null);

    expect(
      await OnCallAcknowledgePageAnswerReader.readRecord(
        reference(OnCallNotificationResourceType.Alert),
      ),
    ).toBe(null);
  });

  test("is null, never a throw, when the record cannot be read", async () => {
    recordState.mockRejectedValue(new Error("the database is away"));

    await expect(
      OnCallAcknowledgePageAnswerReader.readRecord(
        reference(OnCallNotificationResourceType.Incident),
      ),
    ).resolves.toBeNull();
  });
});

describe("read: what the page offers", () => {
  const INCIDENT: OnCallNotificationResourceReference = reference(
    OnCallNotificationResourceType.Incident,
  );

  test("Acknowledge, for a page nobody has answered about a record that waits", async () => {
    expect(
      await OnCallAcknowledgePageAnswerReader.read({
        timelineItem: item(),
        reference: INCIDENT,
        run: run(),
      }),
    ).toEqual({ state: OnCallAcknowledgePageState.Open });
  });

  test("this message's own answer, read off the message", async () => {
    expect(
      (
        await OnCallAcknowledgePageAnswerReader.read({
          timelineItem: item({ isAcknowledged: true }),
          reference: INCIDENT,
          run: run(),
        })
      ).state,
    ).toBe(OnCallAcknowledgePageState.AcknowledgedByYou);
  });

  test("the person's answer some other way, read off the run", async () => {
    expect(
      (
        await OnCallAcknowledgePageAnswerReader.read({
          timelineItem: item(),
          reference: INCIDENT,
          run: run({
            acknowledgedAt: new Date(),
            acknowledgedByUserId: PERSON,
          }),
        })
      ).state,
    ).toBe(OnCallAcknowledgePageState.AcknowledgedByYou);
  });

  test("a colleague's acknowledgement, read off the record's timeline: who and when", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
    });

    expect(
      await OnCallAcknowledgePageAnswerReader.read({
        timelineItem: item(),
        reference: INCIDENT,
        run: run(),
      }),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
      byName: "Ana Lopez",
      at: ACKNOWLEDGED_AT,
    });
  });

  test("with no timeline to name anybody, the run's answer says who and when", async () => {
    recordState.mockResolvedValue({ isAcknowledged: true, isResolved: false });

    expect(
      await OnCallAcknowledgePageAnswerReader.read({
        timelineItem: item(),
        reference: INCIDENT,
        run: run({
          acknowledgedAt: ANSWERED_AT,
          acknowledgedByUserId: ANA,
          acknowledgedByUser: { name: "Ana Lopez" } as never,
        }),
      }),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
      byName: "Ana Lopez",
      at: ANSWERED_AT,
    });
  });

  test("this message's own answer says when, read off the message", async () => {
    expect(
      await OnCallAcknowledgePageAnswerReader.read({
        timelineItem: item({
          isAcknowledged: true,
          acknowledgedAt: ANSWERED_AT,
        }),
        reference: INCIDENT,
        run: run(),
      }),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedByYou,
      at: ANSWERED_AT,
    });
  });

  test("the person's own acknowledgement in the Dashboard is theirs, and their name is not read", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: false,
      acknowledgement: { createdByUserId: PERSON, startsAt: ACKNOWLEDGED_AT },
    });

    expect(
      await OnCallAcknowledgePageAnswerReader.read({
        timelineItem: item(),
        reference: INCIDENT,
        run: run(),
      }),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedByYou,
      at: ACKNOWLEDGED_AT,
    });
    expect(findUser).not.toHaveBeenCalled();
  });

  test("resolved: who resolved it, and when", async () => {
    recordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: true,
      acknowledgement: { createdByUserId: ANA, startsAt: ACKNOWLEDGED_AT },
      resolution: { createdByUserId: BOB, startsAt: RESOLVED_AT },
    });

    expect(
      await OnCallAcknowledgePageAnswerReader.read({
        timelineItem: item(),
        reference: INCIDENT,
        run: run(),
      }),
    ).toEqual({
      state: OnCallAcknowledgePageState.Resolved,
      byName: "Bob Smith",
      at: RESOLVED_AT,
    });
  });

  test("a page whose run came back as nothing keeps its Acknowledge however its record stands", async () => {
    // It might be a page again, which the record being acknowledged does not end.
    recordState.mockResolvedValue({ isAcknowledged: true, isResolved: false });

    expect(
      (
        await OnCallAcknowledgePageAnswerReader.read({
          timelineItem: item(),
          reference: INCIDENT,
          run: null,
        })
      ).state,
    ).toBe(OnCallAcknowledgePageState.Open);
  });

  test("a page with no run at all is a responder's page", async () => {
    recordState.mockResolvedValue({ isAcknowledged: true, isResolved: false });

    expect(
      (
        await OnCallAcknowledgePageAnswerReader.read({
          timelineItem: withoutRun(item()),
          reference: INCIDENT,
          run: null,
        })
      ).state,
    ).toBe(OnCallAcknowledgePageState.AcknowledgedBySomeoneElse);
  });

  test("a record that cannot be read leaves Acknowledge offered", async () => {
    recordState.mockRejectedValue(new Error("the database is away"));

    expect(
      (
        await OnCallAcknowledgePageAnswerReader.read({
          timelineItem: item(),
          reference: INCIDENT,
          run: run(),
        })
      ).state,
    ).toBe(OnCallAcknowledgePageState.Open);
  });
});
