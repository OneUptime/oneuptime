/*
 * useAfterPress (UI/Utils/UseAfterPress): an update a field makes when it
 * is left - its "what it needs" message - waits for the press that left it
 * to end, so the message cannot push the pressed button out from under the
 * pointer before the click lands.
 *
 * Found in a real browser on a new Switch / Case: its empty value to check
 * has the focus as the settings open, and the first press on Add case or a
 * case's remove button did nothing - leaving the field showed its message,
 * which moved the button down between the press and the release.
 */

import useAfterPress, {
  AfterPressFunction,
} from "../../../UI/Utils/UseAfterPress";
import React, { FunctionComponent, ReactElement, useState } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

let schedule: AfterPressFunction | null = null;

// Shows how many updates have run, and hands the test its scheduler.
const Probe: FunctionComponent = (): ReactElement => {
  const afterPress: AfterPressFunction = useAfterPress();
  const [count, setCount] = useState<number>(0);

  schedule = (update: () => void): void => {
    afterPress(update);
  };

  return (
    <button
      type="button"
      data-testid="probe"
      onClick={() => {
        afterPress(() => {
          setCount((current: number) => {
            return current + 1;
          });
        });
      }}
    >
      {count}
    </button>
  );
};

const shown: () => string = (): string => {
  return screen.getByTestId("probe").textContent || "";
};

const runTimers: () => void = (): void => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  schedule = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("an update made while nothing is pressed - the keyboard, a tap", () => {
  test("runs once the events already on their way have been handled, not in the middle of them", () => {
    render(<Probe />);

    fireEvent.click(screen.getByTestId("probe"));

    expect(shown()).toBe("0");
    runTimers();
    expect(shown()).toBe("1");
  });
});

describe("an update made while a mouse button is down", () => {
  test("waits for the release, and then for the click it makes", () => {
    render(<Probe />);
    const ran: Array<string> = [];

    fireEvent.pointerDown(document.body);
    act(() => {
      schedule?.(() => {
        ran.push("update");
      });
    });

    // However long the button is held.
    runTimers();
    runTimers();
    expect(ran).toEqual([]);

    fireEvent.pointerUp(document.body);
    // The click the release makes is handled first.
    ran.push("click");
    expect(ran).toEqual(["click"]);

    runTimers();
    expect(ran).toEqual(["click", "update"]);
  });

  test("a mouse without pointer events waits the same way", () => {
    render(<Probe />);
    const ran: Array<string> = [];

    fireEvent.mouseDown(document.body);
    act(() => {
      schedule?.(() => {
        ran.push("update");
      });
    });
    runTimers();
    expect(ran).toEqual([]);

    fireEvent.mouseUp(document.body);
    runTimers();
    expect(ran).toEqual(["update"]);
  });

  test("a press the browser cancels ends it too", () => {
    render(<Probe />);
    const ran: Array<string> = [];

    fireEvent.pointerDown(document.body);
    act(() => {
      schedule?.(() => {
        ran.push("update");
      });
    });
    fireEvent.pointerCancel(document.body);
    runTimers();

    expect(ran).toEqual(["update"]);
  });

  test("several updates run in the order they were made", () => {
    render(<Probe />);
    const ran: Array<string> = [];

    fireEvent.pointerDown(document.body);
    act(() => {
      schedule?.(() => {
        ran.push("first");
      });
      schedule?.(() => {
        ran.push("second");
      });
    });
    fireEvent.pointerUp(document.body);
    runTimers();

    expect(ran).toEqual(["first", "second"]);
  });

  test("the next press starts afresh: an update made after the release does not wait for another", () => {
    render(<Probe />);
    const ran: Array<string> = [];

    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    act(() => {
      schedule?.(() => {
        ran.push("update");
      });
    });
    runTimers();

    expect(ran).toEqual(["update"]);
  });
});

describe("once the field is gone", () => {
  test("an update still waiting never runs", () => {
    const view: ReturnType<typeof render> = render(<Probe />);
    const ran: Array<string> = [];

    fireEvent.pointerDown(document.body);
    act(() => {
      schedule?.(() => {
        ran.push("update");
      });
    });
    view.unmount();
    fireEvent.pointerUp(document.body);
    runTimers();

    expect(ran).toEqual([]);
  });

  test("nor does one already on its way", () => {
    const view: ReturnType<typeof render> = render(<Probe />);
    const ran: Array<string> = [];

    act(() => {
      schedule?.(() => {
        ran.push("update");
      });
    });
    view.unmount();
    runTimers();

    expect(ran).toEqual([]);
  });

  test("and it stops listening to the page", () => {
    const removed: Array<string> = [];
    const original: typeof document.removeEventListener =
      document.removeEventListener.bind(document);
    const spy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(document, "removeEventListener")
      .mockImplementation(((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ): void => {
        removed.push(type);
        original(type, listener, options);
      }) as typeof document.removeEventListener);

    const view: ReturnType<typeof render> = render(<Probe />);
    view.unmount();
    spy.mockRestore();

    expect(removed).toEqual(
      expect.arrayContaining([
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "pointercancel",
      ]),
    );
  });
});
