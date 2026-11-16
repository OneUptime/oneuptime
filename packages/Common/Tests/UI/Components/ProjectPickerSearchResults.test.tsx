import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
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
import ProjectPicker from "../../../UI/Components/Header/ProjectPicker/ProjectPicker";
import {
  PROJECT_PICKER_FOUND_COUNT,
  PROJECT_PICKER_NO_MATCHES_CLASS_NAME,
  PROJECT_PICKER_NO_MATCHES_TEMPLATE,
} from "../../../UI/Components/Header/ProjectPicker/ProjectPickerMenu";
import { MATCHED_TEXT_MARK_CLASS_NAME } from "../../../UI/Components/CommandPalette/MatchedText";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE PROJECT LIST AS SOMEONE SEARCHES IT.
 *
 * The header's project list showed only the projects whose names started
 * with what was typed, in the list's order: "kube" did not list "OneUptime
 * Kubernetes", nor "acme" "Sample: Acme Shop". A search that found nothing
 * left Create New Project as the only row - so a project spelled another
 * way read as one that was gone, with a new one as the way out - and a
 * screen reader heard nothing of what a search found.
 *
 * Now, in the real picker:
 *
 *  - a name is found by any of its words, as Search (Cmd/Ctrl+K) finds a
 *    page, best match first, and the first row - the one Enter opens - is
 *    the best match;
 *  - the part of each name the search matched is marked, as Search marks
 *    it;
 *  - a search that finds nothing says "No matches for “...”" and offers no
 *    Create New Project (Docs/ux/README.md#empty-states-and-suggestions);
 *  - a screen reader hears how many projects each search lists, or that
 *    none matched, in the reader's language.
 */

const KUBERNETES_ID: string = "b7000000-0000-4000-8000-0000000000f1";
const PROJECT_TEST_ID: string = "b7000000-0000-4000-8000-0000000000f2";
const FREE_DEMO_ID: string = "b7000000-0000-4000-8000-0000000000f3";
const ACME_SHOP_ID: string = "b7000000-0000-4000-8000-0000000000f4";
const TEST_PROJECT_ONE_ID: string = "b7000000-0000-4000-8000-0000000000f5";
const TEST_PROJECT_TWO_ID: string = "b7000000-0000-4000-8000-0000000000f6";
const ACME_STAGING_ID: string = "b7000000-0000-4000-8000-0000000000f7";
const KUBE_PROD_ID: string = "b7000000-0000-4000-8000-0000000000f8";
const LAUNCH_ID: string = "b7000000-0000-4000-8000-0000000000f9";
const PERSIAN_ID: string = "b7000000-0000-4000-8000-0000000000fa";

function project(id: string, name: string): Project {
  const item: Project = new Project();
  item._id = id;
  item.name = name;
  return item;
}

// The list in the header's screenshot, and a few names like it.
const PROJECTS: Array<Project> = [
  project(KUBERNETES_ID, "OneUptime Kubernetes"),
  project(PROJECT_TEST_ID, "Project test"),
  project(FREE_DEMO_ID, "Free demo"),
  project(ACME_SHOP_ID, "Sample: Acme Shop"),
  project(TEST_PROJECT_ONE_ID, "Test Project\\"),
  project(TEST_PROJECT_TWO_ID, "Test Project\\"),
  project(ACME_STAGING_ID, "Acme Staging"),
  project(KUBE_PROD_ID, "Kube Prod"),
  project(LAUNCH_ID, "🚀 Launch Pad"),
  project(PERSIAN_ID, "پروژه آکمه"),
];

const EVERY_ROW: Array<string> = [
  ...PROJECTS.map((item: Project): string => {
    return item.name!;
  }),
  "Create New Project",
];

let calls: Array<string>;

function picker(
  props: {
    hideCreateProjectButton?: boolean;
  } = {},
): React.ReactElement {
  return (
    <ProjectPicker
      projects={PROJECTS}
      selectedProjectIcon={IconProp.Folder}
      selectedProjectName="Project test"
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

function pickerButton(): HTMLElement {
  return screen.getByRole("button", { name: /Project test/ });
}

// Enter or Space on the picker: the list opens with the focus in its search box.
function openWithEnter(): void {
  const button: HTMLElement = pickerButton();

  act(() => {
    button.focus();
  });
  fireEvent.click(button, { detail: 0 });
}

// A click or a tap: the focus stays where it was.
function openWithPointer(): void {
  fireEvent.click(pickerButton(), { detail: 1 });
}

function listbox(): HTMLElement {
  return screen.getByRole("listbox");
}

function searchBox(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

function type(text: string): void {
  fireEvent.change(searchBox(), { target: { value: text } });
}

function press(key: string): void {
  fireEvent.keyDown(searchBox(), { key: key });
}

function options(): Array<HTMLElement> {
  return within(listbox()).queryAllByRole("option");
}

function rows(): Array<string> {
  return options().map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

function rowOf(name: string): HTMLElement {
  const row: HTMLElement | undefined = options().find(
    (option: HTMLElement): boolean => {
      return option.textContent === name;
    },
  );

  expect(row).toBeDefined();

  return row!;
}

// The parts of a row's name that are marked as matched.
function marksIn(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("mark")).map(
    (mark: HTMLElement): string => {
      return mark.textContent || "";
    },
  );
}

function activeRow(): HTMLElement | null {
  const id: string | null = searchBox().getAttribute("aria-activedescendant");

  return id ? document.getElementById(id) : null;
}

// What a screen reader hears as the search changes the list.
function searchStatus(): string {
  return screen.getByTestId("project-picker-search-status").textContent || "";
}

function noMatches(): HTMLElement | null {
  return screen.queryByTestId("project-picker-no-matches");
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
    `/dashboard/${PROJECT_TEST_ID}/home`,
  );
  Navigation.setNavigateHook(((to: string) => {
    calls.push(`navigate ${to}`);
  }) as unknown as NavigateFunction);
});

afterEach(() => {
  cleanup();
  LeaveGuard.reset();
});

describe("a project is found by any word of its name, best match first", () => {
  test("kube lists OneUptime Kubernetes, which a search for a name's start never found", () => {
    render(picker());
    openWithEnter();
    type("kube");

    expect(rows()).toEqual([
      "Kube Prod",
      "OneUptime Kubernetes",
      "Create New Project",
    ]);
  });

  test("acme lists Sample: Acme Shop, after the name that starts with it", () => {
    render(picker());
    openWithEnter();
    type("acme");

    expect(rows()).toEqual([
      "Acme Staging",
      "Sample: Acme Shop",
      "Create New Project",
    ]);
  });

  test("the words in any order, case and punctuation aside", () => {
    render(picker());
    openWithEnter();

    type("SHOP acme");
    expect(rows()).toEqual(["Sample: Acme Shop", "Create New Project"]);

    type("demo free");
    expect(rows()).toEqual(["Free demo", "Create New Project"]);

    type("oneuptime-kubernetes");
    expect(rows()).toEqual(["OneUptime Kubernetes", "Create New Project"]);
  });

  test("the whole name first: test project lists both Test Project\\ before Project test", () => {
    render(picker());
    openWithEnter();
    type("test project");

    expect(rows()).toEqual([
      "Test Project\\",
      "Test Project\\",
      "Project test",
      "Create New Project",
    ]);
    // Two projects with one name are two rows, each with its own id.
    expect(options()[0]!.id).toContain(TEST_PROJECT_ONE_ID);
    expect(options()[1]!.id).toContain(TEST_PROJECT_TWO_ID);
  });

  test("a name's initials, a typo and its letters in order find it when nothing matches better", () => {
    render(picker());
    openWithEnter();

    type("ouk");
    expect(rows()).toEqual(["OneUptime Kubernetes", "Create New Project"]);

    type("kubernetse");
    expect(rows()).toEqual(["OneUptime Kubernetes", "Create New Project"]);

    type("fd");
    expect(rows()).toEqual(["Free demo", "Create New Project"]);
  });

  test("an emoji finds the project whose name holds it", () => {
    render(picker());
    openWithEnter();
    type("🚀");

    expect(rows()).toEqual(["🚀 Launch Pad", "Create New Project"]);
  });

  test("the best match is the keyboard's row, whichever row the keys were on before", () => {
    render(picker());
    openWithEnter();
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    expect(activeRow()).toHaveTextContent("Sample: Acme Shop");

    type("kubernetes");

    expect(activeRow()).toBe(options()[0]);
    expect(activeRow()).toHaveTextContent("OneUptime Kubernetes");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  test("Enter opens the best match, through the page's leave guard", () => {
    render(picker());
    openWithEnter();
    type("kubernetes");
    press("Enter");

    expect(calls).toEqual([
      "selected OneUptime Kubernetes",
      `navigate /dashboard/${KUBERNETES_ID}`,
    ]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("Down goes from the best match to the next, then to Create New Project, and stops there", () => {
    render(picker());
    openWithEnter();
    type("kube");

    expect(activeRow()).toHaveTextContent("Kube Prod");
    press("ArrowDown");
    expect(activeRow()).toHaveTextContent("OneUptime Kubernetes");
    press("ArrowDown");
    expect(activeRow()).toHaveTextContent("Create New Project");
    press("ArrowDown");
    expect(activeRow()).toHaveTextContent("Create New Project");

    press("Enter");
    expect(calls).toEqual(["create"]);
  });

  test("a click on a found project opens it", () => {
    render(picker());
    openWithPointer();
    type("staging");
    fireEvent.click(rowOf("Acme Staging"));

    expect(calls).toEqual([
      "selected Acme Staging",
      `navigate /dashboard/${ACME_STAGING_ID}`,
    ]);
  });
});

describe("the part of a name the search matched is marked", () => {
  test("acme is marked in each name it found, and each name reads whole", () => {
    render(picker());
    openWithEnter();
    type("acme");

    expect(marksIn(rowOf("Acme Staging"))).toEqual(["Acme"]);
    expect(marksIn(rowOf("Sample: Acme Shop"))).toEqual(["Acme"]);
    // Create New Project is not a name the search matched.
    expect(marksIn(rowOf("Create New Project"))).toEqual([]);
  });

  test("the mark is the one Search (Cmd/Ctrl+K) draws", () => {
    render(picker());
    openWithEnter();
    type("acme");

    const marks: Array<HTMLElement> = Array.from(
      listbox().querySelectorAll("mark"),
    );

    expect(marks.length).toBeGreaterThan(0);

    for (const mark of marks) {
      expect(mark.className).toBe(MATCHED_TEXT_MARK_CLASS_NAME);
    }
  });

  test("words typed in another order are each marked where they are, and a space between two is marked with them", () => {
    render(picker());
    openWithEnter();
    type("shop acme");

    expect(marksIn(rowOf("Sample: Acme Shop"))).toEqual(["Acme Shop"]);

    type("sample shop");
    expect(marksIn(rowOf("Sample: Acme Shop"))).toEqual(["Sample", "Shop"]);
  });

  test("letters found inside a word are marked where they are", () => {
    render(picker());
    openWithEnter();
    type("ernet");

    expect(marksIn(rowOf("OneUptime Kubernetes"))).toEqual(["ernet"]);
  });

  test("a match by initials or by a typo marks nothing, rather than a letter here and there", () => {
    render(picker());
    openWithEnter();

    type("ouk");
    expect(marksIn(rowOf("OneUptime Kubernetes"))).toEqual([]);

    type("kubernetse");
    expect(marksIn(rowOf("OneUptime Kubernetes"))).toEqual([]);
  });

  test("with nothing typed, or the search cleared, nothing is marked", () => {
    render(picker());
    openWithEnter();

    expect(listbox().querySelectorAll("mark")).toHaveLength(0);

    type("acme");
    expect(listbox().querySelectorAll("mark").length).toBeGreaterThan(0);

    type("");
    expect(listbox().querySelectorAll("mark")).toHaveLength(0);
    expect(rows()).toEqual(EVERY_ROW);
  });

  test("a name marked still reads its own way: a Persian name in a dir=auto run", () => {
    render(picker());
    openWithEnter();
    type("آکمه");

    const row: HTMLElement = rowOf("پروژه آکمه");
    const mark: HTMLElement | null = row.querySelector("mark");

    expect(mark).toHaveTextContent("آکمه");
    expect(mark!.closest('[dir="auto"]')).not.toBeNull();
    expect(row.querySelector('[dir="auto"]')).toHaveTextContent("پروژه آکمه");
  });
});

describe("a search that finds nothing", () => {
  test("says so, naming the search, where the rows were", () => {
    render(picker());
    openWithEnter();
    type("zzz");

    expect(noMatches()).toHaveTextContent("No matches for “zzz”");
    expect(noMatches()).toBeVisible();
    for (const name of PROJECT_PICKER_NO_MATCHES_CLASS_NAME.split(" ")) {
      expect(noMatches()).toHaveClass(name);
    }
    expect(options()).toEqual([]);
  });

  test("offers no Create New Project: it is not a way out of a search", () => {
    render(picker());
    openWithEnter();
    type("zzz");

    expect(screen.queryByText("Create New Project")).toBeNull();
    expect(rows()).toEqual([]);
  });

  test("names the search as typed, without the spaces around it", () => {
    render(picker());
    openWithEnter();
    type("   no such project   ");

    expect(noMatches()).toHaveTextContent("No matches for “no such project”");
  });

  test("is said outside the list, which stays as the box's aria-controls names it", () => {
    render(picker());
    openWithEnter();
    type("zzz");

    expect(listbox()).toBeInTheDocument();
    expect(searchBox()).toHaveAttribute("aria-controls", listbox().id);
    expect(listbox().contains(noMatches())).toBe(false);
    expect(listbox().children).toHaveLength(0);
  });

  test("names no row as the keyboard's, and Enter, Down and Up open nothing", () => {
    render(picker());
    openWithEnter();
    type("zzz");

    expect(searchBox()).not.toHaveAttribute("aria-activedescendant");

    press("ArrowDown");
    press("ArrowUp");
    press("Enter");

    expect(calls).toEqual([]);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(searchBox()).not.toHaveAttribute("aria-activedescendant");
  });

  test("Escape still puts the list away and gives the focus back to the picker", () => {
    render(picker());
    openWithEnter();
    type("zzz");
    press("Escape");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(pickerButton()).toHaveFocus();
  });

  test("clearing the search brings back every project and Create New Project, and the message goes", () => {
    render(picker());
    openWithEnter();
    type("zzz");
    expect(noMatches()).not.toBeNull();

    type("");

    expect(noMatches()).toBeNull();
    expect(rows()).toEqual(EVERY_ROW);
    expect(activeRow()).toBe(options()[0]);
  });

  test("a search that finds something again takes the message away and brings Create New Project back", () => {
    render(picker());
    openWithEnter();
    // A second word no name has ("acmez" would be forgiven as a typo).
    type("acme qq");
    expect(noMatches()).toHaveTextContent("No matches for “acme qq”");

    type("acme");

    expect(noMatches()).toBeNull();
    expect(rows()).toEqual([
      "Acme Staging",
      "Sample: Acme Shop",
      "Create New Project",
    ]);
  });

  test("with Create New Project hidden, says so all the same", () => {
    render(picker({ hideCreateProjectButton: true }));
    openWithEnter();
    type("zzz");

    expect(noMatches()).toHaveTextContent("No matches for “zzz”");
    expect(rows()).toEqual([]);
  });

  test("a symbol no name holds finds nothing, and says so", () => {
    render(picker());
    openWithEnter();
    type("#");

    expect(noMatches()).toHaveTextContent("No matches for “#”");
    expect(rows()).toEqual([]);
  });
});

describe("spaces alone are no search", () => {
  test("every project is listed, with Create New Project, and nothing is said", () => {
    render(picker());
    openWithEnter();
    type("    ");

    expect(rows()).toEqual(EVERY_ROW);
    expect(noMatches()).toBeNull();
    expect(searchStatus()).toBe("");
    expect(listbox().querySelectorAll("mark")).toHaveLength(0);
  });
});

describe("what a screen reader hears", () => {
  test("nothing while the box is empty, then how many projects each search lists, then that none matched", () => {
    render(picker());
    openWithEnter();

    expect(searchStatus()).toBe("");

    type("acme");
    expect(searchStatus()).toBe("2 projects");

    type("acme sta");
    expect(searchStatus()).toBe("1 project");

    type("zzz");
    expect(searchStatus()).toBe("No matches for “zzz”");

    type("");
    expect(searchStatus()).toBe("");
  });

  test("counts projects, not rows: Create New Project is not one of them", () => {
    render(picker());
    openWithEnter();
    type("kube");

    expect(rows()).toHaveLength(3);
    expect(searchStatus()).toBe("2 projects");
  });

  test("is a polite live region, out of sight and outside the list", () => {
    render(picker());
    openWithEnter();

    const status: HTMLElement = screen.getByTestId(
      "project-picker-search-status",
    );

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveClass("sr-only");
    expect(listbox().contains(status)).toBe(false);
  });

  test("says the same in a list opened with the pointer", () => {
    render(picker());
    openWithPointer();
    type("staging");

    expect(searchStatus()).toBe("1 project");
  });
});

describe("opened again, the list starts afresh", () => {
  test("with its search empty, every project listed and nothing marked", () => {
    render(picker());
    openWithEnter();
    type("zzz");
    press("Escape");

    openWithEnter();

    expect(searchBox().value).toBe("");
    expect(rows()).toEqual(EVERY_ROW);
    expect(noMatches()).toBeNull();
    expect(searchStatus()).toBe("");
    expect(listbox().querySelectorAll("mark")).toHaveLength(0);
  });

  test("after a project was opened from a search", () => {
    render(picker());
    openWithEnter();
    type("free");
    press("Enter");
    expect(calls[0]).toBe("selected Free demo");

    openWithEnter();

    expect(searchBox().value).toBe("");
    expect(rows()).toEqual(EVERY_ROW);
  });
});

describe("the projects it is given change while it is open", () => {
  test("the search runs over the new list", () => {
    const view: RenderResult = render(picker());
    openWithEnter();
    type("kube");
    expect(rows()).toEqual([
      "Kube Prod",
      "OneUptime Kubernetes",
      "Create New Project",
    ]);

    view.rerender(
      <ProjectPicker
        projects={[
          ...PROJECTS,
          project("b7000000-0000-4000-8000-0000000000fb", "Kubernetes Lab"),
        ]}
        selectedProjectIcon={IconProp.Folder}
        selectedProjectName="Project test"
        onCreateProjectButtonClicked={() => {
          calls.push("create");
        }}
        onProjectSelected={(selected: Project) => {
          calls.push(`selected ${selected.name}`);
        }}
      />,
    );

    expect(rows()).toEqual([
      "Kube Prod",
      "Kubernetes Lab",
      "OneUptime Kubernetes",
      "Create New Project",
    ]);
  });
});

describe("in the reader's language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  function readLocale(language: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }

  async function instanceFor(language: string): Promise<i18n> {
    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readLocale("en") },
        [language]: { translation: readLocale(language) },
      },
      interpolation: { escapeValue: false },
    });
    return instance;
  }

  const SENTENCES: ReadonlyArray<string> = [
    PROJECT_PICKER_NO_MATCHES_TEMPLATE,
    PROJECT_PICKER_FOUND_COUNT.other,
    `${PROJECT_PICKER_FOUND_COUNT.other}_one`,
  ];

  test("the list's sentences are the ones en.json holds, as the list writes them", () => {
    const english: Record<string, string> = readLocale("en");

    expect(english[PROJECT_PICKER_NO_MATCHES_TEMPLATE]).toBe(
      "No matches for “{{search}}”",
    );
    expect(english[PROJECT_PICKER_FOUND_COUNT.other]).toBe(
      PROJECT_PICKER_FOUND_COUNT.other,
    );
    expect(english[`${PROJECT_PICKER_FOUND_COUNT.other}_one`]).toBe(
      PROJECT_PICKER_FOUND_COUNT.one,
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words what a search found, its values kept",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);
      const english: Record<string, string> = readLocale("en");

      // Worded, and not the English left in place.
      expect(locale[PROJECT_PICKER_NO_MATCHES_TEMPLATE]).toBeTruthy();
      expect(locale[PROJECT_PICKER_NO_MATCHES_TEMPLATE]).not.toBe(
        english[PROJECT_PICKER_NO_MATCHES_TEMPLATE],
      );
      expect(locale[PROJECT_PICKER_FOUND_COUNT.other]).toBeTruthy();
      expect(locale[PROJECT_PICKER_FOUND_COUNT.other]).not.toBe(
        english[PROJECT_PICKER_FOUND_COUNT.other],
      );

      for (const key of SENTENCES) {
        const value: string = locale[key] || "";
        const placeholder: string =
          key === PROJECT_PICKER_NO_MATCHES_TEMPLATE
            ? "{{search}}"
            : "{{count}}";

        expect({
          language,
          key,
          keepsValue: value.includes(placeholder),
        }).toEqual({ language, key, keepsValue: true });
      }
    },
  );

  test("in German: what a search found, and that it found none", async () => {
    const de: Record<string, string> = readLocale("de");
    const instance: i18n = await instanceFor("de");

    render(<I18nextProvider i18n={instance}>{picker()}</I18nextProvider>);
    openWithEnter();

    type("staging");
    expect(searchStatus()).toBe("1 Projekt");

    type("acme");
    expect(searchStatus()).toBe("2 Projekte");

    type("zzz");
    const expected: string = de[PROJECT_PICKER_NO_MATCHES_TEMPLATE]!.replace(
      "{{search}}",
      "zzz",
    );
    expect(expected).toBe("Keine Treffer für „zzz“");
    expect(noMatches()).toHaveTextContent(expected);
    expect(searchStatus()).toBe(expected);
  });

  test("in Russian, whose count sentence is worded for every number", async () => {
    const ru: Record<string, string> = readLocale("ru");
    const instance: i18n = await instanceFor("ru");

    render(<I18nextProvider i18n={instance}>{picker()}</I18nextProvider>);
    openWithEnter();

    type("acme");
    expect(searchStatus()).toBe("Проектов: 2");

    type("нет такого");
    expect(noMatches()).toHaveTextContent(
      ru[PROJECT_PICKER_NO_MATCHES_TEMPLATE]!.replace(
        "{{search}}",
        "нет такого",
      ),
    );
    expect(noMatches()).not.toHaveTextContent("No matches");
  });

  test("in Persian, a Persian name is found and marked", async () => {
    const instance: i18n = await instanceFor("fa");

    render(<I18nextProvider i18n={instance}>{picker()}</I18nextProvider>);
    openWithEnter();
    type("پروژه");

    expect(rows()[0]).toBe("پروژه آکمه");
    expect(marksIn(rowOf("پروژه آکمه"))).toEqual(["پروژه"]);
  });
});
