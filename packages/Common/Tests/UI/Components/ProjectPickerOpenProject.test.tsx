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
import path from "path";
import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { NavigateFunction } from "react-router-dom";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectPicker, {
  getProjectPickerIds,
  isOpenProject,
} from "../../../UI/Components/Header/ProjectPicker/ProjectPicker";
import ProjectPickerMenuItem, {
  PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME,
  PROJECT_PICKER_OPEN_PROJECT_MARK_CLASS_NAME,
  PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID,
} from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenuItem";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * THE PROJECT LIST MARKS THE OPEN PROJECT (#8050).
 *
 * The header's project list drew every row alike, so with 14 projects
 * nothing in it said which one the person was in - the picker's button
 * says it, cut short on a phone ("Acme Commer…") - and the keyboard
 * started on the first row wherever the person was. Now:
 *
 *  - the open project's row shows the products menu's dot for the page
 *    the person is on, right after its name, small enough that a whole
 *    name still fits beside it on a 320px phone, and says
 *    "current" to a screen reader (aria-current), found by its id, never
 *    its name: two projects may share one;
 *  - the list opened from the keyboard starts on it, a search starts on
 *    its best match, and a search cleared starts on it again;
 *  - it is scrolled into view as the list opens, however the list was
 *    opened, so someone in many projects sees where they are.
 *
 * The search that finds a project by any word, and the line that says a
 * search found none, came with #9145 (ProjectPickerSearchResults).
 */

// A project's search is counted: the mark must add none (someone in many projects).
let mockSearchRuns: number = 0;

jest.mock("../../../UI/Components/Header/ProjectPicker/ProjectSearch", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Header/ProjectPicker/ProjectSearch",
  ) as Record<string, unknown>;
  const create: (projects: Array<unknown>) => (text: string) => unknown =
    actual["createProjectSearch"] as (
      projects: Array<unknown>,
    ) => (text: string) => unknown;

  return {
    ...actual,
    createProjectSearch: (projects: Array<unknown>) => {
      const search: (text: string) => unknown = create(projects);

      return (text: string): unknown => {
        mockSearchRuns++;
        return search(text);
      };
    },
  };
});

const PRODUCTION_ID: string = "b7000000-0000-4000-8000-0000000000d1";
const STAGING_ID: string = "b7000000-0000-4000-8000-0000000000d2";
const SANDBOX_ID: string = "b7000000-0000-4000-8000-0000000000d3";
const PERSONAL_ID: string = "b7000000-0000-4000-8000-0000000000d4";
const TEST_ONE_ID: string = "b7000000-0000-4000-8000-0000000000d5";
const TEST_TWO_ID: string = "b7000000-0000-4000-8000-0000000000d6";

function project(id: string, name: string, isBlocked?: boolean): Project {
  const item: Project = new Project();
  item._id = id;
  item.name = name;

  if (isBlocked) {
    item.isBlocked = true;
  }

  return item;
}

const PROJECTS: Array<Project> = [
  project(PRODUCTION_ID, "Acme Production"),
  project(STAGING_ID, "Acme Staging"),
  project(SANDBOX_ID, "Sandbox"),
  project(PERSONAL_ID, "Personal"),
];

let calls: Array<string>;

function picker(
  props: {
    projects?: Array<Project>;
    selectedProjectId?: ObjectID | string | null;
    selectedProjectName?: string;
  } = {},
): React.ReactElement {
  return (
    <ProjectPicker
      projects={props.projects || PROJECTS}
      selectedProjectIcon={IconProp.Folder}
      selectedProjectName={props.selectedProjectName || "Acme Staging"}
      selectedProjectId={
        props.selectedProjectId === undefined
          ? STAGING_ID
          : props.selectedProjectId
      }
      onCreateProjectButtonClicked={() => {
        calls.push("create");
      }}
      onProjectSelected={(selected: Project) => {
        calls.push(`selected ${selected.id?.toString()}`);
      }}
    />
  );
}

function pickerButton(): HTMLElement {
  return screen.getByRole("button", { expanded: false });
}

// A click or a tap: the browser counts it (detail 1).
function openWithPointer(): void {
  fireEvent.click(pickerButton(), { detail: 1 });
}

// Enter or Space on the picker: a click with no pointer (detail 0).
function openWithEnter(): void {
  const button: HTMLElement = pickerButton();

  act(() => {
    button.focus();
  });
  fireEvent.click(button, { detail: 0 });
}

function closeWithEscape(): void {
  fireEvent.keyDown(searchBox(), { key: "Escape" });
}

