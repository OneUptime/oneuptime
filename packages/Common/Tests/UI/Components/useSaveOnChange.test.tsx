import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  renderHook,
  RenderHookResult,
} from "@testing-library/react";
import { SaveState } from "../../../UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
  SaveOnChangeOptions,
} from "../../../UI/Components/SaveStatus/useSaveOnChange";

/*
 * A setting that saves the moment it changes, with no Save button: a
 * dropdown, a set of chips (the status page's uptime precision and the
 * statuses that count as downtime use it).
 *
 * What it promises: the change shows at once and is saved at once; the
 * control is never locked, so a change made while one is saved waits its
 * turn and the record ends up with the last one, one request at a time; a
 * change back to what the record has sends nothing; a refusal puts back
 * what the record has, with the reason; and a change the setting turns down
 * itself sends nothing and says why.
 *
 * The fake save never answers on its own: each test settles the requests
 * itself, in the order the case is about.
 */

interface SaveRequest {
  value: string;
  succeed: () => Promise<void>;
  fail: (message: string) => Promise<void>;
}

interface FakeSave {
  requests: Array<SaveRequest>;
  save: (value: string) => Promise<void>;
}

const createFakeSave: () => FakeSave = (): FakeSave => {
  const requests: Array<SaveRequest> = [];

  return {
    requests,
    save: (value: string): Promise<void> => {
      return new Promise<void>(
        (resolve: () => void, reject: (error: Error) => void): void => {
          requests.push({
            value,
            succeed: async (): Promise<void> => {
              await act(async () => {
                resolve();
              });
            },
            fail: async (message: string): Promise<void> => {
              await act(async () => {
                reject(new Error(message));
              });
            },
          });
        },
      );
    },
  };
};

type Hook = RenderHookResult<
  SaveOnChange<string>,
  SaveOnChangeOptions<string>
>;

const renderSetting: (
  options: Partial<SaveOnChangeOptions<string>> & {
    save: (value: string) => Promise<void>;
  },
) => Hook = (
  options: Partial<SaveOnChangeOptions<string>> & {
    save: (value: string) => Promise<void>;
  },
): Hook => {
  return renderHook(
    (props: SaveOnChangeOptions<string>) => {
      return useSaveOnChange<string>(props);
    },
    {
      initialProps: {
        initialValue: "two",
        ...options,
      },
    },
  );
};

const change: (hook: Hook, value: string) => Promise<void> = async (
  hook: Hook,
  value: string,
): Promise<void> => {
  await act(async () => {
    hook.result.current.change(value);
  });
};

afterEach(() => {
  cleanup();
});

