import { Alert, type AlertButton } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { usePassOnAction, type PassOnControls } from "./usePassOnAction";
import {
  fetchOnCallPassOnPages,
  passOnOnCallPages,
  type OnCallPageRecordType,
  type OnCallPassOnAnswer,
  type OnCallPassOnPage,
} from "../api/onCallPassOn";
import {
  createQueryWrapper,
  createTestQueryClient,
} from "../__tests__/testSupport";

jest.mock("../api/onCallPassOn", () => {
  return {
    fetchOnCallPassOnPages: jest.fn(),
    passOnOnCallPages: jest.fn(),
  };
});

const mockSuccessFeedback: jest.Mock<() => Promise<void>> = jest.fn(
  async (): Promise<void> => {
    return undefined;
  },
);
const mockErrorFeedback: jest.Mock<() => Promise<void>> = jest.fn(
  async (): Promise<void> => {
    return undefined;
  },
);

jest.mock("./useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: mockSuccessFeedback,
        errorFeedback: mockErrorFeedback,
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

/*
 * "Pass it on" on a detail screen. A push notification about a page opens
 * the screen of what it is about; the person who cannot take it passes it
 * on from there. The button is there for them only - for anybody the policy
 * is not paging, and whenever the server cannot be asked, there is none and
 * the screen is as it was. Pressing it asks first, saying what passing on
 * will do; only "Pass it on" in that question passes it on. Then it says
 * what it did, or why there was nothing to pass on.
 */

const fetchMock: jest.MockedFunction<typeof fetchOnCallPassOnPages> =
  fetchOnCallPassOnPages as jest.MockedFunction<typeof fetchOnCallPassOnPages>;
const passOnMock: jest.MockedFunction<typeof passOnOnCallPages> =
  passOnOnCallPages as jest.MockedFunction<typeof passOnOnCallPages>;

const PAGE: OnCallPassOnPage = {
  executionLogId: "run-1",
  policyName: "Payments",
  sentence:
    "Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
};

const PASSED: OnCallPassOnAnswer = {
  passedOn: true,
  policyName: "Payments",
  sentence: "Escalation rule 2 of 3 (Level 2) is paging Sam Lee now.",
};

interface HookArgs {
  recordType: OnCallPageRecordType;
  recordId: string;
  onPassedOn?: () => Promise<unknown> | void;
}

interface HookRender {
  result: { current: PassOnControls };
}

async function renderPassOn(
  client: QueryClient,
  args: Partial<HookArgs> = {},
): Promise<HookRender> {
  return renderHook(
    () => {
      return usePassOnAction({
        projectId: "project-1",
        recordType: args.recordType || "incident",
        recordId: args.recordId ?? "incident-1",
        recordLabel: "incident",
        onPassedOn: args.onPassedOn,
      });
    },
    { wrapper: createQueryWrapper(client) },
  );
}

let alertSpy: jest.SpiedFunction<typeof Alert.alert>;

// The buttons of the last Alert shown.
function lastAlert(): {
  title: string;
  message: string | undefined;
  buttons: AlertButton[] | undefined;
} {
  const calls: Array<Parameters<typeof Alert.alert>> = alertSpy.mock.calls;
  const [title, message, buttons] = calls[calls.length - 1]!;

  return { title, message, buttons };
}

function pressInLastAlert(text: string): void {
  const button: AlertButton | undefined = lastAlert().buttons?.find(
    (candidate: AlertButton) => {
      return candidate.text === text;
    },
  );

  expect(button).toBeDefined();
  button!.onPress?.();
}

beforeEach(() => {
  fetchMock.mockReset();
  passOnMock.mockReset();
  mockSuccessFeedback.mockClear();
  mockErrorFeedback.mockClear();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe("who sees the button", () => {
  test("somebody the policy is not paging: no button", async () => {
    fetchMock.mockResolvedValue([]);
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(rendered.result.current.action).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "project-1",
      "incident",
      "incident-1",
    );
  });

  test("the server cannot be asked: no button, and no error on the screen", async () => {
    fetchMock.mockRejectedValue(new Error("Network Error"));
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(fetchMock).toHaveBeenCalled();
    });
    expect(rendered.result.current.action).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("before the record's id is known, nothing is asked", async () => {
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client, { recordId: "" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rendered.result.current.action).toBeNull();
  });

  test("the person being paged: Pass it on, named for a screen reader", async () => {
    fetchMock.mockResolvedValue([PAGE]);
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(rendered.result.current.action).not.toBeNull();
    });
    expect(rendered.result.current.action).toMatchObject({
      label: "Pass it on",
      accessibilityLabel: "Pass this incident page on",
      icon: "play-skip-forward-outline",
    });
    expect(rendered.result.current.action!.primary).toBeFalsy();
  });
});

