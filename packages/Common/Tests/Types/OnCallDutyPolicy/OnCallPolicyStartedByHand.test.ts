import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import { isOnCallPageEndedOnlyByAnAnswer } from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import { isOnCallPersonPage } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import {
  OnCallPolicyStartedByHandRun,
  getOnCallPolicyStartedOnResolvedRecordMessage,
  isOnCallPolicyStartedByHand,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyStartedByHand";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";

/*
 * AN ON-CALL POLICY A PERSON STARTED BY HAND (issue #7596) - Execute
 * On-Call Policy in the Dashboard, Slack or Microsoft Teams, a page that
 * names the policy - goes on until one of the people it paged answers it,
 * or its record is resolved, as a page a person asked for does. Every other
 * run of a policy - OneUptime's own, a workflow's, an API key's - ends once
 * anybody acknowledges its record, as it always did.
 */

const USER: ObjectID = new ObjectID("7596a000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("7596a000-0000-4000-8000-000000000002");
const WORKFLOW: ObjectID = new ObjectID("7596a000-0000-4000-8000-000000000003");

// A policy run Execute On-Call Policy writes, as the person who pressed it.
const STARTED_BY_HAND: OnCallPolicyStartedByHandRun = {
  onCallDutyPolicyId: POLICY,
  triggeredByUserId: USER,
  triggeredByWorkflowId: null,
  pageAgainNumber: null,
  isObserverPage: false,
  userNotificationEventType: UserNotificationEventType.IncidentCreated,
};

describe("isOnCallPolicyStartedByHand: which runs are a policy a person started by hand", () => {
  test.each([
    ["Execute On-Call Policy on an incident", STARTED_BY_HAND, true],
    [
      "the same on an alert",
      {
        ...STARTED_BY_HAND,
        userNotificationEventType: UserNotificationEventType.AlertCreated,
      },
      true,
    ],
    [
      "the same on an alert episode",
      {
        ...STARTED_BY_HAND,
        userNotificationEventType:
          UserNotificationEventType.AlertEpisodeCreated,
      },
      true,
    ],
    [
      "the same on an incident episode",
      {
        ...STARTED_BY_HAND,
        userNotificationEventType:
          UserNotificationEventType.IncidentEpisodeCreated,
      },
      true,
    ],
    [
      "with the ids as text, as a row read back can hold them",
      {
        ...STARTED_BY_HAND,
        onCallDutyPolicyId: POLICY.toString(),
        triggeredByUserId: USER.toString(),
      },
      true,
    ],
    [
      "told by the policy read with it rather than its id",
      {
        ...STARTED_BY_HAND,
        onCallDutyPolicyId: null,
        onCallDutyPolicy: { name: "Database" },
      },
      true,
    ],
    [
      "read without the event type: no test page either",
      {
        onCallDutyPolicyId: POLICY,
        triggeredByUserId: USER,
        triggeredByWorkflowId: null,
        pageAgainNumber: null,
        isObserverPage: false,
      },
      true,
    ],
    [
      "a policy OneUptime started for a new record (no person)",
      { ...STARTED_BY_HAND, triggeredByUserId: null },
      false,
    ],
    [
      "a policy an API key started (no person)",
      { ...STARTED_BY_HAND, triggeredByUserId: undefined },
      false,
    ],
    [
      "a policy a workflow started",
      {
        ...STARTED_BY_HAND,
        triggeredByUserId: null,
        triggeredByWorkflowId: WORKFLOW,
      },
      false,
    ],
    [
      "a policy a workflow started as a person",
      { ...STARTED_BY_HAND, triggeredByWorkflowId: WORKFLOW },
      false,
    ],
    [
      "a page again of a policy (OnCallAcknowledgementTimeout)",
      { ...STARTED_BY_HAND, pageAgainNumber: 1 },
      false,
    ],
    [
      "an observer's page a person started (OnCallObserverPage)",
      { ...STARTED_BY_HAND, isObserverPage: true },
      false,
    ],
    [
      "a test of a policy a person sent (OnCallTestPage)",
      {
        ...STARTED_BY_HAND,
        userNotificationEventType: UserNotificationEventType.TestPage,
      },
      false,
    ],
    [
      "a page a person asked for, with no policy (OnCallPersonPage)",
      { ...STARTED_BY_HAND, onCallDutyPolicyId: null },
      false,
    ],
    ["no run", null, false],
    ["a run read without any of the columns", {}, false],
  ])(
    "%s: %p",
    (
      _name: string,
      run: OnCallPolicyStartedByHandRun | null,
      expected: boolean,
    ) => {
      expect(isOnCallPolicyStartedByHand(run)).toBe(expected);
    },
  );

  test("a policy started by hand is no page a person asked for: its words stay a policy's", () => {
    expect(isOnCallPersonPage(STARTED_BY_HAND)).toBe(false);
  });

  test("it goes on until answered, by the one rule every worker ends runs by", () => {
    expect(isOnCallPageEndedOnlyByAnAnswer(STARTED_BY_HAND)).toBe(true);
    expect(
      isOnCallPageEndedOnlyByAnAnswer({
        ...STARTED_BY_HAND,
        triggeredByUserId: null,
      }),
    ).toBe(false);
  });
});

describe("a person starting a policy for a resolved record is told why nothing started", () => {
  test.each([
    [
      "incident",
      "This incident is resolved, so no on-call policy was started.",
    ],
    ["alert", "This alert is resolved, so no on-call policy was started."],
    [
      "incident episode",
      "This incident episode is resolved, so no on-call policy was started.",
    ],
    [
      "alert episode",
      "This alert episode is resolved, so no on-call policy was started.",
    ],
  ])("about an %s", (kind: string, message: string) => {
    expect(getOnCallPolicyStartedOnResolvedRecordMessage(kind)).toBe(message);
  });
});
