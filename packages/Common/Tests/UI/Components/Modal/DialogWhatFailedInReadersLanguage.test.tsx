// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import Permission, { UserPermission } from "../../../../Types/Permission";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import {
  ERROR_REFERENCE_FIELD,
  getUnexplainedServerErrorMessage,
  UnexplainedErrorWords,
} from "../../../../Types/Exception/UnexplainedError";
import { createTranslator, Translator } from "../../../../Types/Translator";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";

/*
 * A DIALOG THAT FAILS SAYS WHAT FAILED, IN THE READER'S LANGUAGE (#7680).
 *
 * A failure nobody explained opens with what failed. Every dialog but the
 * notes' opened with "This did not finish." Each kind of dialog this
 * changed is drawn here in English, German (long words) and Persian (right
 * to left), with the Dashboard's words as it ships them:
 *
 *   - any dialog, named by its title: "“Rotate Verification Code” did not
 *     finish." (Modal), a question's title named without its mark;
 *   - a dialog that says what failed in words of its own (errorWhatFailed);
 *   - an Error dialog, whose description is the error: what it says it
 *     failed at, or nothing more where its title says it
 *     (titleSaysWhatFailed);
 *   - a table's or a card's failed delete, a failed read, a failed save,
 *     named by its record ("The monitor was not deleted.");
 *   - an action of a row that failed at once, named by its button;
 *   - an edit dialog whose record could not be read: said once, where its
 *     dialog drew two alerts with the same words.
 *
 * And every sentence this added is worded in every language of every front
 * end that can draw it.
 */

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        throw new HTTPErrorResponse(
          500,
          {
            error: getUnexplainedServerErrorMessage("9c4e1a07"),
            [ERROR_REFERENCE_FIELD]: "9c4e1a07",
          },
          {},
        );
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: (): { permissions: Array<UserPermission> } => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

import Modal from "../../../../UI/Components/Modal/Modal";
import ConfirmModal from "../../../../UI/Components/Modal/ConfirmModal";
import ModelFormModal from "../../../../UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RowActionsStore, {
  RowActionOpener,
} from "../../../../UI/Components/ActionButton/RowActionsStore";
import RowActionDialogs from "../../../../UI/Components/ActionButton/RowActionDialogs";
import {
  getDeleteWhatFailed,
  getDialogWhatFailed,
  getLoadWhatFailed,
  getSaveWhatFailed,
} from "../../../../UI/Utils/DialogWhatFailed";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../../Types/ObjectID";

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet",
);

type App =
  | "Dashboard"
  | "AdminDashboard"
  | "Accounts"
  | "StatusPage"
  | "PublicDashboard";

const APPS: Array<App> = [
  "Dashboard",
  "AdminDashboard",
  "Accounts",
  "StatusPage",
  "PublicDashboard",
];

const LANGUAGES: Array<string> = [
  "da",
  "de",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
  "ar",
  "fa",
];

// Each locale file read once: the Dashboard's are 60,000 keys each.
const localeFiles: Map<string, Record<string, string>> = new Map();

const wordsOf: (app: App, language: string) => Record<string, string> = (
  app: App,
  language: string,
): Record<string, string> => {
  const key: string = `${app}/${language}`;
  const cached: Record<string, string> | undefined = localeFiles.get(key);

  if (cached) {
    return cached;
  }

  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;

  localeFiles.set(key, words);

  return words;
};

// Every front end can draw a dialog, a table and a card delete.
const SHARED_SENTENCES: Array<string> = [
  UnexplainedErrorWords.dialogDidNotFinish,
  UnexplainedErrorWords.deleteFailed,
];

// What the Dashboard's Error dialogs say they failed at (#7680).
const DASHBOARD_SENTENCES: Array<string> = [
  "The incident states could not be loaded.",
  "The incident templates could not be loaded.",
  "The alert states could not be loaded.",
  "The scheduled maintenance states could not be loaded.",
  "The scheduled maintenance templates could not be loaded.",
  "The announcement templates could not be loaded.",
];

const SERVER_FAILURE: string = getUnexplainedServerErrorMessage("9c4e1a07");

const speak: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    for (const code of [language, "en"]) {
      i18next.removeResourceBundle(code, "translation");
      // A copy: i18next keeps what it is handed, and the files are cached.
      i18next.addResourceBundle(
        code,
        "translation",
        { ...wordsOf("Dashboard", code) },
        true,
        true,
      );
    }

    await i18next.changeLanguage(language);
  });
};

