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
  acknowledgeOnCallPagesAgain,
  fetchOnCallPassOnPages,
  passOnOnCallPages,
  type OnCallPageRecordType,
  type OnCallPassOnAnswer,
  type OnCallPassOnPage,
} from "../api/onCallPassOn";
import { PAGE_AGAIN_TEXT } from "../oncall/passOn";
import { PAGE_AGAIN_ACTION_MIN_WIDTH } from "../components/ResponseDetailLayout";
import {
  createQueryWrapper,
  createTestQueryClient,
} from "../__tests__/testSupport";

jest.mock("../api/onCallPassOn", () => {
  return {
    fetchOnCallPassOnPages: jest.fn(),
    passOnOnCallPages: jest.fn(),
    acknowledgeOnCallPagesAgain: jest.fn(),
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
 * "Escalate" on a detail screen. A push notification about a page opens the
 * screen of what it is about; the person who cannot take it escalates it
 * from there. The button is there for them only - for anybody the policy is
 * not paging, and whenever the server cannot be asked, there is none and the
 * screen is as it was. Pressing it asks first, in the words of the
 * Dashboard's dialog - "Escalate Incident?", what escalating will do, then
 * "You will not be paged again for this incident." - and only "Escalate" in
 * that question escalates it. Then it says what it did, or why there was
 * nothing to escalate. The action was called "Pass it on" before.
 */

const fetchMock: jest.MockedFunction<typeof fetchOnCallPassOnPages> =
  fetchOnCallPassOnPages as jest.MockedFunction<typeof fetchOnCallPassOnPages>;
const passOnMock: jest.MockedFunction<typeof passOnOnCallPages> =
  passOnOnCallPages as jest.MockedFunction<typeof passOnOnCallPages>;
const acknowledgeAgainMock: jest.MockedFunction<
  typeof acknowledgeOnCallPagesAgain
> = acknowledgeOnCallPagesAgain as jest.MockedFunction<
  typeof acknowledgeOnCallPagesAgain
>;

const PAGE: OnCallPassOnPage = {
  executionLogId: "run-1",
  policyName: "Payments",
  sentence:
    "This will immediately page Platform leads (Level 2 of 3), without waiting.",
};

const PASSED: OnCallPassOnAnswer = {
  passedOn: true,
  policyName: "Payments",
  sentence: "The policy is now paging Platform leads (Level 2 of 3): Sam Lee.",
};

// What a screen calls each kind of record, for a screen reader.
const LABELS: Record<OnCallPageRecordType, string> = {
  incident: "incident",
  alert: "alert",
  "incident-episode": "incident episode",
  "alert-episode": "alert episode",
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
        recordLabel: LABELS[args.recordType || "incident"],
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
  acknowledgeAgainMock.mockReset();
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

  test("the person being paged: Escalate, named for a screen reader, with an arrow up the levels", async () => {
    fetchMock.mockResolvedValue([PAGE]);
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(rendered.result.current.action).not.toBeNull();
    });
    expect(rendered.result.current.action).toMatchObject({
      label: "Escalate",
      accessibilityLabel: "Escalate this incident",
      busyAccessibilityLabel: "Escalating",
      icon: "arrow-up-circle-outline",
    });
    expect(rendered.result.current.action!.primary).toBeFalsy();
  });
});

/*
 * An observer's page (oncall/observerPage.ts) is answered with "I've seen
 * it" (useObserverPageAction): there is nothing for an observer to escalate,
 * so it never brings the button, and never counts as a page of theirs here.
 */
