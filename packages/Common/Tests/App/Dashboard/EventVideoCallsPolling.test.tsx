import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react";
import useEventVideoCalls, {
  CALL_SUMMARY_POLL_INTERVAL_MS,
  EventVideoCallsState,
  VideoCallEventKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/useEventVideoCalls";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import {
  CALL_SUMMARY_STALE_AFTER_MS,
  CallSummaryStatus,
} from "../../../Types/VideoCall/CallSummary";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  INCIDENT_ID,
  TRANSCRIPT_INFO,
  suggestedCall,
  transcriptCall,
} from "./CallTranscriptFixtures";

/*
 * WHILE ONEUPTIME AI READS A CALL'S TRANSCRIPT, the incident page looks
 * again every few seconds, so what it found appears without a reload - and
 * stops once the reading is done, or has gone on so long it stopped
 * somewhere. A look that fails keeps the calls on screen and does not end
 * the looking.
 */

type Answer = Array<IncidentVideoCall> | Error;

let answers: Array<Answer>;
let getList: ReturnType<typeof jest.spyOn>;

function reading(): IncidentVideoCall {
  return transcriptCall({
    info: TRANSCRIPT_INFO,
    status: CallSummaryStatus.Pending,
    statusMinutesAgo: 0,
  });
}

function renderCalls(): { result: { current: EventVideoCallsState } } {
  return renderHook(() => {
    return useEventVideoCalls({
      kind: VideoCallEventKind.Incident,
      eventId: new ObjectID(INCIDENT_ID),
    });
  });
}

async function nextLook(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(CALL_SUMMARY_POLL_INTERVAL_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["Date"] });

  answers = [];
  getList = jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    const answer: Answer | undefined =
      answers.length > 1 ? answers.shift() : answers[0];

    if (answer instanceof Error) {
      throw answer;
    }

    return {
      data: answer || [],
      count: (answer || []).length,
      skip: 0,
      limit: 20,
    } as ListResult<IncidentVideoCall>;
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("looking again while OneUptime AI reads", () => {
  test("looks again every few seconds until the reading is done, then stops", async () => {
    answers = [[reading()], [reading()], [suggestedCall()]];

    const { result } = renderCalls();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });
    expect(getList).toHaveBeenCalledTimes(1);

    await nextLook();
    await waitFor(() => {
      expect(getList).toHaveBeenCalledTimes(2);
    });

    await nextLook();
    await waitFor(() => {
      expect(
        (result.current.calls[0] as IncidentVideoCall).callSummaryStatus,
      ).toBe(CallSummaryStatus.Ready);
    });
    expect(getList).toHaveBeenCalledTimes(3);

    // Done: nothing more to wait for.
    await nextLook();
    await nextLook();
    expect(getList).toHaveBeenCalledTimes(3);
  });

  test("a look that fails keeps the calls on screen and does not end the looking", async () => {
    answers = [[reading()], new Error("Network error"), [suggestedCall()]];

    const { result } = renderCalls();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    await nextLook();
    await waitFor(() => {
      expect(getList).toHaveBeenCalledTimes(2);
    });
    // The failed look changed nothing on screen.
    expect(result.current.error).toBeUndefined();
    expect(result.current.calls).toHaveLength(1);

    await nextLook();
    await waitFor(() => {
      expect(
        (result.current.calls[0] as IncidentVideoCall).callSummaryStatus,
      ).toBe(CallSummaryStatus.Ready);
    });
  });

  test("never looks again for calls nobody is reading", async () => {
    answers = [[suggestedCall(), transcriptCall()]];

    const { result } = renderCalls();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    await nextLook();
    await nextLook();

    expect(getList).toHaveBeenCalledTimes(1);
  });

  test("a reading that has gone on too long is not waited on: the page offers it again instead", async () => {
    answers = [
      [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Pending,
          statusMinutesAgo: CALL_SUMMARY_STALE_AFTER_MS / 60000 + 1,
        }),
      ],
    ];

    const { result } = renderCalls();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    await nextLook();

    expect(getList).toHaveBeenCalledTimes(1);
  });
});
