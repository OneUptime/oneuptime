import "@testing-library/jest-dom";
import {
  afterAll,
  beforeAll,
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
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";

/*
 * Add Multiple Monitor Groups, in the reader's language (issue #6544).
 *
 * The customer who asked for it reads the Dashboard in Chinese. Every word
 * the dialog, its link and its summary add has a translation in each
 * language the Dashboard ships (Arabic aside, whose bulk add dialog is
 * still English), and the dialog says them: the title, the picker, the
 * button, and the counted summary - "one" and "other" forms included.
 */

const PAYMENTS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194169020";
const SEARCH_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194169021";

/*
 * The picker, reduced to one button that picks both monitor groups. It draws
 * its placeholder as the picker does: the form hands it over as written, in
 * English, and the picker looks it up in the reader's language, once (#7663).
 */
jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      placeholder?: string;
      onChange?: (value: Array<string>) => void;
    }) => {
      const translator: Translator = useTranslator();

      return (
        <div>
          <span data-testid="picker-placeholder">
            {translator.translateText(props.placeholder || "Select...")}
          </span>
          <button
            type="button"
            onClick={() => {
              props.onChange?.([SEARCH_ID, PAYMENTS_ID]);
            }}
          >
            Pick both
          </button>
        </div>
      );
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorGroups",
  () => {
    return {
      __esModule: true,
      default: jest.fn(),
    };
  },
);

