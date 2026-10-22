import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  RULE_LLM_PROVIDERS_PATH,
  RULE_LLM_PROVIDER_FIELD_COPY,
  RULE_LLM_PROVIDER_HINT_TEST_ID,
  RULE_LLM_PROVIDER_LOADING_TEST_ID,
  RULE_LLM_PROVIDER_PICKER_TEST_ID,
  RULE_LLM_PROVIDER_WARNING_TEST_ID,
  RuleLlmProviderChoices,
  RuleLlmProviderOption,
  RuleLlmProviderPickState,
  RuleLlmProviderWork,
  UNREAD_RULE_LLM_PROVIDER_CHOICES,
  getRuleLlmProviderFoldedValue,
  getRuleLlmProviderOptionDescription,
  getRuleLlmProviderPickState,
  getRuleLlmProviderPlaceholder,
  getRulePickedLlmProviderId,
  readRuleLlmProviderChoices,
} from "./RuleLlmProviderCopy";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EntityDropdown from "Common/UI/Components/EntityDropdown/EntityDropdown";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import Link from "Common/UI/Components/Link/Link";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A rule's "LLM Provider" field, under its More fields: the provider
 * OneUptime AI uses for everything the rule starts - the shared field of
 * every OneUptime AI rule (investigation, auto remediation, postmortem, and
 * the AI rules of the telemetry products after them). Its words and its
 * rule are RuleLlmProviderCopy; what the server does with the pick is
 * Common/Types/AI/LlmProviderChoice.
 *
 * Empty is an answer of its own - the default provider - so the empty box
 * names it ("Project default (Azure GPT-4o)") and the field never says
 * "(Optional)". It is drawn as the Code Repositories and MCP Servers
 * pickers beside it are (EntityDropdown): the project's providers, its
 * default first and tagged, then the global ones, each with its model;
 * a pick can be cleared back to the default.
 *
 * It reads the providers itself (POST /ai-chat/providers, which the chat's
 * provider switcher reads too), when it opens and again when the window
 * takes the focus back - the line under it links to Project Settings › AI ›
 * LLM Providers in a new tab, so one just added can be picked at once. A
 * reader who may not read the project's providers cannot pick one (the
 * server would refuse it): the box is locked, and a pick the rule holds is
 * kept, named as one they cannot see. A pick the project can no longer use
 * - a global provider that stopped being shared - says so: OneUptime AI
 * uses the default instead.
 */

// The project's LLM providers, as the field lists them.
async function readRuleLlmProviderChoicesFromServer(): Promise<RuleLlmProviderChoices> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString() + RULE_LLM_PROVIDERS_PATH),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    return UNREAD_RULE_LLM_PROVIDER_CHOICES;
  }

  return readRuleLlmProviderChoices(response.data);
}

/*
 * The project's LLM providers, or null while they are first read - and
 * read again whenever the window takes the focus back. A read that fails
 * after one that worked keeps what the field has.
 */
export function useRuleLlmProviderChoices(): RuleLlmProviderChoices | null {
  const [choices, setChoices] = useState<RuleLlmProviderChoices | null>(null);

  useEffect(() => {
    let isMounted: boolean = true;
    // Only the newest read is drawn: an older answer arriving late is dropped.
    let latestRead: number = 0;

    const read: () => void = (): void => {
      latestRead++;
      const thisRead: number = latestRead;

      readRuleLlmProviderChoicesFromServer()
        .then((answer: RuleLlmProviderChoices) => {
          if (!isMounted || thisRead !== latestRead) {
            return;
          }

          setChoices(
            (
              current: RuleLlmProviderChoices | null,
            ): RuleLlmProviderChoices => {
              return !answer.isRead && current?.isRead ? current : answer;
            },
          );
        })
        .catch(() => {
          if (isMounted && thisRead === latestRead) {
            setChoices(
              (
                current: RuleLlmProviderChoices | null,
              ): RuleLlmProviderChoices => {
                return current || UNREAD_RULE_LLM_PROVIDER_CHOICES;
              },
            );
          }
        });
    };

    read();
    window.addEventListener("focus", read);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", read);
    };
  }, []);

  return choices;
}

