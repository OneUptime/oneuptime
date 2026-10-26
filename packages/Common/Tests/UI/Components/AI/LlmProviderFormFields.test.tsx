import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import IconProp from "../../../../Types/Icon/IconProp";
import LlmType from "../../../../Types/LLM/LlmType";
import {
  LLM_PROVIDER_CARD_OPTIONS,
  getGlobalLlmProviderFormFields,
  getLlmProviderBaseUrlHint,
  getLlmProviderDefaultName,
  getLlmProviderFormSteps,
  getLlmProviderNameAfterPick,
  getProjectLlmProviderFormFields,
} from "../../../../UI/Components/AI/LlmProviderFormFields";
import {
  LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE,
  LLM_PROVIDER_TYPES,
  LLM_PROVIDER_TYPE_COPY,
  LlmProviderFormCopy,
  getLlmProviderShownModelName,
  getLlmProviderShownValue,
  readLlmType,
} from "../../../../UI/Components/AI/LlmProviderFormCopy";
import { CardSelectOption } from "../../../../UI/Components/CardSelect/CardSelect";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { createTranslator } from "../../../../UI/Utils/TranslateTemplate";

/*
 * The LLM provider form (LlmProviderFormFields): which provider, then only
 * what it needs. Drawn and saved on the real pages by
 * Tests/App/Dashboard/LlmProviderFormsFoundry, Tests/App/AdminDashboard/
 * AdminSettingsFormsOnePage and the E2E suite LlmProviderTest; held to the
 * server by Tests/Server/Utils/AI/LlmProviderFormCopyFacts. Here: the
 * pieces - the cards, what each field asks of each provider, the help
 * under it, and the name that follows the provider picked.
 */

type ProviderField = Field<LlmProvider>;

function columnOf(field: ProviderField): string {
  return Object.keys(field.field || {})[0] || "";
}

function fieldOf(
  fields: Array<ProviderField>,
  column: keyof LlmProvider,
): ProviderField {
  const found: ProviderField | undefined = fields.find(
    (field: ProviderField) => {
      return columnOf(field) === column;
    },
  );

  if (!found) {
    throw new Error(`No ${String(column)} field.`);
  }

  return found;
}

function valuesFor(type: unknown): FormValues<LlmProvider> {
  return { llmType: type } as unknown as FormValues<LlmProvider>;
}

function isRequired(field: ProviderField, type: unknown): boolean {
  return typeof field.required === "function"
    ? field.required(valuesFor(type))
    : Boolean(field.required);
}

function isShown(field: ProviderField, type: unknown): boolean {
  return field.showIf ? field.showIf(valuesFor(type)) : true;
}

// The help under a field, for a provider picked, as text.
function helpUnder(field: ProviderField, type: unknown): string {
  const footer: ReactElement | undefined = field.getFooterElement?.(
    valuesFor(type),
  );

  if (!footer) {
    return "";
  }

  const drawn: ReturnType<typeof render> = render(footer);
  const text: string = (drawn.container.textContent || "").trim();

  drawn.unmount();

  return text;
}

afterEach(() => {
  cleanup();
});