function listbox(): HTMLElement {
  return screen.getByRole("listbox");
}

function searchBox(): HTMLElement {
  return screen.getByRole("combobox");
}

function options(): Array<HTMLElement> {
  return within(listbox()).getAllByRole("option");
}

function optionFor(id: string): HTMLElement {
  return options().find((option: HTMLElement): boolean => {
    return option.id.endsWith(`-project-${id}`);
  }) as HTMLElement;
}

// The projects' rows, without Create New Project (always tinted, as an action).
function projectOptions(): Array<HTMLElement> {
  return options().filter((option: HTMLElement): boolean => {
    return option.id.includes("-project-");
  });
}

function markedOptions(): Array<HTMLElement> {
  return options().filter((option: HTMLElement): boolean => {
    return option.getAttribute("aria-current") === "true";
  });
}

function activeOptionId(): string | null {
  return searchBox().getAttribute("aria-activedescendant");
}

function press(key: string): void {
  fireEvent.keyDown(searchBox(), { key: key });
}

function type(text: string): void {
  fireEvent.change(searchBox(), { target: { value: text } });
}

let scrolledTo: Array<string>;

beforeAll(() => {
  Element.prototype.scrollIntoView = function (this: Element): void {
    scrolledTo.push(this.id);
  };
});

beforeEach(() => {
  calls = [];
  scrolledTo = [];
  mockSearchRuns = 0;
  LeaveGuard.reset();
  window.history.replaceState(
    { usr: null, key: "p1", idx: 0 },
    "",
    `/dashboard/${STAGING_ID}/home`,
  );
  Navigation.setNavigateHook(((to: string) => {
    calls.push(`navigate ${to}`);
  }) as unknown as NavigateFunction);
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
});

