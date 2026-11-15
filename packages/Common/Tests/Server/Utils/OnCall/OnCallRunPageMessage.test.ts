/*
 * The execution log service reaches the isolated-vm native addon through
 * the template renderer it imports. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallRunPageMessage from "../../../../Server/Utils/OnCall/OnCallRunPageMessage";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import { ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH } from "../../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A POLICY A PAGE STARTS IS CREATED WITH ITS MESSAGE (#7838).
 *
 * A page from Slack or Microsoft Teams that names an on-call policy starts
 * it as the person who paged, and keeps what they wrote on the run
 * (pageMessage), a column no caller may write. Written after the run was
 * created, it came too late for the notifications its first level sends as
 * it is created - the first people the person asked for were never told it.
 * The run is now created inside OnCallRunPageMessage.startWith, and the
 * service writes the message on it as it is created, once every check on
 * the caller has passed (onCreatePermitted).
 */

const USER: ObjectID = new ObjectID("07838001-0000-4000-8000-000000000001");
const WORKFLOW: ObjectID = new ObjectID("07838001-0000-4000-8000-000000000002");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OnCallRunPageMessage: the message a run is created with", () => {
  test("the first run created inside it takes the message, once", async () => {
    const taken: Array<string | undefined> =
      await OnCallRunPageMessage.startWith(
        "Can you check the database?",
        async (): Promise<Array<string | undefined>> => {
          return [OnCallRunPageMessage.take(), OnCallRunPageMessage.take()];
        },
      );

    expect(taken).toEqual(["Can you check the database?", undefined]);
  });

  test("it is what `start` gives back", async () => {
    await expect(
      OnCallRunPageMessage.startWith("hi", async (): Promise<number> => {
        return 42;
      }),
    ).resolves.toBe(42);
    await expect(
      OnCallRunPageMessage.startWith("", async (): Promise<number> => {
        return 7;
      }),
    ).resolves.toBe(7);
  });

  test("a run created later in the same page - after awaits, deep inside - still takes it, once", async () => {
    const taken: string | undefined = await OnCallRunPageMessage.startWith(
      "Can you check the database?",
      async (): Promise<string | undefined> => {
        await Promise.resolve();
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 1);
        });

        return await (async (): Promise<string | undefined> => {
          return OnCallRunPageMessage.take();
        })();
      },
    );

    expect(taken).toBe("Can you check the database?");
  });

  test("kept as a page keeps it: on one line, its ends trimmed, cut to its longest", async () => {
    const taken: string | undefined = await OnCallRunPageMessage.startWith(
      "  Can you check\n\nthe   database? ",
      async (): Promise<string | undefined> => {
        return OnCallRunPageMessage.take();
      },
    );

    expect(taken).toBe("Can you check the database?");

    const long: string | undefined = await OnCallRunPageMessage.startWith(
      "word ".repeat(300),
      async (): Promise<string | undefined> => {
        return OnCallRunPageMessage.take();
      },
    );

    expect(long!.length).toBeLessThanOrEqual(
      ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH,
    );
    expect(long!.endsWith("…")).toBe(true);
  });

  test.each([
    ["no message", undefined],
    ["a null message", null],
    ["an empty message", ""],
    ["white space only", " \n\t "],
  ])("%s: nothing to take", async (_name: string, message: unknown) => {
    const taken: string | undefined = await OnCallRunPageMessage.startWith(
      message as string | null | undefined,
      async (): Promise<string | undefined> => {
        return OnCallRunPageMessage.take();
      },
    );

    expect(taken).toBeUndefined();
  });

  test("outside it, there is never one to take", () => {
    expect(OnCallRunPageMessage.take()).toBeUndefined();
  });

  test("two pages at the same time each take their own", async () => {
    const [first, second] = await Promise.all([
      OnCallRunPageMessage.startWith(
        "first",
        async (): Promise<string | undefined> => {
          await new Promise((resolve: (value: unknown) => void) => {
            setTimeout(resolve, 5);
          });
          return OnCallRunPageMessage.take();
        },
      ),
      OnCallRunPageMessage.startWith(
        "second",
        async (): Promise<string | undefined> => {
          return OnCallRunPageMessage.take();
        },
      ),
    ]);

    expect(first).toBe("first");
    expect(second).toBe("second");
  });

  test("what the run's create leaves behind - a timer that fires later - takes nothing more", async () => {
    let later: Promise<string | undefined> | null = null;

    await OnCallRunPageMessage.startWith("hi", async (): Promise<void> => {
      OnCallRunPageMessage.take();

      later = new Promise((resolve: (value: string | undefined) => void) => {
        setTimeout(() => {
          resolve(OnCallRunPageMessage.take());
        }, 1);
      });
    });

    await expect(later).resolves.toBeUndefined();
  });
});