describe("the form's steps and fields", () => {
  test("asks which provider, then how to reach it", () => {
    expect(getLlmProviderFormSteps()).toEqual([
      { title: "Provider", id: "provider" },
      { title: "Connection", id: "connection" },
    ]);
  });

  test("a project's provider: the provider, how to reach it, its name, then its description, default switch and parameters folded", () => {
    const fields: Array<ProviderField> = getProjectLlmProviderFormFields();

    expect(fields.map(columnOf)).toEqual([
      "llmType",
      "apiKey",
      "baseUrl",
      "modelName",
      "name",
      "description",
      "isDefault",
      "additionalParams",
    ]);
    expect(
      fields
        .filter((field: ProviderField) => {
          return Boolean(field.collapsibleSection);
        })
        .map(columnOf),
    ).toEqual(["description", "isDefault", "additionalParams"]);
    // One fold, and a new provider is the default.
    expect(
      new Set(
        fields
          .filter((field: ProviderField) => {
            return Boolean(field.collapsibleSection);
          })
          .map((field: ProviderField) => {
            return field.collapsibleSection?.id;
          }),
      ).size,
    ).toBe(1);
    expect(fieldOf(fields, "isDefault").defaultValue).toBe(true);
  });

  test("a global provider: no default switch, and its price only where projects are billed", () => {
    expect(
      getGlobalLlmProviderFormFields({ includeCost: false }).map(columnOf),
    ).toEqual([
      "llmType",
      "apiKey",
      "baseUrl",
      "modelName",
      "name",
      "description",
      "additionalParams",
    ]);

    const billed: Array<ProviderField> = getGlobalLlmProviderFormFields({
      includeCost: true,
    });

    expect(billed.map(columnOf)).toContain("costPerMillionTokensInUSDCents");
    expect(billed.map(columnOf)).not.toContain("isDefault");
    expect(fieldOf(billed, "costPerMillionTokensInUSDCents").defaultValue).toBe(
      0,
    );
  });

  test("the provider alone is on the first step, and every other field on the second", () => {
    for (const fields of [
      getProjectLlmProviderFormFields(),
      getGlobalLlmProviderFormFields({ includeCost: true }),
    ]) {
      expect(
        fields.map((field: ProviderField) => {
          return [columnOf(field), field.stepId];
        }),
      ).toEqual(
        fields.map((field: ProviderField) => {
          return [
            columnOf(field),
            columnOf(field) === "llmType" ? "provider" : "connection",
          ];
        }),
      );
    }
  });
});

describe("the provider cards", () => {
  test("one per provider, in the form's order, each saying what it is", () => {
    expect(
      LLM_PROVIDER_CARD_OPTIONS.map((option: CardSelectOption) => {
        return option.value;
      }),
    ).toEqual(LLM_PROVIDER_TYPES);

    for (const option of LLM_PROVIDER_CARD_OPTIONS) {
      const type: LlmType = option.value as LlmType;

      expect(option.title).toBe(LLM_PROVIDER_TYPE_COPY[type].title);
      expect(option.description).toBe(LLM_PROVIDER_TYPE_COPY[type].description);
    }

    expect(
      fieldOf(getProjectLlmProviderFormFields(), "llmType").cardSelectOptions,
    ).toBe(LLM_PROVIDER_CARD_OPTIONS);
  });

  /*
   * Two cards to a row squeezed every line to a few words in the dialog's
   * column, and Azure's long name left the card beside it half empty: one
   * ruled row each now, in one panel, on a project's form and the Admin
   * Dashboard's alike.
   */
  test("one row each, in one panel, on every form", () => {
    for (const fields of [
      getProjectLlmProviderFormFields(),
      getGlobalLlmProviderFormFields({ includeCost: true }),
      getGlobalLlmProviderFormFields({ includeCost: false }),
    ]) {
      expect(fieldOf(fields, "llmType").cardSelectLayout).toBe("list");
      expect(fieldOf(fields, "llmType").cardSelectMaxColumns).toBeUndefined();
    }
  });

  test("every card has an icon of its own", () => {
    const icons: Array<IconProp | undefined> = LLM_PROVIDER_CARD_OPTIONS.map(
      (option: CardSelectOption) => {
        return option.icon;
      },
    );

    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
    /*
     * Brain draws Sparkles' shape (Icon), so a card drawn with it looked
     * like OpenAI's: Mistral's was.
     */
    expect(icons).not.toContain(IconProp.Brain);
  });
});

