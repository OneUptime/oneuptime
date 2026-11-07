import { Alert } from "react-native";
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
import {
  useObserverPageAction,
  type ObserverPageControls,
} from "./useObserverPageAction";
import {
  fetchOnCallObserverPages,
  markOnCallObserverPagesSeen,
  type OnCallObserverPage,
} from "../api/onCallObserverPages";
import type { OnCallPageRecordType } from "../api/onCallPassOn";
import { OBSERVER_PAGE_TEXT } from "../oncall/observerPage";
import {
  createQueryWrapper,
  createTestQueryClient,
} from "../__tests__/testSupport";

jest.mock("../api/onCallObserverPages", () => {
  return {
    fetchOnCallObserverPages: jest.fn(),
    markOnCallObserverPagesSeen: jest.fn(),
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
 * "I've seen it" on a detail screen, for the person paged about it as an
 * observer: kept informed while others respond. The button is there for
 * them only - for anybody else, and whenever the server cannot be asked,
 * there is none and the screen is as it was. Pressing it answers their page
 * in one step, with no question, as its email's link does: the record is not
 * acknowledged, and nobody else's page stops.
 */

const fetchMock: jest.MockedFunction<typeof fetchOnCallObserverPages> =
  fetchOnCallObserverPages as jest.MockedFunction<
    typeof fetchOnCallObserverPages
  >;
const markSeenMock: jest.MockedFunction<typeof markOnCallObserverPagesSeen> =
  markOnCallObserverPagesSeen as jest.MockedFunction<
    typeof markOnCallObserverPagesSeen
  >;

const PAGE: OnCallObserverPage = {
  executionLogId: "run-1",
  policyName: "Oversight",
};

const LABELS: Record<OnCallPageRecordType, string> = {
  incident: "incident",
  alert: "alert",
  "incident-episode": "incident episode",
  "alert-episode": "alert episode",
};

interface HookArgs {
  recordType: OnCallPageRecordType;
  recordId: string;
  onSeen?: () => Promise<unknown> | void;
}

interface HookRender {
  result: { current: ObserverPageControls };
}

async function renderObserver(
  client: QueryClient,
  args: Partial<HookArgs> = {},
): Promise<HookRender> {
  return renderHook(
    () => {
      return useObserverPageAction({
        projectId: "project-1",
        recordType: args.recordType || "incident",
        recordId: args.recordId ?? "incident-1",
        recordLabel: LABELS[args.recordType || "incident"],
        onSeen: args.onSeen,
      });
    },
    { wrapper: createQueryWrapper(client) },
  );
}

let alertSpy: jest.SpiedFunction<typeof Alert.alert>;

beforeEach(() => {
  fetchMock.mockReset();
  markSeenMock.mockReset();
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
  test("somebody not paged about it as an observer: no button", async () => {
    fetchMock.mockResolvedValue([]);
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderObserver(client);

    await waitFor(() => {
      return expect(rendered.result.current.pagesSettled).toBe(true);
    });
    expect(rendered.result.current.action).toBeNull();
    expect(rendered.result.current.hasOpenPages).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "project-1",
      "incident",
      "incident-1",
    );
  });

  test("the server cannot be asked - an older one, no signal: no button, and no error on the screen", async () => {
    fetchMock.mockRejectedValue(new Error("Request failed with status 404"));
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderObserver(client);

    await waitFor(() => {
      return expect(rendered.result.current.pagesSettled).toBe(true);
    });
    expect(rendered.result.current.action).toBeNull();
    expect(rendered.result.current.pagesKnown).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
    // Asked once: when it cannot say, there is no button, not a retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("before the record's id is known, nothing is asked", async () => {
    const client: QueryClient = createTestQueryClient();

    const rendered: HookRender = await renderObserver(client, {
      recordId: "",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rendered.result.current.action).toBeNull();
    expect(rendered.result.current.pagesSettled).toBe(true);
  });

  test.each(Object.keys(LABELS) as Array<OnCallPageRecordType>)(
    "the observer of an %s: I've seen it, filled, named for a screen reader",
    async (recordType: OnCallPageRecordType) => {
      fetchMock.mockResolvedValue([PAGE]);
      const client: QueryClient = createTestQueryClient();

      const rendered: HookRender = await renderObserver(client, {
        recordType,
      });

      await waitFor(() => {
        return expect(rendered.result.current.action).not.toBeNull();
      });
      expect(rendered.result.current.action).toMatchObject({
        label: "I've seen it",
        accessibilityLabel: `I've seen this ${LABELS[recordType]}`,
        busyAccessibilityLabel: "Marking as seen",
        icon: "checkmark-done-outline",
        primary: true,
      });
      expect(rendered.result.current.hasOpenPages).toBe(true);
      expect(rendered.result.current.pagesKnown).toBe(true);
    },
  );
});

describe("pressing it", () => {
  async function renderWithPage(
    client: QueryClient,
    args: Partial<HookArgs> = {},
  ): Promise<HookRender> {
    fetchMock.mockResolvedValueOnce([PAGE]).mockResolvedValue([]);

    const rendered: HookRender = await renderObserver(client, args);

    await waitFor(() => {
      return expect(rendered.result.current.action).not.toBeNull();
    });

    return rendered;
  }

  test("answers the page in one step - no question - and the button goes", async () => {
    markSeenMock.mockResolvedValue(1);
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await renderWithPage(client);

    await act(async () => {
      await rendered.result.current.action!.onPress();
    });

    expect(markSeenMock).toHaveBeenCalledTimes(1);
    expect(markSeenMock).toHaveBeenCalledWith(
      "project-1",
      "incident",
      "incident-1",
    );
    expect(mockSuccessFeedback).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();

    await waitFor(() => {
      return expect(rendered.result.current.action).toBeNull();
    });
  });

  test("the screen's feed is told, and so is My Pages", async () => {
    markSeenMock.mockResolvedValue(1);
    const onSeen: jest.Mock<() => Promise<void>> = jest.fn(
      async (): Promise<void> => {
        return undefined;
      },
    );
    const client: QueryClient = createTestQueryClient();
    const invalidate: jest.SpiedFunction<typeof client.invalidateQueries> =
      jest.spyOn(client, "invalidateQueries");
    const rendered: HookRender = await renderWithPage(client, { onSeen });

    await act(async () => {
      await rendered.result.current.markSeen();
    });

    expect(onSeen).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["oncall", "my-pages"],
    });
  });

  test("nothing left to answer - somebody it reached said so first - says so, and is no success", async () => {
    markSeenMock.mockResolvedValue(0);
    const onSeen: jest.Mock<() => void> = jest.fn();
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await renderWithPage(client, { onSeen });

    await act(async () => {
      await rendered.result.current.markSeen();
    });

    expect(mockSuccessFeedback).not.toHaveBeenCalled();
    expect(onSeen).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      OBSERVER_PAGE_TEXT.alreadySeenTitle,
      OBSERVER_PAGE_TEXT.alreadySeen,
    );
  });

  test("a failure says so under its own title, and the button stays: the page goes on", async () => {
    markSeenMock.mockRejectedValue(new Error("Network Error"));
    fetchMock.mockReset();
    fetchMock.mockResolvedValue([PAGE]);
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await renderObserver(client);

    await waitFor(() => {
      return expect(rendered.result.current.action).not.toBeNull();
    });

    await act(async () => {
      await rendered.result.current.markSeen();
    });

    expect(mockErrorFeedback).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(
      "Could not mark as seen",
      "You are still paged as an observer. Please try again.",
    );
    expect(rendered.result.current.action).not.toBeNull();
    expect(rendered.result.current.markingSeen).toBe(false);
  });

  test("busy while it asks, so the screen's buttons wait", async () => {
    let finish: (count: number) => void = (): void => {
      return undefined;
    };
    markSeenMock.mockImplementation(() => {
      return new Promise<number>((resolve: (count: number) => void) => {
        finish = resolve;
      });
    });
    const client: QueryClient = createTestQueryClient();
    const rendered: HookRender = await renderWithPage(client);

    let pressed: Promise<void> = Promise.resolve();
    await act(async () => {
      pressed = rendered.result.current.markSeen();
    });

    expect(rendered.result.current.markingSeen).toBe(true);

    await act(async () => {
      finish(1);
      await pressed;
    });

    expect(rendered.result.current.markingSeen).toBe(false);
  });
});