describe("pressing it", () => {
  async function pagedAndReady(
    client: QueryClient,
    args: Partial<HookArgs> = {},
  ): Promise<HookRender> {
    fetchMock.mockResolvedValue([PAGE]);
    const rendered: HookRender = await renderPassOn(client, args);

    await waitFor(() => {
      return expect(rendered.result.current.action).not.toBeNull();
    });

    return rendered;
  }

  test("asks first, saying what passing on will do; Cancel passes nothing on", async () => {
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });

    expect(lastAlert().title).toBe("Pass it on?");
    expect(lastAlert().message).toBe(
      `You won't be paged about it again.\n\n${PAGE.sentence}`,
    );
    expect(
      lastAlert().buttons!.map((button: AlertButton) => {
        return [button.text, button.style];
      }),
    ).toEqual([
      ["Cancel", "cancel"],
      ["Pass it on", undefined],
    ]);

    pressInLastAlert("Cancel");
    expect(passOnMock).not.toHaveBeenCalled();
  });

  test("Pass it on: passes it on, says what it did, and the button goes", async () => {
    const onPassedOn: jest.Mock<() => Promise<void>> = jest.fn(
      async (): Promise<void> => {
        return undefined;
      },
    );
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client, { onPassedOn });

    passOnMock.mockResolvedValue([PASSED]);
    // Read again after passing on: no longer paged.
    fetchMock.mockResolvedValue([]);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Pass it on");
    });

    await waitFor(() => {
      return expect(lastAlert().title).toBe("You passed it on");
    });
    expect(passOnMock).toHaveBeenCalledWith(
      "project-1",
      "incident",
      "incident-1",
    );
    expect(lastAlert().message).toBe(
      `${PASSED.sentence}\n\nYou won't be paged about it again.`,
    );
    expect(mockSuccessFeedback).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      return expect(rendered.result.current.action).toBeNull();
    });
    expect(onPassedOn).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.passingOn).toBe(false);
  });

  test("My Pages is told: the page shows as passed on there", async () => {
    const client: QueryClient = createTestQueryClient();
    const invalidate: jest.SpiedFunction<QueryClient["invalidateQueries"]> =
      jest.spyOn(client, "invalidateQueries");
    const rendered: HookRender = await pagedAndReady(client);

    passOnMock.mockResolvedValue([PASSED]);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Pass it on");
    });

    await waitFor(() => {
      return expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["oncall", "my-pages"],
      });
    });
  });

  test("somebody acknowledged it meanwhile: it says why, and the screen is not told of a pass", async () => {
    const onPassedOn: jest.Mock<() => void> = jest.fn();
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client, { onPassedOn });

    passOnMock.mockResolvedValue([
      {
        passedOn: false,
        policyName: "",
        sentence:
          "It was already acknowledged by Ana Lopez, so there is nothing to pass on.",
      },
    ]);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Pass it on");
    });

    await waitFor(() => {
      return expect(lastAlert().title).toBe("Nothing to pass on");
    });
    expect(lastAlert().message).toBe(
      "It was already acknowledged by Ana Lopez, so there is nothing to pass on.",
    );
    expect(onPassedOn).not.toHaveBeenCalled();
    expect(mockSuccessFeedback).not.toHaveBeenCalled();
  });

  test("a failed request says so, and can be tried again", async () => {
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client);

    passOnMock.mockRejectedValueOnce(new Error("Network Error"));

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Pass it on");
    });

    await waitFor(() => {
      return expect(lastAlert().title).toBe("Error");
    });
    expect(lastAlert().message).toBe("Could not pass it on. Please try again.");
    expect(mockErrorFeedback).toHaveBeenCalledTimes(1);
    // Still paged, so the button is still there to try again.
    expect(rendered.result.current.action).not.toBeNull();
    expect(rendered.result.current.passingOn).toBe(false);
  });

  test("while it passes on, the screen's buttons are busy", async () => {
    let finish: (answers: OnCallPassOnAnswer[]) => void = (): void => {
      return undefined;
    };

    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client);

    passOnMock.mockReturnValue(
      new Promise<OnCallPassOnAnswer[]>(
        (resolve: (answers: OnCallPassOnAnswer[]) => void) => {
          finish = resolve;
        },
      ),
    );

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Pass it on");
    });

    expect(rendered.result.current.passingOn).toBe(true);

    await act(async () => {
      finish([PASSED]);
    });

    await waitFor(() => {
      return expect(rendered.result.current.passingOn).toBe(false);
    });
  });

  test.each<[OnCallPageRecordType]>([
    ["alert"],
    ["incident-episode"],
    ["alert-episode"],
  ])(
    "%s: asks about its own kind of record",
    async (recordType: OnCallPageRecordType) => {
      const client: QueryClient = createTestQueryClient();
      const rendered: HookRender = await pagedAndReady(client, {
        recordType,
        recordId: "record-9",
      });

      passOnMock.mockResolvedValue([PASSED]);

      await act(async () => {
        await rendered.result.current.action!.onPress();
      });
      await act(async () => {
        pressInLastAlert("Pass it on");
      });

      await waitFor(() => {
        return expect(passOnMock).toHaveBeenCalledWith(
          "project-1",
          recordType,
          "record-9",
        );
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "project-1",
        recordType,
        "record-9",
      );
    },
  );
});
