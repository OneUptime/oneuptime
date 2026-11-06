import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import Path from "path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * A STATUS PAGE SUBSCRIBER'S LANGUAGE, ON THE DASHBOARD.
 *
 * Each subscriber is written to in their own language, else in the status
 * page's default language (Common/Server/Utils/StatusPage/
 * SubscriberLanguage). The Email, SMS, Slack and Microsoft Teams subscriber
 * lists show which - the subscriber's own language by name ("Deutsch
 * (German)"), or "Deutsch (default)" for one who follows the page, the
 * language first so a cell cut short to fit its table still names it - and
 * their Add and Edit forms let the team pick one, or clear it to follow the
 * page ("Page default (Deutsch)"), under More fields
 * (SubscriberFormFields.getSubscriberLanguageField, SubscriberLanguageColumn).
 * Languages are named as the page's Languages card names them
 * (StatusPageLanguageOptions).
 *
 * The labels, the field and the column are tested on their own, then the
 * field through the real ModelForm with only the network stubbed: what is
 * drawn, and what is sent.
 */

type CapturedRequest = {
  model: JSONObject;
};

let capturedRequests: Array<CapturedRequest> = [];
let storedSubscriber: JSONObject = {};

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return { ...storedSubscriber };
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({ model: data.model });
        return { data: data.model };
      },
    },
  };
});

