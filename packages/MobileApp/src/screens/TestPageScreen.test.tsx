import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import {
  beforeEach,
  describe,
  expect,
  jest as jestGlobal,
  test,
} from "@jest/globals";
import TestPageScreen from "./TestPageScreen";
import { TEST_PAGE_TEXT } from "../oncall/testPage";

/*
 * A TEST PAGE'S OWN SCREEN (#7014), where its push lands.
 *
 *   - Opened by "Acknowledge test page" under the push, it acknowledges the
 *     test once - from the push's own message, in its project - and says it
 *     works. Back, a re-render or the same tap again never sends it twice.
 *   - Opened by a tap, it asks first whether it is acknowledged already, and
 *     otherwise offers the button; it acknowledges nothing until pressed.
 *   - It never says a test works that the server did not confirm: a write
 *     that did not land, or a request that failed, says so, with the button
 *     to try again.
 */

const mockGoBack: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockSetParams: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockParams: {
  current: {
    messageId: string;
    projectId: string;
    acknowledgeRequestId?: string | undefined;
  };
} = { current: { messageId: "message-1", projectId: "project-1" } };
const mockAcknowledge: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockIsAcknowledged: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockSuccess: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;
const mockError: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { goBack: mockGoBack, setParams: mockSetParams };
    },
    useRoute: () => {
      return { params: mockParams.current };
    },
  };
});

jest.mock("../api/onCallTestPage", () => {
  return {
    acknowledgeTestPage: (...args: Array<unknown>) => {
      return mockAcknowledge(...args);
    },
    fetchIsTestPageAcknowledged: (...args: Array<unknown>) => {
      return mockIsAcknowledged(...args);
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        lightImpact: jest.fn(),
        selectionFeedback: jest.fn(),
        successFeedback: mockSuccess,
        errorFeedback: mockError,
      };
    },
  };
});

function textOf(testID: string): string {
  const children: unknown = screen.getByTestId(testID).props.children;

  return Array.isArray(children) ? children.join("") : String(children);
}

function isDisabled(testID: string): boolean {
  return Boolean(screen.getByTestId(testID).props.accessibilityState?.disabled);
}

// Lets the screen's requests settle.
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn += 1) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  mockParams.current = { messageId: "message-1", projectId: "project-1" };
  mockAcknowledge.mockReset();
  mockAcknowledge.mockImplementation(async () => {
    return "Acknowledged";
  });
  mockIsAcknowledged.mockReset();
  mockIsAcknowledged.mockImplementation(async () => {
    return false;
  });
  mockGoBack.mockClear();
  mockSetParams.mockClear();
  mockSuccess.mockClear();
  mockError.mockClear();
});