describe("the open project's row is marked", () => {
  test("it says so to a screen reader and shows a dot after its name; no other row does", () => {
    render(picker());
    openWithPointer();

    const staging: HTMLElement = optionFor(STAGING_ID);

    expect(markedOptions()).toEqual([staging]);
    expect(staging).toHaveAttribute("aria-current", "true");
    expect(
      within(staging).getByTestId(PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID),
    ).toBeInTheDocument();

    for (const option of options()) {
      if (option === staging) {
        continue;
      }

      expect(option).not.toHaveAttribute("aria-current");
      expect(
        within(option).queryByTestId(PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID),
      ).toBeNull();
    }
  });

  test("the dot is for the eye only: hidden from a screen reader, and the row's words stay the project's name", () => {
    render(picker());
    openWithPointer();

    const staging: HTMLElement = optionFor(STAGING_ID);
    const mark: HTMLElement = within(staging).getByTestId(
      PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID,
    );

    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(staging.textContent).toBe("Acme Staging");
    // The row a screen reader hears is the project, then "current".
    expect(
      screen.getByRole("option", { name: "Acme Staging", current: true }),
    ).toBe(staging);
  });

  test("the dot comes right after the name, 6px from it, and never shrinks, so a long name cut short still shows it", () => {
    render(
      picker({
        projects: [
          project(
            STAGING_ID,
            "Acme Commerce Production for the Northern Region and Beyond",
          ),
          project(SANDBOX_ID, "Sandbox"),
        ],
      }),
    );
    openWithPointer();

    const row: HTMLElement = optionFor(STAGING_ID);
    const name: HTMLElement = within(row).getByText(
      "Acme Commerce Production for the Northern Region and Beyond",
    );
    const mark: HTMLElement = within(row).getByTestId(
      PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID,
    );

    expect(name.closest("span[dir='auto']")?.nextElementSibling).toBe(mark);
    expect(mark.getAttribute("class")).toBe(
      PROJECT_PICKER_OPEN_PROJECT_MARK_CLASS_NAME,
    );
    /*
     * A 6px dot that keeps its room, pulled 6px back from the row's 12px
     * gap on the reading side (margin-inline-start), and nothing inside it.
     */
    expect(PROJECT_PICKER_OPEN_PROJECT_MARK_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "flex-shrink-0",
        "h-1.5",
        "w-1.5",
        "rounded-full",
        "-ms-1.5",
      ]),
    );
    expect(PROJECT_PICKER_OPEN_PROJECT_MARK_CLASS_NAME).not.toMatch(
      /(^|\s)-?m[lr]-/,
    );
    expect(mark.childElementCount).toBe(0);
  });

  test("it is the products menu's dot for the page the person is on: one mark for where you are", () => {
    const productsMenu: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/Navbar/NavBarMenuModal.tsx"),
      "utf8",
    );
    const productsMenuDot: RegExpMatchArray | null = productsMenu.match(
      /\{isCurrent && \(\s*<span\s+aria-hidden="true"\s+className="([^"]+)"/,
    );

    expect(productsMenuDot).not.toBeNull();

    // The same size, shape and colour; the picker adds only its spacing.
    expect(
      PROJECT_PICKER_OPEN_PROJECT_MARK_CLASS_NAME.split(" ")
        .filter((name: string): boolean => {
          return name !== "-ms-1.5";
        })
        .sort(),
    ).toEqual(productsMenuDot![1]!.split(" ").sort());
  });

  test("two projects with the same name are told apart by id: only the open one is marked", () => {
    const twins: Array<Project> = [
      project(TEST_ONE_ID, "Test Project"),
      project(TEST_TWO_ID, "Test Project"),
    ];

    render(
      picker({
        projects: twins,
        selectedProjectId: TEST_TWO_ID,
        selectedProjectName: "Test Project",
      }),
    );
    openWithPointer();

    expect(markedOptions()).toEqual([optionFor(TEST_TWO_ID)]);
    expect(optionFor(TEST_ONE_ID)).not.toHaveAttribute("aria-current");
  });

  test("the open project is found by an ObjectID as well as by its id's text", () => {
    render(picker({ selectedProjectId: new ObjectID(SANDBOX_ID) }));
    openWithPointer();

    expect(markedOptions()).toEqual([optionFor(SANDBOX_ID)]);
  });

  test("with no open project told, no row is marked", () => {
    render(picker({ selectedProjectId: null }));
    openWithPointer();

    expect(markedOptions()).toEqual([]);
    expect(
      screen.queryByTestId(PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID),
    ).toBeNull();
  });

  test("the mark goes with the open project's row: kept while a search lists it, gone while it does not", () => {
    render(picker());
    openWithPointer();

    type("acme");
    expect(markedOptions()).toEqual([optionFor(STAGING_ID)]);

    type("sandbox");
    expect(
      options().map((option: HTMLElement) => {
        return option.textContent;
      }),
    ).toEqual(["Sandbox", "Create New Project"]);
    expect(markedOptions()).toEqual([]);

    type("");
    expect(markedOptions()).toEqual([optionFor(STAGING_ID)]);
  });

  test("an open project a master admin blocked shows its dot, then its Blocked pill at the row's end", () => {
    render(
      picker({
        projects: [
          project(STAGING_ID, "Acme Staging", true),
          project(SANDBOX_ID, "Sandbox"),
        ],
      }),
    );
    openWithPointer();

    const row: HTMLElement = optionFor(STAGING_ID);
    const mark: HTMLElement = within(row).getByTestId(
      PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID,
    );
    const blocked: HTMLElement = within(row).getByTestId(
      "project-picker-blocked",
    );

    expect(mark.nextElementSibling).toBe(blocked);
    // At the row's end on the page's side: start and end, never left.
    expect(blocked.className).toContain("ms-auto");
    expect(blocked.className).not.toContain("ml-auto");
  });

  test("on a page read from the right, the dot still follows the name: the row's order is the page's", () => {
    render(
      <div dir="rtl">
        <ProjectPickerMenuItem
          id="project-picker-row-rtl"
          icon={IconProp.Folder}
          project={project(STAGING_ID, "پروژه آکمه")}
          isOpenProject={true}
          onProjectSelected={() => {}}
        />
      </div>,
    );

    const row: HTMLElement = screen.getByRole("option");
    const name: HTMLElement = within(row).getByText("پروژه آکمه");
    const mark: HTMLElement = within(row).getByTestId(
      PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID,
    );

    // The name reads its own way, and the dot comes after it in the flow.
    expect(name.closest("span[dir='auto']")).not.toBeNull();
    expect(
      name.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Drawn in a flex row, which lays its items out in the page's direction.
    expect(mark.parentElement?.className).toContain("flex");
    expect(row).toHaveAttribute("aria-current", "true");
  });

  /*
   * Indigo-500 is 4.5:1 on the light theme's white list and 3.6:1 on the
   * dark theme's (#172033), both over the 3:1 a mark that means something needs
   * (WCAG 1.4.11): the dark theme leaves it as it is, as it does the
   * products menu's (Playwright measures both, ProjectPickerSearch.spec).
   */
  test("in the dark theme the dot keeps its indigo, as the products menu's does", () => {
    const theme: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Styles/Theme.css"),
      "utf8",
    );

    expect(PROJECT_PICKER_OPEN_PROJECT_MARK_CLASS_NAME).toContain(
      "bg-indigo-500",
    );
    expect(theme).not.toMatch(/\.bg-indigo-500(?![/\w-])/);
  });
});

