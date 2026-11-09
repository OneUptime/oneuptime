import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import {
  AIRunAttemptOutcome,
  AIRunFailureKind,
} from "../../../Types/AI/AIRunAttempt";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Where a run's next event goes (issue #6437). An investigation's attempts
 * number their events in blocks of their own, so the count of a run's
 * events is no longer where its next one goes: an event that says how an
 * attempt ended (the stale sweep's, a shutdown's hand-back) is numbered
 * after the run's last event instead, and so drawn after the attempt's
 * steps.
 */

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();

function lastEventAt(sequence: number | null): jest.SpyInstance {
  return jest
    .spyOn(AIRunEventService, "findBy")
    .mockResolvedValue(
      sequence === null ? [] : [{ sequence } as unknown as AIRunEvent],
    );
}

describe("AIRunEventService.getSequenceAfterLastEvent", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a run with no events starts at 0", async () => {
    lastEventAt(null);

    await expect(
      AIRunEventService.getSequenceAfterLastEvent(aiRunId),
    ).resolves.toBe(0);
  });

  test("after the run's last event, whatever the count of its events", async () => {
    // A retried run: its second attempt's block starts at a million.
    lastEventAt(1000004);

    await expect(
      AIRunEventService.getSequenceAfterLastEvent(aiRunId),
    ).resolves.toBe(1000005);
  });

  test("it reads the one last event of the run, as root", async () => {
    const findBy: jest.SpyInstance = lastEventAt(3);

    await AIRunEventService.getSequenceAfterLastEvent(aiRunId);

    expect(findBy).toHaveBeenCalledWith({
      query: { aiRunId },
      select: { sequence: true },
      sort: { sequence: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
  });
});

describe("AIRunEventService.appendEventToRun", () => {
  let create: jest.SpyInstance;
  let countBy: jest.SpyInstance;

  beforeEach(() => {
    create = jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        return (data as { data: AIRunEvent }).data;
      });
    countBy = jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(5));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function written(): AIRunEvent {
    return (create.mock.calls[0]![0] as { data: AIRunEvent }).data;
  }

  test("after the last event: how an attempt ended goes after its steps", async () => {
    lastEventAt(1000041);

    await AIRunEventService.appendEventToRun({
      projectId,
      aiRunId,
      eventType: AIRunEventType.AttemptEnded,
      resultSummary: {
        attemptEnd: {
          outcome: AIRunAttemptOutcome.Stalled,
          failureKind: AIRunFailureKind.ServerStopped,
        },
      },
      afterLastEvent: true,
    });

    expect(written().sequence).toBe(1000042);
    expect(written().eventType).toBe(AIRunEventType.AttemptEnded);
    expect(written().resultSummary?.attemptEnd?.outcome).toBe(
      AIRunAttemptOutcome.Stalled,
    );
    expect(countBy).not.toHaveBeenCalled();
  });

  test("without it, by the count of the run's events, as every other caller numbers", async () => {
    const findBy: jest.SpyInstance = lastEventAt(1000041);

    await AIRunEventService.appendEventToRun({
      projectId,
      aiRunId,
      eventType: AIRunEventType.RunFailed,
    });

    expect(written().sequence).toBe(5);
    expect(findBy).not.toHaveBeenCalled();
  });
});
