import { Alert } from "react-native";
import { renderHook } from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  runPushPageAnswer,
  usePushPageAction,
  type PushPageActionOptions,
} from "./usePushPageAction";
import type { PushPageRecordState } from "../oncall/pushPageAction";

/*
 * A push's Acknowledge or Escalate on the record's screen: done once, when the
 * screen knows enough to answer it, as its own button would - and taken out
 * of the screen's params, so a re-render, a fold or Back never does it twice.
 */

const OPEN: PushPageRecordState = {
  recordType: "incident",
  isResolved: false,
  isAcknowledged: false,
  canAcknowledge: true,
  hasOpenPages: true,
  isPageAgain: false,
  pagesKnown: true,
};

interface Handlers {
  clear: jest.Mock<() => void>;
  acknowledge: jest.Mock<() => Promise<void>>;
  acknowledgeAgain: jest.Mock<() => Promise<void>>;
  askToEscalate: jest.Mock<() => void>;
  markSeen: jest.Mock<() => Promise<void>>;
}

function handlers(): Handlers {
  return {
    clear: jest.fn(),
    acknowledge: jest.fn(async (): Promise<void> => {
      return undefined;
    }),
    acknowledgeAgain: jest.fn(async (): Promise<void> => {
      return undefined;
    }),
    askToEscalate: jest.fn(),
    markSeen: jest.fn(async (): Promise<void> => {
      return undefined;
    }),
  };
}

// Paged about it only as an observer, their page still open.
const OBSERVER: PushPageRecordState = {
  ...OPEN,
  hasOpenPages: false,
  observerPages: { hasOpenPages: true, known: true },
};

let alertSpy: jest.SpiedFunction<typeof Alert.alert>;

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  alertSpy.mockRestore();
});

interface Props {
  request: unknown;
  ready: boolean;
  state: PushPageRecordState;
}

async function renderAction(
  given: Handlers,
  initial: Props,
): Promise<{ rerender: (props: Props) => Promise<void> | void }> {
  return renderHook(
    (props: Props): void => {
      const options: PushPageActionOptions = { ...given, ...props };
      usePushPageAction(options);
    },
    { initialProps: initial },
  );
}

describe("a push's action waits for the screen", () => {
  test("nothing is done until the record, its states and the reader's pages are read", async () => {
    const given: Handlers = handlers();
    const rendered: { rerender: (props: Props) => Promise<void> | void } =
      await renderAction(given, {
        request: { kind: "acknowledge", id: "n-1:ACKNOWLEDGE_PAGE" },
        ready: false,
        state: OPEN,
      });

    expect(given.acknowledge).not.toHaveBeenCalled();
    expect(given.clear).not.toHaveBeenCalled();

    await rendered.rerender({
      request: { kind: "acknowledge", id: "n-1:ACKNOWLEDGE_PAGE" },
      ready: true,
      state: OPEN,
    });

    expect(given.clear).toHaveBeenCalledTimes(1);
    expect(given.acknowledge).toHaveBeenCalledTimes(1);
  });

  test("the answer reads what the screen knows when it is ready, not when the push came", async () => {
    const given: Handlers = handlers();
    const rendered: { rerender: (props: Props) => Promise<void> | void } =
      await renderAction(given, {
        request: { kind: "acknowledge", id: "n-2:ACKNOWLEDGE_PAGE" },
        ready: false,
        state: OPEN,
      });

    // Somebody else acknowledged it while the app was opening.
    await rendered.rerender({
      request: { kind: "acknowledge", id: "n-2:ACKNOWLEDGE_PAGE" },
      ready: true,
      state: { ...OPEN, isAcknowledged: true, hasOpenPages: false },
    });

    expect(given.acknowledge).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Already acknowledged",
      "This incident was already acknowledged, and you are not being paged about it.",
    );
  });
});

