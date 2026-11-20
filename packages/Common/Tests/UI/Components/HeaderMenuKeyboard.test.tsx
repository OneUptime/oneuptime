import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import React, { ReactElement, useState } from "react";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import {
  DARK_COLOR_SCHEME_MEDIA_QUERY,
  ThemePreference,
} from "../../../Types/Theme/ThemePreference";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";

/*
 * THE HEADER'S HELP AND PROFILE MENUS, FROM THE KEYBOARD (#7237).
 *
 * Both are drawn as menus (role="menu"), and a menu promises what WAI-ARIA's
 * menu button pattern gives: its rows are menu items, the focus moves into
 * it as it opens (to the first row, or the last when Up opened it), Up and
 * Down move between the rows and round, Home and End go to the first and the
 * last, Escape closes it back onto its button, and Tab leaves it. The
 * theme's Light, Dark and System are menu item radios in a group named
 * Theme, one checked, which Left and Right walk the way the row is drawn:
 * on a page read from the right, Left goes on from Light to Dark. Up and
 * Down never turn round: the rows are one above another in every language.
 *
 * The rows were plain links and buttons the arrows did nothing to, so a
 * screen reader announced a menu and found no item in it, and someone who
 * pressed Down stayed on the button.
 */

let mockLocale: Record<string, unknown> = {};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          if (!value) {
            return value;
          }

          const translated: unknown = mockLocale[value];

          return typeof translated === "string" ? translated : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import HeaderIconDropdownButton from "../../../UI/Components/Header/HeaderIconDropdownButton";
import {
  getHeaderMenuChoiceStep,
  getHeaderMenuItemIndexAfterKey,
  getHeaderMenuItems,
  isHeaderMenuRightToLeft,
} from "../../../UI/Components/Header/HeaderMenuKeyboard";
import IconDropdownItem from "../../../UI/Components/Header/IconDropdown/IconDropdownItem";
import IconDropdownMenu from "../../../UI/Components/Header/IconDropdown/IconDropdownMenu";
import IconDropdownRow from "../../../UI/Components/Header/IconDropdown/IconDropdownRow";
import ThemeChoiceRow from "../../../UI/Components/Header/IconDropdown/ThemeChoiceRow";
import Modal from "../../../UI/Components/Modal/Modal";
import ThemeUtil from "../../../UI/Utils/Theme";

const FEATURE_SET: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const readLocale: (app: string, language: string) => Record<string, unknown> = (
  app: string,
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SET, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
};

// The device's light / dark setting, as the page asks matchMedia for it.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: (query: string): MediaQueryList => {
    return {
      media: query,
      matches: query === DARK_COLOR_SCHEME_MEDIA_QUERY && false,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
    } as unknown as MediaQueryList;
  },
});

interface Recorded {
  opened: Array<string>;
}

const recorded: Recorded = { opened: [] };

/*
 * Help as the Dashboard draws it: pages to open in a new tab, then ways to
 * ask, set apart - one that opens a dialog, one that only acts.
 */
function HelpMenu(): ReactElement {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

  const close: () => void = (): void => {
    setIsOpen(false);
  };

  return (
    <>
      <HeaderIconDropdownButton
        icon={IconProp.Help}
        name="Help"
        showDropdown={isOpen}
        onClick={() => {
          setIsOpen(true);
        }}
      >
        <IconDropdownMenu>
          <IconDropdownRow>
            {["Quickstart", "Glossary", "Documentation"].map(
              (row: string): ReactElement => {
                return (
                  <IconDropdownItem
                    key={row}
                    title={row}
                    icon={IconProp.Book}
                    openInNewTab={true}
                    url={URL.fromString(
                      `https://oneuptime.com/docs/${row.toLowerCase()}`,
                    )}
                    onClick={() => {
                      recorded.opened.push(row);
                      close();
                    }}
                  />
                );
              },
            )}
          </IconDropdownRow>
          <IconDropdownRow isSeparated={true}>
            <IconDropdownItem
              title="Give feedback"
              icon={IconProp.ChatBubbleLeftRight}
              onClick={() => {
                recorded.opened.push("Give feedback");
                close();
                setIsDialogOpen(true);
              }}
            />
            <IconDropdownItem
              title="Keyboard shortcuts"
              icon={IconProp.Keyboard}
              onClick={() => {
                recorded.opened.push("Keyboard shortcuts");
                close();
              }}
            />
          </IconDropdownRow>
        </IconDropdownMenu>
      </HeaderIconDropdownButton>
      {isDialogOpen && (
        <Modal
          title="Give feedback"
          onClose={() => {
            setIsDialogOpen(false);
          }}
          onSubmit={() => {
            setIsDialogOpen(false);
          }}
          submitButtonText="Send"
        >
          <p>What was hard?</p>
        </Modal>
      )}
    </>
  );
}