describe("what each field asks of each provider", () => {
  const fields: Array<ProviderField> = getProjectLlmProviderFormFields();

  test.each(LLM_PROVIDER_TYPES)("%s", (type: LlmType) => {
    const copy: (typeof LLM_PROVIDER_TYPE_COPY)[LlmType] =
      LLM_PROVIDER_TYPE_COPY[type];

    expect({
      apiKeyShown: isShown(fieldOf(fields, "apiKey"), type),
      apiKeyRequired: isRequired(fieldOf(fields, "apiKey"), type),
      baseUrlRequired: isRequired(fieldOf(fields, "baseUrl"), type),
      modelNameRequired: isRequired(fieldOf(fields, "modelName"), type),
    }).toEqual({
      apiKeyShown: copy.apiKey !== "NotUsed",
      apiKeyRequired: copy.apiKey === "Required",
      baseUrlRequired: copy.baseUrl === "Required",
      modelNameRequired: copy.modelName === "Required",
    });
  });

  test("before a provider is picked, nothing is required of the second step's fields", () => {
    for (const column of ["apiKey", "baseUrl", "modelName"] as Array<
      keyof LlmProvider
    >) {
      expect(isRequired(fieldOf(fields, column), undefined)).toBe(false);
    }
  });

  test("an Edit form keeps the stored API key when the field is left blank", () => {
    expect(fieldOf(fields, "apiKey").doNotRequireWhenEditing).toBe(true);
  });
});

describe("the help under each field, for the provider picked", () => {
  const fields: Array<ProviderField> = getProjectLlmProviderFormFields();

  test("API Key: where to get one, or that it is optional", () => {
    expect(helpUnder(fieldOf(fields, "apiKey"), LlmType.Anthropic)).toBe(
      "Create one at console.anthropic.com, under API Keys.",
    );
    expect(helpUnder(fieldOf(fields, "apiKey"), LlmType.OpenAICompatible)).toBe(
      "Only if your server asks for one.",
    );
  });

  test("Base URL: the address to give, or only for a proxy, and never a key", () => {
    expect(helpUnder(fieldOf(fields, "baseUrl"), LlmType.Ollama)).toBe(
      "An address the OneUptime server can reach, such as http://ollama:11434. Not localhost. Never put keys here.",
    );
    expect(helpUnder(fieldOf(fields, "baseUrl"), LlmType.Mistral)).toBe(
      "Only to go through a proxy or a gateway. Leave empty for Mistral's own API: https://api.mistral.ai/v1. Never put keys here.",
    );
    // No provider yet: still never a key.
    expect(helpUnder(fieldOf(fields, "baseUrl"), undefined)).toBe(
      "Never put keys here.",
    );
  });

  test("Model Name: the model a blank one gets, or what to type", () => {
    expect(helpUnder(fieldOf(fields, "modelName"), LlmType.Groq)).toBe(
      "Leave empty for llama-3.3-70b-versatile.",
    );
    expect(
      helpUnder(fieldOf(fields, "modelName"), LlmType.OpenAICompatible),
    ).toBe(
      "Leave empty for the first model your server lists. To use another, type its name exactly as your server lists it.",
    );
    expect(helpUnder(fieldOf(fields, "modelName"), undefined)).toBe("");
  });

  test("Model Name: optional for every provider, an OpenAI-compatible server's too", () => {
    for (const type of LLM_PROVIDER_TYPES) {
      expect({
        type,
        required: isRequired(fieldOf(fields, "modelName"), type),
      }).toEqual({ type, required: false });
    }

    for (const globalField of getGlobalLlmProviderFormFields({
      includeCost: true,
    })) {
      if (columnOf(globalField) === "modelName") {
        expect(isRequired(globalField, LlmType.OpenAICompatible)).toBe(false);
      }
    }
  });

  /*
   * A hint is two sentences, each translated on its own. Chinese and
   * Japanese put no space after a full-width full stop, so the two read
   * with a stray gap ("…不可です。 ここに…") when joined with one.
   */
  describe("in the reader's language", () => {
    const DASHBOARD_LOCALES: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
    );

    const OLLAMA_BASE_URL_HINT: string =
      LLM_PROVIDER_TYPE_COPY[LlmType.Ollama].baseUrlHint || "";

    function locale(code: string): Record<string, string> {
      return JSON.parse(
        fs.readFileSync(path.join(DASHBOARD_LOCALES, `${code}.json`), "utf8"),
      ) as Record<string, string>;
    }

    async function baseUrlHelpIn(code: string): Promise<string> {
      const language: i18n = createInstance();

      await language.init({
        lng: code,
        fallbackLng: false,
        resources: { [code]: { translation: locale(code) } },
        keySeparator: false,
        nsSeparator: false,
        interpolation: { escapeValue: false },
      });

      const footer: ReactElement | undefined = fieldOf(
        fields,
        "baseUrl",
      ).getFooterElement?.(valuesFor(LlmType.Ollama));
      const drawn: ReturnType<typeof render> = render(
        <I18nextProvider i18n={language}>{footer}</I18nextProvider>,
      );
      const text: string = drawn.container.textContent || "";

      drawn.unmount();

      return text;
    }

    test.each(["ja", "zh-CN", "zh-TW"])(
      "%s: the hint's two sentences run on, with no space after the full stop",
      async (code: string) => {
        const words: Record<string, string> = locale(code);
        const first: string = words[OLLAMA_BASE_URL_HINT]!;
        const second: string = words[LlmProviderFormCopy.baseUrlNoKeys]!;

        // Both are translated, and the first ends the way the script does.
        expect(first).not.toBe(OLLAMA_BASE_URL_HINT);
        expect(first.endsWith("。")).toBe(true);
        expect(await baseUrlHelpIn(code)).toBe(`${first}${second}`);
      },
    );

    test.each(["de", "fr", "ko", "hi"])(
      "%s: a space between the two sentences, as its sentences are written",
      async (code: string) => {
        const words: Record<string, string> = locale(code);

        expect(await baseUrlHelpIn(code)).toBe(
          `${words[OLLAMA_BASE_URL_HINT]} ${words[LlmProviderFormCopy.baseUrlNoKeys]}`,
        );
      },
    );
  });

  test.each(LLM_PROVIDER_TYPES)(
    "%s: the Base URL hint is the copy's",
    (type: LlmType) => {
      const hint: { text: string; values: Record<string, string> } | null =
        getLlmProviderBaseUrlHint(type);

      expect(hint).not.toBeNull();
      expect(hint!.text).toBe(
        LLM_PROVIDER_TYPE_COPY[type].baseUrlHint ||
          LlmProviderFormCopy.optionalBaseUrlHint,
      );
    },
  );
});