describe("each tap is done once", () => {
  test("re-renders - a fold, a refresh - never do it again, even before the params are cleared", async () => {
    const given: Handlers = handlers();
    const props: Props = {
      request: { kind: "escalate", id: "n-3:ESCALATE_PAGE" },
      ready: true,
      state: OPEN,
    };
    const rendered: { rerender: (props: Props) => Promise<void> | void } =
      await renderAction(given, props);

    await rendered.rerender({ ...props, state: { ...OPEN } });
    await rendered.rerender({ ...props, ready: false });
    await rendered.rerender({ ...props });

    expect(given.askToEscalate).toHaveBeenCalledTimes(1);
    expect(given.clear).toHaveBeenCalledTimes(1);
  });

  test("a second tap, on another push about the same record, is a new action", async () => {
    const given: Handlers = handlers();
    const rendered: { rerender: (props: Props) => Promise<void> | void } =
      await renderAction(given, {
        request: { kind: "escalate", id: "n-4:ESCALATE_PAGE" },
        ready: true,
        state: OPEN,
      });

    await rendered.rerender({ request: undefined, ready: true, state: OPEN });
    await rendered.rerender({
      request: { kind: "escalate", id: "n-5:ESCALATE_PAGE" },
      ready: true,
      state: OPEN,
    });

    expect(given.askToEscalate).toHaveBeenCalledTimes(2);
  });

  test("a screen opened with no action - a plain tap, a row in the list - does nothing", async () => {
    for (const request of [
      undefined,
      null,
      "acknowledge",
      { kind: "resolve", id: "n-6" },
    ]) {
      const given: Handlers = handlers();
      await renderAction(given, { request, ready: true, state: OPEN });

      expect(given.clear).not.toHaveBeenCalled();
      expect(given.acknowledge).not.toHaveBeenCalled();
      expect(given.askToEscalate).not.toHaveBeenCalled();
    }
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("what each answer does", () => {
  test("acknowledge, acknowledge again, escalate and mark seen call the screen's own", () => {
    const given: Handlers = handlers();

    runPushPageAnswer({ kind: "acknowledge" }, given);
    runPushPageAnswer({ kind: "acknowledgeAgain" }, given);
    runPushPageAnswer({ kind: "askToEscalate" }, given);
    runPushPageAnswer({ kind: "markSeen" }, given);

    expect(given.acknowledge).toHaveBeenCalledTimes(1);
    expect(given.acknowledgeAgain).toHaveBeenCalledTimes(1);
    expect(given.askToEscalate).toHaveBeenCalledTimes(1);
    expect(given.markSeen).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("an explanation is said, and nothing else is done", () => {
    const given: Handlers = handlers();

    runPushPageAnswer(
      { kind: "explain", title: "Nothing to escalate", message: "Why." },
      given,
    );

    expect(alertSpy).toHaveBeenCalledWith("Nothing to escalate", "Why.");
    expect(given.acknowledge).not.toHaveBeenCalled();
    expect(given.acknowledgeAgain).not.toHaveBeenCalled();
    expect(given.askToEscalate).not.toHaveBeenCalled();
  });

  test("an observer's I've seen it marks their page seen, through the hook - and never acknowledges the record", async () => {
    for (const state of [
      OBSERVER,
      { ...OBSERVER, isAcknowledged: true },
      { ...OBSERVER, isAcknowledged: true, isPageAgain: true },
    ]) {
      const given: Handlers = handlers();

      await renderAction(given, {
        request: { kind: "seen", id: "n-8:MARK_PAGE_SEEN" },
        ready: true,
        state,
      });

      expect(given.clear).toHaveBeenCalledTimes(1);
      expect(given.markSeen).toHaveBeenCalledTimes(1);
      expect(given.acknowledge).not.toHaveBeenCalled();
      expect(given.acknowledgeAgain).not.toHaveBeenCalled();
      expect(given.askToEscalate).not.toHaveBeenCalled();
    }
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("I've seen it on a page answered meanwhile says so, and marks nothing", async () => {
    const given: Handlers = handlers();

    await renderAction(given, {
      request: { kind: "seen", id: "n-9:MARK_PAGE_SEEN" },
      ready: true,
      state: {
        ...OBSERVER,
        observerPages: { hasOpenPages: false, known: true },
      },
    });

    expect(given.markSeen).not.toHaveBeenCalled();
    expect(given.acknowledge).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Already marked as seen",
      "This page has already been marked as seen.",
    );
  });

  test("I've seen it waits, like every action, until the screen knows the reader's pages", async () => {
    const given: Handlers = handlers();
    const rendered: { rerender: (props: Props) => Promise<void> | void } =
      await renderAction(given, {
        request: { kind: "seen", id: "n-10:MARK_PAGE_SEEN" },
        ready: false,
        state: OBSERVER,
      });

    expect(given.markSeen).not.toHaveBeenCalled();

    await rendered.rerender({
      request: { kind: "seen", id: "n-10:MARK_PAGE_SEEN" },
      ready: true,
      state: OBSERVER,
    });
    await rendered.rerender({
      request: { kind: "seen", id: "n-10:MARK_PAGE_SEEN" },
      ready: true,
      state: { ...OBSERVER },
    });

    expect(given.markSeen).toHaveBeenCalledTimes(1);
  });

  test("a page again's Acknowledge acknowledges it again, through the hook", async () => {
    const given: Handlers = handlers();

    await renderAction(given, {
      request: { kind: "acknowledge", id: "n-7:ACKNOWLEDGE_PAGE" },
      ready: true,
      state: { ...OPEN, isAcknowledged: true, isPageAgain: true },
    });

    expect(given.acknowledgeAgain).toHaveBeenCalledTimes(1);
    expect(given.acknowledge).not.toHaveBeenCalled();
  });
});