describe("an observer's page", () => {
  const OBSERVER_PAGE: OnCallPassOnPage = {
    ...PAGE,
    executionLogId: "run-observer",
    isObserverPage: true,
  };

  test("alone brings no Escalate, and is no open page for a push's Escalate", async () => {
    fetchMock.mockResolvedValue([OBSERVER_PAGE]);
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(rendered.result.current.pagesSettled).toBe(true);
    });
    expect(rendered.result.current.action).toBeNull();
    expect(rendered.result.current.acknowledgeAgainAction).toBeNull();
    expect(rendered.result.current.hasOpenPages).toBe(false);
    expect(rendered.result.current.pagesKnown).toBe(true);
  });

  test("beside a responder's page, Escalate asks about the responder's only", async () => {
    fetchMock.mockResolvedValue([
      {
        ...OBSERVER_PAGE,
        sentence: "Observers: this will page the next level of observers.",
      },
      PAGE,
    ]);
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(rendered.result.current.action).not.toBeNull();
    });
    expect(rendered.result.current.hasOpenPages).toBe(true);

    await act(async () => {
      rendered.result.current.askToPassOn();
    });

    expect(lastAlert().message).toContain(PAGE.sentence);
    expect(lastAlert().message).not.toContain("Observers:");
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

  test("asks first, in the maintainer's words; Cancel escalates nothing", async () => {
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });

    expect(lastAlert().title).toBe("Escalate Incident?");
    expect(lastAlert().message).toBe(
      `${PAGE.sentence}\n\nYou will not be paged again for this incident.`,
    );
    expect(
      lastAlert().buttons!.map((button: AlertButton) => {
        return [button.text, button.style];
      }),
    ).toEqual([
      ["Cancel", "cancel"],
      ["Escalate", undefined],
    ]);

    pressInLastAlert("Cancel");
    expect(passOnMock).not.toHaveBeenCalled();
  });

  test("Escalate: escalates it, says what it did, and the button goes", async () => {
    const onPassedOn: jest.Mock<() => Promise<void>> = jest.fn(
      async (): Promise<void> => {
        return undefined;
      },
    );
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client, { onPassedOn });

    passOnMock.mockResolvedValue([PASSED]);
    // Read again after escalating: no longer paged.
    fetchMock.mockResolvedValue([]);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Escalate");
    });

    await waitFor(() => {
      return expect(lastAlert().title).toBe("Incident escalated");
    });
    expect(passOnMock).toHaveBeenCalledWith(
      "project-1",
      "incident",
      "incident-1",
    );
    expect(lastAlert().message).toBe(
      `${PASSED.sentence}\n\nYou will not be paged again for this incident.`,
    );
    expect(mockSuccessFeedback).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      return expect(rendered.result.current.action).toBeNull();
    });
    expect(onPassedOn).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.passingOn).toBe(false);
  });

  test("My Pages is told: the page shows as escalated there", async () => {
    const client: QueryClient = createTestQueryClient();
    const invalidate: jest.SpiedFunction<QueryClient["invalidateQueries"]> =
      jest.spyOn(client, "invalidateQueries");
    const rendered: HookRender = await pagedAndReady(client);

    passOnMock.mockResolvedValue([PASSED]);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Escalate");
    });

    await waitFor(() => {
      return expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["oncall", "my-pages"],
      });
    });
  });

  test("somebody acknowledged it meanwhile: it says why, and the screen is not told of an escalation", async () => {
    const onPassedOn: jest.Mock<() => void> = jest.fn();
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await pagedAndReady(client, { onPassedOn });

    passOnMock.mockResolvedValue([
      {
        passedOn: false,
        policyName: "",
        sentence:
          "It was already acknowledged by Ana Lopez, so there is nothing to escalate.",
      },
    ]);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });
    await act(async () => {
      pressInLastAlert("Escalate");
    });

    await waitFor(() => {
      return expect(lastAlert().title).toBe("Nothing to escalate");
    });
    expect(lastAlert().message).toBe(
      "It was already acknowledged by Ana Lopez, so there is nothing to escalate.",
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
      pressInLastAlert("Escalate");
    });

    await waitFor(() => {
      return expect(lastAlert().title).toBe("Error");
    });
    expect(lastAlert().message).toBe("Could not escalate. Please try again.");
    expect(mockErrorFeedback).toHaveBeenCalledTimes(1);
    // Still paged, so the button is still there to try again.
    expect(rendered.result.current.action).not.toBeNull();
    expect(rendered.result.current.passingOn).toBe(false);
  });

  test("while it escalates, the screen's buttons are busy", async () => {
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
      pressInLastAlert("Escalate");
    });

    expect(rendered.result.current.passingOn).toBe(true);

    await act(async () => {
      finish([PASSED]);
    });

    await waitFor(() => {
      return expect(rendered.result.current.passingOn).toBe(false);
    });
  });

  test.each<[OnCallPageRecordType, string, string, string]>([
    [
      "alert",
      "Escalate Alert?",
      "Alert escalated",
      "You will not be paged again for this alert.",
    ],
    [
      "incident-episode",
      "Escalate Episode?",
      "Episode escalated",
      "You will not be paged again for this episode.",
    ],
    [
      "alert-episode",
      "Escalate Episode?",
      "Episode escalated",
      "You will not be paged again for this episode.",
    ],
  ])(
    "%s: asks about its own kind of record, in its own words",
    async (
      recordType: OnCallPageRecordType,
      question: string,
      doneTitle: string,
      notPagedAgain: string,
    ) => {
      const client: QueryClient = createTestQueryClient();
      const rendered: HookRender = await pagedAndReady(client, {
        recordType,
        recordId: "record-9",
      });

      expect(rendered.result.current.action!.accessibilityLabel).toBe(
        `Escalate this ${LABELS[recordType]}`,
      );

      passOnMock.mockResolvedValue([PASSED]);

      await act(async () => {
        await rendered.result.current.action!.onPress();
      });

      expect(lastAlert().title).toBe(question);
      expect(lastAlert().message).toBe(`${PAGE.sentence}\n\n${notPagedAgain}`);

      await act(async () => {
        pressInLastAlert("Escalate");
      });

      await waitFor(() => {
        return expect(lastAlert().title).toBe(doneTitle);
      });
      expect(lastAlert().message).toBe(
        `${PASSED.sentence}\n\n${notPagedAgain}`,
      );

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
describe("a page again: Acknowledge again", () => {
  /*
   * The policy's acknowledgement timeout ran out with the record still
   * acknowledged and not resolved, and it pages the reader again. The
   * record's own Acknowledge is gone - it is acknowledged - so the reader gets
   * Acknowledge again of their own, which answers their page in one step, as
   * its link, a call's 1 or a text does. Nobody else sees it.
   */
  const PAGE_AGAIN: OnCallPassOnPage = { ...PAGE, isPageAgain: true };

  test("only a page again offers it - first and filled - beside Escalate", async () => {
    fetchMock.mockResolvedValue([PAGE_AGAIN]);
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(
        rendered.result.current.acknowledgeAgainAction,
      ).not.toBeNull();
    });
    expect(rendered.result.current.isPageAgain).toBe(true);
    expect(rendered.result.current.hasOpenPages).toBe(true);
    expect(rendered.result.current.action).not.toBeNull();
    expect(rendered.result.current.acknowledgeAgainAction).toMatchObject({
      label: PAGE_AGAIN_TEXT.button,
      accessibilityLabel: "Acknowledge this incident again",
      busyAccessibilityLabel: "Acknowledging",
      icon: "eye-outline",
      primary: true,
      // Two words that never break across lines: a row of its own on a phone.
      minWidth: PAGE_AGAIN_ACTION_MIN_WIDTH,
    });
    // Escalate keeps the row's own minimum.
    expect(rendered.result.current.action?.minWidth).toBeUndefined();
    expect(PAGE_AGAIN_TEXT.button).toBe("Acknowledge again");
  });

  /*
   * A page somebody asked for by hand - sent from a chat, or a policy
   * started by hand - about a record somebody else acknowledged is answered
   * the same way, but the reader was paged to help, not paged again: the
   * screen words it apart (isPagedToHelp). A page again among the reader's
   * pages is said as one: they took the record before.
   */
  test("a page somebody asked for offers it too, and says the reader is paged to help - unless a page again is among their pages", async () => {
    const ASKED_FOR: OnCallPassOnPage = {
      ...PAGE,
      executionLogId: "run-asked",
      isPageAgain: true,
      isAskedFor: true,
    };

    for (const [pages, isPagedToHelp] of [
      [[ASKED_FOR], true],
      [[ASKED_FOR, PAGE], true],
      [[ASKED_FOR, PAGE_AGAIN], false],
      [[PAGE_AGAIN], false],
    ] as Array<[Array<OnCallPassOnPage>, boolean]>) {
      fetchMock.mockResolvedValue(pages);
      const client: QueryClient = createTestQueryClient();

      const rendered: HookRender = await renderPassOn(client);

      await waitFor(() => {
        return expect(rendered.result.current.pagesSettled).toBe(true);
      });
      expect(rendered.result.current.acknowledgeAgainAction).toMatchObject({
        label: PAGE_AGAIN_TEXT.button,
        primary: true,
      });
      expect(rendered.result.current.isPageAgain).toBe(true);
      expect(rendered.result.current.isPagedToHelp).toBe(isPagedToHelp);
    }
  });

  test("a first page, and no page at all, offer none", async () => {
    for (const pages of [[PAGE], [PAGE, { ...PAGE, isPageAgain: false }], []]) {
      fetchMock.mockResolvedValue(pages);
      const client: QueryClient = createTestQueryClient();

      const rendered: HookRender = await renderPassOn(client);

      await waitFor(() => {
        return expect(rendered.result.current.pagesSettled).toBe(true);
      });
      expect(rendered.result.current.acknowledgeAgainAction).toBeNull();
      expect(rendered.result.current.isPageAgain).toBe(false);
      expect(rendered.result.current.isPagedToHelp).toBe(false);
    }
  });

  test("it answers the page in one step - no question - says nothing on success, and the button goes", async () => {
    fetchMock.mockResolvedValueOnce([PAGE_AGAIN]).mockResolvedValue([]);
    acknowledgeAgainMock.mockResolvedValue(1);
    const onPassedOn: jest.Mock<() => Promise<void>> = jest.fn(
      async (): Promise<void> => {
        return undefined;
      },
    );
    const client: QueryClient = createTestQueryClient();
    const invalidate: jest.SpiedFunction<QueryClient["invalidateQueries"]> =
      jest.spyOn(client, "invalidateQueries");

    const rendered: HookRender = await renderPassOn(client, { onPassedOn });

    await waitFor(() => {
      return expect(
        rendered.result.current.acknowledgeAgainAction,
      ).not.toBeNull();
    });

    await act(async () => {
      await rendered.result.current.acknowledgeAgainAction!.onPress();
    });

    expect(acknowledgeAgainMock).toHaveBeenCalledWith(
      "project-1",
      "incident",
      "incident-1",
    );
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockSuccessFeedback).toHaveBeenCalledTimes(1);
    // The record's feed has news, and My Pages shows the page acknowledged.
    expect(onPassedOn).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["oncall", "my-pages"],
    });
    await waitFor(() => {
      return expect(rendered.result.current.acknowledgeAgainAction).toBeNull();
    });
    expect(rendered.result.current.acknowledgingAgain).toBe(false);
  });

  test("nothing left to answer - acknowledged elsewhere first - is no success, and no news", async () => {
    fetchMock.mockResolvedValueOnce([PAGE_AGAIN]).mockResolvedValue([]);
    acknowledgeAgainMock.mockResolvedValue(0);
    const onPassedOn: jest.Mock<() => void> = jest.fn();
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client, { onPassedOn });

    await waitFor(() => {
      return expect(
        rendered.result.current.acknowledgeAgainAction,
      ).not.toBeNull();
    });
    await act(async () => {
      await rendered.result.current.acknowledgeAgain();
    });

    expect(mockSuccessFeedback).not.toHaveBeenCalled();
    expect(onPassedOn).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    // Read again all the same: the button goes.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a failure says so under its own title, and the button stays: the page goes on", async () => {
    fetchMock.mockResolvedValue([PAGE_AGAIN]);
    acknowledgeAgainMock.mockRejectedValue(
      new Error("Request failed with 503"),
    );
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(
        rendered.result.current.acknowledgeAgainAction,
      ).not.toBeNull();
    });
    await act(async () => {
      await rendered.result.current.acknowledgeAgain();
    });

    expect(mockErrorFeedback).toHaveBeenCalledTimes(1);
    expect(lastAlert()).toEqual({
      title: "Could not acknowledge",
      message: "You are still being paged. Please try again.",
      buttons: undefined,
    });
    expect(rendered.result.current.acknowledgeAgainAction).not.toBeNull();
    expect(rendered.result.current.acknowledgingAgain).toBe(false);
  });

  test("busy while it asks, so the screen's buttons wait", async () => {
    fetchMock.mockResolvedValue([PAGE_AGAIN]);
    let finish: (value: number) => void = (): void => {
      // Set below.
    };
    acknowledgeAgainMock.mockImplementation(() => {
      return new Promise<number>((resolve: (value: number) => void) => {
        finish = resolve;
      });
    });
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderPassOn(client);

    await waitFor(() => {
      return expect(
        rendered.result.current.acknowledgeAgainAction,
      ).not.toBeNull();
    });
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = rendered.result.current.acknowledgeAgain();
      await Promise.resolve();
    });
    expect(rendered.result.current.acknowledgingAgain).toBe(true);

    await act(async () => {
      finish(1);
      await pending;
    });
    expect(rendered.result.current.acknowledgingAgain).toBe(false);
  });
});

