import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import React from "react";
import PushRepeatControl, {
  PUSH_REPEAT_DROPDOWN_OPTIONS,
  REPEAT_HELP_TEXT,
  REPEAT_SAVE_FAILED_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PushRepeatControl";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import {
  getRepeatEveryMinutes,
  isRepeatEveryMinutes,
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "../../../Types/NotificationRule/NotificationRepeat";

/*
 * The pill beside the push level under every push rule on the On-Call Rules
 * page: how often the push is sent again until somebody acknowledges, and -
 * for somebody allowed to change the rule - a menu to change it there and
 * then.
 *
 * What is pinned here is what a responder relies on when they set a phone to
 * keep ringing for the page they must not sleep through:
 *
 *   - the menu and the create form offer exactly the intervals the server
 *     accepts, so neither can offer one that is refused (or, worse, stored
 *     and then read by the on-call worker as "do not repeat");
 *   - the pill names the interval the rule really has, and anything this
 *     build does not offer - a missing value, a value from another build -
 *     reads as not repeating, which is how the worker treats it;
 *   - a change shows at once, and a change the server refused does not stay
 *     on screen pretending it worked.
 */

/*
 * The reader's language and wording. Empty is English everywhere, as with
 * no locale loaded; a test that is about translation fills it in.
 */
let translations: Record<string, string> = {};
let readerLanguage: string = "en";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return translations[key] ?? options?.defaultValue ?? key;
        },
        i18n: { language: readerLanguage },
      };
    },
  };
});

jest.setTimeout(30000);

// Restated rather than imported where the words ARE the behaviour.
const DOES_NOT_REPEAT: string = "Doesn't repeat";
const HELP_TEXT: string =
  "Sent again until somebody acknowledges, up to 10 more times.";
const SAVE_FAILED: string = "Could not change how often this push repeats.";
const ARIA_LABEL_ENDING: string =
  ". Change how often this push repeats until acknowledged.";

// The pill's words for a rule that repeats every `minutes`.
function repeatsEvery(minutes: number): string {
  return minutes === 1
    ? "Repeats every minute"
    : `Repeats every ${minutes} minutes`;
}

// The menu's and the create form's words for an interval.
function optionLabel(minutes: number): string {
  if (minutes === 0) {
    return "Don't repeat";
  }

  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

const OFFERED_VALUES: Array<number> = [
  NO_NOTIFICATION_REPEAT,
  ...REPEAT_EVERY_MINUTES_OPTIONS,
];

type ChangeHandler = (repeatEveryMinutes: number) => Promise<void>;

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve: () => void = (): void => {
    return undefined;
  };
  let reject: (error: Error) => void = (): void => {
    return undefined;
  };

  const promise: Promise<void> = new Promise<void>(
    (innerResolve: () => void, innerReject: (error: Error) => void) => {
      resolve = innerResolve;
      reject = innerReject;
    },
  );

  return { promise, resolve, reject };
}

function control(): HTMLElement {
  return screen.getByTestId("push-repeat");
}

function pill(): HTMLElement {
  return screen.getByTestId("push-repeat-pill");
}

function errorNote(): HTMLElement | null {
  return screen.queryByTestId("push-repeat-error");
}

function optionValues(): Array<number> {
  return PUSH_REPEAT_DROPDOWN_OPTIONS.map((option: DropdownOption): number => {
    return option.value as number;
  });
}

function renderEditable(
  repeatEveryMinutes: number | null | undefined,
  onChange: ChangeHandler,
): ReturnType<typeof render> {
  return render(
    <PushRepeatControl
      repeatEveryMinutes={repeatEveryMinutes}
      isEditable={true}
      onChange={onChange}
    />,
  );
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.click(pill());
  });
}

// Picks the interval through the menu, as a pointer would.
async function choose(minutes: number): Promise<void> {
  await openMenu();

  const option: HTMLElement = screen.getByRole("menuitemradio", {
    name: optionLabel(minutes),
  });

  await act(async () => {
    fireEvent.click(option);
  });
}

