import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { act, FunctionComponent, ReactElement } from "react";
import {
  BrowserRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

/*
 * THE TWO QUESTIONS A DASHBOARD ASKS BEFORE ITS UNSAVED CHANGES ARE LOST,
 * IN EVERY LANGUAGE (issue #7173).
 *
 * Leaving a board being edited asks "Leave without saving?", and the
 * toolbar's Cancel asks "Discard unsaved changes?" - each with Keep Editing
 * and Discard Changes. They are one voice: both open with the same sentence
 * ("You have unsaved changes to this dashboard."), and then say what the
 * answer does. Cancel's question was "Are you sure?" - "You have unsaved
 * changes. Are you sure you want to cancel?", which asked twice, and left
 * "cancel" to mean the edit or the question.
 *
 * Read from the Dashboard's locale files: every language words all six of
 * their texts itself, opens both questions with one sentence, and asks
 * with its own question mark. Then drawn: the real dashboard view in
 * German, Arabic and Persian shows each question in that language, with
 * none of its English sentences.
 */

jest.setTimeout(120000);

const PROJECT_ID: string = "44444444-4444-4444-8444-444444444451";
const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444452";
const DASHBOARDS_PATH: string = `/dashboard/${PROJECT_ID}/dashboards`;
const BOARD_PATH: string = `${DASHBOARDS_PATH}/${DASHBOARD_ID}`;
const MONITORS_PATH: string = `/dashboard/${PROJECT_ID}/monitors`;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // Permission.ProjectAdmin: someone who may edit the board.
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      // A saved board with one text widget on it.
      getItem: (): Promise<unknown> => {
        const textComponent: unknown = (
          jest.requireActual(
            "../../../Utils/Dashboard/Components/DashboardTextComponent",
          ) as {
            default: { getDefaultComponent: () => unknown };
          }
        ).default.getDefaultComponent();

        return Promise.resolve({
          dashboardViewConfig: {
            _type: "DashboardViewConfig",
            components: [textComponent],
            heightInDashboardUnits: 60,
          },
          name: "Checkout",
          description: "",
          pageTitle: null,
          pageDescription: null,
        });
      },
      updateById: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error): string => {
        return err.message;
      },
      getFriendlyMessage: (err: Error): string => {
        return err.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryAttributes: [] });
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

/*
 * The canvas is ~60 widget modules deep: a stand-in that says how many
 * widgets it holds and whether it is being edited.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: {
        isEditMode?: boolean | undefined;
        dashboardViewConfig: { components: Array<unknown> };
      }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-is-edit-mode": props.isEditMode ? "true" : "false",
          "data-widget-count": String(
            props.dashboardViewConfig.components.length,
          ),
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import UnsavedChanges from "../../../UI/Utils/NewVersion/UnsavedChanges";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LEAVE_TITLE: string = "Leave without saving?";
const LEAVE_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you leave now, they will be lost.";
const CANCEL_TITLE: string = "Discard unsaved changes?";
const CANCEL_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you discard them, the dashboard goes back to how it was last saved.";
const KEEP_EDITING: string = "Keep Editing";
const DISCARD_CHANGES: string = "Discard Changes";

// What Cancel asked before: no language may ask it so again.
const OLD_CANCEL_TITLE: string = "Are you sure?";
const OLD_CANCEL_DESCRIPTION: string =
  "You have unsaved changes. Are you sure you want to cancel?";

const QUESTION_WORDS: ReadonlyArray<string> = [
  LEAVE_TITLE,
  LEAVE_DESCRIPTION,
  CANCEL_TITLE,
  CANCEL_DESCRIPTION,
  KEEP_EDITING,
  DISCARD_CHANGES,
];

// The two questions, each a title the buttons answer.
const QUESTIONS: ReadonlyArray<string> = [LEAVE_TITLE, CANCEL_TITLE];

const ENGLISH_SENTENCES: ReadonlyArray<string> = [
  LEAVE_TITLE,
  CANCEL_TITLE,
  "You have unsaved changes to this dashboard.",
  "If you leave now, they will be lost.",
  "If you discard them, the dashboard goes back to how it was last saved.",
  KEEP_EDITING,
  DISCARD_CHANGES,
];

/*
 * The question mark a language asks with: full width after Japanese and
 * Chinese text, the Arabic one in Arabic and Persian.
 */
