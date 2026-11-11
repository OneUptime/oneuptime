/*
 * The record services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
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
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../../Types/ObjectID";
import { OnCallAcknowledgePageState } from "../../../../Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT A MESSAGE'S ACKNOWLEDGE PAGE READS TO KNOW WHETHER IT STILL OFFERS
 * ACKNOWLEDGE (OnCallAcknowledgePage, issue #6706): the run the page is part
 * of, and where the record it shows stands. Each read is best effort on its
 * own - one that fails never takes Acknowledge away - and the run is read
 * with every column that tells a page again, a person's page and an
 * observer's page apart, since those are not ended by the record being
 * acknowledged.
 */

const RUN: ObjectID = new ObjectID("0f670601-0000-4000-8000-000000000001");
const RECORD: ObjectID = new ObjectID("0f670601-0000-4000-8000-000000000002");
const PERSON: ObjectID = new ObjectID("0f670601-0000-4000-8000-0000000000a0");
const ANA: ObjectID = new ObjectID("0f670601-0000-4000-8000-0000000000a1");

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

let findRun: jest.SpiedFunction<
  typeof OnCallDutyPolicyExecutionLogService.findOneById
>;
let recordState: jest.SpiedFunction<
  typeof OnCallAcknowledgementTimeout.readRecordState
>;

beforeEach(() => {
  jest.restoreAllMocks();

  findRun = jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "findOneById")
    .mockResolvedValue(run());

  recordState = jest
    .spyOn(OnCallAcknowledgementTimeout, "readRecordState")
    .mockResolvedValue({ isAcknowledged: false, isResolved: false });
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

  test("a colleague's acknowledgement, read off the record", async () => {
    recordState.mockResolvedValue({ isAcknowledged: true, isResolved: false });

    expect(
      await OnCallAcknowledgePageAnswerReader.read({
        timelineItem: item(),
        reference: INCIDENT,
        run: run({
          acknowledgedAt: new Date(),
          acknowledgedByUserId: ANA,
          acknowledgedByUser: { name: "Ana Lopez" } as never,
        }),
      }),
    ).toEqual({
      state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
      acknowledgedByName: "Ana Lopez",
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
          timelineItem: item({ onCallDutyPolicyExecutionLogId: undefined }),
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