export interface RuleLlmProviderPickerProps {
  // The provider the rule picks, as the form holds it; empty for none.
  value: unknown;
  // The provider picked, by id, or null for none - the default.
  onChange: (llmProviderId: string | null) => void;
  // The label the form drew for the field, read out with the menu.
  ariaLabelledby?: string | undefined;
  dataTestId?: string | undefined;
}

export const RuleLlmProviderPicker: FunctionComponent<
  RuleLlmProviderPickerProps
> = (props: RuleLlmProviderPickerProps): ReactElement => {
  const translator: Translator = useTranslator();
  const choices: RuleLlmProviderChoices | null = useRuleLlmProviderChoices();
  const dataTestId: string =
    props.dataTestId || RULE_LLM_PROVIDER_PICKER_TEST_ID;

  if (!choices) {
    /*
     * The box's own place and height (EntityDropdown's), so the fields
     * below do not jump when it arrives.
     */
    return (
      <Skeleton
        className="mt-2 mb-1 h-[38px] w-full rounded-lg"
        dataTestId={RULE_LLM_PROVIDER_LOADING_TEST_ID}
      />
    );
  }

  const pickedProviderId: string = getRulePickedLlmProviderId({
    llmProviderId: props.value,
  });

  const pickState: RuleLlmProviderPickState = getRuleLlmProviderPickState({
    pickedProviderId,
    choices,
  });

  /*
   * A provider's name is drawn as it is called (EntityDropdown never looks
   * a label up); its tags are translated here.
   */
  const options: Array<DropdownOption> = choices.providers.map(
    (provider: RuleLlmProviderOption): DropdownOption => {
      const description: string = getRuleLlmProviderOptionDescription(
        provider,
        translator,
      );

      return {
        value: provider.id,
        label: provider.name || provider.id,
        ...(description ? { description } : {}),
      };
    },
  );

  // A pick that is not in the list stays, named for what it is.
  if (
    pickState === RuleLlmProviderPickState.Hidden ||
    pickState === RuleLlmProviderPickState.Unavailable
  ) {
    options.push({
      value: pickedProviderId,
      label: translator.translateText(
        pickState === RuleLlmProviderPickState.Hidden
          ? RULE_LLM_PROVIDER_FIELD_COPY.hiddenProvider
          : RULE_LLM_PROVIDER_FIELD_COPY.unavailableProvider,
      ) as string,
    });
  }

  /*
   * Nothing to pick: the reader may not read the providers, or the project
   * has none. The box stays, locked and saying so, unless the rule holds a
   * pick that can still be cleared.
   */
  const isLocked: boolean = options.length === 0;

  return (
    <div data-testid={dataTestId}>
      <EntityDropdown
        options={options}
        value={pickedProviderId || null}
        isMultiSelect={false}
        placeholder={getRuleLlmProviderPlaceholder(choices, translator)}
        disabled={isLocked}
        dataTestId={`${dataTestId}-dropdown`}
        ariaLabel={translator.translateText(RULE_LLM_PROVIDER_FIELD_COPY.title)}
        ariaLabelledby={props.ariaLabelledby}
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
        ): void => {
          const picked: DropdownValue | null | undefined = Array.isArray(value)
            ? value[0]
            : value;

          props.onChange(
            picked === null || picked === undefined || picked === ""
              ? null
              : String(picked),
          );
        }}
      />
      {pickState === RuleLlmProviderPickState.Unavailable ? (
        <p
          className="mt-1.5 text-xs text-amber-700"
          data-testid={RULE_LLM_PROVIDER_WARNING_TEST_ID}
        >
          {translator.translateText(
            RULE_LLM_PROVIDER_FIELD_COPY.unavailableWarning,
          )}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * THE FIELD, as a rule form lists it: "LLM Provider", under the rule's More
 * fields (`collapsibleSection`), on the step that says what the rule does.
 * Every OneUptime AI rule's form adds it with this, so they draw and fold
 * it alike:
 *
 *   - the column is the rule's llmProviderId (Common/Types/AI/
 *     LlmProviderChoice reads it); empty is the default provider, so the
 *     field never says "(Optional)", and its own line says what it does for
 *     this kind of rule (`work`) instead of the column's API description;
 *   - folded, the More fields line names the provider a rule picks
 *     ("LLM Provider: Claude Opus"); while it picks none, the section's
 *     summary says which provider that is (getRuleLlmProviderSummary, which
 *     the form's getSummary adds) - both from `getChoices`, the providers
 *     as the table last read them (a form may hold on to the fields it was
 *     opened with, so they are read through a function);
 *   - open, RuleLlmProviderPicker, and the line to LLM Providers under it.
 */
export function getRuleLlmProviderFormField<TBaseModel extends BaseModel>(data: {
  work: RuleLlmProviderWork;
  stepId: string;
  collapsibleSection: FormFieldCollapsibleSection<TBaseModel>;
  dataTestId: string;
  getChoices: () => RuleLlmProviderChoices | null;
  showIf?: ((values: FormValues<TBaseModel>) => boolean) | undefined;
}): ModelField<TBaseModel> {
  const field: ModelField<TBaseModel> = {
    field: { llmProviderId: true } as unknown as ModelField<TBaseModel>["field"],
    title: RULE_LLM_PROVIDER_FIELD_COPY.title,
    description: RULE_LLM_PROVIDER_FIELD_COPY.descriptions[data.work],
    stepId: data.stepId,
    collapsibleSection: data.collapsibleSection,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    // Empty is an answer of its own - the default provider - not "(Optional)".
    hideOptionalLabel: true,
    // Its own line, not the column's (written for the API reference).
    hideColumnDescription: true,
    dataTestId: data.dataTestId,
    getFoldedValue: (values: FormValues<TBaseModel>): string | null => {
      return getRuleLlmProviderFoldedValue(values, data.getChoices());
    },
    getCustomElement: (
      values: FormValues<TBaseModel>,
      elementProps: CustomElementProps,
    ): ReactElement => {
      return (
        <RuleLlmProviderPicker
          value={(values as { llmProviderId?: unknown }).llmProviderId}
          ariaLabelledby={elementProps.ariaLabelledby}
          onChange={(llmProviderId: string | null): void => {
            elementProps.onChange?.(llmProviderId);
          }}
        />
      );
    },
    getFooterElement: (): ReactElement => {
      return <RuleLlmProviderFieldHint />;
    },
  };

  if (data.showIf) {
    field.showIf = data.showIf;
  }

  return field;
}

/*
 * Under the field: where the providers it lists are added, as a link - so a
 * project with none yet finds the page. Close under its box and a field's
 * gap above the next field, as the MCP Servers and Code Repositories hints
 * are. In a new tab: the rule being edited stays, and the picker reads the
 * providers again when the person comes back.
 */
export const RuleLlmProviderFieldHint: FunctionComponent =
  (): ReactElement => {
    const translator: Translator = useTranslator();

    return (
      <p
        className="mt-1.5 mb-2 text-xs text-gray-500"
        data-testid={RULE_LLM_PROVIDER_HINT_TEST_ID}
      >
        <TranslatedSentence
          template={RULE_LLM_PROVIDER_FIELD_COPY.manageHint}
          slots={{
            llmProvidersLink: (
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
                )}
                openInNewTab={true}
                className="underline"
                dataTestId="rule-llm-provider-link"
              >
                {translator.translateText(
                  RULE_LLM_PROVIDER_FIELD_COPY.llmProvidersPage,
                )}
              </Link>
            ),
          }}
        />
      </p>
    );
  };