// The Dashboard's translator in `language`, as a page has it.
const translatorIn: (language: string) => Translator = (
  language: string,
): Translator => {
  const words: Record<string, string> = wordsOf("Dashboard", language);

  return createTranslator((text: string): string => {
    return words[text] || text;
  }, language);
};

const firstLineOf: (container: HTMLElement) => string = (
  container: HTMLElement,
): string => {
  return withoutIsolateMarks(
    within(container).getByTestId("error-what-failed").textContent || "",
  );
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("a dialog named by its title", () => {
  test.each(["en", "de", "fa"])(
    "in %s, a failure nobody explained opens with the dialog's own action, never 'This did not finish.'",
    async (language: string) => {
      await speak(language);

      render(
        <Modal
          title="Rotate Verification Code"
          error={SERVER_FAILURE}
          onSubmit={() => {}}
          onClose={() => {}}
        >
          <p>Rotating ends the current code.</p>
        </Modal>,
      );

      const words: Record<string, string> = wordsOf("Dashboard", language);
      const title: string =
        words["Rotate Verification Code"] || "Rotate Verification Code";

      expect(firstLineOf(screen.getByTestId("modal-error"))).toBe(
        translatorIn(language).translateTemplate(
          UnexplainedErrorWords.dialogDidNotFinish,
          { action: title },
        ),
      );
      expect(firstLineOf(screen.getByTestId("modal-error"))).toContain(title);
      expect(firstLineOf(screen.getByTestId("modal-error"))).not.toBe(
        words[UnexplainedErrorWords.didNotFinish] ||
          UnexplainedErrorWords.didNotFinish,
      );
      // The reference is still there to give, with its copy button.
      expect(
        within(screen.getByTestId("modal-error")).getByTestId(
          "error-reference",
        ),
      ).toHaveTextContent("9c4e1a07");
    },
  );

  test("a title asked as a question is named without its question mark", async () => {
    await speak("en");

    render(
      <ConfirmModal
        title="Regenerate backup codes?"
        description="Your old codes stop working."
        error={SERVER_FAILURE}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );

    expect(firstLineOf(screen.getByTestId("modal-error"))).toBe(
      "“Regenerate backup codes” did not finish.",
    );
  });

  test("a Persian or Arabic question mark goes too", () => {
    expect(
      getDialogWhatFailed(translatorIn("fa"), "کد پشتیبان را بسازم؟"),
    ).toBe(
      translatorIn("fa").translateTemplate(
        UnexplainedErrorWords.dialogDidNotFinish,
        { action: "کد پشتیبان را بسازم" },
      ),
    );
    expect(getDialogWhatFailed(translatorIn("en"), "  ")).toBeUndefined();
  });

  test("words of the page's own win over the title", async () => {
    await speak("de");

    render(
      <Modal
        title="Rotate Verification Code"
        error={SERVER_FAILURE}
        errorWhatFailed="Der Bestätigungscode wurde nicht erneuert."
        onSubmit={() => {}}
      >
        <p />
      </Modal>,
    );

    expect(firstLineOf(screen.getByTestId("modal-error"))).toBe(
      "Der Bestätigungscode wurde nicht erneuert.",
    );
  });

  test("an error somebody explained is drawn as it was, with no first line", async () => {
    await speak("en");

    render(
      <Modal
        title="Rotate Verification Code"
        error="The code was rotated a moment ago. Wait a minute, then try again."
        onSubmit={() => {}}
      >
        <p />
      </Modal>,
    );

    expect(screen.getByTestId("modal-error")).toHaveTextContent(
      "The code was rotated a moment ago.",
    );
    expect(
      within(screen.getByTestId("modal-error")).queryByTestId(
        "error-what-failed",
      ),
    ).toBeNull();
  });
});

describe("an Error dialog, whose description is the error", () => {
  test.each(["en", "de", "fa"])(
    "in %s, says what failed as its page words it",
    async (language: string) => {
      await speak(language);

      const whatFailed: string = getDeleteWhatFailed(
        translatorIn(language),
        "Monitor",
      );

      render(
        <ConfirmModal
          title="Error"
          description={SERVER_FAILURE}
          errorWhatFailed={whatFailed}
          submitButtonText="Close"
          onSubmit={() => {}}
        />,
      );

      expect(firstLineOf(screen.getByTestId("confirm-modal-description"))).toBe(
        whatFailed,
      );
    },
  );

  test("with a title that says what failed, says why and what to do next under it, and not what failed again", async () => {
    await speak("en");

    render(
      <ConfirmModal
        title="Could not start runbook"
        description={SERVER_FAILURE}
        titleSaysWhatFailed={true}
        submitButtonText="Close"
        onSubmit={() => {}}
      />,
    );

    const description: HTMLElement = screen.getByTestId(
      "confirm-modal-description",
    );

    expect(within(description).queryByTestId("error-what-failed")).toBeNull();
    expect(
      within(description).getByTestId("error-why-and-next"),
    ).toBeInTheDocument();
    expect(within(description).getByTestId("error-reference")).toBeVisible();
  });
});

describe("a record's delete, read and save, named by the record", () => {
  test.each([
    [
      "en",
      "The monitor was not deleted.",
      "The monitor could not be loaded.",
      "The workflow was not saved.",
    ],
    [
      "de",
      "Monitor wurde nicht gelöscht.",
      "Monitor konnte nicht geladen werden.",
      "Arbeitsablauf wurde nicht gespeichert.",
    ],
  ])(
    "in %s",
    (language: string, deleted: string, loaded: string, saved: string) => {
      const translator: Translator = translatorIn(language);

      expect(getDeleteWhatFailed(translator, "Monitor")).toBe(deleted);
      expect(getLoadWhatFailed(translator, "Monitor")).toBe(loaded);
      expect(getSaveWhatFailed(translator, "Workflow")).toBe(saved);
    },
  );

  test("in Persian, each in its own words", () => {
    const translator: Translator = translatorIn("fa");

    for (const sentence of [
      getDeleteWhatFailed(translator, "Monitor"),
      getLoadWhatFailed(translator, "Monitor"),
      getSaveWhatFailed(translator, "Workflow"),
    ]) {
      expect(sentence).not.toMatch(/was not|could not|Monitor|Workflow/);
    }
  });
});

describe("a row's action that failed at once", () => {
  test.each(["en", "de", "fa"])(
    "in %s, is named by its button in the Error dialog it opens",
    async (language: string) => {
      await speak(language);

      const store: RowActionsStore<{ _id: string }> = new RowActionsStore<{
        _id: string;
      }>();

      render(<RowActionDialogs store={store} />);

      act(() => {
        store.openError({
          rowKey: "row-1",
          message: SERVER_FAILURE,
          actionTitle: "Assign to Me",
          openedFrom: RowActionOpener.Button,
        });
      });

      const words: Record<string, string> = wordsOf("Dashboard", language);

      expect(
        firstLineOf(await screen.findByTestId("confirm-modal-description")),
      ).toBe(
        translatorIn(language).translateTemplate(
          UnexplainedErrorWords.dialogDidNotFinish,
          { action: words["Assign to Me"] || "Assign to Me" },
        ),
      );
    },
  );
});

describe("an edit dialog whose record could not be read", () => {
  test("says so once, with what failed, where it drew two alerts with the same words", async () => {
    await speak("en");

    render(
      <ModelFormModal<Probe>
        modelType={Probe}
        title="Edit Probe"
        onClose={() => {}}
        modelIdToEdit={new ObjectID("6f000000-0000-4000-8000-00000000000a")}
        formProps={{
          modelType: Probe,
          id: "edit-probe-form",
          formType: FormType.Update,
          fields: [
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
            },
          ],
        }}
      />,
    );

    const alert: HTMLElement = await screen.findByTestId("modal-error");

    expect(firstLineOf(alert)).toBe("The probe could not be loaded.");
    expect(screen.getAllByTestId("error-explanation")).toHaveLength(1);
    expect(screen.getAllByText(/9c4e1a07/)).toHaveLength(1);
  });
});

describe("every sentence this added", () => {
  test.each(APPS)("is worded in every language of the %s", (app: App) => {
    const sentences: Array<string> =
      app === "Dashboard"
        ? [...SHARED_SENTENCES, ...DASHBOARD_SENTENCES]
        : SHARED_SENTENCES;
    const english: Record<string, string> = wordsOf(app, "en");

    for (const sentence of sentences) {
      expect(english[sentence]).toBe(sentence);

      for (const language of LANGUAGES) {
        const worded: string | undefined = wordsOf(app, language)[sentence];

        expect([app, language, sentence, worded]).toEqual([
          app,
          language,
          sentence,
          expect.any(String),
        ]);
        expect(worded).not.toBe(sentence);

        for (const placeholder of sentence.match(/\{\{\w+\}\}/g) || []) {
          expect(worded).toContain(placeholder);
        }
      }
    }
  });
});