const QUESTION_MARKS: Record<string, string> = {
  ja: "？",
  "zh-CN": "？",
  "zh-TW": "？",
  ar: "؟",
  fa: "؟",
};

// Marks that would turn a right-to-left sentence round (Locales/ARABIC.md).
const DIRECTION_MARKS: RegExp = /[\u{200E}\u{200F}\u{061C}]/u;

// Where a sentence ends: a full stop and a space, or an ideographic stop.
const SENTENCE_END: RegExp = /(?:[.!?।]\s|。)/u;

// The words of `locale` the questions still take from English.
const englishLeftIn: (locale: Record<string, string>) => Array<string> = (
  locale: Record<string, string>,
): Array<string> => {
  return QUESTION_WORDS.filter((key: string): boolean => {
    const value: string | undefined = locale[key];

    return !value || !value.trim() || value === key;
  });
};

// A text's first sentence, with its stop.
const openingSentence: (text: string) => string = (text: string): string => {
  const end: RegExpExecArray | null = SENTENCE_END.exec(text);

  return end ? text.slice(0, end.index + 1) : text;
};

describe("the questions in English", () => {
  test("each text is an English key of its own, and both open with one sentence", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of QUESTION_WORDS) {
      expect(english[key]).toBe(key);
    }

    expect(openingSentence(LEAVE_DESCRIPTION)).toBe(
      "You have unsaved changes to this dashboard.",
    );
    expect(openingSentence(CANCEL_DESCRIPTION)).toBe(
      openingSentence(LEAVE_DESCRIPTION),
    );
  });

  test("a language that kept one English text, or opened one question its own way, would be caught", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(englishLeftIn(german)).toEqual([]);
    expect(englishLeftIn({ ...german, [CANCEL_TITLE]: CANCEL_TITLE })).toEqual([
      CANCEL_TITLE,
    ]);
    expect(englishLeftIn({ ...german, [KEEP_EDITING]: "" })).toEqual([
      KEEP_EDITING,
    ]);

    expect(openingSentence("Sie haben etwas geändert. Wirklich?")).not.toBe(
      openingSentence(german[LEAVE_DESCRIPTION]!),
    );
    expect(openingSentence("一つ目。二つ目。")).toBe("一つ目。");
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the questions in %s",
  (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);

    test("every text is the language's own, not the English", () => {
      expect(englishLeftIn(locale)).toEqual([]);
    });

    test("both questions open with one sentence: the unsaved changes", () => {
      const leaveOpening: string = openingSentence(locale[LEAVE_DESCRIPTION]!);

      expect(leaveOpening.length).toBeGreaterThan(0);
      expect(leaveOpening).not.toBe(locale[LEAVE_DESCRIPTION]);
      expect(openingSentence(locale[CANCEL_DESCRIPTION]!)).toBe(leaveOpening);
    });

    test("each question asks with the language's own question mark", () => {
      const mark: string = QUESTION_MARKS[language] || "?";

      for (const question of QUESTIONS) {
        expect(locale[question]!.endsWith(mark)).toBe(true);
      }
    });

    test("Cancel no longer asks the old question", () => {
      expect(locale[CANCEL_TITLE]).not.toBe(locale[OLD_CANCEL_TITLE]);
      expect(locale[CANCEL_DESCRIPTION]).not.toBe(
        locale[OLD_CANCEL_DESCRIPTION],
      );
    });

    test("no direction marks, and Spanish says tu", () => {
      for (const key of QUESTION_WORDS) {
        expect(DIRECTION_MARKS.test(locale[key]!)).toBe(false);

        if (language === "es") {
          expect(locale[key]!.toLowerCase()).not.toContain("usted");
        }
      }
    });
  },
);

// ---- drawn: the real dashboard view, in the reader's language ----------------

