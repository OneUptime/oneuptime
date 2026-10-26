import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import ColumnLength from "../../../Types/Database/ColumnLength";
import LlmType from "../../../Types/LLM/LlmType";
import { CardSelectOption } from "../CardSelect/CardSelect";
import Field, { FormFieldCollapsibleSection } from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { FormStep } from "../Forms/Types/FormStep";
import FormValues from "../Forms/Types/FormValues";
import { getAdvancedFormSection } from "../Forms/Utils/AdvancedFormSection";
import { joinSentences } from "../DeleteConfirmation/DeleteConsequences";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import {
  LLM_PROVIDER_TYPES,
  LLM_PROVIDER_TYPE_COPY,
  LlmProviderFormCopy,
  LlmProviderTypeCopy,
  getLlmProviderTypeCopy,
  needsApiKey,
  needsBaseUrl,
  needsModelName,
  takesApiKey,
} from "./LlmProviderFormCopy";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * THE LLM PROVIDER FORM: WHICH PROVIDER, THEN WHAT IT NEEDS.
 *
 * One form for every place an LLM provider is added or edited - Project
 * Settings > AI > LLM Providers (Create), a provider's own page (Edit) and
 * the Admin Dashboard's Global LLM Providers - so they ask the same thing in
 * the same words (they used to be three copies that drifted).
 *
 *   - Provider: one row per provider in a single panel, each with what it
 *     is in a line (LlmProviderFormCopy).
 *   - Connection: only what that provider uses, with the help for that
 *     provider under each field - where to get its API key, the address to
 *     give it, the model the server asks for when Model Name is left blank
 *     (for an OpenAI-compatible server, the first model it lists).
 *     Ollama is never asked for an API key. The Base URL is required of a
 *     provider with no address of its own (Azure, Ollama, a server of
 *     yours) and optional for one that has one (OpenAI, Anthropic, Groq,
 *     Mistral), where it only sends requests through a proxy. Then the
 *     provider's Name, filled in from the provider until a name of one's
 *     own is typed, and More fields: its description, whether it is the
 *     project's default, its extra parameters (and, for a global provider
 *     where projects are billed, its price).
 *
 * Nothing stored changes: every field writes the column it always wrote, so
 * the API, Terraform and every saved provider are as they were.
 *
 * Every step id is written out as a string literal on each field, so the
 * form step guards (Common/Tests/Helpers/FormStepsScan.ts) can place them.
 */

export const getLlmProviderFormSteps: () => Array<
  FormStep<LlmProvider>
> = (): Array<FormStep<LlmProvider>> => {
  return [
    { title: "Provider", id: "provider" },
    { title: "Connection", id: "connection" },
  ];
};

// The provider cards, in the order the form offers them.
export const LLM_PROVIDER_CARD_OPTIONS: Array<CardSelectOption> =
  LLM_PROVIDER_TYPES.map((type: LlmType): CardSelectOption => {
    const copy: LlmProviderTypeCopy = LLM_PROVIDER_TYPE_COPY[type];

    return {
      value: type,
      title: copy.title,
      description: copy.description,
      icon: copy.icon,
    };
  });

interface LlmProviderHintProps {
  text?: string | undefined;
  values: Record<string, string>;
  afterText?: string | undefined;
  testId: string;
}

/*
 * A hint under a field, in the reader's language: the provider's own line,
 * with what it names filled in, and a sentence every provider's field says
 * after it (afterText) - run together as the reader's script writes
 * sentences: a space after each, none after a full-width stop ("…不可です。
 * ここに…", not "…不可です。 ここに…").
 */
const LlmProviderHint: FunctionComponent<LlmProviderHintProps> = (
  props: LlmProviderHintProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p className="mt-1.5 text-xs text-gray-500" data-testid={props.testId}>
      {joinSentences([
        props.text
          ? translator.translateTemplate(props.text, props.values)
          : "",
        props.afterText ? translator.translateText(props.afterText) || "" : "",
      ])}
    </p>
  );
};

function renderHint(
  text: string | undefined,
  values: Record<string, string>,
  testId: string,
  afterText?: string | undefined,
): ReactElement | undefined {
  if (!text && !afterText) {
    return undefined;
  }

  return (
    <LlmProviderHint
      text={text}
      values={values}
      afterText={afterText}
      testId={testId}
    />
  );
}

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

/*
 * The line under Base URL for a provider: where to reach it, or - for one
 * with an address of its own - that it is only for a proxy, and the address
 * used without one.
 */