describe("what a push's action reads from the hook", () => {
  test("whether the pages are settled, and known: an answer, a failure, and no record yet", async () => {
    fetchMock.mockResolvedValue([PAGE]);
    const answered: HookRender = await renderPassOn(createTestQueryClient());

    await waitFor(() => {
      return expect(answered.result.current.pagesSettled).toBe(true);
    });
    expect(answered.result.current.pagesKnown).toBe(true);

    fetchMock.mockRejectedValue(new Error("Network Error"));
    const failed: HookRender = await renderPassOn(createTestQueryClient());

    await waitFor(() => {
      return expect(failed.result.current.pagesSettled).toBe(true);
    });
    expect(failed.result.current.pagesKnown).toBe(false);
    expect(failed.result.current.hasOpenPages).toBe(false);

    // Nothing to ask about: settled at once, and not known.
    const none: HookRender = await renderPassOn(createTestQueryClient(), {
      recordId: "",
    });
    expect(none.result.current.pagesSettled).toBe(true);
    expect(none.result.current.pagesKnown).toBe(false);
  });

  test("askToPassOn asks exactly what the screen's Escalate asks", async () => {
    fetchMock.mockResolvedValue([PAGE]);
    const rendered: HookRender = await renderPassOn(createTestQueryClient());

    await waitFor(() => {
      return expect(rendered.result.current.action).not.toBeNull();
    });

    await act(async () => {
      rendered.result.current.askToPassOn();
    });
    const fromPush: ReturnType<typeof lastAlert> = lastAlert();

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });

    expect(fromPush.title).toBe("Escalate Incident?");
    expect(lastAlert().title).toBe(fromPush.title);
    expect(lastAlert().message).toBe(fromPush.message);
    expect(
      (fromPush.buttons ?? []).map((button: AlertButton) => {
        return button.text;
      }),
    ).toEqual(["Cancel", "Escalate"]);
  });
});