describe("opened by Acknowledge test page under the push", () => {
  beforeEach(() => {
    mockParams.current = {
      messageId: "message-1",
      projectId: "project-1",
      acknowledgeRequestId: "n-1:ACKNOWLEDGE_TEST_PAGE",
    };
  });

  test("acknowledges it once, from the push's own message in its project, and says it works", async () => {
    await render(<TestPageScreen />);
    await settle();

    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
    expect(mockAcknowledge).toHaveBeenCalledWith("project-1", "message-1");
    // It does not need to ask first: the reader asked for it.
    expect(mockIsAcknowledged).not.toHaveBeenCalled();
    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.answeredTitle);
    expect(textOf("test-page-message")).toBe(TEST_PAGE_TEXT.answered);
    expect(screen.getByTestId("test-page-done")).toBeTruthy();
    expect(screen.queryByTestId("test-page-acknowledge")).toBeNull();
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  });

  test("takes the tap out of its params, so Back or a re-render never sends it twice", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <TestPageScreen />,
    );
    await settle();

    expect(mockSetParams).toHaveBeenCalledWith({
      acknowledgeRequestId: undefined,
    });

    // The same tap, drawn again (params not yet cleared): still once.
    await view.rerender(<TestPageScreen />);
    await settle();

    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
  });

  test("once the tap is out of its params it asks nothing more: no read lands to offer the button while it answers", async () => {
    let answer: (value: string) => void = (): void => {};

    mockAcknowledge.mockImplementation(() => {
      return new Promise((resolve: (value: string) => void) => {
        answer = resolve;
      });
    });
    mockSetParams.mockImplementation((next: unknown) => {
      mockParams.current = {
        ...mockParams.current,
        ...(next as Record<string, undefined>),
      };
    });

    const view: Awaited<ReturnType<typeof render>> = await render(
      <TestPageScreen />,
    );
    await settle();

    // The params as the navigator hands them once the tap is taken out.
    await view.rerender(<TestPageScreen />);
    await settle();

    expect(mockIsAcknowledged).not.toHaveBeenCalled();
    expect(isDisabled("test-page-acknowledge")).toBe(true);

    await act(async () => {
      answer("Acknowledged");
    });
    await settle();

    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.answeredTitle);
  });

  test("one the reader acknowledged already, from another message, says it works too", async () => {
    mockAcknowledge.mockImplementation(async () => {
      return "AlreadyAcknowledged";
    });

    await render(<TestPageScreen />);
    await settle();

    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.answeredTitle);
  });

  test("a write that did not land is never said to work: it says so, and offers the button again", async () => {
    mockAcknowledge.mockImplementation(async () => {
      return "NotAcknowledged";
    });

    await render(<TestPageScreen />);
    await settle();

    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.heading);
    expect(screen.getByTestId("test-page-failed")).toBeTruthy();
    expect(screen.getByText(TEST_PAGE_TEXT.notAcknowledged)).toBeTruthy();
    expect(isDisabled("test-page-acknowledge")).toBe(false);
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  test("a request that failed says why, in the server's words, and pressing the button tries again", async () => {
    mockAcknowledge.mockImplementationOnce(async () => {
      throw new Error("Network Error");
    });

    await render(<TestPageScreen />);
    await settle();

    expect(screen.getByTestId("test-page-failed")).toBeTruthy();
    expect(screen.getByText("Network Error")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("test-page-acknowledge"));
    await settle();

    expect(mockAcknowledge).toHaveBeenCalledTimes(2);
    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.answeredTitle);
  });
});

describe("opened by a tap on the push", () => {
  test("asks whether it is acknowledged already, then offers the button - and acknowledges nothing", async () => {
    await render(<TestPageScreen />);
    await settle();

    expect(mockIsAcknowledged).toHaveBeenCalledWith("project-1", "message-1");
    expect(mockAcknowledge).not.toHaveBeenCalled();
    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.heading);
    expect(textOf("test-page-message")).toBe(TEST_PAGE_TEXT.message);
    expect(isDisabled("test-page-acknowledge")).toBe(false);
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  test("the button is off while it asks, so it is not pressed for a test already answered", async () => {
    mockIsAcknowledged.mockImplementation(() => {
      return new Promise(() => {});
    });

    await render(<TestPageScreen />);

    expect(isDisabled("test-page-acknowledge")).toBe(true);
  });

  test("pressing it acknowledges the test, once, and Done closes the screen", async () => {
    await render(<TestPageScreen />);
    await settle();

    await fireEvent.press(screen.getByTestId("test-page-acknowledge"));
    await settle();

    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
    expect(mockAcknowledge).toHaveBeenCalledWith("project-1", "message-1");
    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.answeredTitle);

    await fireEvent.press(screen.getByTestId("test-page-done"));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test("one acknowledged already says it works, with no button to press", async () => {
    mockIsAcknowledged.mockImplementation(async () => {
      return true;
    });

    await render(<TestPageScreen />);
    await settle();

    expect(textOf("test-page-title")).toBe(TEST_PAGE_TEXT.answeredTitle);
    expect(screen.queryByTestId("test-page-acknowledge")).toBeNull();
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  test("when it can't ask, the button still answers it", async () => {
    mockIsAcknowledged.mockImplementation(async () => {
      throw new Error("Network Error");
    });

    await render(<TestPageScreen />);
    await settle();

    expect(isDisabled("test-page-acknowledge")).toBe(false);
    expect(screen.queryByTestId("test-page-failed")).toBeNull();
  });
});

describe("its words", () => {
  test("are the server's: what the test is, its button and what it says once answered", () => {
    expect(TEST_PAGE_TEXT.acknowledgeButton).toBe("Acknowledge test page");
    expect(TEST_PAGE_TEXT.message).toBe(
      "This is a test page. Nothing is wrong: acknowledge it to show that on-call pages reach you.",
    );
    expect(TEST_PAGE_TEXT.answeredTitle).toBe("Test page acknowledged");
    expect(TEST_PAGE_TEXT.answered).toBe(
      "You acknowledged this test page. It works: on-call pages reach you.",
    );
  });
});