// The profile menu as the Dashboard draws it: Profile, the theme, Sign Out.
function ProfileMenu(): ReactElement {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <HeaderIconDropdownButton
      icon={IconProp.User}
      name="User Profile"
      showDropdown={isOpen}
      onClick={() => {
        setIsOpen(true);
      }}
    >
      <IconDropdownMenu>
        <IconDropdownItem
          title="Profile"
          icon={IconProp.User}
          onClick={() => {
            recorded.opened.push("Profile");
            setIsOpen(false);
          }}
        />
        <ThemeChoiceRow />
        <IconDropdownItem
          title="Sign Out"
          icon={IconProp.Logout}
          url={URL.fromString("https://oneuptime.example/dashboard/logout")}
          onClick={() => {
            recorded.opened.push("Sign Out");
            setIsOpen(false);
          }}
        />
      </IconDropdownMenu>
    </HeaderIconDropdownButton>
  );
}

function renderHeader(): void {
  render(
    <div>
      <button type="button">Before the menus</button>
      <HelpMenu />
      <ProfileMenu />
      <button type="button">Elsewhere on the page</button>
    </div>,
  );
}

function menuButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: name });
}

function names(elements: Array<HTMLElement>): Array<string> {
  return elements.map((element: HTMLElement): string => {
    return (
      element.getAttribute("aria-label") ||
      element.textContent ||
      ""
    ).trim();
  });
}

beforeEach(() => {
  mockLocale = {};
  recorded.opened = [];
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("dir");
  ThemeUtil.initialize();
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

describe("what the keys do, worked out from the menu", () => {
  test("Up and Down go round, Home and End to the ends, and nothing else moves", () => {
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "ArrowDown", from: 0, count: 3 }),
    ).toBe(1);
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "ArrowDown", from: 2, count: 3 }),
    ).toBe(0);
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "ArrowUp", from: 0, count: 3 }),
    ).toBe(2);
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "ArrowUp", from: -1, count: 3 }),
    ).toBe(2);
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "ArrowDown", from: -1, count: 3 }),
    ).toBe(0);
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "Home", from: 2, count: 3 }),
    ).toBe(0);
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "End", from: 0, count: 3 }),
    ).toBe(2);
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "ArrowLeft", from: 1, count: 3 }),
    ).toBeUndefined();
    expect(
      getHeaderMenuItemIndexAfterKey({ key: "ArrowDown", from: 0, count: 0 }),
    ).toBeUndefined();
  });

  test("Left and Right walk a row of choices the way it is drawn", () => {
    expect(
      getHeaderMenuChoiceStep({ key: "ArrowRight", isRightToLeft: false }),
    ).toBe(1);
    expect(
      getHeaderMenuChoiceStep({ key: "ArrowLeft", isRightToLeft: false }),
    ).toBe(-1);
    // From the right: Light is at the right, and Left goes on to Dark.
    expect(
      getHeaderMenuChoiceStep({ key: "ArrowLeft", isRightToLeft: true }),
    ).toBe(1);
    expect(
      getHeaderMenuChoiceStep({ key: "ArrowRight", isRightToLeft: true }),
    ).toBe(-1);
    expect(
      getHeaderMenuChoiceStep({ key: "ArrowDown", isRightToLeft: true }),
    ).toBe(0);
  });

  test("reads the direction from the element, else from the page", () => {
    const box: HTMLElement = document.createElement("div");
    const inner: HTMLElement = document.createElement("span");

    box.append(inner);
    document.body.append(box);

    expect(isHeaderMenuRightToLeft(inner)).toBe(false);

    document.documentElement.dir = "rtl";
    expect(isHeaderMenuRightToLeft(inner)).toBe(true);

    box.setAttribute("dir", "ltr");
    expect(isHeaderMenuRightToLeft(inner)).toBe(false);

    box.remove();
  });

  test("a locked row takes no focus", () => {
    const menu: HTMLElement = document.createElement("div");

    menu.innerHTML =
      '<a role="menuitem">One</a><button role="menuitem" disabled>Two</button><a role="menuitem" aria-disabled="true">Three</a><button role="menuitemradio">Four</button>';

    expect(names(getHeaderMenuItems(menu))).toEqual(["One", "Four"]);
    expect(getHeaderMenuItems(null)).toEqual([]);
  });
});