describe("the keyboard starts on the open project", () => {
  test("opened with Enter, the search box names the open project's row, drawn as the keyboard's row", () => {
    render(picker());
    openWithEnter();

    const staging: HTMLElement = optionFor(STAGING_ID);

    expect(document.activeElement).toBe(searchBox());
    expect(activeOptionId()).toBe(staging.id);
    expect(staging).toHaveAttribute("aria-selected", "true");
    expect(staging.className).toContain(PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME);
  });

  test("Down and Up move from the open project to its neighbours, and its mark stays put", () => {
    render(picker());
    openWithEnter();

    press("ArrowDown");
    expect(activeOptionId()).toBe(optionFor(SANDBOX_ID).id);
    expect(markedOptions()).toEqual([optionFor(STAGING_ID)]);

    press("ArrowUp");
    press("ArrowUp");
    expect(activeOptionId()).toBe(optionFor(PRODUCTION_ID).id);
    expect(markedOptions()).toEqual([optionFor(STAGING_ID)]);
  });

  test("Enter at once opens the open project, the row it started on", () => {
    render(picker());
    openWithEnter();
    press("Enter");

    expect(calls).toEqual([
      `selected ${STAGING_ID}`,
      `navigate /dashboard/${STAGING_ID}`,
    ]);
  });

  test("a search starts on its best match, and a search cleared on the open project again", () => {
    render(picker());
    openWithEnter();

    type("sand");
    expect(activeOptionId()).toBe(optionFor(SANDBOX_ID).id);

    type("acme");
    // Both Acme projects match as well; the list's order decides.
    expect(activeOptionId()).toBe(options()[0]!.id);

    type("");
    expect(activeOptionId()).toBe(optionFor(STAGING_ID).id);
  });

  test("each opening starts on the open project again, wherever the keyboard left the last one", () => {
    render(picker());
    openWithEnter();
    press("ArrowDown");
    press("ArrowDown");
    expect(activeOptionId()).toBe(optionFor(PERSONAL_ID).id);

    closeWithEscape();
    expect(screen.queryByRole("listbox")).toBeNull();

    openWithEnter();
    expect(activeOptionId()).toBe(optionFor(STAGING_ID).id);
  });

  test("opened with the pointer, the open project is marked but no row is picked out until the pointer is on one", () => {
    render(picker());
    openWithPointer();

    expect(markedOptions()).toEqual([optionFor(STAGING_ID)]);
    expect(projectOptions()).toHaveLength(PROJECTS.length);

    for (const option of projectOptions()) {
      expect(option.className).not.toContain(
        PROJECT_PICKER_ACTIVE_ROW_CLASS_NAME,
      );
    }
  });

  test("with no open project told, the keyboard starts on the first row, as it always did", () => {
    render(picker({ selectedProjectId: null }));
    openWithEnter();

    expect(activeOptionId()).toBe(options()[0]!.id);
  });

  test("an open project the list does not hold leaves the keyboard on the first row", () => {
    render(
      picker({ selectedProjectId: "b7000000-0000-4000-8000-0000000000ff" }),
    );
    openWithEnter();

    expect(markedOptions()).toEqual([]);
    expect(activeOptionId()).toBe(options()[0]!.id);
  });
});

describe("the open project is in view as the list opens", () => {
  test("opened with the pointer, its row is scrolled into view", () => {
    render(picker());
    openWithPointer();

    expect(scrolledTo).toContain(optionFor(STAGING_ID).id);
  });

  test("opened from the keyboard, its row is scrolled into view, and only rows the keyboard is on after that", () => {
    render(picker());
    openWithEnter();

    expect(new Set(scrolledTo)).toEqual(new Set([optionFor(STAGING_ID).id]));

    scrolledTo = [];
    press("ArrowDown");
    expect(scrolledTo).toEqual([optionFor(SANDBOX_ID).id]);
  });

  test("scrolling the list leaves it where the person scrolled: the row is brought into view once per opening", () => {
    render(picker());
    openWithPointer();

    const firstOpening: number = scrolledTo.length;
    expect(firstOpening).toBeGreaterThan(0);

    // The pointer passing over rows draws the list again; nothing scrolls.
    fireEvent.mouseMove(optionFor(PERSONAL_ID));
    fireEvent.mouseMove(optionFor(PRODUCTION_ID));
    expect(scrolledTo).toHaveLength(firstOpening);
  });
});