describe("a run is written with the message as it is created, once its caller is checked", () => {
  interface Permitted {
    onCreatePermitted: (onCreate: {
      createBy: {
        data: OnCallDutyPolicyExecutionLog;
        props: DatabaseCommonInteractionProps;
      };
      carryForward: unknown;
    }) => Promise<void>;
  }

  const service: Permitted =
    OnCallDutyPolicyExecutionLogService as unknown as Permitted;

  function newRun(): OnCallDutyPolicyExecutionLog {
    return new OnCallDutyPolicyExecutionLog();
  }

  function resolvedRecordIsNotRead(): jest.SpyInstance {
    return jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService as unknown as {
          readResolvedRecordKind: () => Promise<string | null>;
        },
        "readResolvedRecordKind",
      )
      .mockResolvedValue(null);
  }

  test("a run a person starts inside startWith is written with the message", async () => {
    resolvedRecordIsNotRead();
    const run: OnCallDutyPolicyExecutionLog = newRun();

    await OnCallRunPageMessage.startWith(
      "Can you check the database?",
      async (): Promise<void> => {
        await service.onCreatePermitted({
          createBy: { data: run, props: { userId: USER } },
          carryForward: null,
        });
      },
    );

    expect(run.pageMessage).toBe("Can you check the database?");
  });

  test("only the first run created inside it: a second is written with none", async () => {
    resolvedRecordIsNotRead();
    const first: OnCallDutyPolicyExecutionLog = newRun();
    const second: OnCallDutyPolicyExecutionLog = newRun();

    await OnCallRunPageMessage.startWith(
      "Can you check the database?",
      async (): Promise<void> => {
        for (const run of [first, second]) {
          await service.onCreatePermitted({
            createBy: { data: run, props: { userId: USER } },
            carryForward: null,
          });
        }
      },
    );

    expect(first.pageMessage).toBe("Can you check the database?");
    expect(second.pageMessage).toBeUndefined();
  });

  test("a run created outside it is written with no message", async () => {
    const run: OnCallDutyPolicyExecutionLog = newRun();

    await service.onCreatePermitted({
      createBy: { data: run, props: { isRoot: true } },
      carryForward: null,
    });

    expect(run.pageMessage).toBeUndefined();
  });

  test("a run refused for its resolved record takes no message", async () => {
    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService as unknown as {
          readResolvedRecordKind: () => Promise<string | null>;
        },
        "readResolvedRecordKind",
      )
      .mockResolvedValue("incident");

    const run: OnCallDutyPolicyExecutionLog = newRun();

    const left: string | undefined = await OnCallRunPageMessage.startWith(
      "Can you check the database?",
      async (): Promise<string | undefined> => {
        await expect(
          service.onCreatePermitted({
            createBy: { data: run, props: { userId: USER } },
            carryForward: null,
          }),
        ).rejects.toThrow("This incident is resolved");

        return OnCallRunPageMessage.take();
      },
    );

    expect(run.pageMessage).toBeUndefined();
    // Still there for nothing: the page's context ends with it.
    expect(left).toBe("Can you check the database?");
  });

  test("a workflow's run inside it keeps the workflow, and the message", async () => {
    const run: OnCallDutyPolicyExecutionLog = newRun();

    await OnCallRunPageMessage.startWith("db down", async (): Promise<void> => {
      await service.onCreatePermitted({
        createBy: {
          data: run,
          props: {
            userId: USER,
            workflowId: WORKFLOW,
            workflowName: "Page the DBAs",
          },
        },
        carryForward: null,
      });
    });

    expect(run.triggeredByWorkflowId).toEqual(WORKFLOW);
    expect(run.triggeredByWorkflowName).toBe("Page the DBAs");
    expect(run.pageMessage).toBe("db down");
  });
});