describe("useSaveOnChange", () => {
  test("starts as the record has it, with nothing to say", () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });

    expect(hook.result.current.value).toBe("two");
    expect(hook.result.current.savedValue).toBe("two");
    expect(hook.result.current.saveState).toBe(SaveState.Idle);
    expect(hook.result.current.error).toBe("");
    expect(fake.requests).toHaveLength(0);
  });

  test("a change shows at once, is saved at once, and says Saving… then Saved", async () => {
    const fake: FakeSave = createFakeSave();
    const saved: Array<string> = [];
    const hook: Hook = renderSetting({
      save: fake.save,
      onSaved: (value: string): void => {
        saved.push(value);
      },
    });

    await change(hook, "three");

    expect(hook.result.current.value).toBe("three");
    expect(hook.result.current.savedValue).toBe("two");
    expect(hook.result.current.saveState).toBe(SaveState.Saving);
    expect(fake.requests.map((request: SaveRequest) => {
      return request.value;
    })).toEqual(["three"]);

    await fake.requests[0]!.succeed();

    expect(hook.result.current.value).toBe("three");
    expect(hook.result.current.savedValue).toBe("three");
    expect(hook.result.current.saveState).toBe(SaveState.Saved);
    expect(saved).toEqual(["three"]);
  });

  test("a change to what the record has sends nothing", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });

    await change(hook, "two");

    expect(fake.requests).toHaveLength(0);
    expect(hook.result.current.saveState).toBe(SaveState.Idle);
  });

  test("a change made while one is saved waits its turn, and only the last waiting change is sent", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });

    await change(hook, "three");
    await change(hook, "four");
    await change(hook, "five");

    // One request at a time, while the control shows the last change.
    expect(fake.requests).toHaveLength(1);
    expect(hook.result.current.value).toBe("five");
    expect(hook.result.current.saveState).toBe(SaveState.Saving);

    await fake.requests[0]!.succeed();

    expect(fake.requests.map((request: SaveRequest) => {
      return request.value;
    })).toEqual(["three", "five"]);
    expect(hook.result.current.saveState).toBe(SaveState.Saving);

    await fake.requests[1]!.succeed();

    expect(fake.requests).toHaveLength(2);
    expect(hook.result.current.value).toBe("five");
    expect(hook.result.current.savedValue).toBe("five");
    expect(hook.result.current.saveState).toBe(SaveState.Saved);
  });

  test("a waiting change back to what the record has by then sends nothing", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });

    await change(hook, "three");
    await change(hook, "three");

    await fake.requests[0]!.succeed();

    expect(fake.requests).toHaveLength(1);
    expect(hook.result.current.saveState).toBe(SaveState.Saved);
  });

  test("a change back to the start while the first is saved is saved after it, so the record ends as the control shows", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });

    await change(hook, "three");
    await change(hook, "two");

    await fake.requests[0]!.succeed();

    expect(fake.requests.map((request: SaveRequest) => {
      return request.value;
    })).toEqual(["three", "two"]);

    await fake.requests[1]!.succeed();

    expect(hook.result.current.savedValue).toBe("two");
    expect(hook.result.current.value).toBe("two");
  });

  test("a refused change puts back what the record has, with the reason, and drops a change waiting its turn", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });
    const revision: number = hook.result.current.revision;

    await change(hook, "three");
    await change(hook, "four");

    await fake.requests[0]!.fail("Please upgrade your plan.");

    expect(hook.result.current.value).toBe("two");
    expect(hook.result.current.savedValue).toBe("two");
    expect(hook.result.current.error).toBe("Please upgrade your plan.");
    expect(hook.result.current.saveState).toBe(SaveState.Idle);
    expect(hook.result.current.revision).toBe(revision + 1);
    // "four" went with it.
    expect(fake.requests).toHaveLength(1);
  });

  test("a new change clears the last refusal", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });

    await change(hook, "three");
    await fake.requests[0]!.fail("Refused.");

    await change(hook, "four");

    expect(hook.result.current.error).toBe("");
    await fake.requests[1]!.succeed();
    expect(hook.result.current.savedValue).toBe("four");
  });

  test("refuse() turns a change down without saving: what was last asked for stays, with why", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });
    const revision: number = hook.result.current.revision;

    await act(async () => {
      hook.result.current.refuse("Keep at least one.");
    });

    expect(fake.requests).toHaveLength(0);
    expect(hook.result.current.value).toBe("two");
    expect(hook.result.current.error).toBe("Keep at least one.");
    expect(hook.result.current.saveState).toBe(SaveState.Idle);
    // A control keeping its own copy is told to follow.
    expect(hook.result.current.revision).toBe(revision + 1);
  });

  test("refuse() while a change is saved keeps that change and its Saving…", async () => {
    const fake: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: fake.save });

    await change(hook, "three");

    await act(async () => {
      hook.result.current.refuse("Keep at least one.");
    });

    expect(hook.result.current.value).toBe("three");
    expect(hook.result.current.saveState).toBe(SaveState.Saving);
    expect(hook.result.current.error).toBe("Keep at least one.");

    await fake.requests[0]!.succeed();

    expect(hook.result.current.savedValue).toBe("three");
    expect(hook.result.current.saveState).toBe(SaveState.Saved);
  });

  test("a setting that is a list compares with isSame: the same items in another order send nothing", async () => {
    const requests: Array<Array<string>> = [];
    const hook: RenderHookResult<
      SaveOnChange<Array<string>>,
      SaveOnChangeOptions<Array<string>>
    > = renderHook(
      (props: SaveOnChangeOptions<Array<string>>) => {
        return useSaveOnChange<Array<string>>(props);
      },
      {
        initialProps: {
          initialValue: ["a", "b"],
          isSame: (first: Array<string>, second: Array<string>): boolean => {
            return [...first].sort().join() === [...second].sort().join();
          },
          save: async (value: Array<string>): Promise<void> => {
            requests.push(value);
          },
        },
      },
    );

    await act(async () => {
      hook.result.current.change(["b", "a"]);
    });

    expect(requests).toEqual([]);

    await act(async () => {
      hook.result.current.change(["b"]);
    });

    expect(requests).toEqual([["b"]]);
    expect(hook.result.current.saveState).toBe(SaveState.Saved);
  });

  test("saves with the latest render's options", async () => {
    const first: FakeSave = createFakeSave();
    const second: FakeSave = createFakeSave();
    const hook: Hook = renderSetting({ save: first.save });

    hook.rerender({ initialValue: "two", save: second.save });

    await change(hook, "three");

    expect(first.requests).toHaveLength(0);
    expect(second.requests).toHaveLength(1);
  });
});