import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import {
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
} from "../../../Types/StatusPage/StatusPageLanguage";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import Column from "../../../UI/Components/ModelTable/Column";
import FieldType from "../../../UI/Components/Types/FieldType";
import { createTranslator, Translator } from "../../../Types/Translator";
import { SubscriberFormCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices";
import {
  SUBSCRIBER_INFO_STEP_ID,
  getSubscriberLanguageField,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormFields";
import {
  findStatusPageLanguage,
  getStatusPageLanguageLabel,
  getStatusPageLanguageLabelOfCode,
  getStatusPageLanguageNativeName,
  STATUS_PAGE_LANGUAGE_OPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageLanguageOptions";
import {
  getSubscriberFollowsPageLanguageText,
  getSubscriberLanguageColumn,
  getSubscriberLanguageText,
  getSubscriberPageDefaultLanguageText,
  SubscriberLanguageCell,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberLanguageColumn";

// The Dashboard's 17 locale files, by language.
const DASHBOARD_LOCALES_DIR: string = Path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const SUBSCRIBER_ID: string = "00000005-0000-4000-8000-000000000005";
const EMAIL_PLACEHOLDER: string = "subscriber@company.com";

const EMAIL_FIELD: ModelField<StatusPageSubscriber> = {
  field: { subscriberEmail: true },
  stepId: SUBSCRIBER_INFO_STEP_ID,
  title: "Email",
  fieldType: FormFieldSchemaType.Email,
  required: true,
  placeholder: EMAIL_PLACEHOLDER,
};

// The English Dashboard's translator: the words as written.
const ENGLISH: Translator = createTranslator(undefined, "en");

// A German Dashboard's, for the sentences this suite reads.
const GERMAN: Translator = createTranslator((text: string) => {
  return (
    {
      "Page default ({{language}})": "Seitenstandard ({{language}})",
      "{{language}} (default)": "{{language}} (Standard)",
    } as Record<string, string>
  )[text];
}, "de");

afterEach(() => {
  cleanup();
  capturedRequests = [];
  storedSubscriber = {};
});

describe("the languages, as the Dashboard names them", () => {
  test("each in its own words, then its English name", () => {
    expect(getStatusPageLanguageLabelOfCode("de")).toBe("Deutsch (German)");
    expect(getStatusPageLanguageLabelOfCode("ja")).toBe("日本語 (Japanese)");
    expect(getStatusPageLanguageLabelOfCode("fa")).toBe("فارسی (Persian)");
    expect(getStatusPageLanguageLabelOfCode("zh-TW")).toBe(
      "繁體中文 (Chinese (Traditional))",
    );
  });

  test("a language whose own name is its English one is named once", () => {
    expect(getStatusPageLanguageLabelOfCode("en")).toBe("English");
    expect(
      getStatusPageLanguageLabel(findStatusPageLanguage("en")!),
    ).not.toContain("(");
  });

  test("a code no status page shows is shown as it is stored, never hidden", () => {
    expect(getStatusPageLanguageLabelOfCode("tlh")).toBe("tlh");
    expect(getStatusPageLanguageNativeName("tlh")).toBe("tlh");
    expect(findStatusPageLanguage("tlh")).toBeUndefined();
    expect(findStatusPageLanguage("")).toBeUndefined();
    expect(findStatusPageLanguage(null)).toBeUndefined();
  });

  test("a language's own name", () => {
    expect(getStatusPageLanguageNativeName("de")).toBe("Deutsch");
    expect(getStatusPageLanguageNativeName("en")).toBe("English");
  });

  test("the picker offers every language a status page and its subscribers are written in, once each, in the page's order", () => {
    expect(
      STATUS_PAGE_LANGUAGE_OPTIONS.map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual(SUPPORTED_STATUS_PAGE_LANGUAGE_CODES);

    // The server writes in every one of them (SubscriberLanguage).
    expect([...SUPPORTED_STATUS_PAGE_LANGUAGE_CODES].sort()).toEqual(
      [...READER_LANGUAGE_CODES].sort(),
    );

    expect(
      STATUS_PAGE_LANGUAGE_OPTIONS.map((option: { label: string }) => {
        return option.label;
      }),
    ).toEqual(
      SUPPORTED_STATUS_PAGE_LANGUAGES.map(
        (language: StatusPageLanguage): string => {
          return getStatusPageLanguageLabel(language);
        },
      ),
    );
  });
});

describe("the Language field of a subscriber's Add and Edit forms", () => {
  const moreFields: FormFieldCollapsibleSection<StatusPageSubscriber> =
    getAdvancedFormSection<StatusPageSubscriber>();
  const field: ModelField<StatusPageSubscriber> = getSubscriberLanguageField({
    moreFields: moreFields,
    placeholder: "Page default (Deutsch)",
  });

  test("picks the subscriber's language, from every language, under More fields", () => {
    expect(field.field).toEqual({ language: true });
    expect(field.title).toBe("Language");
    expect(field.description).toBe(
      "The language their notifications are written in.",
    );
    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.dropdownOptions).toBe(STATUS_PAGE_LANGUAGE_OPTIONS);
    expect(field.collapsibleSection).toBe(moreFields);
    expect(field.stepId).toBe(SUBSCRIBER_INFO_STEP_ID);
    expect(field.dataTestId).toBe("subscriber-language");
  });

  test("is not required: cleared, the subscriber follows the page, which its placeholder names", () => {
    expect(field.required).toBe(false);
    expect(field.placeholder).toBe("Page default (Deutsch)");
    // Shown on Add and on Edit alike.
    expect(field.doNotShowWhenCreating).toBeUndefined();
    expect(field.doNotShowWhenEditing).toBeUndefined();
  });

  test("says the page's default language by its own name, in the reader's language", () => {
    expect(getSubscriberPageDefaultLanguageText(ENGLISH, "de")).toBe(
      "Page default (Deutsch)",
    );
    expect(getSubscriberPageDefaultLanguageText(ENGLISH, "ja")).toBe(
      "Page default (日本語)",
    );
    expect(getSubscriberPageDefaultLanguageText(GERMAN, "de")).toBe(
      "Seitenstandard (Deutsch)",
    );
  });

  test("a page without a default language is English", () => {
    for (const pageLanguage of [undefined, null, ""]) {
      expect(getSubscriberPageDefaultLanguageText(ENGLISH, pageLanguage)).toBe(
        "Page default (English)",
      );
    }
  });

  test("its words are the copy's", () => {
    expect(SubscriberFormCopy.languageTitle).toBe("Language");
    expect(SubscriberFormCopy.pageDefaultLanguage).toBe(
      "Page default ({{language}})",
    );
    expect(SubscriberFormCopy.followsPageLanguage).toBe(
      "{{language}} (default)",
    );
  });
});

describe("the Language column of the subscriber lists", () => {
  const column: Column<StatusPageSubscriber> = getSubscriberLanguageColumn({
    translator: ENGLISH,
    pageLanguage: "de",
  });

  const subscriberWith: (language?: string) => StatusPageSubscriber = (
    language?: string,
  ): StatusPageSubscriber => {
    const row: StatusPageSubscriber = new StatusPageSubscriber();

    if (language) {
      row.language = language;
    }

    return row;
  };

  test("reads the subscriber's language column, titled Language, off a phone's cards", () => {
    expect(column.field).toEqual({ language: true });
    expect(column.title).toBe("Language");
    expect(column.type).toBe(FieldType.Text);
    expect(column.hideOnMobile).toBe(true);
  });

  test("names a subscriber's own language", () => {
    render(column.getElement!(subscriberWith("fr")));

    expect(screen.getByTestId("subscriber-language-own")).toHaveTextContent(
      "Français (French)",
    );
    expect(screen.queryByTestId("subscriber-language-default")).toBeNull();
  });

  test("says a subscriber without one follows the page's default, quieter", () => {
    render(column.getElement!(subscriberWith()));

    const cell: HTMLElement = screen.getByTestId("subscriber-language-default");

    expect(cell).toHaveTextContent("Deutsch (default)");
    expect(cell).toHaveClass("text-gray-500");
    expect(screen.queryByTestId("subscriber-language-own")).toBeNull();
  });

  /*
   * A list beside the side menu, or in a language with long words, cuts a
   * value short to fit its card ("Page default (De..."): a cell that
   * starts with the language still says which one it is when cut.
   */
  test("names the language first, so a cell cut short still says which", () => {
    render(column.getElement!(subscriberWith()));

    const cell: HTMLElement = screen.getByTestId("subscriber-language-default");

    expect(cell.textContent?.startsWith("Deutsch")).toBe(true);
    expect(cell.querySelector("bdi")).toHaveTextContent("Deutsch");

    // Whatever the page's language, and in the reader's language too.
    expect(getSubscriberFollowsPageLanguageText(ENGLISH, "ja")).toBe(
      "日本語 (default)",
    );
    expect(getSubscriberFollowsPageLanguageText(GERMAN, "de")).toBe(
      "Deutsch (Standard)",
    );
    expect(getSubscriberFollowsPageLanguageText(ENGLISH, undefined)).toBe(
      "English (default)",
    );
  });

  test("every Dashboard language words the cell with the language first", () => {
    const files: Array<string> = fs
      .readdirSync(DASHBOARD_LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const words: Record<string, unknown> = JSON.parse(
        fs.readFileSync(Path.join(DASHBOARD_LOCALES_DIR, file), "utf8"),
      );
      const cell: unknown = words[SubscriberFormCopy.followsPageLanguage];

      expect([file, typeof cell]).toEqual([file, "string"]);
      expect([file, String(cell).startsWith("{{language}} ")]).toEqual([
        file,
        true,
      ]);

      // Worded apart from English everywhere but in English itself.
      if (file !== "en.json") {
        expect([file, cell]).not.toEqual([
          file,
          SubscriberFormCopy.followsPageLanguage,
        ]);
      }
    }
  });

  test("a language's name reads its own way inside the cell", () => {
    render(<SubscriberLanguageCell language="fa" pageLanguage="de" />);

    const name: HTMLElement = screen.getByTestId("subscriber-language-own");

    expect(name.tagName.toLowerCase()).toBe("bdi");
    expect(name).toHaveTextContent("فارسی (Persian)");
  });

  test("exports what it shows, as text", () => {
    expect(column.getExportValue!(subscriberWith("ja"))).toBe(
      "日本語 (Japanese)",
    );
    expect(column.getExportValue!(subscriberWith())).toBe("Deutsch (default)");
    expect(
      getSubscriberLanguageText({
        translator: ENGLISH,
        language: undefined,
        pageLanguage: undefined,
      }),
    ).toBe("English (default)");
  });
});

describe("the Language field, through the real form", () => {
  const fields: () => Array<ModelField<StatusPageSubscriber>> = (): Array<
    ModelField<StatusPageSubscriber>
  > => {
    const moreFields: FormFieldCollapsibleSection<StatusPageSubscriber> =
      getAdvancedFormSection<StatusPageSubscriber>();

    return [
      EMAIL_FIELD,
      getSubscriberLanguageField({
        moreFields: moreFields,
        placeholder: "Page default (Deutsch)",
      }),
    ];
  };

  const renderForm: (formType: FormType) => Promise<void> = async (
    formType: FormType,
  ): Promise<void> => {
    await act(async (): Promise<void> => {
      render(
        <ModelForm<StatusPageSubscriber>
          modelType={StatusPageSubscriber}
          id="email-subscriber-form"
          name="Email Subscriber"
          fields={fields()}
          formType={formType}
          {...(formType === FormType.Update
            ? { modelIdToEdit: new ObjectID(SUBSCRIBER_ID) }
            : {})}
          onSuccess={(): void => {
            // Not asserted on.
          }}
          submitButtonText="Save"
        />,
      );
    });
  };

  const openMoreFields: () => void = (): void => {
    fireEvent.click(screen.getByRole("button", { name: /More fields/ }));
  };

  const openLanguageMenu: () => void = (): void => {
    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
  };

  const save: () => Promise<CapturedRequest> =
    async (): Promise<CapturedRequest> => {
      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      await waitFor(() => {
        expect(capturedRequests).toHaveLength(1);
      });

      return capturedRequests[0]!;
    };

  test("folded, More fields names the Language field", async () => {
    await renderForm(FormType.Create);

    expect(listedNames()).toContain("Language");
    // Nothing picked: nothing set.
    expect(setChips()).toEqual([]);
  });

  test("Add: a language picked from the list is sent as its code", async () => {
    await renderForm(FormType.Create);

    fireEvent.change(screen.getByPlaceholderText(EMAIL_PLACEHOLDER), {
      target: { value: "ana@example.com" },
    });
    openMoreFields();

    // Empty, it says what the subscriber will follow.
    expect(screen.getByText("Page default (Deutsch)")).toBeInTheDocument();

    openLanguageMenu();
    fireEvent.click(await screen.findByText("Français (French)"));

    const request: CapturedRequest = await save();

    expect(request.model["language"]).toBe("fr");
    expect(request.model["subscriberEmail"]).toBe("ana@example.com");
  });

  test("Add: left empty, the subscriber is sent with no language of its own", async () => {
    await renderForm(FormType.Create);

    fireEvent.change(screen.getByPlaceholderText(EMAIL_PLACEHOLDER), {
      target: { value: "ana@example.com" },
    });

    const request: CapturedRequest = await save();

    expect(request.model["language"] ?? null).toBeNull();
  });

  test("Edit: a subscriber's stored language is shown, and folded More fields says so", async () => {
    storedSubscriber = {
      _id: SUBSCRIBER_ID,
      subscriberEmail: "ana@example.com",
      language: "ja",
    };

    await renderForm(FormType.Update);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toHaveValue(
        "ana@example.com",
      );
    });

    await waitFor(() => {
      expect(setChips().join(" ")).toContain("日本語 (Japanese)");
    });

    openMoreFields();

    expect(
      document.querySelector(".ou-select__single-value"),
    ).toHaveTextContent("日本語 (Japanese)");
  });

  test("Edit: clearing the language sends none, so the subscriber follows the page", async () => {
    storedSubscriber = {
      _id: SUBSCRIBER_ID,
      subscriberEmail: "ana@example.com",
      language: "ja",
    };

    await renderForm(FormType.Update);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toHaveValue(
        "ana@example.com",
      );
    });

    openMoreFields();

    const clear: HTMLElement | null = document.querySelector<HTMLElement>(
      ".ou-select__clear-indicator",
    );

    expect(clear).not.toBeNull();
    // react-select clears on a primary-button mousedown.
    fireEvent.mouseDown(clear as HTMLElement, { button: 0 });

    expect(screen.getByText("Page default (Deutsch)")).toBeInTheDocument();

    const request: CapturedRequest = await save();

    expect(request.model["language"] ?? null).toBeNull();
  });
});
