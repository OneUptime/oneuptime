import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { NavigateFunction } from "react-router-dom";
import IconProp from "../../../Types/Icon/IconProp";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectPicker, {
  getProjectPickerIds,
  ProjectPickerIds,
} from "../../../UI/Components/Header/ProjectPicker/ProjectPicker";
import { PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME } from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenuItem";
import {
  CREATE_PROJECT_ACTIVE_ROW_CLASS_NAME,
  CREATE_PROJECT_ROW_CLASS_NAME,
} from "../../../UI/Components/Header/ProjectPicker/CreateNewProjectButton";
import { PROJECT_PICKER_LIST_CLASS_NAME } from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenu";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * THE PROJECT PICKER'S LIST, AS A SCREEN READER AND THE KEYBOARD MEET IT
 * (#7487).
 *
 * The list was a listbox named by an id no element had (listbox-label), with
 * its search box drawn inside it, every row sharing the one id
 * listbox-option-0, and aria-activedescendant fixed on listbox-option-3, a
 * row that never existed. Its rows could not be reached from the keyboard
 * at all. Now:
 *
 *  - the list is a listbox named "Projects" in the reader's language,
 *    holding its rows and nothing else;
 *  - every row has an id of its own, unique on the page, with two pickers
 *    on it too;
 *  - the search box above the list is its combobox, named by its label
 *    ("Search Projects"), and names the row the arrow keys are on;
 *  - Down and Up move through the rows, Enter opens the row, Escape puts
 *    the list away and gives the focus back to the picker;
 *  - the list opened from the keyboard puts the focus in its search box,
 *    the list opened with the pointer leaves it where it was.
 */

const PRODUCTION_ID: string = "b7000000-0000-4000-8000-0000000000c1";
const STAGING_ID: string = "b7000000-0000-4000-8000-0000000000c2";
const SANDBOX_ID: string = "b7000000-0000-4000-8000-0000000000c3";

function project(id: string, name: string): Project {
  const item: Project = new Project();
  item._id = id;
  item.name = name;
  return item;
}

const PROJECTS: Array<Project> = [
  project(PRODUCTION_ID, "Acme Production"),
  project(STAGING_ID, "Acme Staging"),
  project(SANDBOX_ID, "Sandbox"),
];

let calls: Array<string>;

function picker(
  props: {
    selectedProjectName?: string;
    hideCreateProjectButton?: boolean;
  } = {},
): React.ReactElement {
  return (
    <ProjectPicker
      projects={PROJECTS}
      selectedProjectIcon={IconProp.Folder}
      selectedProjectName={props.selectedProjectName || "Acme Production"}
      hideCreateProjectButton={props.hideCreateProjectButton}
      onCreateProjectButtonClicked={() => {
        calls.push("create");
      }}
      onProjectSelected={(selected: Project) => {
        calls.push(`selected ${selected.name}`);
      }}
    />
  );
}

function pickerButton(name: string = "Acme Production"): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(name) });
}

// A click or a tap: the browser counts it (detail 1).
function openWithPointer(button: HTMLElement = pickerButton()): void {
  fireEvent.click(button, { detail: 1 });
}

// Enter or Space on the picker: a click with no pointer (detail 0).
function openWithEnter(button: HTMLElement = pickerButton()): void {
  act(() => {
    button.focus();
  });
  fireEvent.click(button, { detail: 0 });
}

function listbox(): HTMLElement {
  return screen.getByRole("listbox");
}

function searchBox(): HTMLElement {
  return screen.getByRole("combobox");
}

function optionIds(): Array<string> {
  return within(listbox())
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.id;
    });
}

function activeOptionId(): string | null {
  return searchBox().getAttribute("aria-activedescendant");
}

function press(key: string): void {
  fireEvent.keyDown(searchBox(), { key: key });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  calls = [];
  LeaveGuard.reset();
  window.history.replaceState(
    { usr: null, key: "p1", idx: 0 },
    "",
    `/dashboard/${PRODUCTION_ID}/home`,
  );
  Navigation.setNavigateHook(((to: string) => {
    calls.push(`navigate ${to}`);
  }) as unknown as NavigateFunction);
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
});