describe("the name follows the provider picked", () => {
  test("an empty name takes the provider's", () => {
    expect(
      getLlmProviderNameAfterPick({
        name: "",
        previousType: undefined,
        nextType: LlmType.Ollama,
      }),
    ).toBe("Ollama");
  });

  test("the name the last pick gave follows the next pick", () => {
    expect(
      getLlmProviderNameAfterPick({
        name: "Ollama",
        previousType: LlmType.Ollama,
        nextType: LlmType.AzureOpenAI,
      }),
    ).toBe("Azure OpenAI");
  });

  test("a name of one's own stays", () => {
    expect(
      getLlmProviderNameAfterPick({
        name: "Production Claude",
        previousType: LlmType.Anthropic,
        nextType: LlmType.OpenAI,
      }),
    ).toBeNull();
  });

  test("picking the same provider changes nothing", () => {
    expect(
      getLlmProviderNameAfterPick({
        name: "OpenAI",
        previousType: LlmType.OpenAI,
        nextType: LlmType.OpenAI,
      }),
    ).toBeNull();
  });

  test("the field sets the name as it is picked", () => {
    const llmType: ProviderField = fieldOf(
      getProjectLlmProviderFormFields(),
      "llmType",
    );
    const set: Array<Record<string, unknown>> = [];

    llmType.onChange!(
      LlmType.Groq,
      { name: "" } as unknown as FormValues<LlmProvider>,
      (values: FormValues<LlmProvider>) => {
        set.push(values as unknown as Record<string, unknown>);
      },
    );
    llmType.onChange!(
      LlmType.Groq,
      { name: "Mine" } as unknown as FormValues<LlmProvider>,
      (values: FormValues<LlmProvider>) => {
        set.push(values as unknown as Record<string, unknown>);
      },
    );

    expect(set).toEqual([{ name: "Groq" }]);
  });

  test("every provider has a name to start from, the same in every language", () => {
    for (const type of LLM_PROVIDER_TYPES) {
      expect(getLlmProviderDefaultName(type).length).toBeGreaterThan(0);
    }

    expect(getLlmProviderDefaultName("NotAProvider")).toBe("");
    expect(readLlmType("NotAProvider")).toBeNull();
  });
});