describe("the menus are menus a screen reader can walk", () => {
  test("the button says it opens a menu, and which one, while it is open", () => {
    renderHeader();

    const help: HTMLElement = menuButton("Help");

    expect(help).toHaveAttribute("aria-haspopup", "menu");
    expect(help).toHaveAttribute("aria-expanded", "false");
    expect(help).not.toHaveAttribute("aria-controls");

    fireEvent.click(help);

    const menu: HTMLElement = screen.getByRole("menu", { name: "Help" });

    expect(help).toHaveAttribute("aria-expanded", "true");
    expect(help).toHaveAttribute("aria-controls", menu.id);
    expect(menu.id).not.toBe("");
  });

  test("every row is a menu item, none a stop of its own for Tab", () => {
    renderHeader();
    fireEvent.click(menuButton("Help"));

    const menu: HTMLElement = screen.getByRole("menu", { name: "Help" });
    const items: Array<HTMLElement> = within(menu).getAllByRole("menuitem");

    expect(names(items)).toEqual([
      "Quickstart",
      "Glossary",
      "Documentation",
      "Give feedback",
      "Keyboard shortcuts",
    ]);

    for (const item of items) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }

    // Nothing else in the menu is in the Tab order.
    expect(
      within(menu)
        .queryAllByRole("link")
        .concat(within(menu).queryAllByRole("button")),
    ).toEqual([]);
    // A page's row keeps its address: a middle click, a new tab.
    expect(
      within(menu).getByRole("menuitem", { name: "Glossary" }),
    ).toHaveAttribute("href", "https://oneuptime.com/docs/glossary");
  });

  test("the theme is a group named Theme of three menu item radios, the one in use checked", () => {
    renderHeader();
    fireEvent.click(menuButton("User Profile"));

    const menu: HTMLElement = screen.getByRole("menu", {
      name: "User Profile",
    });
    const theme: HTMLElement = within(menu).getByRole("group", {
      name: "Theme",
    });
    const choices: Array<HTMLElement> =
      within(theme).getAllByRole("menuitemradio");

    expect(names(choices)).toEqual(["Light", "Dark", "System"]);
    expect(
      choices.map((choice: HTMLElement): string | null => {
        return choice.getAttribute("aria-checked");
      }),
    ).toEqual(["false", "false", "true"]);
    expect(names(within(menu).getAllByRole("menuitem"))).toEqual([
      "Profile",
      "Sign Out",
    ]);
  });
});

describe("opening a menu puts the focus in it", () => {
  test("a click opens it on its first row", () => {
    renderHeader();
    fireEvent.click(menuButton("Help"));

    expect(screen.getByRole("menuitem", { name: "Quickstart" })).toHaveFocus();
  });

  test("Enter and Space on the button open it on its first row", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    menuButton("Help").focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("menuitem", { name: "Quickstart" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(menuButton("Help")).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();

    await user.keyboard(" ");
    expect(screen.getByRole("menuitem", { name: "Quickstart" })).toHaveFocus();
  });

  test("Down on the button opens it on its first row, Up on its last", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    menuButton("Help").focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("menu", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Quickstart" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await user.keyboard("{ArrowUp}");

    expect(
      screen.getByRole("menuitem", { name: "Keyboard shortcuts" }),
    ).toHaveFocus();
  });
});

describe("the keys inside an open menu", () => {
  test("Down and Up walk every row across its groups, and round", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));

    const visited: Array<string> = [];

    for (let index: number = 0; index < 5; index++) {
      await user.keyboard("{ArrowDown}");
      visited.push(document.activeElement?.textContent || "");
    }

    expect(visited).toEqual([
      "Glossary",
      "Documentation",
      "Give feedback",
      "Keyboard shortcuts",
      "Quickstart",
    ]);

    await user.keyboard("{ArrowUp}");
    expect(
      screen.getByRole("menuitem", { name: "Keyboard shortcuts" }),
    ).toHaveFocus();
  });

  test("Home and End go to the first row and the last", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));

    await user.keyboard("{End}");
    expect(
      screen.getByRole("menuitem", { name: "Keyboard shortcuts" }),
    ).toHaveFocus();

    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Quickstart" })).toHaveFocus();
  });

  test("Escape closes it from any row and gives the focus back to its button", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(menuButton("Help")).toHaveFocus();
    expect(menuButton("Help")).toHaveAttribute("aria-expanded", "false");
  });

  test("Tab closes it and goes on from its button, to the next control", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));
    await user.keyboard("{ArrowDown}");
    await user.tab();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(menuButton("User Profile")).toHaveFocus();
  });

  /*
   * A browser goes on back from the button, where the menu put the focus
   * (NavigationSearch/HeaderMenusKeyboard.spec.ts checks it there); user-event
   * goes back from the row the key was pressed on, which is the button.
   * Either way the menu is closed, and the focus is out of it.
   */
  test("Shift+Tab closes it, and the focus leaves it backwards", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));
    await user.tab({ shift: true });

    expect(screen.queryByRole("menu")).toBeNull();
    expect([
      menuButton("Help"),
      screen.getByRole("button", { name: "Before the menus" }),
    ]).toContain(document.activeElement);
  });
});

