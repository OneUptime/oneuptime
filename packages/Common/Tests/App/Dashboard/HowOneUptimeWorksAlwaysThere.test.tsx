import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "How OneUptime works", always one click away (#6819).
 *
 * The four core products in the order a problem flows through them used to
 * live only inside Home's Welcome checklist, and went for good once it was
 * done or dismissed. Now Help opens it on any page and Home opens it at any
 * time, in a dialog of its own; it says what feeds the loop and links Core
 * Concepts and the Glossary; and Help starts with the ways to learn.
 *
 * react-i18next answers from the Dashboard's REAL locale files, nested keys
 * and the reader's language included, so the words asserted are the words
 * a reader sees.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

const readLocale: (code: string) => LocaleData = (code: string): LocaleData => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
};

const LOCALES: Record<string, LocaleData> = {
  en: readLocale("en"),
  de: readLocale("de"),
  ar: readLocale("ar"),
  fa: readLocale("fa"),
};

let language: string = "en";

function lookupNested(data: LocaleData, key: string): string | undefined {
  let cursor: unknown = data;
  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const locale: LocaleData = LOCALES[language]!;
          if (
            options &&
            typeof options === "object" &&
            (options as { keySeparator?: unknown }).keySeparator === false
          ) {
            const flat: unknown = locale[key];
            return typeof flat === "string"
              ? flat
              : (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return (
            lookupNested(locale, key) ??
            (typeof locale[key] === "string"
              ? (locale[key] as string)
              : undefined) ??
            (typeof options === "string" ? options : key)
          );
        },
        i18n: { resolvedLanguage: language, language: language },
      };
    },
  };
});

const captureMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      isStartWith: () => {
        return false;
      },
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
      getCurrentRoute: () => {
        return {
          toString: () => {
            return "/";
          },
        };
      },
      getCurrentPath: () => {
        return {
          toString: () => {
            return "/";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

let currentProjectId: ObjectID | null = null;

// The Welcome checklist is one server answer (#6803).
const welcomeFetchMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/WelcomeChecklist/WelcomeChecklistApi",
  () => {
    return {
      __esModule: true,
      fetchWelcomeChecklist: (...args: Array<unknown>) => {
        return welcomeFetchMock(...args);
      },
      postWelcomeChecklist: () => {
        return Promise.resolve(null);
      },
      sendLegacyBrowserState: () => {
        return Promise.resolve(null);
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
      },
    },
  };
});

import ObjectID from "../../../Types/ObjectID";
import { getEmptyWelcomeChecklistAnswer } from "../../../Types/WelcomeChecklist/WelcomeChecklistAnswer";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { DOCS_URL } from "../../../UI/Config";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import { DEFINED_TERM_TEST_ID } from "../../../UI/Components/Glossary/DefinedTerm";
import Help, {
  HELP_ASK_GROUP_TEST_ID,
  HELP_LEARN_GROUP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/Help";
import HowOneUptimeWorksDialog, {
  HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID,
  HowOneUptimeWorksOpenedFrom,
  openHowOneUptimeWorks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorksDialog";
import HowOneUptimeWorks, {
  FEEDS_INFRASTRUCTURE_TEXT,
  FEEDS_TELEMETRY_TEXT,
  HOW_IT_WORKS_CORE_CONCEPTS,
  HOW_IT_WORKS_FEEDS,
  HOW_IT_WORKS_GLOSSARY,
  HOW_IT_WORKS_STEPS,
  HOW_IT_WORKS_TITLE,
  HowItWorksStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HowOneUptimeWorks";
import ExploreProducts, {
  HOME_HOW_ONEUPTIME_WORKS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/ExploreProducts";
import GettingStarted from "../../../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

const PROJECT_ID: string = "65f00000000000000000dddd";
const DOCS: string = DOCS_URL.toString();

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => {};
});

beforeEach(() => {
  language = "en";
  currentProjectId = new ObjectID(PROJECT_ID);
  window.localStorage.clear();
  countMock.mockImplementation((): Promise<number> => {
    return Promise.resolve(0);
  });
});

afterEach(() => {
  cleanup();
  captureMock.mockReset();
  navigateMock.mockReset();
  countMock.mockReset();
});

const openHelp: () => void = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Help" }));
};

const helpEntry: (text: string) => HTMLElement = (
  text: string,
): HTMLElement => {
  return screen.getByText(text).closest("a") as HTMLElement;
};

/*
 * The activation funnel's "How it works" opened events (#6830), as product
 * analytics receives them: How OneUptime works is the product "oneuptime".
 */
const openedEvents: () => Array<Record<string, unknown>> = (): Array<
  Record<string, unknown>
> => {
  return captureMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === ProductEventName.HowItWorksOpened;
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[1] as Record<string, unknown>;
    });
};