describe("the list a screen reader meets", () => {
  test("is a listbox named Projects, holding the projects and Create New Project, and nothing else", () => {
    render(picker());
    openWithPointer();

    const list: HTMLElement = screen.getByRole("listbox", {
      name: "Projects",
    });
    const options: Array<HTMLElement> = within(list).getAllByRole("option");

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      "Acme Production",
      "Acme Staging",
      "Sandbox",
      "Create New Project",
    ]);
    // The search box sits above the list, outside it.
    expect(within(list).queryByRole("combobox")).toBeNull();
    expect(within(list).queryByRole("textbox")).toBeNull();
    expect(list.contains(searchBox())).toBe(false);
    expect(list.children).toHaveLength(options.length);
    // Not named by an id no element has.
    expect(list).not.toHaveAttribute("aria-labelledby");
  });

  test("every row has an id of its own: none shared, none the old listbox-option-0, each project's naming the project", () => {
    render(picker());
    openWithPointer();

    const ids: Array<string> = optionIds();

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("listbox-option-0");

    for (const id of ids) {
      expect(id).toMatch(/^project-picker-/);
      // A valid id to name in aria-activedescendant: no colons, no spaces.
      expect(id).not.toMatch(/[:\s]/);
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }

    expect(ids[0]).toContain(PRODUCTION_ID);
    expect(ids[1]).toContain(STAGING_ID);
    expect(ids[2]).toContain(SANDBOX_ID);
  });

  test("two pickers on one page never share an id", () => {
    render(
      <>
        {picker({ selectedProjectName: "Acme Production" })}
        {picker({ selectedProjectName: "Acme Staging" })}
      </>,
    );

    openWithPointer(pickerButton("Acme Production"));
    const first: Array<string> = [...optionIds(), listbox().id, searchBox().id];
    openWithPointer(pickerButton("Acme Production"));
    expect(screen.queryByRole("listbox")).toBeNull();

    openWithPointer(pickerButton("Acme Staging"));
    const second: Array<string> = [
      ...optionIds(),
      listbox().id,
      searchBox().id,
    ];

    expect(second).toHaveLength(first.length);
    expect(
      second.filter((id: string): boolean => {
        return first.includes(id);
      }),
    ).toEqual([]);
  });

  test("the search box is the list's combobox, named by its label, and names the row the keys are on", () => {
    render(picker());
    openWithPointer();

    const box: HTMLElement = screen.getByRole("combobox", {
      name: "Search Projects",
    });
    const label: HTMLLabelElement = document.querySelector(
      `label[for="${box.id}"]`,
    ) as HTMLLabelElement;

    expect(label).not.toBeNull();
    expect(label).toHaveTextContent("Search Projects");
    expect(box).toHaveAttribute("aria-controls", listbox().id);
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveAttribute("aria-autocomplete", "list");
    expect(box).toHaveAttribute("placeholder", "Search projects...");
    // The first row, and a row that is on the page.
    expect(activeOptionId()).toBe(optionIds()[0]);
    expect(document.getElementById(activeOptionId()!)).not.toBeNull();
  });

  test("the picker says whether its list is open", () => {
    render(picker());

    const button: HTMLElement = pickerButton();
    expect(button).toHaveAttribute("aria-haspopup", "listbox");
    expect(button).toHaveAttribute("aria-expanded", "false");

    openWithPointer(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the list from the keyboard", () => {
  test("Enter on the picker opens the list with the focus in its search box", () => {
    render(picker());
    openWithEnter();

    expect(searchBox()).toHaveFocus();
    expect(activeOptionId()).toBe(optionIds()[0]);
  });

  test("Down or Up on the closed picker opens the list, with the focus in its search box", () => {
    render(picker());

    fireEvent.keyDown(pickerButton(), { key: "ArrowDown" });
    expect(searchBox()).toHaveFocus();

    press("Escape");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.keyDown(pickerButton(), { key: "ArrowUp" });
    expect(searchBox()).toHaveFocus();
  });

  test("a click or a tap opens the list and leaves the focus where it was, so a phone's keyboard does not cover it", () => {
    render(picker());
    openWithPointer();

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(searchBox()).not.toHaveFocus();
  });

  test("Down and Up move through the rows, stopping at either end, and the row says it is the one", () => {
    render(picker());
    openWithEnter();

    const ids: Array<string> = optionIds();
    const expectActive: (index: number) => void = (index: number): void => {
      expect(activeOptionId()).toBe(ids[index]);
      within(listbox())
        .getAllByRole("option")
        .forEach((option: HTMLElement, at: number) => {
          expect({
            row: at,
            selected: option.getAttribute("aria-selected"),
          }).toEqual({ row: at, selected: at === index ? "true" : "false" });
        });
    };

    expectActive(0);
    press("ArrowDown");
    expectActive(1);
    press("ArrowDown");
    press("ArrowDown");
    expectActive(3);
    // The last row stays the last: no wrap to the top.
    press("ArrowDown");
    expectActive(3);
    press("ArrowUp");
    expectActive(2);
    press("ArrowUp");
    press("ArrowUp");
    press("ArrowUp");
    expectActive(0);
  });

  test("the keyboard's row is drawn as picked out while the search box has the focus, and not after", () => {
    render(picker());
    openWithEnter();
    press("ArrowDown");

    const staging: HTMLElement = document.getElementById(optionIds()[1]!)!;
    const production: HTMLElement = document.getElementById(optionIds()[0]!)!;
    expect(staging).toHaveClass(PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME);
    expect(production).not.toHaveClass(PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME);

    fireEvent.blur(searchBox());
    expect(staging).not.toHaveClass(PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME);
  });

  test("the keyboard's row takes the ground Search's row takes under its cursor, not a hover's near-white gray", () => {
    /*
     * A hover's bg-gray-50 is all but white on the white list: a keyboard
     * user could not see which row Enter opens. Search (Ctrl K) draws its
     * cursor row bg-indigo-50, and so does this list.
     */
    expect(PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME).toBe("bg-indigo-50");

    render(picker());
    openWithEnter();

    const first: HTMLElement = document.getElementById(optionIds()[0]!)!;
    expect(first).toHaveClass("bg-indigo-50");
    // The pointer's own ground stays the light gray, for a row it passes over.
    expect(first.className).toContain("hover:bg-gray-50");
    expect(first.className.split(" ")).not.toContain("bg-gray-50");
  });

  test("Create New Project under the keyboard takes a deeper ground and a stronger edge than at rest", () => {
    render(picker());
    openWithEnter();

    const createRow: HTMLElement = within(listbox())
      .getByText("Create New Project")
      .closest('[role="option"]') as HTMLElement;

    // At rest: its own light indigo row.
    for (const name of CREATE_PROJECT_ROW_CLASS_NAME.split(" ")) {
      expect(createRow).toHaveClass(name);
    }

    for (let step: number = 0; step < PROJECTS.length; step++) {
      press("ArrowDown");
    }
    expect(activeOptionId()).toBe(createRow.id);

    for (const name of CREATE_PROJECT_ACTIVE_ROW_CLASS_NAME.split(" ")) {
      expect(createRow).toHaveClass(name);
    }
    /*
     * The dark theme gives bg-indigo-50 and bg-indigo-100 the one wash
     * (Theme.css), so the edge must change too, or a keyboard user in the
     * dark theme could not tell the row is the one Enter opens.
     */
    const restingEdge: string | undefined = CREATE_PROJECT_ROW_CLASS_NAME.split(
      " ",
    ).find((name: string): boolean => {
      return name.startsWith("border-");
    });
    const activeEdge: string | undefined =
      CREATE_PROJECT_ACTIVE_ROW_CLASS_NAME.split(" ").find(
        (name: string): boolean => {
          return name.startsWith("border-");
        },
      );
    expect(restingEdge).toBeDefined();
    expect(activeEdge).toBeDefined();
    expect(activeEdge).not.toBe(restingEdge);
    expect(createRow).not.toHaveClass(restingEdge!);

    fireEvent.blur(searchBox());
    expect(createRow).toHaveClass(restingEdge!);
    expect(createRow).not.toHaveClass(activeEdge!);
  });

  test("the list scrolls under the search box past six and a half rows, so a cut row says there are more", () => {
    render(picker());
    openWithPointer();

    expect(PROJECT_PICKER_LIST_CLASS_NAME).toContain("overflow-auto");
    // 16rem of 40px rows: never a whole number of rows (15rem was six).
    expect(PROJECT_PICKER_LIST_CLASS_NAME).toContain("max-h-64");
    for (const name of PROJECT_PICKER_LIST_CLASS_NAME.split(" ")) {
      expect(listbox()).toHaveClass(name);
    }
    // The search box stays put above the scrolling list, outside it.
    expect(listbox()).not.toContainElement(searchBox());
  });

  test("the pointer over a row makes it the keyboard's row", () => {
    render(picker());
    openWithEnter();

    fireEvent.mouseMove(screen.getByText("Sandbox"));
    expect(activeOptionId()).toBe(optionIds()[2]);

    press("ArrowUp");
    expect(activeOptionId()).toBe(optionIds()[1]);
  });

  test("typing narrows the list and starts again on its first row", () => {
    render(picker());
    openWithEnter();
    press("ArrowDown");
    press("ArrowDown");

    fireEvent.change(searchBox(), { target: { value: "acme" } });

    expect(
      within(listbox())
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.textContent || "";
        }),
    ).toEqual(["Acme Production", "Acme Staging", "Create New Project"]);
    expect(activeOptionId()).toBe(optionIds()[0]);

    press("ArrowDown");
    press("ArrowDown");
    // Sandbox is not listed: Down goes from Acme Staging to Create New Project.
    expect(document.getElementById(activeOptionId()!)).toHaveTextContent(
      "Create New Project",
    );
  });

  test("Enter opens the project the keys are on, through the page's leave guard", () => {
    render(picker());
    openWithEnter();
    press("ArrowDown");
    press("Enter");

    expect(calls).toEqual([
      "selected Acme Staging",
      `navigate /dashboard/${STAGING_ID}`,
    ]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("Enter on Create New Project creates one", () => {
    render(picker());
    openWithEnter();
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");

    expect(calls).toEqual(["create"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("without Create New Project, Down stops at the last project", () => {
    render(picker({ hideCreateProjectButton: true }));
    openWithEnter();

    expect(optionIds()).toHaveLength(3);
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    expect(activeOptionId()).toBe(optionIds()[2]);
    press("Enter");
    expect(calls).toEqual([
      "selected Sandbox",
      `navigate /dashboard/${SANDBOX_ID}`,
    ]);
  });

  test("a search that lists nothing but Create New Project still opens it on Enter", () => {
    render(picker());
    openWithEnter();
    fireEvent.change(searchBox(), { target: { value: "zzz" } });

    expect(optionIds()).toHaveLength(1);
    press("ArrowDown");
    press("Enter");
    expect(calls).toEqual(["create"]);
  });

  test("Tab moves the focus on and puts the list away behind it, after the focus has moved", async () => {
    render(picker());
    openWithEnter();
    expect(listbox()).toBeInTheDocument();

    press("Tab");
    // Not before the browser moves the focus: the box is still there.
    expect(screen.queryByRole("listbox")).toBeInTheDocument();
    expect(searchBox()).toBeInTheDocument();

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  test("Escape puts the list away and gives the focus back to the picker", () => {
    render(picker());
    openWithEnter();
    press("Escape");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(pickerButton()).toHaveFocus();
    expect(pickerButton()).toHaveAttribute("aria-expanded", "false");
    expect(calls).toEqual([]);
  });
});

describe("the ids", () => {
  test("are React's id for the picker without its colons, and a project's id for its row", () => {
    const ids: ProjectPickerIds = getProjectPickerIds(":r5:");

    expect(ids.listbox).toBe("project-picker-r5-list");
    expect(ids.search).toBe("project-picker-r5-search");
    expect(ids.createRow).toBe("project-picker-r5-create");
    expect(ids.projectRow(PROJECTS[1]!, 1)).toBe(
      `project-picker-r5-project-${STAGING_ID}`,
    );
    // A project not saved yet has no id: its row's place stands in.
    expect(ids.projectRow(new Project(), 4)).toBe(
      "project-picker-r5-project-row-4",
    );
    expect(getProjectPickerIds(":r6:").listbox).not.toBe(ids.listbox);
  });
});

describe("in the reader's language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  function readLocale(language: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, unknown>;
  }

  async function russian(): Promise<i18n> {
    const instance: i18n = createInstance();
    await instance.init({
      lng: "ru",
      fallbackLng: "en",
      resources: {
        en: { translation: readLocale("en") },
        ru: { translation: readLocale("ru") },
      },
      interpolation: { escapeValue: false },
    });
    return instance;
  }

  test("the list and its search box are named in Russian", async () => {
    const ru: Record<string, unknown> = readLocale("ru");
    const instance: i18n = await russian();

    render(<I18nextProvider i18n={instance}>{picker()}</I18nextProvider>);
    openWithEnter();

    expect(ru["Projects"]).not.toBe("Projects");
    expect(ru["Search Projects"]).not.toBe("Search Projects");
    expect(
      screen.getByRole("listbox", { name: ru["Projects"] as string }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: ru["Search Projects"] as string }),
    ).toHaveFocus();
    expect(screen.queryByRole("listbox", { name: "Projects" })).toBeNull();
  });
});