// A person at the keyboard, each step inside act as the menu's own tests do.
async function userTab(user: UserEvent): Promise<void> {
  await act(async () => {
    await user.tab();
  });
}

async function userKeyboard(user: UserEvent, keys: string): Promise<void> {
  await act(async () => {
    await user.keyboard(keys);
  });
}

async function userClick(user: UserEvent, element: Element): Promise<void> {
  await act(async () => {
    await user.click(element);
  });
}

// The menu takes focus on its first interval once it is placed.
async function waitForMenuFocus(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("push-repeat-option-0")).toHaveFocus();
  });
}

beforeEach(() => {
  translations = {};
  readerLanguage = "en";
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the intervals the On-Call Rules page offers", () => {
  test("are Don't repeat, then every interval the server accepts, in its order", () => {
    expect(optionValues()).toEqual(OFFERED_VALUES);
  });

  test("are each one the server accepts and the on-call worker repeats at", () => {
    for (const value of optionValues()) {
      // A number, as the column holds it: "5" is refused.
      expect(typeof value).toBe("number");
      expect(isRepeatEveryMinutes(value)).toBe(true);
      expect(getRepeatEveryMinutes(value)).toBe(value);
    }
  });

  test("leave out nothing the server accepts", () => {
    /*
     * The other half of agreeing with the server: an interval it accepts
     * that the page cannot offer is one a rule can be given through the API
     * and then never shown on its row as anything the menu can pick.
     */
    for (let minutes: number = -5; minutes <= 120; minutes++) {
      expect(optionValues().includes(minutes)).toBe(
        isRepeatEveryMinutes(minutes),
      );
    }
  });

  test("name each interval once, and no two the same way", () => {
    const values: Array<number> = optionValues();
    const labels: Array<string> = PUSH_REPEAT_DROPDOWN_OPTIONS.map(
      (option: DropdownOption): string => {
        return option.label;
      },
    );

    expect(new Set(values).size).toBe(values.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("run from not repeating to the longest wait", () => {
    const values: Array<number> = optionValues();

    expect(values[0]).toBe(NO_NOTIFICATION_REPEAT);

    for (let index: number = 1; index < values.length; index++) {
      expect(values[index]!).toBeGreaterThan(values[index - 1]!);
    }
  });

  test("are worded for the person picking one", () => {
    expect(
      PUSH_REPEAT_DROPDOWN_OPTIONS.map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual(OFFERED_VALUES.map(optionLabel));
  });

  test("are explained with the worker's own limit, never a number of their own", () => {
    // A placeholder, filled with MAX_NOTIFICATION_REPEATS when shown.
    expect(REPEAT_HELP_TEXT).toContain("{{count}}");
    expect(REPEAT_HELP_TEXT).not.toMatch(/\d/);
  });
});

describe("PushRepeatControl - what it shows", () => {
  test.each(
    REPEAT_EVERY_MINUTES_OPTIONS.map((minutes: number) => {
      return [minutes];
    }),
  )("a rule that repeats every %i minute(s) says so", (minutes: number) => {
    render(
      <PushRepeatControl repeatEveryMinutes={minutes} isEditable={false} />,
    );

    expect(pill().textContent).toBe(repeatsEvery(minutes));
    expect(control()).toHaveAttribute(
      "data-repeat-every-minutes",
      String(minutes),
    );
  });

  test("one minute is singular, and every other interval plural", () => {
    const { unmount } = render(
      <PushRepeatControl repeatEveryMinutes={1} isEditable={false} />,
    );

    expect(pill().textContent).toBe("Repeats every minute");
    expect(pill().textContent).not.toContain("1 minutes");

    unmount();

    render(<PushRepeatControl repeatEveryMinutes={2} isEditable={false} />);

    expect(pill().textContent).toBe("Repeats every 2 minutes");
  });

  test("a rule that does not repeat says so", () => {
    render(
      <PushRepeatControl
        repeatEveryMinutes={NO_NOTIFICATION_REPEAT}
        isEditable={false}
      />,
    );

    expect(pill().textContent).toBe(DOES_NOT_REPEAT);
    expect(control()).toHaveAttribute("data-repeat-every-minutes", "0");
  });

  test.each([
    ["was read without the column", undefined],
    ["was read with a null interval", null],
    ["carries an interval this build does not offer", 4],
    ["carries an interval longer than any offered", 60],
    ["carries a negative interval", -5],
    ["carries a fraction of a minute", 1.5],
    ["carries something that is not a number", NaN],
    ["carries the interval as text", "5"],
  ])(
    "a rule that %s does not repeat - as the on-call worker reads it",
    (_label: string, value: unknown) => {
      render(
        <PushRepeatControl
          repeatEveryMinutes={value as number | null | undefined}
          isEditable={false}
        />,
      );

      expect(pill().textContent).toBe(DOES_NOT_REPEAT);
      expect(control()).toHaveAttribute("data-repeat-every-minutes", "0");
    },
  );

  test("a repeating rule is drawn indigo and one that does not grey, from classes the dark theme re-tints", () => {
    const { unmount } = render(
      <PushRepeatControl repeatEveryMinutes={5} isEditable={false} />,
    );

    expect(pill()).toHaveClass("bg-indigo-50", "text-indigo-700");
    expect(pill()).not.toHaveClass("bg-gray-50");

    unmount();

    render(
      <PushRepeatControl
        repeatEveryMinutes={NO_NOTIFICATION_REPEAT}
        isEditable={false}
      />,
    );

    expect(pill()).toHaveClass("bg-gray-50", "text-gray-700");
    expect(pill()).not.toHaveClass("bg-indigo-50");
  });

  test("a repeating pill says on hover how long it keeps going", () => {
    render(<PushRepeatControl repeatEveryMinutes={10} isEditable={false} />);

    expect(pill()).toHaveAttribute("title", HELP_TEXT);
    expect(pill().getAttribute("title")).toContain(
      `up to ${MAX_NOTIFICATION_REPEATS} more times`,
    );
  });

  test("a pill that does not repeat has nothing to explain on hover", () => {
    render(
      <PushRepeatControl
        repeatEveryMinutes={NO_NOTIFICATION_REPEAT}
        isEditable={false}
      />,
    );

    expect(pill()).not.toHaveAttribute("title");
  });

  test("shows the interval the table hands it after a reload", () => {
    const { rerender } = render(
      <PushRepeatControl repeatEveryMinutes={2} isEditable={false} />,
    );

    rerender(<PushRepeatControl repeatEveryMinutes={30} isEditable={false} />);

    expect(pill().textContent).toBe(repeatsEvery(30));
    expect(control()).toHaveAttribute("data-repeat-every-minutes", "30");

    rerender(
      <PushRepeatControl
        repeatEveryMinutes={NO_NOTIFICATION_REPEAT}
        isEditable={false}
      />,
    );

    expect(pill().textContent).toBe(DOES_NOT_REPEAT);
    expect(pill()).toHaveClass("bg-gray-50");

    // A reload that reads a value this build does not offer.
    rerender(<PushRepeatControl repeatEveryMinutes={7} isEditable={false} />);

    expect(pill().textContent).toBe(DOES_NOT_REPEAT);
  });
});

describe("PushRepeatControl - who may change it", () => {
  test("a viewer who may not change the rule gets a plain pill, no menu", async () => {
    const onChange: Mock<ChangeHandler> = jest.fn<ChangeHandler>();

    render(
      <PushRepeatControl
        repeatEveryMinutes={5}
        isEditable={false}
        onChange={onChange}
      />,
    );

    expect(pill().tagName).toBe("SPAN");
    expect(pill()).not.toHaveAttribute("aria-haspopup");
    expect(within(control()).queryByRole("button")).toBeNull();

    await act(async () => {
      fireEvent.click(pill());
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an editable control with nothing to save to is drawn read-only", () => {
    render(<PushRepeatControl repeatEveryMinutes={5} isEditable={true} />);

    expect(pill().tagName).toBe("SPAN");
    expect(pill()).not.toHaveAttribute("aria-haspopup");
  });

  test("a read-only pill draws no chevron - there is nothing to open", () => {
    const { unmount } = render(
      <PushRepeatControl repeatEveryMinutes={5} isEditable={false} />,
    );

    // The repeat icon alone.
    expect(pill().querySelectorAll("svg")).toHaveLength(1);

    unmount();

    renderEditable(5, jest.fn<ChangeHandler>());

    // The repeat icon and the chevron that says it opens.
    expect(pill().querySelectorAll("svg")).toHaveLength(2);
  });

  test("an editable control is a menu button that says what it changes", () => {
    renderEditable(5, jest.fn<ChangeHandler>());

    expect(pill().tagName).toBe("BUTTON");
    expect(pill()).toHaveAttribute("type", "button");
    expect(pill()).toHaveAttribute("aria-haspopup", "menu");
    expect(pill()).toHaveAttribute("aria-expanded", "false");
    expect(pill()).toHaveAttribute("aria-busy", "false");
    expect(pill()).not.toBeDisabled();
    expect(pill()).toHaveAttribute(
      "aria-label",
      `${repeatsEvery(5)}${ARIA_LABEL_ENDING}`,
    );
    expect(pill()).toHaveAttribute("title", HELP_TEXT);
  });

  test.each([
    [1, `${repeatsEvery(1)}${ARIA_LABEL_ENDING}`],
    [NO_NOTIFICATION_REPEAT, `${DOES_NOT_REPEAT}${ARIA_LABEL_ENDING}`],
  ])(
    "the button's name starts with what the pill reads (%i)",
    (minutes: number, ariaLabel: string) => {
      renderEditable(minutes, jest.fn<ChangeHandler>());

      expect(screen.getByRole("button", { name: ariaLabel })).toBe(pill());
    },
  );

  test("the editable pill keeps the read-only pill's colours", () => {
    renderEditable(5, jest.fn<ChangeHandler>());

    expect(pill()).toHaveClass("bg-indigo-50", "text-indigo-700");
  });
});

describe("PushRepeatControl - changing the interval", () => {
  test("the menu offers every interval, in order, and marks the current one", async () => {
    renderEditable(5, jest.fn<ChangeHandler>());

    await openMenu();

    expect(pill()).toHaveAttribute("aria-expanded", "true");

    const options: Array<HTMLElement> = screen.getAllByRole("menuitemradio");

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual(OFFERED_VALUES.map(optionLabel));

    expect(
      options.map((option: HTMLElement): string | null => {
        return option.getAttribute("data-testid");
      }),
    ).toEqual(
      OFFERED_VALUES.map((minutes: number): string => {
        return `push-repeat-option-${minutes}`;
      }),
    );

    const checked: Array<HTMLElement> = options.filter(
      (option: HTMLElement): boolean => {
        return option.getAttribute("aria-checked") === "true";
      },
    );

    expect(checked).toHaveLength(1);
    expect(checked[0]).toBe(screen.getByTestId("push-repeat-option-5"));

    // The tick is drawn on the current interval only.
    for (const option of options) {
      expect(option.querySelector("svg") !== null).toBe(option === checked[0]);
    }
  });

  test("a rule that does not repeat has Don't repeat marked", async () => {
    renderEditable(undefined, jest.fn<ChangeHandler>());

    await openMenu();

    expect(screen.getByTestId("push-repeat-option-0")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("the menu opens under the pill, lined up on its left, outside the table", async () => {
    /*
     * The pill sits in the method cell beside the push level; a menu lined up
     * on its right edge would hang out past the left of the table.
     */
    renderEditable(5, jest.fn<ChangeHandler>());

    await openMenu();

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("origin-top-left");
    expect(menu.style.right).toBe("");
    // Portalled out of the table's scroller, like every row's menu.
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveAttribute("aria-labelledby", pill().id);
    expect(pill()).toHaveAttribute("aria-controls", menu.id);
  });

  test("picking an interval saves it, once, and shows it", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(5);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(5);
    expect(pill().textContent).toBe(repeatsEvery(5));
    expect(control()).toHaveAttribute("data-repeat-every-minutes", "5");
    expect(pill()).toHaveClass("bg-indigo-50");
    expect(pill()).toHaveAttribute("title", HELP_TEXT);
    expect(pill()).toHaveAttribute(
      "aria-label",
      `${repeatsEvery(5)}${ARIA_LABEL_ENDING}`,
    );
  });

  test.each(
    REPEAT_EVERY_MINUTES_OPTIONS.map((minutes: number) => {
      return [minutes];
    }),
  )(
    "every %i minute(s) can be picked and is saved as that number",
    async (minutes: number) => {
      const onChange: Mock<ChangeHandler> = jest
        .fn<ChangeHandler>()
        .mockResolvedValue(undefined);

      renderEditable(NO_NOTIFICATION_REPEAT, onChange);

      await choose(minutes);

      expect(onChange).toHaveBeenCalledWith(minutes);
      expect(pill().textContent).toBe(repeatsEvery(minutes));
    },
  );

  test("Don't repeat is saved as 0 - turning repeating off is a change like any other", async () => {
    /*
     * 0 is falsy: a guard written as "if (!value)" would quietly keep a rule
     * that somebody asked to stop repeating ringing every minute.
     */
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    renderEditable(1, onChange);

    await choose(NO_NOTIFICATION_REPEAT);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(NO_NOTIFICATION_REPEAT);
    expect(pill().textContent).toBe(DOES_NOT_REPEAT);
    expect(pill()).toHaveClass("bg-gray-50");
    expect(pill()).not.toHaveAttribute("title");
  });

  test("picking the interval it already has saves nothing", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    renderEditable(15, onChange);

    await choose(15);

    expect(onChange).not.toHaveBeenCalled();
    expect(pill()).toHaveAttribute("aria-busy", "false");
    expect(pill().textContent).toBe(repeatsEvery(15));
  });

  test("picking Don't repeat on a rule that does not repeat saves nothing", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    renderEditable(undefined, onChange);

    await choose(NO_NOTIFICATION_REPEAT);

    expect(onChange).not.toHaveBeenCalled();
  });

  test("the menu closes once an interval is picked", async () => {
    renderEditable(
      NO_NOTIFICATION_REPEAT,
      jest.fn<ChangeHandler>().mockResolvedValue(undefined),
    );

    await choose(3);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(pill()).toHaveAttribute("aria-expanded", "false");
  });

  test("the new interval shows before the server answers, and the pill waits for it", async () => {
    const save: ReturnType<typeof deferred> = deferred();
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockReturnValue(save.promise);

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(10);

    // Optimistic: the row already reads the new interval while it saves.
    expect(pill().textContent).toBe(repeatsEvery(10));
    expect(control()).toHaveAttribute("data-repeat-every-minutes", "10");
    expect(pill()).toHaveAttribute("aria-busy", "true");
    expect(pill()).toBeDisabled();
    expect(pill()).toHaveClass("opacity-60");

    await act(async () => {
      save.resolve();
      await save.promise;
    });

    expect(pill()).toHaveAttribute("aria-busy", "false");
    expect(pill()).not.toBeDisabled();
    expect(pill()).not.toHaveClass("opacity-60");
    expect(pill().textContent).toBe(repeatsEvery(10));
  });

  test("a second pick cannot start while the first is saving, so the server hears one", async () => {
    const save: ReturnType<typeof deferred> = deferred();
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockReturnValueOnce(save.promise)
      .mockResolvedValue(undefined);

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(5);

    // The trigger is disabled, so the menu does not open again.
    await act(async () => {
      fireEvent.click(pill());
    });

    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve();
      await save.promise;
    });

    // Once it has saved, the next change goes through as usual.
    await choose(30);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(30);
  });

  test("a refused change goes back to the stored interval and says why", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockRejectedValue(new Error("You do not have permission to do this."));

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(1);

    // Never left claiming a repeat the server did not store.
    expect(pill().textContent).toBe(DOES_NOT_REPEAT);
    expect(control()).toHaveAttribute("data-repeat-every-minutes", "0");
    expect(pill()).toHaveClass("bg-gray-50");

    const error: HTMLElement = errorNote()!;

    expect(error).toHaveAttribute("role", "alert");
    expect(REPEAT_SAVE_FAILED_MESSAGE).toBe(SAVE_FAILED);
    expect(error.textContent).toBe(
      `${SAVE_FAILED} You do not have permission to do this.`,
    );
    expect(pill()).not.toBeDisabled();
    expect(pill()).toHaveAttribute("aria-busy", "false");

    // And the menu marks what is stored, not what was refused.
    await openMenu();

    expect(screen.getByTestId("push-repeat-option-0")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("push-repeat-option-1")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("the reason is the server's message, not the error object", async () => {
    // A gateway's refusal, as a plain object.
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockRejectedValue({ error: "Too many requests." });

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(2);

    expect(errorNote()!.textContent).toBe(`${SAVE_FAILED} Too many requests.`);
    expect(errorNote()!.textContent).not.toContain("[object Object]");
  });

  test("a refusal puts back the interval saved last, after several changes", async () => {
    /*
     * The stored interval moves with every change that is saved, so a later
     * refusal goes back to that one - not to the interval the table loaded,
     * which is no longer what the server holds.
     */
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Server Error"));

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(5);
    await choose(15);
    await choose(30);

    expect(onChange.mock.calls).toEqual([[5], [15], [30]]);
    expect(pill().textContent).toBe(repeatsEvery(15));
    expect(control()).toHaveAttribute("data-repeat-every-minutes", "15");
    expect(errorNote()).toHaveTextContent("Server Error");
  });

  test("refusals in a row keep putting back the same stored interval", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockRejectedValueOnce(new Error("First refusal"))
      .mockRejectedValueOnce(new Error("Second refusal"))
      .mockResolvedValueOnce(undefined);

    renderEditable(10, onChange);

    await choose(5);

    expect(pill().textContent).toBe(repeatsEvery(10));
    expect(errorNote()).toHaveTextContent("First refusal");

    await choose(2);

    expect(pill().textContent).toBe(repeatsEvery(10));
    // Only the latest reason, not a pile of them.
    expect(errorNote()).toHaveTextContent("Second refusal");
    expect(errorNote()).not.toHaveTextContent("First refusal");

    await choose(2);

    expect(pill().textContent).toBe(repeatsEvery(2));
    expect(errorNote()).toBeNull();
  });

  test("the error goes as soon as the next change starts, and stays gone once it is saved", async () => {
    const save: ReturnType<typeof deferred> = deferred();
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockRejectedValueOnce(new Error("Server Error"))
      .mockReturnValueOnce(save.promise);

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(5);

    expect(errorNote()).not.toBeNull();

    await choose(5);

    // The old reason is not left beside a change that may well succeed.
    expect(errorNote()).toBeNull();

    await act(async () => {
      save.resolve();
      await save.promise;
    });

    expect(errorNote()).toBeNull();
    expect(pill().textContent).toBe(repeatsEvery(5));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("the reason sits inside the control, under the pill", async () => {
    renderEditable(
      NO_NOTIFICATION_REPEAT,
      jest.fn<ChangeHandler>().mockRejectedValue(new Error("Server Error")),
    );

    await choose(5);

    expect(within(control()).getByRole("alert")).toBe(errorNote());
    expect(
      pill().compareDocumentPosition(errorNote()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the reason is valid markup", async () => {
    /*
     * A paragraph cannot hold a <div> - and Icon draws one. React warns, and
     * a browser moves the icon out of the paragraph.
     */
    const consoleError: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    renderEditable(
      NO_NOTIFICATION_REPEAT,
      jest.fn<ChangeHandler>().mockRejectedValue(new Error("Server Error")),
    );

    await choose(5);

    const nestingWarnings: Array<unknown> = consoleError.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(call[0]).includes("validateDOMNesting");
      },
    );

    expect(errorNote()).not.toBeNull();
    expect(nestingWarnings).toEqual([]);
  });

  test("a redraw that hands it the same stored interval keeps a saved change", async () => {
    /*
     * The table redraws its rows for reasons of its own, handing every row
     * the interval it loaded - still the old one until it reloads. A saved
     * change must not be undone by that.
     */
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    const { rerender } = renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await choose(5);

    rerender(
      <PushRepeatControl
        repeatEveryMinutes={NO_NOTIFICATION_REPEAT}
        isEditable={true}
        onChange={onChange}
      />,
    );

    expect(pill().textContent).toBe(repeatsEvery(5));
  });

  test("a reload that brings somebody else's change shows it", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    const { rerender } = renderEditable(5, onChange);

    rerender(
      <PushRepeatControl
        repeatEveryMinutes={15}
        isEditable={true}
        onChange={onChange}
      />,
    );

    expect(pill().textContent).toBe(repeatsEvery(15));

    await openMenu();

    expect(screen.getByTestId("push-repeat-option-15")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a value this build does not offer is marked as Don't repeat, which is how it pages", async () => {
    renderEditable(45, jest.fn<ChangeHandler>());

    await openMenu();

    expect(screen.getByTestId("push-repeat-option-0")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen
        .getAllByRole("menuitemradio")
        .filter((option: HTMLElement): boolean => {
          return option.getAttribute("aria-checked") === "true";
        }),
    ).toHaveLength(1);
  });
});

describe("PushRepeatControl - from the keyboard", () => {
  test("is reached with Tab, opened with Enter, and changed with the arrow keys", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    renderEditable(NO_NOTIFICATION_REPEAT, onChange);

    await userTab(user);

    expect(pill()).toHaveFocus();

    await userKeyboard(user, "{Enter}");

    expect(screen.getByRole("menu")).toBeInTheDocument();
    await waitForMenuFocus();

    // Don't repeat -> 1 -> 2 -> 3 minutes.
    await userKeyboard(user, "{ArrowDown}{ArrowDown}{ArrowDown}");

    expect(screen.getByTestId("push-repeat-option-3")).toHaveFocus();

    await userKeyboard(user, "{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(pill().textContent).toBe(repeatsEvery(3));
  });

  test("End reaches the longest interval and Home comes back to Don't repeat", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    renderEditable(5, jest.fn<ChangeHandler>());

    await userClick(user, pill());
    await waitForMenuFocus();

    await userKeyboard(user, "{End}");

    expect(screen.getByTestId("push-repeat-option-30")).toHaveFocus();

    await userKeyboard(user, "{Home}");

    expect(screen.getByTestId("push-repeat-option-0")).toHaveFocus();
  });

  test("Escape closes the menu without changing anything, and hands focus back to the pill", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });
    const onChange: Mock<ChangeHandler> = jest.fn<ChangeHandler>();

    renderEditable(5, onChange);

    await userClick(user, pill());
    await waitForMenuFocus();

    await userKeyboard(user, "{ArrowDown}");

    expect(screen.getByTestId("push-repeat-option-1")).toHaveFocus();

    await userKeyboard(user, "{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(pill()).toHaveFocus();
    expect(pill()).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
    expect(pill().textContent).toBe(repeatsEvery(5));
  });

  test("a read-only pill is not a stop on the way through the page", async () => {
    const user: UserEvent = userEvent.setup({ delay: null });

    render(<PushRepeatControl repeatEveryMinutes={5} isEditable={false} />);

    await userTab(user);

    expect(pill()).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});

describe("PushRepeatControl - in the reader's language", () => {
  const GERMAN: Record<string, string> = {
    "Repeats every {{count}} minutes": "Wiederholt alle {{count}} Minuten",
    "Repeats every {{count}} minutes_one": "Wiederholt jede Minute",
    "Doesn't repeat": "Wiederholt nicht",
    "Don't repeat": "Nicht wiederholen",
    "Every minute": "Jede Minute",
    "Every 5 minutes": "Alle 5 Minuten",
    "Sent again until somebody acknowledges, up to {{count}} more times.":
      "Erneut gesendet, bis jemand bestätigt, bis zu {{count}} weitere Male.",
    "Could not change how often this push repeats.":
      "Konnte nicht ändern, wie oft dieser Push wiederholt wird.",
    "{{repeat}}. Change how often this push repeats until acknowledged.":
      "{{repeat}}. Ändern, wie oft dieser Push bis zur Bestätigung wiederholt wird.",
  };

  beforeEach(() => {
    translations = { ...GERMAN };
    readerLanguage = "de";
  });

  test("the pill reads the reader's words, in the form the number asks for", () => {
    const { rerender } = render(
      <PushRepeatControl repeatEveryMinutes={5} isEditable={false} />,
    );

    expect(pill().textContent).toBe("Wiederholt alle 5 Minuten");

    rerender(<PushRepeatControl repeatEveryMinutes={1} isEditable={false} />);

    expect(pill().textContent).toBe("Wiederholt jede Minute");

    rerender(
      <PushRepeatControl
        repeatEveryMinutes={NO_NOTIFICATION_REPEAT}
        isEditable={false}
      />,
    );

    expect(pill().textContent).toBe("Wiederholt nicht");
  });

  test("its explanation fills in the number of repeats", () => {
    render(<PushRepeatControl repeatEveryMinutes={5} isEditable={false} />);

    expect(pill()).toHaveAttribute(
      "title",
      `Erneut gesendet, bis jemand bestätigt, bis zu ${MAX_NOTIFICATION_REPEATS} weitere Male.`,
    );
  });

  test("its menu offers the intervals in the reader's words", async () => {
    renderEditable(5, jest.fn<ChangeHandler>());

    await openMenu();

    expect(screen.getByTestId("push-repeat-option-0")).toHaveTextContent(
      "Nicht wiederholen",
    );
    expect(screen.getByTestId("push-repeat-option-1")).toHaveTextContent(
      "Jede Minute",
    );
    expect(screen.getByTestId("push-repeat-option-5")).toHaveTextContent(
      "Alle 5 Minuten",
    );
  });

  test("the button's name is one sentence in the reader's language", () => {
    renderEditable(5, jest.fn<ChangeHandler>());

    expect(pill()).toHaveAttribute(
      "aria-label",
      "Wiederholt alle 5 Minuten. Ändern, wie oft dieser Push bis zur Bestätigung wiederholt wird.",
    );
  });

  test("a sentence the language has no wording for stays wholly English, the pill's words included", () => {
    /*
     * The name is one sentence around the pill's words. Half German, half
     * English would read as neither; until the sentence is translated the
     * whole of it - the words it carries too - stays in English.
     */
    delete translations[
      "{{repeat}}. Change how often this push repeats until acknowledged."
    ];

    renderEditable(5, jest.fn<ChangeHandler>());

    expect(pill().textContent).toBe("Wiederholt alle 5 Minuten");
    expect(pill()).toHaveAttribute(
      "aria-label",
      `${repeatsEvery(5)}${ARIA_LABEL_ENDING}`,
    );
  });

  test("a refusal says so in the reader's language, beside the server's own words", async () => {
    renderEditable(
      NO_NOTIFICATION_REPEAT,
      jest
        .fn<ChangeHandler>()
        .mockRejectedValue(new Error("Keine Berechtigung.")),
    );

    await openMenu();

    await act(async () => {
      fireEvent.click(screen.getByTestId("push-repeat-option-5"));
    });

    expect(errorNote()!.textContent).toBe(
      "Konnte nicht ändern, wie oft dieser Push wiederholt wird. Keine Berechtigung.",
    );
  });
});