const dialog: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId(HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID);
};

describe("Help starts with learning", () => {
  test("the Quickstart, How OneUptime works, the Glossary and the docs, then the ways to ask", () => {
    render(<Help />);
    openHelp();

    const learn: HTMLElement = screen.getByTestId(HELP_LEARN_GROUP_TEST_ID);
    const ask: HTMLElement = screen.getByTestId(HELP_ASK_GROUP_TEST_ID);

    expect(
      within(learn)
        .getAllByRole("link")
        .concat(within(learn).queryAllByRole("button"))
        .sort((a: HTMLElement, b: HTMLElement): number => {
          return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1;
        })
        .map((entry: HTMLElement): string => {
          return entry.textContent || "";
        }),
    ).toEqual([
      "Quickstart",
      "How OneUptime works",
      "Glossary",
      "Documentation",
    ]);
    expect(ask).toHaveTextContent("Keyboard shortcuts");
    expect(ask).toHaveTextContent("Support Email");
    // The ways to ask are set apart under a line.
    expect(ask.className).toContain("border-t");
    expect(
      learn.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the Quickstart and the Glossary open in a new tab, on this instance's docs", () => {
    render(<Help />);
    openHelp();

    expect(helpEntry("Quickstart")).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/quickstart`,
    );
    expect(helpEntry("Glossary")).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/glossary`,
    );
    expect(helpEntry("Quickstart")).toHaveAttribute("target", "_blank");
    expect(helpEntry("Glossary")).toHaveAttribute("target", "_blank");
  });

  test("in German, they say so in German and open the German docs", () => {
    language = "de";
    render(<Help />);
    fireEvent.click(screen.getByRole("button", { name: "Hilfe" }));

    const de: LocaleData = LOCALES["de"]!;

    for (const key of [
      "help.quickstart",
      "help.howOneUptimeWorks",
      "help.glossary",
    ]) {
      const german: string | undefined = lookupNested(de, key);
      expect(german).toBeTruthy();
      expect(german).not.toBe(lookupNested(LOCALES["en"]!, key));
      expect(screen.getByText(german!)).toBeInTheDocument();
    }

    expect(helpEntry(lookupNested(de, "help.quickstart")!)).toHaveAttribute(
      "href",
      `${DOCS}/de/introduction/quickstart`,
    );
    expect(helpEntry(lookupNested(de, "help.glossary")!)).toHaveAttribute(
      "href",
      `${DOCS}/de/introduction/glossary`,
    );
  });

  test("Arabic, which the docs have no copy of, opens the English docs", () => {
    language = "ar";
    render(<Help />);
    fireEvent.click(
      screen.getByRole("button", {
        name: lookupNested(LOCALES["ar"]!, "help.label")!,
      }),
    );

    expect(
      helpEntry(lookupNested(LOCALES["ar"]!, "help.quickstart")!),
    ).toHaveAttribute("href", `${DOCS}/en/introduction/quickstart`);
  });

  test("How OneUptime works opens the dialog from any page, and closes the menu", () => {
    const opened: MockFunction = getJestMockFunction();
    const listener: (event: CustomEvent) => void = (
      event: CustomEvent,
    ): void => {
      opened(event.detail);
    };
    GlobalEvents.addEventListener(EventName.HOW_ONEUPTIME_WORKS_OPEN, listener);

    render(<Help />);
    openHelp();
    fireEvent.click(screen.getByText("How OneUptime works"));

    expect(opened).toHaveBeenCalledWith({ from: "help" });
    // The menu closed behind it.
    expect(screen.queryByText("Quickstart")).toBeNull();

    GlobalEvents.removeEventListener(
      EventName.HOW_ONEUPTIME_WORKS_OPEN,
      listener,
    );
  });
});

