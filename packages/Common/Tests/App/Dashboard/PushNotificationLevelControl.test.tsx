import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import React from "react";
import PushNotificationLevelControl, {
  DEVICE_NOT_OPTED_IN_HINT,
  getPushNotificationLevelCardSelectOptions,
  getPushNotificationLevelChoice,
  PUSH_NOTIFICATION_LEVEL_CHOICES,
  PushNotificationLevelChoice,
  SAVE_FAILED_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PushNotificationLevelControl";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import IconProp from "../../../Types/Icon/IconProp";
import PushNotificationLevel, {
  PUSH_NOTIFICATION_LEVELS,
} from "../../../Types/NotificationRule/PushNotificationLevel";

/*
 * The pill under every push rule on the On-Call Rules page: it says how the
 * page will sound, and - for somebody allowed to change the rule - opens a
 * menu to change it there and then.
 *
 * What is pinned here is what a responder relies on when they glance at the
 * page at 6pm to decide whether they will be woken at 3am:
 *
 *   - the pill names the level the rule really has, including the default
 *     for a rule that never chose;
 *   - a change shows at once, and a change the server refused does not stay
 *     on screen pretending it worked;
 *   - "Critical alert" on a phone that has not turned critical alerts on says
 *     so, because the rule alone cannot make that phone ring.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(30000);

// Restated rather than imported where the words ARE the behaviour.
const CRITICAL_TITLE: string = "Critical alert";
const STANDARD_TITLE: string = "Standard";

type ChangeHandler = (level: PushNotificationLevel) => Promise<void>;

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
  return screen.getByTestId("push-notification-level");
}

function pill(): HTMLElement {
  return screen.getByTestId("push-notification-level-pill");
}

async function openMenu(): Promise<void> {
  await act(async () => {
    fireEvent.click(pill());
  });
}

async function choose(title: string): Promise<void> {
  await openMenu();

  const option: HTMLElement = screen.getByRole("menuitemradio", {
    name: title,
  });

  await act(async () => {
    fireEvent.click(option);
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the choices the On-Call Rules page offers", () => {
  test("offers exactly one choice per level, Critical first", () => {
    expect(
      PUSH_NOTIFICATION_LEVEL_CHOICES.map(
        (choice: PushNotificationLevelChoice) => {
          return choice.level;
        },
      ),
    ).toEqual([...PUSH_NOTIFICATION_LEVELS]);
  });

  test("names and explains each level in words a responder recognises", () => {
    const critical: PushNotificationLevelChoice =
      getPushNotificationLevelChoice(PushNotificationLevel.Critical);
    const standard: PushNotificationLevelChoice =
      getPushNotificationLevelChoice(PushNotificationLevel.Standard);

    expect(critical.title).toBe(CRITICAL_TITLE);
    expect(critical.description).toContain("silent");
    expect(critical.description).toContain("Do Not Disturb");
    expect(critical.icon).toBe(IconProp.BellAlert);

    expect(standard.title).toBe(STANDARD_TITLE);
    expect(standard.description).toContain("phone's sound");
    expect(standard.icon).toBe(IconProp.Bell);
  });

  test("gives the two levels different icons, so they differ without colour", () => {
    const icons: Set<IconProp> = new Set(
      PUSH_NOTIFICATION_LEVEL_CHOICES.map(
        (choice: PushNotificationLevelChoice) => {
          return choice.icon;
        },
      ),
    );

    expect(icons.size).toBe(PUSH_NOTIFICATION_LEVEL_CHOICES.length);
  });

  test.each([
    ["an unset level", undefined],
    ["a null level", null],
    ["a level from a newer build", "Quiet"],
  ])(
    "describes %s as the default, Critical",
    (_label: string, value: unknown) => {
      expect(getPushNotificationLevelChoice(value).level).toBe(
        PushNotificationLevel.Critical,
      );
    },
  );

  test("hands the create form one card per level, carrying the stored value", () => {
    const options: Array<CardSelectOption> =
      getPushNotificationLevelCardSelectOptions();

    expect(
      options.map((option: CardSelectOption) => {
        return option.value;
      }),
    ).toEqual([PushNotificationLevel.Critical, PushNotificationLevel.Standard]);

    for (const option of options) {
      const choice: PushNotificationLevelChoice =
        getPushNotificationLevelChoice(option.value);

      expect(option.title).toBe(choice.title);
      expect(option.description).toBe(choice.description);
      expect(option.icon).toBe(choice.icon);
    }
  });
});

describe("PushNotificationLevelControl - what it shows", () => {
  test.each([
    [PushNotificationLevel.Critical, CRITICAL_TITLE],
    [PushNotificationLevel.Standard, STANDARD_TITLE],
  ])("a %s rule reads %s", (level: PushNotificationLevel, title: string) => {
    render(<PushNotificationLevelControl level={level} isEditable={false} />);

    expect(pill()).toHaveTextContent(title);
    expect(control()).toHaveAttribute("data-level", level);
  });

  test.each([
    ["never chose", undefined],
    ["was read with a null level", null],
    ["carries a level this build does not know", "Quiet"],
  ])(
    "a rule that %s reads as the default, Critical",
    (_label: string, level: string | null | undefined) => {
      render(<PushNotificationLevelControl level={level} isEditable={false} />);

      expect(pill()).toHaveTextContent(CRITICAL_TITLE);
      expect(control()).toHaveAttribute(
        "data-level",
        PushNotificationLevel.Critical,
      );
    },
  );

  test("Critical is drawn red and Standard grey, from classes the dark theme re-tints", () => {
    const { unmount } = render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={false}
      />,
    );

    expect(pill().className).toContain("bg-red-50");
    expect(pill().className).toContain("text-red-700");

    unmount();

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Standard}
        isEditable={false}
      />,
    );

    expect(pill().className).toContain("bg-gray-50");
    expect(pill().className).toContain("text-gray-700");
  });

  test("the pill explains its level on hover", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Standard}
        isEditable={false}
      />,
    );

    expect(pill()).toHaveAttribute(
      "title",
      getPushNotificationLevelChoice(PushNotificationLevel.Standard)
        .description,
    );
  });

  test("shows the level the table hands it after a reload", () => {
    const { rerender } = render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={false}
      />,
    );

    rerender(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Standard}
        isEditable={false}
      />,
    );

    expect(pill()).toHaveTextContent(STANDARD_TITLE);
  });
});

describe("PushNotificationLevelControl - who may change it", () => {
  test("a viewer who may not change the rule gets a plain pill, no menu", async () => {
    const onChange: Mock<ChangeHandler> = jest.fn<ChangeHandler>();

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={false}
        onChange={onChange}
      />,
    );

    expect(pill().tagName).toBe("SPAN");
    expect(pill()).not.toHaveAttribute("aria-haspopup");

    await act(async () => {
      fireEvent.click(pill());
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an editable control with nothing to save to is drawn read-only", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
      />,
    );

    expect(pill().tagName).toBe("SPAN");
    expect(pill()).not.toHaveAttribute("aria-haspopup");
  });

  test("an editable control is a menu button that says what it changes", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={jest.fn<ChangeHandler>()}
      />,
    );

    expect(pill().tagName).toBe("BUTTON");
    expect(pill()).toHaveAttribute("aria-haspopup", "menu");
    expect(pill()).toHaveAttribute("aria-expanded", "false");
    expect(pill().getAttribute("aria-label")).toContain(CRITICAL_TITLE);
    expect(pill().getAttribute("aria-label")).toContain(
      "Change how this push sounds",
    );
  });
});

describe("PushNotificationLevelControl - changing the level", () => {
  test("the menu offers both levels and marks the current one", async () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={jest.fn<ChangeHandler>()}
      />,
    );

    await openMenu();

    expect(pill()).toHaveAttribute("aria-expanded", "true");

    const options: Array<HTMLElement> = screen.getAllByRole("menuitemradio");

    expect(
      options.map((option: HTMLElement) => {
        return option.textContent;
      }),
    ).toEqual([CRITICAL_TITLE, STANDARD_TITLE]);

    expect(
      screen.getByRole("menuitemradio", { name: CRITICAL_TITLE }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: STANDARD_TITLE }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("the menu opens under the pill, lined up on its left", async () => {
    /*
     * The pill starts its line in the method cell; a menu lined up on its
     * right edge would hang out past the left of the table.
     */
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={jest.fn<ChangeHandler>()}
      />,
    );

    await openMenu();

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("origin-top-left");
    expect(menu.style.right).toBe("");
    // Portalled out of the table's scroller, like every row's menu.
    expect(menu.parentElement).toBe(document.body);
  });

  test("picking the other level saves it, once", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={onChange}
      />,
    );

    await choose(STANDARD_TITLE);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(PushNotificationLevel.Standard);
    expect(pill()).toHaveTextContent(STANDARD_TITLE);
    expect(control()).toHaveAttribute(
      "data-level",
      PushNotificationLevel.Standard,
    );
  });

  test("Standard back to Critical saves Critical", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Standard}
        isEditable={true}
        onChange={onChange}
      />,
    );

    await choose(CRITICAL_TITLE);

    expect(onChange).toHaveBeenCalledWith(PushNotificationLevel.Critical);
    expect(pill()).toHaveTextContent(CRITICAL_TITLE);
  });

  test("picking the level it already has saves nothing", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockResolvedValue(undefined);

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={onChange}
      />,
    );

    await choose(CRITICAL_TITLE);

    expect(onChange).not.toHaveBeenCalled();
  });

  test("the new level shows before the server answers, and the pill waits for it", async () => {
    const save: ReturnType<typeof deferred> = deferred();
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockReturnValue(save.promise);

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={onChange}
      />,
    );

    await choose(STANDARD_TITLE);

    // Optimistic: the row already reads Standard while the save is in flight.
    expect(pill()).toHaveTextContent(STANDARD_TITLE);
    expect(pill()).toHaveAttribute("aria-busy", "true");
    expect(pill()).toBeDisabled();

    await act(async () => {
      save.resolve();
      await save.promise;
    });

    expect(pill()).toHaveAttribute("aria-busy", "false");
    expect(pill()).not.toBeDisabled();
    expect(pill()).toHaveTextContent(STANDARD_TITLE);
  });

  test("a second change cannot start while the first is saving", async () => {
    const save: ReturnType<typeof deferred> = deferred();
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockReturnValue(save.promise);

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={onChange}
      />,
    );

    await choose(STANDARD_TITLE);

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
  });

  test("a refused change goes back to the stored level and says why", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockRejectedValue(new Error("You do not have permission to do this."));

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={onChange}
      />,
    );

    await choose(STANDARD_TITLE);

    // Never left claiming a level the server did not store.
    expect(pill()).toHaveTextContent(CRITICAL_TITLE);
    expect(control()).toHaveAttribute(
      "data-level",
      PushNotificationLevel.Critical,
    );

    const error: HTMLElement = screen.getByTestId(
      "push-notification-level-error",
    );

    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(SAVE_FAILED_MESSAGE);
    expect(error).toHaveTextContent("You do not have permission to do this.");
    expect(pill()).not.toBeDisabled();
  });

  test("the error clears once a later change is saved", async () => {
    const onChange: Mock<ChangeHandler> = jest
      .fn<ChangeHandler>()
      .mockRejectedValueOnce(new Error("Server Error"))
      .mockResolvedValueOnce(undefined);

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={onChange}
      />,
    );

    await choose(STANDARD_TITLE);

    expect(
      screen.getByTestId("push-notification-level-error"),
    ).toBeInTheDocument();

    await choose(STANDARD_TITLE);

    expect(screen.queryByTestId("push-notification-level-error")).toBeNull();
    expect(pill()).toHaveTextContent(STANDARD_TITLE);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test("the menu closes once a level is picked", async () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        onChange={jest.fn<ChangeHandler>().mockResolvedValue(undefined)}
      />,
    );

    await choose(STANDARD_TITLE);

    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });
});