describe("a provider's page names what a blank field gets", () => {
  const english: ReturnType<typeof createTranslator> = createTranslator(
    (key: string): string => {
      return key;
    },
  );

  test("what was typed, as typed", () => {
    expect(
      getLlmProviderShownValue({
        value: " gpt-5.1-mini ",
        defaultValue: "gpt-5.1",
        translator: english,
      }),
    ).toBe("gpt-5.1-mini");
  });

  test("left blank, the default by name", () => {
    expect(
      getLlmProviderShownValue({
        value: "",
        defaultValue: "gpt-5.1",
        translator: english,
      }),
    ).toBe("gpt-5.1 (default)");
    expect(LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE).toBe("{{name}} (default)");
  });

  test("no default to name: a dash", () => {
    expect(
      getLlmProviderShownValue({
        value: undefined,
        defaultValue: undefined,
        translator: english,
      }),
    ).toBe("-");
  });

  describe("its Model Name, on its page and in every list", () => {
    test("what was typed, as typed, whatever the provider", () => {
      for (const type of LLM_PROVIDER_TYPES) {
        expect(
          getLlmProviderShownModelName({
            modelName: " Qwen/Qwen3.8-27B ",
            llmType: type,
            translator: english,
          }),
        ).toBe("Qwen/Qwen3.8-27B");
      }
    });

    test("left blank, the model the server asks for, by name", () => {
      expect(
        getLlmProviderShownModelName({
          modelName: "",
          llmType: LlmType.OpenAI,
          translator: english,
        }),
      ).toBe("gpt-5.1 (default)");
      expect(
        getLlmProviderShownModelName({
          modelName: undefined,
          llmType: LlmType.Ollama,
          translator: english,
        }),
      ).toBe("llama3.1 (default)");
      // A Claude deployment in Foundry is asked for Anthropic's default.
      expect(
        getLlmProviderShownModelName({
          modelName: null,
          llmType: LlmType.AzureOpenAI,
          baseUrl: "https://contoso-ai.services.ai.azure.com/anthropic",
          translator: english,
        }),
      ).toBe("claude-sonnet-5-5 (default)");
    });

    test("left blank on an OpenAI-compatible server, what it does instead: no model can be named in advance", () => {
      expect(
        getLlmProviderShownModelName({
          modelName: "  ",
          llmType: LlmType.OpenAICompatible,
          baseUrl: "http://vllm:8000/v1",
          translator: english,
        }),
      ).toBe("First model the server lists");
    });

    test("in the reader's language", () => {
      const german: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(
            __dirname,
            "..",
            "..",
            "..",
            "..",
            "..",
            "App",
            "FeatureSet",
            "Dashboard",
            "src",
            "Locales",
            "de.json",
          ),
          "utf8",
        ),
      ) as Record<string, string>;
      const inGerman: ReturnType<typeof createTranslator> = createTranslator(
        (key: string): string => {
          return german[key] || key;
        },
      );

      expect(
        getLlmProviderShownModelName({
          modelName: "",
          llmType: LlmType.OpenAICompatible,
          translator: inGerman,
        }),
      ).toBe("Erstes Modell, das der Server auflistet");
      expect(
        getLlmProviderShownModelName({
          modelName: "",
          llmType: LlmType.OpenAI,
          translator: inGerman,
        }),
      ).toBe("gpt-5.1 (Standard)");
    });

    test("no provider picked, or one this version does not know: a dash", () => {
      for (const llmType of [undefined, null, "", "NotAProvider"]) {
        expect(
          getLlmProviderShownModelName({
            modelName: "",
            llmType: llmType,
            translator: english,
          }),
        ).toBe("-");
      }
    });
  });
});