const AppShell: FunctionComponent = (): ReactElement => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());

  return (
    <div>
      <nav aria-label="Side menu">
        <SideMenuItem
          link={{ title: "Monitors", to: new Route(MONITORS_PATH) }}
        />
      </nav>
      <Routes>
        <RouterRoute
          path="/dashboard/:projectId/dashboards"
          element={<p>All dashboards</p>}
        />
        <RouterRoute
          path="/dashboard/:projectId/dashboards/:id"
          element={<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />}
        />
        <RouterRoute
          path="/dashboard/:projectId/monitors"
          element={<p>All monitors</p>}
        />
      </Routes>
    </div>
  );
};

const DRAWN_LANGUAGES: ReadonlyArray<string> = ["de", "ar", "fa"];

// `key` as `language` words it, read from its locale file.
const word: (language: string, key: string) => string = (
  language: string,
  key: string,
): string => {
  const text: string | undefined = readDashboardLocale(language)[key];

  expect({ language, key, worded: Boolean(text) }).toEqual({
    language,
    key,
    worded: true,
  });

  return text as string;
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 8; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function openBoardInEditMode(language: string): Promise<void> {
  render(
    <BrowserRouter useTransitions={false}>
      <AppShell />
    </BrowserRouter>,
  );

  await act(async () => {
    Navigation.navigate(new Route(BOARD_PATH));
  });
  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
  await settle();

  await act(async () => {
    fireEvent.click(
      screen.getByLabelText(word(language, "More dashboard options")),
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByText(word(language, "Edit Dashboard")));
  });
  expect(
    screen.getByTestId("canvas-stub").getAttribute("data-is-edit-mode"),
  ).toBe("true");
}

async function addTextWidget(language: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTitle(word(language, "Add Widget")));
  });
  await act(async () => {
    fireEvent.click(
      screen.getByTestId(`widget-card-${DashboardComponentType.Text}`),
    );
  });
  expect(
    screen.getByTestId("canvas-stub").getAttribute("data-widget-count"),
  ).toBe("2");
}

// The one dialog open, as a reader reads it.
function dialogText(): string {
  return withoutIsolateMarks(screen.getByRole("dialog").textContent || "");
}

function expectQuestionIn(
  language: string,
  question: { title: string; description: string },
): void {
  const text: string = dialogText();

  for (const key of [
    question.title,
    question.description,
    KEEP_EDITING,
    DISCARD_CHANGES,
  ]) {
    expect(text).toContain(word(language, key));
  }

  const englishShown: Array<string> = ENGLISH_SENTENCES.filter(
    (sentence: string): boolean => {
      return text.includes(sentence);
    },
  );

  expect(englishShown).toEqual([]);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", ...DRAWN_LANGUAGES].map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  LeaveGuard.reset();
  UnsavedChanges.reset();
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(null, "", DASHBOARDS_PATH);
});

afterEach(async () => {
  cleanup();
  LeaveGuard.reset();
  UnsavedChanges.reset();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  await settle();
});

describe.each([...DRAWN_LANGUAGES])(
  "a board with an unsaved widget, drawn in %s",
  (language: string) => {
    test("the side menu's question is the language's own, with none of its English", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });
      await openBoardInEditMode(language);
      await addTextWidget(language);

      await act(async () => {
        fireEvent.click(
          document.querySelector(`a[href="${MONITORS_PATH}"]`) as Element,
        );
      });
      await settle();

      expect(window.location.pathname).toBe(BOARD_PATH);
      expectQuestionIn(language, {
        title: LEAVE_TITLE,
        description: LEAVE_DESCRIPTION,
      });
    });

    test("the toolbar Cancel's question is the language's own, with none of its English", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });
      await openBoardInEditMode(language);
      await addTextWidget(language);

      await act(async () => {
        fireEvent.click(screen.getByTitle(word(language, "Cancel")));
      });
      await settle();

      expectQuestionIn(language, {
        title: CANCEL_TITLE,
        description: CANCEL_DESCRIPTION,
      });
      expect(dialogText()).not.toContain(word(language, OLD_CANCEL_TITLE));
      expect(dialogText()).not.toContain(
        word(language, OLD_CANCEL_DESCRIPTION),
      );
    });
  },
);