export function getLlmProviderBaseUrlHint(
  type: unknown,
): { text: string; values: Record<string, string> } | null {
  const copy: LlmProviderTypeCopy | null = getLlmProviderTypeCopy(type);

  if (!copy) {
    return null;
  }

  if (copy.baseUrlHint) {
    return { text: copy.baseUrlHint, values: {} };
  }

  if (copy.defaultBaseUrl) {
    return {
      text: LlmProviderFormCopy.optionalBaseUrlHint,
      values: { provider: copy.defaultName, url: copy.defaultBaseUrl },
    };
  }

  return null;
}

/*
 * The name a provider type starts a provider with ("OpenAI", "Ollama"): a
 * brand, the same in every language.
 */
export function getLlmProviderDefaultName(type: unknown): string {
  return getLlmProviderTypeCopy(type)?.defaultName || "";
}

/**
 * The name once the provider changes: the new provider's name while the
 * name is still the form's own - empty, or the name the provider picked
 * before gave it. Null when the name stays: somebody typed their own.
 */
export function getLlmProviderNameAfterPick(data: {
  name: unknown;
  previousType: unknown;
  nextType: unknown;
}): string | null {
  const name: string = typeof data.name === "string" ? data.name.trim() : "";
  const previous: string = getLlmProviderDefaultName(data.previousType);
  const next: string = getLlmProviderDefaultName(data.nextType);

  if (!next || name === next) {
    return null;
  }

  if (name === "" || name === previous) {
    return next;
  }

  return null;
}

/*
 * The provider, how to reach it and what to call it: the first fields of
 * every LLM provider form.
 */
function getLlmProviderMainFields(): Array<Field<LlmProvider>> {
  return [
    {
      field: {
        llmType: true,
      },
      title: "LLM Provider",
      stepId: "provider",
      fieldType: FormFieldSchemaType.CardSelect,
      required: true,
      // Each card says what its provider is: the column's sentence would not.
      hideColumnDescription: true,
      cardSelectOptions: LLM_PROVIDER_CARD_OPTIONS,
      /*
       * One ruled row each, in one panel: two cards to a row in the dialog's
       * column squeezed every line to a few words, and Azure's long name
       * left the card beside it half empty.
       */
      cardSelectLayout: "list",
      dataTestId: "llm-provider-type",
      /*
       * The provider names the provider (as a rule is named after what it
       * does) until a name of one's own is typed.
       */
      onChange: (
        value: unknown,
        currentValues: FormValues<LlmProvider>,
        setNewFormValues: (values: FormValues<LlmProvider>) => void,
      ): void => {
        const values: Values = asValues(currentValues);
        const name: string | null = getLlmProviderNameAfterPick({
          name: values["name"],
          previousType: values["llmType"],
          nextType: value,
        });

        if (name === null) {
          return;
        }

        setNewFormValues({
          ...values,
          name: name,
        } as unknown as FormValues<LlmProvider>);
      },
    },
    {
      field: {
        apiKey: true,
      },
      title: "API Key",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      // Ollama reads none.
      showIf: (values: FormValues<LlmProvider>): boolean => {
        return takesApiKey(asValues(values)["llmType"]);
      },
      required: (values: FormValues<LlmProvider>): boolean => {
        return needsApiKey(asValues(values)["llmType"]);
      },
      /*
       * An Edit form starts the key empty, and a blank key keeps the one
       * stored: it is asked for again only of a new provider.
       */
      doNotRequireWhenEditing: true,
      hideColumnDescription: true,
      disableSpellCheck: true,
      dataTestId: "llm-provider-api-key",
      getFooterElement: (
        values: FormValues<LlmProvider>,
      ): ReactElement | undefined => {
        return renderHint(
          getLlmProviderTypeCopy(asValues(values)["llmType"])?.apiKeyHint,
          {},
          "llm-provider-api-key-hint",
        );
      },
    },
    {
      field: {
        baseUrl: true,
      },
      title: "Base URL",
      stepId: "connection",
      fieldType: FormFieldSchemaType.URL,
      /*
       * Required of a provider with no address of its own: the server
       * refuses Azure, Ollama and an OpenAI-compatible server without one.
       */
      required: (values: FormValues<LlmProvider>): boolean => {
        return needsBaseUrl(asValues(values)["llmType"]);
      },
      hideColumnDescription: true,
      /*
       * The column holds 100 characters. Said at the field, before the
       * save: a deployment's whole Target URI with its api-version runs
       * longer, and the resource's endpoint, which is all the field needs,
       * is short.
       */
      validation: {
        maxLength: ColumnLength.ShortURL,
      },
      disableSpellCheck: true,
      dataTestId: "llm-provider-base-url",
      getFooterElement: (
        values: FormValues<LlmProvider>,
      ): ReactElement | undefined => {
        const hint: { text: string; values: Record<string, string> } | null =
          getLlmProviderBaseUrlHint(asValues(values)["llmType"]);

        // Whatever the provider, no key goes in the address.
        return renderHint(
          hint?.text,
          hint?.values || {},
          "llm-provider-base-url-hint",
          LlmProviderFormCopy.baseUrlNoKeys,
        );
      },
    },
    {
      field: {
        modelName: true,
      },
      title: "Model Name",
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: (values: FormValues<LlmProvider>): boolean => {
        return needsModelName(asValues(values)["llmType"]);
      },
      hideColumnDescription: true,
      disableSpellCheck: true,
      dataTestId: "llm-provider-model-name",
      getFooterElement: (
        values: FormValues<LlmProvider>,
      ): ReactElement | undefined => {
        const copy: LlmProviderTypeCopy | null = getLlmProviderTypeCopy(
          asValues(values)["llmType"],
        );

        return renderHint(
          copy?.modelNameHint,
          { model: copy?.defaultModel || "" },
          "llm-provider-model-name-hint",
        );
      },
    },
    {
      field: {
        name: true,
      },
      title: "Name",
      description: LlmProviderFormCopy.nameDescription,
      stepId: "connection",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: LlmProviderFormCopy.namePlaceholder,
      validation: {
        minLength: 2,
      },
    },
  ];
}