describe("PushNotificationLevelControl - a phone that has not opted in", () => {
  function hint(): HTMLElement | null {
    return screen.queryByTestId("push-notification-level-device-hint");
  }

  test("a Critical rule on a phone with critical alerts off says it will ring like a standard push", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={false}
        isDeviceCriticalAlertEnabled={false}
      />,
    );

    expect(hint()).not.toBeNull();
    expect(hint()).toHaveTextContent(DEVICE_NOT_OPTED_IN_HINT);
    expect(hint()).toHaveTextContent("Critical On-Call Alerts");
    expect(hint()).toHaveTextContent("OneUptime On-Call app");
  });

  test("a rule that never chose is Critical too, so it gets the note as well", () => {
    render(
      <PushNotificationLevelControl
        level={undefined}
        isEditable={false}
        isDeviceCriticalAlertEnabled={false}
      />,
    );

    expect(hint()).not.toBeNull();
  });

  test("a Critical rule on a phone that opted in needs no note", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={false}
        isDeviceCriticalAlertEnabled={true}
      />,
    );

    expect(hint()).toBeNull();
  });

  test("a Standard rule needs no note - it is not asking to ring through", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Standard}
        isEditable={false}
        isDeviceCriticalAlertEnabled={false}
      />,
    );

    expect(hint()).toBeNull();
  });

  test("says nothing when the page cannot read the phone (somebody else's rules)", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={false}
      />,
    );

    expect(hint()).toBeNull();
  });

  test("the note goes as soon as the rule is switched to Standard", async () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        isDeviceCriticalAlertEnabled={false}
        onChange={jest.fn<ChangeHandler>().mockResolvedValue(undefined)}
      />,
    );

    expect(hint()).not.toBeNull();

    await choose(STANDARD_TITLE);

    expect(hint()).toBeNull();
  });

  test("the note is valid markup - its icon is not nested inside a paragraph", () => {
    /*
     * Icon draws a <div>, which a <p> cannot hold; React warns, and a browser
     * re-parents the icon out of the note.
     */
    const consoleError: SpyInstance<typeof console.error> = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={true}
        isDeviceCriticalAlertEnabled={false}
        onChange={jest.fn<ChangeHandler>()}
      />,
    );

    const nestingWarnings: Array<unknown> = consoleError.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(call[0]).includes("validateDOMNesting");
      },
    );

    expect(nestingWarnings).toEqual([]);
  });

  test("the note sits inside the control, under the pill", () => {
    render(
      <PushNotificationLevelControl
        level={PushNotificationLevel.Critical}
        isEditable={false}
        isDeviceCriticalAlertEnabled={false}
      />,
    );

    expect(
      within(control()).getByTestId("push-notification-level-device-hint"),
    ).toBeInTheDocument();
  });
});
