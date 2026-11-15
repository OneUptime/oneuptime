import OnCallSendAttempt from "../../../../Server/Utils/OnCall/OnCallSendAttempt";
import {
  whenNotificationRequestAnswers,
  whenNotificationRequestFails,
  whenSendFails,
} from "../../../../Server/Utils/OnCall/OnCallSendFailure";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * WHETHER A RULE'S PAGE GOT AS FAR AS A SENDER (issue #8407).
 *
 * A rule's send that fails before anything of it reached a sender gives
 * its claim back, and is sent again; one that reached a sender keeps it.
 * An attempt counts as handed to a sender from the moment a send's result
 * handler is made - which every channel does as it hands its notification
 * over - through every await of the attempt.
 */

const ROW_ID: ObjectID = new ObjectID("84070000-0000-4000-8000-000000000001");

function tick(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

describe("an attempt", () => {
  test("that hands nothing to a sender says so, also when it throws", async () => {
    const attempt: OnCallSendAttempt = OnCallSendAttempt.begin();

    await expect(
      attempt.run(async () => {
        await tick();
        throw new Error("Connection terminated unexpectedly");
      }),
    ).rejects.toThrow("Connection terminated unexpectedly");

    expect(attempt.handedToASender).toBe(false);
  });

  test("counts as handed to a sender from the send's handler on, through its awaits, and when it throws after", async () => {
    const attempt: OnCallSendAttempt = OnCallSendAttempt.begin();

    await expect(
      attempt.run(async () => {
        await tick();
        Promise.resolve().catch(
          whenSendFails({
            userOnCallLogTimelineId: ROW_ID,
            fallbackStatusMessage: "Not sent.",
          }),
        );
        await tick();
        throw new Error("The next channel's row could not be written.");
      }),
    ).rejects.toThrow();

    expect(attempt.handedToASender).toBe(true);
  });

  test.each([
    [
      "a request to the Notification service's failure handler",
      (): unknown => {
        return whenNotificationRequestFails({
          userOnCallLogTimelineId: ROW_ID,
          fallbackStatusMessage: "Not sent.",
        });
      },
    ],
    [
      "a request to the Notification service's answer handler",
      (): unknown => {
        return whenNotificationRequestAnswers({
          userOnCallLogTimelineId: ROW_ID,
        });
      },
    ],
    [
      "a send in this process's failure handler",
      (): unknown => {
        return whenSendFails({
          userOnCallLogTimelineId: ROW_ID,
          fallbackStatusMessage: "Not sent.",
        });
      },
    ],
  ])(
    "is handed to a sender by %s",
    async (_name: string, make: () => unknown) => {
      const attempt: OnCallSendAttempt = OnCallSendAttempt.begin();

      await attempt.run(async () => {
        make();
      });

      expect(attempt.handedToASender).toBe(true);
    },
  );

  test("a send's handler made outside any attempt marks nothing, and does not throw", () => {
    expect(() => {
      whenSendFails({
        userOnCallLogTimelineId: ROW_ID,
        fallbackStatusMessage: "Not sent.",
      });
      OnCallSendAttempt.markHandedToASender();
    }).not.toThrow();
  });

  test("one attempt's send is not another's: attempts run side by side keep their own", async () => {
    const sends: OnCallSendAttempt = OnCallSendAttempt.begin();
    const fails: OnCallSendAttempt = OnCallSendAttempt.begin();

    await Promise.all([
      sends.run(async () => {
        await tick();
        OnCallSendAttempt.markHandedToASender();
      }),
      fails.run(async () => {
        await tick();
        await tick();
      }),
    ]);

    expect(sends.handedToASender).toBe(true);
    expect(fails.handedToASender).toBe(false);
  });

  test("an attempt run inside another counts for both", async () => {
    const outer: OnCallSendAttempt = OnCallSendAttempt.begin();
    let inner: OnCallSendAttempt | null = null;

    await outer.run(async () => {
      inner = OnCallSendAttempt.begin();

      await inner.run(async () => {
        await tick();
        OnCallSendAttempt.markHandedToASender();
      });
    });

    expect(inner!.handedToASender).toBe(true);
    expect(outer.handedToASender).toBe(true);
  });

  test("an attempt that ended is not marked by what runs after it", async () => {
    const attempt: OnCallSendAttempt = OnCallSendAttempt.begin();

    await attempt.run(async () => {
      await tick();
    });

    OnCallSendAttempt.markHandedToASender();

    expect(attempt.handedToASender).toBe(false);
  });
});