// What the provider is for, under More fields.
function getLlmProviderDescriptionField(
  advancedSection: FormFieldCollapsibleSection<LlmProvider>,
): Field<LlmProvider> {
  return {
    field: {
      description: true,
    },
    title: "Description",
    stepId: "connection",
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    hideColumnDescription: true,
    placeholder: LlmProviderFormCopy.descriptionPlaceholder,
    collapsibleSection: advancedSection,
  };
}

// Extra JSON sent with every request, under More fields.
function getLlmProviderAdditionalParamsField(
  advancedSection: FormFieldCollapsibleSection<LlmProvider>,
): Field<LlmProvider> {
  return {
    field: {
      additionalParams: true,
    },
    title: "Additional Parameters",
    description: LlmProviderFormCopy.additionalParametersDescription,
    stepId: "connection",
    fieldType: FormFieldSchemaType.JSON,
    required: false,
    collapsibleSection: advancedSection,
  };
}

/**
 * A project's LLM provider (Project Settings > AI > LLM Providers, and a
 * provider's own page): the provider, how to reach it and its name, then
 * under More fields its description, whether it is the project's default
 * and its extra parameters.
 */
export const getProjectLlmProviderFormFields: () => Array<
  Field<LlmProvider>
> = (): Array<Field<LlmProvider>> => {
  const advancedSection: FormFieldCollapsibleSection<LlmProvider> =
    getAdvancedFormSection<LlmProvider>();

  return [
    ...getLlmProviderMainFields(),
    getLlmProviderDescriptionField(advancedSection),
    {
      field: {
        isDefault: true,
      },
      title: "Set as Default",
      description: LlmProviderFormCopy.defaultDescription,
      stepId: "connection",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: advancedSection,
      /*
       * On for a new provider: an untouched switch submits false, which
       * would leave it unused (AI features use the default provider).
       */
      defaultValue: true,
    },
    getLlmProviderAdditionalParamsField(advancedSection),
  ];
};

/**
 * A global LLM provider (the Admin Dashboard's Global LLM Providers): the
 * same, less the default switch - a global provider is every project's
 * fallback, never one's default - and, where projects are billed for AI
 * (includeCost), with its price per million tokens under More fields.
 */
export const getGlobalLlmProviderFormFields: (options: {
  includeCost: boolean;
}) => Array<Field<LlmProvider>> = (options: {
  includeCost: boolean;
}): Array<Field<LlmProvider>> => {
  const advancedSection: FormFieldCollapsibleSection<LlmProvider> =
    getAdvancedFormSection<LlmProvider>();

  return [
    ...getLlmProviderMainFields(),
    getLlmProviderDescriptionField(advancedSection),
    getLlmProviderAdditionalParamsField(advancedSection),
    ...(options.includeCost
      ? [
          {
            field: {
              costPerMillionTokensInUSDCents: true,
            },
            title: "Cost Per Million Tokens (USD Cents)",
            description:
              "Cost per million tokens in USD cents. For example, if the cost is $0.01 per 1M tokens, enter 1.",
            stepId: "connection",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            collapsibleSection: advancedSection,
            /*
             * The column's default: a provider that is free to use. Written
             * here too so its Edit form, which does not start from column
             * defaults, reads 0 as nothing set rather than "Configured".
             */
            defaultValue: 0,
            placeholder: "0",
          },
        ]
      : []),
  ];
};