describe("pressing a row", () => {
  test("Enter opens a page's row once, closes the menu and leaves the focus on its button", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    menuButton("Help").focus();
    await user.keyboard("{Enter}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Glossary" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(recorded.opened).toEqual(["Glossary"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(menuButton("Help")).toHaveFocus();
  });

  test("Space opens a page's row too, which a link alone would not", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));
    await user.keyboard(" ");

    expect(recorded.opened).toEqual(["Quickstart"]);
    expect(menuButton("Help")).toHaveFocus();
  });

  test("Enter runs an action's row once, never twice", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));
    await user.keyboard("{End}{Enter}");

    expect(recorded.opened).toEqual(["Keyboard shortcuts"]);
    expect(menuButton("Help")).toHaveFocus();
  });

  test("a click on a row closes the menu with the focus on its button", () => {
    renderHeader();
    fireEvent.click(menuButton("User Profile"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Profile" }));

    expect(recorded.opened).toEqual(["Profile"]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(menuButton("User Profile")).toHaveFocus();
  });

  test("a row that opens a dialog gets the focus back on its button when the dialog closes", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("Help"));
    await user.keyboard("{End}{ArrowUp}");
    expect(
      screen.getByRole("menuitem", { name: "Give feedback" }),
    ).toHaveFocus();

    await user.keyboard("{Enter}");

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(menuButton("Help")).toHaveFocus();
  });
});

describe("the theme's choices", () => {
  test("Up and Down reach each choice in its turn, between Profile and Sign Out", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("User Profile"));

    const visited: Array<string> = [];

    for (let index: number = 0; index < 4; index++) {
      await user.keyboard("{ArrowDown}");
      visited.push(
        document.activeElement?.getAttribute("aria-label") ||
          document.activeElement?.textContent ||
          "",
      );
    }

    expect(visited).toEqual(["Light", "Dark", "System", "Sign Out"]);
  });

  test("Left and Right walk the row from the left on an English page", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("User Profile"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveFocus();

    await user.keyboard("{ArrowRight}{ArrowRight}");
    // Round, from System back to Light.
    expect(screen.getByRole("menuitemradio", { name: "Light" })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveFocus();
  });

  test("on a page read from the right, Left goes on and Right goes back, while Up and Down do not turn round", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    document.documentElement.dir = "rtl";
    mockLocale = readLocale("Dashboard", "ar");
    renderHeader();

    const profileName: string = "User Profile";

    fireEvent.click(menuButton(profileName));

    const light: string = mockLocale["Light"] as string;
    const dark: string = mockLocale["Dark"] as string;
    const system: string = mockLocale["System"] as string;

    expect(light).not.toBe("Light");

    // Down still goes down: Profile, then the theme's first choice.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: light })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("menuitemradio", { name: dark })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("menuitemradio", { name: light })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("menuitemradio", { name: system })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: dark })).toHaveFocus();

    // The group is named in Arabic too.
    expect(
      screen.getByRole("group", { name: mockLocale["Theme"] as string }),
    ).toBeInTheDocument();
  });

  test("Enter or Space checks a choice and keeps the menu open, the focus on it", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderHeader();
    fireEvent.click(menuButton("User Profile"));
    await user.keyboard("{ArrowDown}{ArrowDown}");

    const dark: HTMLElement = screen.getByRole("menuitemradio", {
      name: "Dark",
    });

    expect(dark).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menu", { name: "User Profile" })).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveFocus();

    await user.keyboard("{ArrowLeft} ");

    expect(document.documentElement).not.toHaveClass("dark");
    expect(
      screen.getByRole("menuitemradio", { name: "Light" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(ThemeUtil.getPreference()).toBe(ThemePreference.Light);
  });

  test("a click checks a choice and leaves the focus where the pointer put it", async () => {
    renderHeader();
    fireEvent.click(menuButton("User Profile"));

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    });

    expect(document.documentElement).toHaveClass("dark");
    expect(menuButton("User Profile")).not.toHaveFocus();
    expect(screen.getByRole("menu", { name: "User Profile" })).toBeVisible();
  });
});
