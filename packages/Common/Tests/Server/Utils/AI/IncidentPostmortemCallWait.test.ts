import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentVideoCall from "../../../../Models/DatabaseModels/IncidentVideoCall";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentVideoCallService from "../../../../Server/Services/IncidentVideoCallService";
import IncidentPostmortemCallWait from "../../../../Server/Utils/AI/SRE/IncidentPostmortemCallWait";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { CallSummaryStatus } from "../../../../Types/VideoCall/CallSummary";
import { CallTranscriptFetchStatus } from "../../../../Types/VideoCall/CallTranscriptAutoFetch";
import { VideoCallTranscriptUnavailableReason } from "../../../../Types/VideoCall/VideoCallTranscript";
import ResolvedStateUtil from "../../../../Utils/ResolvedState";
import { StateListType } from "../../../../Utils/StateOrder";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Whether an incident's postmortem draft still waits for what its calls
 * said, read from the calls' own columns (the rule itself is
 * isPostmortemWaitingForCalls), and whether the incident is still resolved
 * when a draft that waited is due.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STATE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const MINUTE: number = 60 * 1000;
const RESOLVED: Date = new Date("2026-10-19T12:00:00.000Z");

function callWith(values: Partial<IncidentVideoCall>): IncidentVideoCall {
  return Object.assign(new IncidentVideoCall(), values);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentPostmortemCallWait.isWaiting", () => {
  test("reads the incident's calls as root, with what the rule needs", async () => {
    const find: SpyInstance<typeof IncidentVideoCallService.findBy> = jest
      .spyOn(IncidentVideoCallService, "findBy")
      .mockResolvedValue([]);

    expect(
      await IncidentPostmortemCallWait.isWaiting({
        incidentId: INCIDENT,
        waitingSince: RESOLVED,
        now: RESOLVED,
      }),
    ).toBe(false);

    const findBy: JSONObject = find.mock.calls[0]![0] as unknown as JSONObject;

    expect(findBy["query"]).toEqual({ incidentId: INCIDENT });
    expect(findBy["select"]).toEqual({
      _id: true,
      transcriptAddedAt: true,
      transcriptFetchStatus: true,
      transcriptFetchReason: true,
      callSummaryStatus: true,
      callSummaryUpdatedAt: true,
    });
    expect(findBy["props"]).toEqual({ isRoot: true });
    expect(findBy["limit"]).toBe(20);
  });

  test("waits for a transcript the provider is preparing", async () => {
    jest.spyOn(IncidentVideoCallService, "findBy").mockResolvedValue([
      callWith({
        transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
        transcriptFetchReason: VideoCallTranscriptUnavailableReason.NotReady,
      }),
    ]);

    expect(
      await IncidentPostmortemCallWait.isWaiting({
        incidentId: INCIDENT,
        waitingSince: RESOLVED,
        now: new Date(RESOLVED.getTime() + 2 * 60 * MINUTE),
      }),
    ).toBe(true);
  });

  test("a call whose transcript is in counts as having one, whatever the job last said", async () => {
    jest.spyOn(IncidentVideoCallService, "findBy").mockResolvedValue([
      callWith({
        transcriptAddedAt: RESOLVED,
        transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
        callSummaryStatus: CallSummaryStatus.Ready,
      }),
    ]);

    expect(
      await IncidentPostmortemCallWait.isWaiting({
        incidentId: INCIDENT,
        waitingSince: RESOLVED,
        now: RESOLVED,
      }),
    ).toBe(false);
  });

  test("waits for a transcript OneUptime AI is still reading", async () => {
    jest.spyOn(IncidentVideoCallService, "findBy").mockResolvedValue([
      // Never read: no reading to wait for.
      callWith({ transcriptAddedAt: RESOLVED }),
      callWith({
        transcriptAddedAt: RESOLVED,
        callSummaryStatus: CallSummaryStatus.Pending,
        callSummaryUpdatedAt: RESOLVED,
      }),
    ]);

    expect(
      await IncidentPostmortemCallWait.isWaiting({
        incidentId: INCIDENT,
        waitingSince: RESOLVED,
        now: new Date(RESOLVED.getTime() + 2 * MINUTE),
      }),
    ).toBe(true);
  });
});

describe("IncidentPostmortemCallWait.isResolved", () => {
  test("by the one rule, over the project's states", async () => {
    const states: Array<IncidentState> = [new IncidentState()];
    const getStates: SpyInstance<
      typeof IncidentStateService.getAllIncidentStates
    > = jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockResolvedValue(states);
    const rule: SpyInstance<typeof ResolvedStateUtil.isResolved> = jest
      .spyOn(ResolvedStateUtil, "isResolved")
      .mockReturnValue(true);

    expect(
      await IncidentPostmortemCallWait.isResolved({
        projectId: PROJECT,
        currentIncidentStateId: STATE,
      }),
    ).toBe(true);
    expect(getStates).toHaveBeenCalledWith({
      projectId: PROJECT,
      props: { isRoot: true },
    });
    expect(rule).toHaveBeenCalledWith({
      list: StateListType.IncidentState,
      states,
      stateId: STATE,
    });
  });

  test("a state the rule does not call resolved is not", async () => {
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockResolvedValue([]);
    jest.spyOn(ResolvedStateUtil, "isResolved").mockReturnValue(false);

    expect(
      await IncidentPostmortemCallWait.isResolved({
        projectId: PROJECT,
        currentIncidentStateId: STATE,
      }),
    ).toBe(false);
  });

  test("an incident with no current state is not resolved, and nothing is read", async () => {
    const getStates: SpyInstance<
      typeof IncidentStateService.getAllIncidentStates
    > = jest.spyOn(IncidentStateService, "getAllIncidentStates");

    expect(
      await IncidentPostmortemCallWait.isResolved({
        projectId: PROJECT,
        currentIncidentStateId: undefined,
      }),
    ).toBe(false);
    expect(getStates).not.toHaveBeenCalled();
  });
});