describe("someone in many projects", () => {
  const NAMES: ReadonlyArray<string> = [
    "Acme",
    "Payments",
    "Checkout",
    "Search",
    "Mobile",
    "Production",
    "Staging",
    "Café",
    "München",
    "Ödeme",
    "Zahlungen",
    "Kunden",
    "مدفوعات",
    "پرداخت",
  ];

  function manyProjects(count: number, random: SeededRandom): Array<Project> {
    return Array.from({ length: count }, (_: unknown, index: number) => {
      const name: string = `${NAMES[random(NAMES.length)]} ${
        NAMES[random(NAMES.length)]
      }`;

      return project(
        `b7000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        name,
      );
    });
  }

  test.each([1, 2, 3, 4, 5])(
    "seed %i: wherever the open project sits among 300, exactly its row is marked, started on and scrolled to",
    (seed: number) => {
      const random: SeededRandom = seededRandom(seed);
      const projects: Array<Project> = shuffled(
        manyProjects(300, random),
        random,
      );
      const open: Project = projects[random(projects.length)]!;

      render(
        picker({
          projects: projects,
          selectedProjectId: open.id!.toString(),
          selectedProjectName: open.name!,
        }),
      );
      openWithEnter();

      const row: HTMLElement = optionFor(open.id!.toString());

      expect(markedOptions()).toEqual([row]);
      expect(activeOptionId()).toBe(row.id);
      expect(scrolledTo).toContain(row.id);
    },
  );

  test.each([11, 12, 13])(
    "seed %i: many projects share names, and the mark still finds the open one by its id",
    (seed: number) => {
      const random: SeededRandom = seededRandom(seed);
      // Two names for 200 projects: a hundred of each, as in a big organisation's test projects.
      const projects: Array<Project> = Array.from(
        { length: 200 },
        (_: unknown, index: number) => {
          return project(
            `b7000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            index % 2 === 0 ? "Test Project" : "Sandbox",
          );
        },
      );
      const open: Project = projects[random(projects.length)]!;

      render(
        picker({
          projects: projects,
          selectedProjectId: open.id!.toString(),
          selectedProjectName: open.name!,
        }),
      );
      openWithPointer();

      expect(markedOptions()).toEqual([optionFor(open.id!.toString())]);
      expect(
        screen.getAllByTestId(PROJECT_PICKER_OPEN_PROJECT_MARK_TEST_ID),
      ).toHaveLength(1);
    },
  );

  test("the mark costs no search: moving through 1,000 projects runs none, and each letter typed runs one", () => {
    const random: SeededRandom = seededRandom(42);
    const projects: Array<Project> = manyProjects(1000, random);
    const open: Project = projects[700]!;

    render(
      picker({
        projects: projects,
        selectedProjectId: open.id!.toString(),
        selectedProjectName: open.name!,
      }),
    );
    openWithEnter();

    const afterOpening: number = mockSearchRuns;

    for (let step: number = 0; step < 25; step++) {
      press(random(2) === 0 ? "ArrowDown" : "ArrowUp");
    }

    expect(mockSearchRuns).toBe(afterOpening);
    expect(markedOptions()).toEqual([optionFor(open.id!.toString())]);

    type("p");
    type("pa");
    type("pay");
    expect(mockSearchRuns).toBe(afterOpening + 3);
  });
});

describe("isOpenProject", () => {
  test("is true only for the project whose id it is given", () => {
    const staging: Project = project(STAGING_ID, "Acme Staging");
    const twin: Project = project(SANDBOX_ID, "Acme Staging");

    expect(isOpenProject(staging, STAGING_ID)).toBe(true);
    expect(isOpenProject(twin, STAGING_ID)).toBe(false);
  });

  test("is false for every project when no id is given, even one without an id", () => {
    const nameless: Project = new Project();

    expect(isOpenProject(project(STAGING_ID, "Acme Staging"), "")).toBe(false);
    expect(isOpenProject(nameless, "")).toBe(false);
  });

  test("names each row by the project's id, so the open project's row is found by its id too", () => {
    const ids: ReturnType<typeof getProjectPickerIds> =
      getProjectPickerIds(":r1:");

    expect(ids.projectRow(project(STAGING_ID, "Acme Staging"), 3)).toBe(
      `project-picker-r1-project-${STAGING_ID}`,
    );
  });
});