describe("the dialog", () => {
  test("opens from Help with the four steps, what feeds them and the docs, and says where it was opened", async () => {
    render(
      <>
        <Help />
        <HowOneUptimeWorksDialog />
      </>,
    );

    expect(dialog()).toBeNull();

    openHelp();
    fireEvent.click(screen.getByText("How OneUptime works"));

    const shown: HTMLElement = await waitFor(() => {
      return screen.getByTestId(HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID);
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(HOW_IT_WORKS_TITLE);
    expect(within(shown).getAllByRole("listitem")).toHaveLength(4);
    HOW_IT_WORKS_STEPS.forEach((step: HowItWorksStep) => {
      expect(shown).toHaveTextContent(step.title);
    });

    // What feeds the loop: two words, each with its definition.
    const feeds: HTMLElement = within(shown).getByTestId(
      "how-oneuptime-works-feeds",
    );
    const words: Array<HTMLElement> =
      within(feeds).getAllByTestId(DEFINED_TERM_TEST_ID);

    expect(
      words.map((word: HTMLElement): string | null => {
        return word.getAttribute("data-glossary-term");
      }),
    ).toEqual(["telemetry", "infrastructure"]);
    expect(feeds).toHaveTextContent("feed the loop");

    // Core Concepts and the Glossary, in a new tab.
    expect(
      within(shown).getByTestId("how-oneuptime-works-docs-core-concepts"),
    ).toHaveAttribute("href", `${DOCS}/en/introduction/core-concepts`);
    expect(
      within(shown).getByTestId("how-oneuptime-works-docs-glossary"),
    ).toHaveAttribute("href", `${DOCS}/en/introduction/glossary`);
    expect(
      within(shown).getByTestId("how-oneuptime-works-docs-glossary"),
    ).toHaveAttribute("target", "_blank");

    expect(openedEvents()).toEqual([
      expect.objectContaining({
        product: "oneuptime",
        source: "help",
        project_id: PROJECT_ID,
      }),
    ]);
  });

  test("a step opens its product in the current project, and the dialog closes", async () => {
    render(<HowOneUptimeWorksDialog />);

    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Help);
    });

    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("how-it-works-step-on-call"));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      RouteMap[PageMap.ON_CALL_DUTY]!.toString().replace(
        ":projectId",
        PROJECT_ID,
      ),
    );
    expect(captureMock).toHaveBeenCalledWith(
      "dashboard/home/how-it-works-step",
      { projectId: PROJECT_ID, step: "on-call", place: "dialog" },
    );
    await waitFor(() => {
      expect(dialog()).toBeNull();
    });
  });

  test("closes with its Close button, and opens again", async () => {
    render(<HowOneUptimeWorksDialog />);

    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Home);
    });
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    // The footer's Close, the last of the two the dialog has (× and Close).
    const closeButtons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Close",
    });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    await waitFor(() => {
      expect(dialog()).toBeNull();
    });

    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Home);
    });
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    // Each opening is counted.
    expect(openedEvents()).toEqual([
      expect.objectContaining({ product: "oneuptime", source: "home" }),
      expect.objectContaining({ product: "oneuptime", source: "home" }),
    ]);
  });

  /*
   * Search (Cmd/Ctrl+K: "how it works") and Help in the phone's menu open
   * it too (#6936, #6816), and the event says which: the palette's own
   * suite (DashboardCommandPaletteFindsMore) and the phone menu's
   * (DashboardPhoneMenuSearchAndHelp) open it the way a person does.
   */
  test.each([
    [HowOneUptimeWorksOpenedFrom.CommandPalette, "command-palette"],
    [HowOneUptimeWorksOpenedFrom.PhoneMenu, "phone-menu"],
  ])(
    "opened from %s, the event says so",
    async (from: HowOneUptimeWorksOpenedFrom, source: string) => {
      render(<HowOneUptimeWorksDialog />);

      act(() => {
        openHowOneUptimeWorks(from);
      });
      await waitFor(() => {
        expect(dialog()).not.toBeNull();
      });

      expect(openedEvents()).toEqual([
        expect.objectContaining({ product: "oneuptime", source: source }),
      ]);
    },
  );

  test("with no project picked yet, the steps say what each product does and open nothing", async () => {
    currentProjectId = null;
    render(<HowOneUptimeWorksDialog />);

    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Help);
    });
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    const step: HTMLElement = screen.getByTestId("how-it-works-step-monitor");

    expect(step.tagName).not.toBe("BUTTON");
    fireEvent.click(step);
    expect(navigateMock).not.toHaveBeenCalled();
    expect(openedEvents()).toEqual([
      expect.objectContaining({ product: "oneuptime", source: "help" }),
    ]);
    expect(openedEvents()[0]).not.toHaveProperty("project_id");
  });

  test("stops listening once it is gone", () => {
    const { unmount } = render(<HowOneUptimeWorksDialog />);

    unmount();

    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Help);
    });

    expect(captureMock).not.toHaveBeenCalled();
  });

  test("in German, every word of it is German", async () => {
    language = "de";
    render(<HowOneUptimeWorksDialog />);

    act(() => {
      openHowOneUptimeWorks(HowOneUptimeWorksOpenedFrom.Help);
    });

    const shown: HTMLElement = await waitFor(() => {
      return screen.getByTestId(HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID);
    });
    const de: LocaleData = LOCALES["de"]!;

    for (const english of [
      HOW_IT_WORKS_CORE_CONCEPTS,
      HOW_IT_WORKS_GLOSSARY,
      FEEDS_TELEMETRY_TEXT,
      FEEDS_INFRASTRUCTURE_TEXT,
    ]) {
      expect(typeof de[english]).toBe("string");
      expect(shown).toHaveTextContent(de[english] as string);
    }

    expect(screen.getByRole("dialog")).toHaveTextContent(
      de[HOW_IT_WORKS_TITLE] as string,
    );
    expect(shown).not.toHaveTextContent("feed the loop");
    expect(
      within(shown).getByTestId("how-oneuptime-works-docs-glossary"),
    ).toHaveAttribute("href", `${DOCS}/de/introduction/glossary`);
  });
});