import bulkAddStatusPageMonitorGroups, {
  BulkAddStatusPageMonitorGroupsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorGroups";
import BulkAddStatusPageMonitorsModal from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/BulkAddStatusPageMonitorsModal";
import { StatusPageResourceTargetType } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourceFormFields";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import useTranslator from "../../../UI/Utils/UseTranslator";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

// The words the bulk add of monitor groups brought to the Dashboard.
const NEW_KEYS: ReadonlyArray<string> = [
  "Add Monitor Groups",
  "Add Monitor Groups instead.",
  "Add Monitors instead.",
  "Add Multiple Monitor Groups",
  "Add monitor groups to this status page. Each resource gets its display name and description from its monitor group.",
  "Add multiple monitor groups",
  "Added {{added}} of {{count}} selected monitor groups.",
  "Added {{added}} of {{count}} selected monitor groups._one",
  "Added {{added}} of {{count}} selected monitors.",
  "Added {{added}} of {{count}} selected monitors._one",
  "Already Added",
  "Select Monitor Groups",
  "The monitor groups to show on the status page, with their names and descriptions. Ones already on the page are skipped.",
  "{{count}} monitor groups were already on this status page and were skipped.",
  "{{count}} monitor groups were already on this status page and were skipped._one",
  "{{count}} monitors were already on this status page and were skipped.",
  "{{count}} monitors were already on this status page and were skipped._one",
  "Monitor Group Add Results",
  "Monitor Groups Added",
  "These monitor groups are already on this status page, so they were left as they are.",
  "Unknown monitor group",
];

const ZH_CN: Record<string, string> = readDashboardLocale("zh-CN");
const DE: Record<string, string> = readDashboardLocale("de");

const mockBulkAddGroups: jest.MockedFunction<
  typeof bulkAddStatusPageMonitorGroups
> = bulkAddStatusPageMonitorGroups as jest.MockedFunction<
  typeof bulkAddStatusPageMonitorGroups
>;

const mockGetList: jest.MockedFunction<any> =
  ModelAPI.getList as unknown as jest.MockedFunction<any>;

type MakeMonitorGroupFunction = (id: string, name: string) => MonitorGroup;

const makeMonitorGroup: MakeMonitorGroupFunction = (
  id: string,
  name: string,
): MonitorGroup => {
  const monitorGroup: MonitorGroup = new MonitorGroup();
  monitorGroup._id = id;
  monitorGroup.name = name;
  return monitorGroup;
};

const PAYMENTS: MonitorGroup = makeMonitorGroup(PAYMENTS_ID, "支付服务");
const SEARCH: MonitorGroup = makeMonitorGroup(SEARCH_ID, "搜索服务");

type InLanguageFunction = (language: string) => Promise<void>;

const inLanguage: InLanguageFunction = async (
  language: string,
): Promise<void> => {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
};

type RenderModalFunction = () => ReturnType<typeof render>;

const renderModal: RenderModalFunction = (): ReturnType<typeof render> => {
  return render(
    <BulkAddStatusPageMonitorsModal
      projectId={new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194169001")}
      statusPageId={new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194169002")}
      targetType={StatusPageResourceTargetType.MonitorGroup}
      canSwitchTarget={true}
      onClose={jest.fn()}
      onComplete={jest.fn()}
    />,
  );
};

type AddBothFunction = (
  view: ReturnType<typeof render>,
  submitText: string,
) => Promise<void>;

// Picks both monitor groups and submits, once the button reads `submitText`.
const addBoth: AddBothFunction = async (
  view: ReturnType<typeof render>,
  submitText: string,
): Promise<void> => {
  fireEvent.click(view.getByRole("button", { name: "Pick both" }));

  await waitFor(() => {
    expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      submitText,
    );
  });

  fireEvent.click(view.getByTestId("modal-footer-submit-button"));
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      "zh-CN": { translation: ZH_CN },
      de: { translation: DE },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  cleanup();
  await inLanguage("en");
});

describe("the words Add Multiple Monitor Groups brought", () => {
  test("are each in the English file", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of NEW_KEYS) {
      expect({ key, english: english[key] }).toEqual({
        key,
        english: expect.any(String),
      });
    }
  });

  test("are worded in every language the Dashboard ships", () => {
    const missing: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const key of NEW_KEYS) {
        if (!isWordedInDashboardLocale(key, language)) {
          missing.push(`${language}: ${key}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("keep their {{placeholders}} in every language", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const changed: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of NEW_KEYS) {
        const expected: Array<string> = placeholdersOf(english[key] || "");
        const actual: Array<string> = placeholdersOf(words[key] || "");

        if (expected.join(",") !== actual.join(",")) {
          changed.push(`${language}: ${key}`);
        }
      }
    }

    expect(changed).toEqual([]);
  });

  /*
   * The menu item opens the dialog of the same name: a reader who clicked
   * "批量添加监视器组" lands on a dialog titled the same.
   */
  test("name the menu item as the dialog it opens, in every language", () => {
    const differ: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const menuItem: string = (words["Add multiple monitor groups"] || "")
        .toLocaleLowerCase(language)
        .replace(/[.。]$/u, "");
      const title: string = (words["Add Multiple Monitor Groups"] || "")
        .toLocaleLowerCase(language)
        .replace(/[.。]$/u, "");

      if (menuItem !== title) {
        differ.push(`${language}: ${menuItem} / ${title}`);
      }
    }

    expect(differ).toEqual([]);
  });
});

interface DialogLanguage {
  language: string;
  words: Record<string, string>;
}

// The customer's language, and one whose plurals have a "one" form.
const DIALOG_LANGUAGES: Array<DialogLanguage> = [
  {
    language: "zh-CN",
    words: ZH_CN,
  },
  {
    language: "de",
    words: DE,
  },
];

describe.each(DIALOG_LANGUAGES)(
  "the dialog in $language",
  ({ language, words }: DialogLanguage) => {
    type WordFunction = (key: string) => string;

    const word: WordFunction = (key: string): string => {
      const value: string | undefined = words[key];

      if (!value) {
        throw new Error(`${language} has no "${key}".`);
      }

      return value;
    };

    type CountedFunction = (
      key: string,
      values: Record<string, number>,
    ) => string;

    // A counted sentence as the locale words it, its form picked as i18next does.
    const counted: CountedFunction = (
      key: string,
      values: Record<string, number>,
    ): string => {
      const form: string = new Intl.PluralRules(language).select(
        values["count"] as number,
      );
      const template: string =
        form === "one" && words[`${key}_one`] ? word(`${key}_one`) : word(key);

      return template.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_match: string, name: string): string => {
          return String(values[name]);
        },
      );
    };

    beforeAll(async () => {
      await inLanguage(language);
    });

    beforeEach(() => {
      cleanup();
      jest.clearAllMocks();

      mockGetList.mockImplementation(async (data: any): Promise<any> => {
        if (data.modelType === StatusPageResource) {
          return { data: [], count: 0 };
        }

        return { data: [PAYMENTS, SEARCH], count: 2 };
      });
    });

    test("asks for monitor groups in the reader's words", async () => {
      const view: ReturnType<typeof render> = renderModal();

      expect(
        view.getByText(word("Add Multiple Monitor Groups")),
      ).toBeInTheDocument();
      expect(
        view.getByText(
          word(
            "Add monitor groups to this status page. Each resource gets its display name and description from its monitor group.",
          ),
        ),
      ).toBeInTheDocument();
      expect(view.getByTestId("picker-placeholder")).toHaveTextContent(
        word("Select Monitor Groups"),
      );
      expect(
        view.getByText(word("Add Monitors instead."), { exact: false }),
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(
          view.getByTestId("modal-footer-submit-button"),
        ).toHaveTextContent(word("Add Monitor Groups"));
      });

      // None of the dialog's English is left on the page.
      expect(view.queryByText("Add Multiple Monitor Groups")).toBeNull();
      expect(view.queryByText("Add Monitors instead.")).toBeNull();
    });

    test("counts what was added and what was already there", async () => {
      mockBulkAddGroups.mockResolvedValue({
        succeeded: [PAYMENTS],
        failed: [],
        skipped: [SEARCH],
      } as BulkAddStatusPageMonitorGroupsResult);

      const view: ReturnType<typeof render> = renderModal();

      await addBoth(view, word("Add Monitor Groups"));

      expect(
        await view.findByText(word("Monitor Groups Added")),
      ).toBeInTheDocument();

      const summary: string = [
        counted("Added {{added}} of {{count}} selected monitor groups.", {
          added: 1,
          count: 2,
        }),
        counted(
          "{{count}} monitor groups were already on this status page and were skipped.",
          { count: 1 },
        ),
      ].join(" ");

      expect(view.getByText(summary)).toBeInTheDocument();
      expect(view.getByTestId("bulk-add-result-skipped")).toHaveTextContent(
        `${word("Already Added")} (1)`,
      );
      expect(view.getByTestId("bulk-add-result-added")).toHaveTextContent(
        `${word("Added")} (1)`,
      );
      expect(
        view.getByText(
          word(
            "These monitor groups are already on this status page, so they were left as they are.",
          ),
        ),
      ).toBeInTheDocument();
    });

    test("says one picked monitor group in its one form", async () => {
      mockBulkAddGroups.mockResolvedValue({
        succeeded: [PAYMENTS],
        failed: [],
        skipped: [],
      } as BulkAddStatusPageMonitorGroupsResult);

      const view: ReturnType<typeof render> = renderModal();

      await addBoth(view, word("Add Monitor Groups"));

      expect(
        await view.findByText(
          counted("Added {{added}} of {{count}} selected monitor groups.", {
            added: 1,
            count: 1,
          }),
        ),
      ).toBeInTheDocument();
    });

    test("titles a summary with failures in the reader's words", async () => {
      mockBulkAddGroups.mockResolvedValue({
        succeeded: [],
        failed: [
          {
            monitorGroup: new MonitorGroup(),
            error: new Error("Refused."),
          },
        ],
        skipped: [],
      } as BulkAddStatusPageMonitorGroupsResult);

      const view: ReturnType<typeof render> = renderModal();

      await addBoth(view, word("Add Monitor Groups"));

      expect(
        await view.findByText(word("Monitor Group Add Results")),
      ).toBeInTheDocument();
      expect(view.getByTestId("bulk-add-result-failed")).toHaveTextContent(
        `${word("Failed")} (1)`,
      );
      expect(view.getByTestId("bulk-add-result-failed")).toHaveTextContent(
        word("Unknown monitor group"),
      );
    });
  },
);
