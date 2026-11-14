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
import { getJestSpyOn } from "../../Spy";

/*
 * THE QUESTIONS A RUNBOOK'S STEPS AND A FORM'S BUILDER ASK BEFORE THEIR
 * UNSAVED CHANGES ARE LOST, IN EVERY LANGUAGE (issue #7401).
 *
 * Both ask as a dashboard being edited asks (DashboardLeaveQuestionInLocale
 * holds that one): "Leave without saving?", one sentence naming what is
 * lost, Keep Editing and Discard Changes. Each names its own work - "this
 * runbook's steps", "this form's questions" - and then says what leaving
 * does in the dashboard's very words.
 *
 * Read from the Dashboard's locale files: every language words both
 * sentences itself, opens each with what it names, closes each with the
 * dashboard's second sentence, and uses no direction marks. Then drawn: the
 * real Steps page and the real form builder in German, Arabic and Persian
 * ask in that language, with none of the English.
 */

jest.setTimeout(120000);

const PROJECT_ID: string = "66666666-6666-4666-8666-666666666671";
const RUNBOOK_ID: string = "66666666-6666-4666-8666-666666666672";
const FORM_ID: string = "66666666-6666-4666-8666-666666666673";
const START_PATH: string = `/dashboard/${PROJECT_ID}/home`;
const STEPS_PATH: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`;
const FORM_PATH: string = `/dashboard/${PROJECT_ID}/forms/${FORM_ID}`;
const MONITORS_PATH: string = `/dashboard/${PROJECT_ID}/monitors`;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData",
  () => {
    return {
      __esModule: true,
      loadFormCustomFields: async (): Promise<Array<unknown>> => {
        return [];
      },
      loadFormRecordOptions: async (): Promise<Array<unknown>> => {
        return [];
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormPreviewModal",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): string => {
      return props.text;
    },
  };
});

import Steps from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps";
import FormBuild from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Build";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Form from "../../../Models/DatabaseModels/Form";
import Project from "../../../Models/DatabaseModels/Project";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { getDefaultFormFields } from "../../../Types/Form/FormField";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import API from "../../../UI/Utils/API/API";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UnsavedChanges from "../../../UI/Utils/NewVersion/UnsavedChanges";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LEAVE_TITLE: string = "Leave without saving?";
const KEEP_EDITING: string = "Keep Editing";
const DISCARD_CHANGES: string = "Discard Changes";
const DASHBOARD_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you leave now, they will be lost.";
const RUNBOOK_DESCRIPTION: string =
  "You have unsaved changes to this runbook's steps. If you leave now, they will be lost.";
const FORM_DESCRIPTION: string =
  "You have unsaved changes to this form's questions. If you leave now, they will be lost.";

// The two new sentences, each naming the work it is about.
const DESCRIPTIONS: ReadonlyArray<string> = [
  RUNBOOK_DESCRIPTION,
  FORM_DESCRIPTION,
];

const ENGLISH_SENTENCES: ReadonlyArray<string> = [
  LEAVE_TITLE,
  "You have unsaved changes to this runbook's steps.",
  "You have unsaved changes to this form's questions.",
  "If you leave now, they will be lost.",
  KEEP_EDITING,
  DISCARD_CHANGES,
];

// Marks that would turn a right-to-left sentence round (Locales/ARABIC.md).
const DIRECTION_MARKS: RegExp = /[\u{200E}\u{200F}\u{061C}]/u;

// Where a sentence ends: a full stop and a space, or an ideographic stop.
const SENTENCE_END: RegExp = /(?:[.!?।]\s|。)/u;

// A text's first sentence, with its stop.
const openingSentence: (text: string) => string = (text: string): string => {
  const end: RegExpExecArray | null = SENTENCE_END.exec(text);

  return end ? text.slice(0, end.index + 1) : text;
};

// What follows a text's first sentence.
const closingSentence: (text: string) => string = (text: string): string => {
  return text.slice(openingSentence(text).length).trim();
};

describe("the sentences in English", () => {
  test("each is an English key of its own, and closes as the dashboard's does", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of DESCRIPTIONS) {
      expect(english[key]).toBe(key);
      expect(closingSentence(key)).toBe(closingSentence(DASHBOARD_DESCRIPTION));
    }

    expect(openingSentence(RUNBOOK_DESCRIPTION)).toBe(
      "You have unsaved changes to this runbook's steps.",
    );
    expect(openingSentence(FORM_DESCRIPTION)).toBe(
      "You have unsaved changes to this form's questions.",
    );
  });

  test("a language that kept the English, or closed its own way, would be caught", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(german[RUNBOOK_DESCRIPTION]).not.toBe(RUNBOOK_DESCRIPTION);
    expect(closingSentence("Sie haben Änderungen. Wirklich gehen?")).not.toBe(
      closingSentence(german[DASHBOARD_DESCRIPTION]!),
    );
    expect(closingSentence("一つ目。二つ目。")).toBe("二つ目。");
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the sentences in %s",
  (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);
    const dashboard: string = locale[DASHBOARD_DESCRIPTION]!;

    test("each is the language's own, not the English", () => {
      for (const key of DESCRIPTIONS) {
        expect({ key, worded: Boolean(locale[key]?.trim()) }).toEqual({
          key,
          worded: true,
        });
        expect(locale[key]).not.toBe(key);
      }
    });

    test("each opens with the work it names, and no two alike", () => {
      const openings: Array<string> = [
        openingSentence(dashboard),
        openingSentence(locale[RUNBOOK_DESCRIPTION]!),
        openingSentence(locale[FORM_DESCRIPTION]!),
      ];

      expect(new Set(openings).size).toBe(3);

      for (const opening of openings) {
        expect(opening.length).toBeGreaterThan(0);
      }
    });

    test("each closes with the dashboard's own second sentence", () => {
      expect(closingSentence(dashboard).length).toBeGreaterThan(0);

      for (const key of DESCRIPTIONS) {
        expect(closingSentence(locale[key]!)).toBe(closingSentence(dashboard));
      }
    });

    test("no direction marks, and Spanish says tu", () => {
      for (const key of DESCRIPTIONS) {
        expect(DIRECTION_MARKS.test(locale[key]!)).toBe(false);

        if (language === "es") {
          expect(locale[key]!.toLowerCase()).not.toContain("usted");
          expect(locale[key]!.startsWith("Tienes")).toBe(true);
        }
      }
    });
  },
);

// ---- drawn: the real pages, in the reader's language ------------------------

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
        <RouterRoute path="/dashboard/:projectId/home" element={<p>Home</p>} />
        <RouterRoute
          path="/dashboard/:projectId/runbooks/:id/steps"
          element={
            <Steps
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
        <RouterRoute
          path="/dashboard/:projectId/forms/:id"
          element={
            <FormBuild
              pageRoute={RouteMap[PageMap.FORM_VIEW] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
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

async function open(path: string): Promise<void> {
  render(
    <BrowserRouter useTransitions={false}>
      <AppShell />
    </BrowserRouter>,
  );

  await act(async () => {
    Navigation.navigate(new Route(path));
  });
}

async function clickSideMenuMonitors(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      document.querySelector(`a[href="${MONITORS_PATH}"]`) as Element,
    );
  });
  await settle();
}

// The one dialog open, as a reader reads it.
function dialogText(): string {
  return withoutIsolateMarks(screen.getByRole("dialog").textContent || "");
}

function expectQuestionIn(language: string, description: string): void {
  const text: string = dialogText();

  for (const key of [LEAVE_TITLE, description, KEEP_EDITING, DISCARD_CHANGES]) {
    expect(text).toContain(word(language, key));
  }

  const englishShown: Array<string> = ENGLISH_SENTENCES.filter(
    (sentence: string): boolean => {
      return text.includes(sentence);
    },
  );

  expect(englishShown).toEqual([]);
}

function storedSteps(): Array<RunbookStep> {
  return [
    {
      id: "check",
      order: 0,
      type: RunbookStepType.Manual,
      title: "Check the dashboards",
      config: {},
    },
  ];
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
  window.history.replaceState(null, "", START_PATH);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (args: {
    modelType: unknown;
  }) => {
    if (args.modelType === Project) {
      return Object.assign(new Project(), {
        _id: PROJECT_ID,
        useGlobalRunners: true,
      });
    }

    if (args.modelType === Form) {
      const form: Form = new Form();
      form._id = FORM_ID;
      form.name = "Report a Problem";
      form.targetType = FormTargetType.Incident;
      form.fields = getDefaultFormFields(FormTargetType.Incident) as never;
      form.targetSettings = {} as never;
      return form;
    }

    const runbook: Runbook = new Runbook();
    runbook._id = RUNBOOK_ID;
    runbook.steps = storedSteps() as never;
    return runbook;
  }) as never);

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (): Promise<
    ListResult<never>
  > => {
    return { data: [], count: 0, skip: 0, limit: 10 };
  }) as never);

  // No AI providers: the Steps page carries on without them.
  jest.spyOn(API, "post").mockImplementation((async () => {
    throw new Error("No AI providers here.");
  }) as never);

  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
});

afterEach(async () => {
  cleanup();
  LeaveGuard.reset();
  UnsavedChanges.reset();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  await settle();
});

describe.each([...DRAWN_LANGUAGES])("drawn in %s", (language: string) => {
  test("a runbook's unsaved steps: the side menu's question is the language's own, with none of its English", async () => {
    await act(async () => {
      await i18next.changeLanguage(language);
    });
    await open(STEPS_PATH);
    await screen.findAllByTestId("runbook-step-header", {}, { timeout: 20000 });
    await settle();

    await act(async () => {
      fireEvent.change(document.getElementById("runbook-step-0-title")!, {
        target: { value: "Check the graphs" },
      });
    });

    await clickSideMenuMonitors();

    expect(window.location.pathname).toBe(STEPS_PATH);
    expectQuestionIn(language, RUNBOOK_DESCRIPTION);
  });

  test("a form's unsaved questions: the side menu's question is the language's own, with none of its English", async () => {
    await act(async () => {
      await i18next.changeLanguage(language);
    });
    await open(FORM_PATH);
    await waitFor(() => {
      expect(screen.getByTestId("form-canvas")).toBeInTheDocument();
    });
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("form-palette-question-Text"));
    });

    await clickSideMenuMonitors();

    expect(window.location.pathname).toBe(FORM_PATH);
    expectQuestionIn(language, FORM_DESCRIPTION);
  });
});