describe("from Home, at any time", () => {
  test("Explore OneUptime has a button that opens it, as Home", async () => {
    render(
      <MemoryRouter>
        <ExploreProducts projectId={PROJECT_ID} />
        <HowOneUptimeWorksDialog />
      </MemoryRouter>,
    );

    const button: HTMLElement = screen.getByTestId(
      HOME_HOW_ONEUPTIME_WORKS_TEST_ID,
    );

    expect(button).toHaveTextContent(HOW_IT_WORKS_TITLE);
    expect(button).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(button);

    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });
    expect(openedEvents()).toEqual([
      expect.objectContaining({
        product: "oneuptime",
        source: "home",
        project_id: PROJECT_ID,
      }),
    ]);
  });

  test("a project whose Welcome checklist is finished still opens it from Home", async () => {
    // An old project: every step done, so the checklist and its strip are gone.
    welcomeFetchMock.mockResolvedValue({
      ...getEmptyWelcomeChecklistAnswer(),
      isFinished: true,
      steps: [],
    });

    await act(async () => {
      render(
        <MemoryRouter>
          <GettingStarted projectId={new ObjectID(PROJECT_ID)} />
          <ExploreProducts projectId={PROJECT_ID} />
          <HowOneUptimeWorksDialog />
        </MemoryRouter>,
      );
    });

    expect(screen.queryByTestId("getting-started")).toBeNull();
    expect(screen.queryByTestId("how-oneuptime-works")).toBeNull();

    // Home still opens it.
    fireEvent.click(screen.getByTestId(HOME_HOW_ONEUPTIME_WORKS_TEST_ID));

    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });
    expect(screen.getByTestId("how-oneuptime-works")).toBeInTheDocument();
  });
});

describe("the strip in the Welcome checklist", () => {
  test("says what feeds the loop and links the docs too, with a heading of its own", () => {
    render(<HowOneUptimeWorks projectId={PROJECT_ID} />);

    const strip: HTMLElement = screen.getByTestId("how-oneuptime-works");

    expect(strip).toHaveTextContent(HOW_IT_WORKS_TITLE);
    expect(strip.className).toContain("border");
    expect(within(strip).getAllByTestId(DEFINED_TERM_TEST_ID)).toHaveLength(2);
    expect(
      within(strip).getByTestId("how-oneuptime-works-docs-core-concepts"),
    ).toBeInTheDocument();
  });

  test("in a dialog, the dialog's title names it: no heading, no frame, two by two", () => {
    render(<HowOneUptimeWorks projectId={PROJECT_ID} isInDialog={true} />);

    const inDialog: HTMLElement = screen.getByTestId("how-oneuptime-works");

    expect(inDialog.className).toBe("");
    expect(inDialog.textContent).not.toMatch(/^How OneUptime works/);
    expect(within(inDialog).getByRole("list").className).toContain(
      "sm:grid-cols-2",
    );
  });

  test("its sentence about what feeds the loop is one translatable sentence with two words in it", () => {
    expect(HOW_IT_WORKS_FEEDS).toContain("{{telemetry}}");
    expect(HOW_IT_WORKS_FEEDS).toContain("{{infrastructure}}");

    for (const code of ["de", "ar", "fa"]) {
      const translated: unknown = LOCALES[code]![HOW_IT_WORKS_FEEDS];

      expect(typeof translated).toBe("string");
      expect(translated).not.toBe(HOW_IT_WORKS_FEEDS);
      expect(translated).toContain("{{telemetry}}");
      expect(translated).toContain("{{infrastructure}}");
    }
  });
});
