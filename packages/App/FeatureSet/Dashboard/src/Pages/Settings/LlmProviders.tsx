import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { VoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ColumnLength from "Common/Types/Database/ColumnLength";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import TestLlmProviderModal from "Common/UI/Components/AI/TestLlmProviderModal";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TestLLMProvider from "Common/UI/Utils/TestLLMProvider";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import Navigation from "Common/UI/Utils/Navigation";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import LlmTypeDropdownOptions from "Common/UI/Utils/LlmTypeDropdownOptions";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

// Set as Default and Additional Parameters, folded at the end of Provider Settings.
const advancedSection: FormFieldCollapsibleSection<LlmProvider> =
  getAdvancedFormSection<LlmProvider>();

const LlmPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();

  // The provider whose Test dialog is open.
  const [testedProviderId, setTestedProviderId] = useState<string | null>(null);

  /*
   * Who may test a provider: whoever may change it (the server asks the
   * same). Anyone else who may read providers sees Test locked, saying who
   * may; before the permission snapshot has landed it is not offered.
   */
  const testGate: PermissionGateResult = TestLLMProvider.getTestGate();

  const codeRepositoriesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_REPOSITORY] as Route,
  );

  return (
    <Fragment>
      <>
        <Card
          title="What Can LLM Providers Do?"
          description="LLM Providers help you automate and enhance your incident management workflow with AI-powered features."
        >
          <div className="mt-4 space-y-3">
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">
                  {translator.translateText("Incident Notes")}
                </span>
                <span className="text-gray-500">
                  {" - "}
                  {translator.translateText(
                    "Automatically generate detailed incident notes and updates",
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">
                  {translator.translateText("Alert Notes")}
                </span>
                <span className="text-gray-500">
                  {" - "}
                  {translator.translateText(
                    "Create meaningful alert descriptions and context",
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">
                  {translator.translateText("Scheduled Maintenance Notes")}
                </span>
                <span className="text-gray-500">
                  {" - "}
                  {translator.translateText(
                    "Generate maintenance event notes automatically",
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">
                  {translator.translateText("Incident Postmortems")}
                </span>
                <span className="text-gray-500">
                  {" - "}
                  {translator.translateText(
                    "Automatically draft comprehensive incident postmortem reports",
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-start">
              <Icon
                icon={IconProp.CheckCircle}
                className="h-5 w-5 text-green-500 mr-3 mt-0.5 flex-shrink-0"
              />
              <div>
                <span className="font-medium">
                  {translator.translateText("Code Improvements")}
                </span>
                <span className="text-gray-500">
                  {" - "}
                  <TranslatedSentence
                    template="Analyze telemetry data (logs, traces, metrics, exceptions) and suggest code improvements when connected to your {{codeRepositoryLink}}"
                    slots={{
                      codeRepositoryLink: (
                        <Link to={codeRepositoriesRoute} className="underline">
                          {translator.translateText("code repository")}
                        </Link>
                      ),
                    }}
                  />
                </span>
              </div>
            </div>
          </div>
        </Card>

        <ModelTable<LlmProvider>
          modelType={LlmProvider}
          id="global-llms-table"
          name="Settings > Global LLM Providers"
          userPreferencesKey={"settings-global-llms-table"}
          saveFilterProps={{
            tableId: "settings-global-llms-table",
          }}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          cardProps={{
            title: "Global LLM Providers",
            description:
              "Global LLM Providers are pre-configured. These will be used automatically for AI features when you haven't set up your own custom LLM provider below.",
          }}
          fetchRequestOptions={{
            overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
              "/llm-provider/global-llms",
            ),
          }}
          noItemsMessage={"No global LLM Providers configured."}
          showRefreshButton={true}
          searchableFields={["name", "description", "modelName"]}
          filters={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
              noValueMessage: "-",
            },
            ...(BILLING_ENABLED
              ? [
                  {
                    field: {
                      costPerMillionTokensInUSDCents: true,
                    },
                    title: "Cost per Million Tokens",
                    type: FieldType.Text,
                    getElement: (item: LlmProvider): ReactElement => {
                      const costPerMillionInCents: number =
                        item.costPerMillionTokensInUSDCents || 0;

                      const costPerMillionInUSD: number =
                        costPerMillionInCents / 100;
                      const formattedCost: string =
                        costPerMillionInUSD.toFixed(2);

                      /*
                       * Show a "Free" pill when there is no cost, or when the
                       * cost is so small it rounds to $0.00 at the precision we
                       * display - otherwise we'd render a meaningless
                       * "$0.00 USD".
                       */
                      if (Number(formattedCost) <= 0) {
                        return <Pill text="Free" color={Green} />;
                      }

                      return <span>${formattedCost} USD</span>;
                    },
                  },
                ]
              : []),
          ]}
        />

        <ModelTable<LlmProvider>
          modelType={LlmProvider}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="project-llms-table"
          userPreferencesKey={"settings-project-llms-table"}
          name="Settings > LLM Providers"
          saveFilterProps={{
            tableId: "settings-project-llms-table",
          }}
          isDeleteable={true}
          isEditable={false}
          isViewable={true}
          isCreateable={true}
          actionButtons={[
            {
              title: "Test",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Play,
              isVisible: (): boolean => {
                return testGate.isAllowed || Boolean(testGate.disabledReason);
              },
              disabled: !testGate.isAllowed,
              // Locked, it says who may; unlocked, its dialog says what it does.
              tooltip: testGate.isAllowed ? undefined : testGate.disabledReason,
              onClick: (item: LlmProvider, onCompleteAction: VoidFunction) => {
                setTestedProviderId(item.id?.toString() || null);
                onCompleteAction();
              },
            },
          ]}
          cardProps={{
            title: "Bring Your Own Large Language Model",
            description: BILLING_ENABLED
              ? "Configure LLM Providers for AI features. Connect to OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama, or other providers. You will not be charged for AI usage when you bring your own models."
              : "Configure LLM Providers for AI features. Connect to OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama, or other providers.",
          }}
          documentationLink={Route.fromString("/docs/ai/llm-provider")}
          noItemsMessage={
            "No LLM Providers configured. Add an LLM Provider to enable AI features for your project."
          }
          viewPageRoute={Navigation.getCurrentRoute()}
          /*
           * Two steps: what the provider is, then how to reach it. Whether
           * it is the default and any extra model parameters are folded
           * under Advanced at the end of the second - they used to be a
           * step of their own that every new provider had to walk through.
           */
          formSteps={[
            {
              title: "Basic Info",
              id: "basic-info",
            },
            {
              title: "Provider Settings",
              id: "provider-settings",
            },
          ]}
          formFields={[
            {
              field: {
                name: true,
              },
              stepId: "basic-info",
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "My OpenAI GPT-4",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              stepId: "basic-info",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
              placeholder: "GPT-4 for general AI features.",
            },
            {
              field: {
                llmType: true,
              },
              title: "LLM Provider",
              stepId: "provider-settings",
              fieldType: FormFieldSchemaType.Dropdown,
              required: true,
              placeholder: "Select LLM Provider",
              dropdownOptions: LlmTypeDropdownOptions,
            },
            {
              field: {
                apiKey: true,
              },
              title: "API Key",
              stepId: "provider-settings",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: "sk-...",
              description:
                "Required for OpenAI, Azure OpenAI / Microsoft Foundry (one of your resource's keys), Anthropic, Groq and Mistral.",
            },
            {
              field: {
                modelName: true,
              },
              title: "Model Name",
              stepId: "provider-settings",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder:
                "gpt-5.1, claude-sonnet-5-5, llama-3.3-70b-versatile",
              description:
                "The model to use, such as gpt-5.1 or claude-sonnet-5-5. For Azure OpenAI / Microsoft Foundry, your deployment's name.",
            },
            {
              field: {
                baseUrl: true,
              },
              title: "Base URL",
              stepId: "provider-settings",
              fieldType: FormFieldSchemaType.URL,
              required: false,
              placeholder: "http://ollama:11434",
              /*
               * The column holds 100 characters. Said at the field, before
               * the save: a deployment's whole Target URI with its
               * api-version runs longer, and the resource's endpoint, which
               * is all the field needs, is short.
               */
              validation: {
                maxLength: ColumnLength.ShortURL,
              },
              description:
                "On Azure: https://<resource>.openai.azure.com/openai/v1, or https://<resource>.services.ai.azure.com/anthropic for Claude. Never put keys here.",
            },
            {
              field: {
                isDefault: true,
              },
              title: "Set as Default",
              stepId: "provider-settings",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              collapsibleSection: advancedSection,
              /*
               * Defaults to on: an untouched toggle submits false, which
               * silently leaves the new provider unused (AI features only
               * pick the default provider).
               */
              defaultValue: true,
              description: "Use this provider for AI features in this project.",
            },
            {
              field: {
                additionalParams: true,
              },
              title: "Additional Parameters",
              stepId: "provider-settings",
              fieldType: FormFieldSchemaType.JSON,
              required: false,
              collapsibleSection: advancedSection,
              description:
                'Extra JSON parameters sent to the provider with every request, such as {"temperature": 0.2}. Leave empty unless your model needs them.',
            },
          ]}
          showRefreshButton={true}
          searchableFields={["name", "description", "modelName"]}
          filters={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
            },
            {
              field: {
                isDefault: true,
              },
              title: "Default",
              type: FieldType.Boolean,
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
              noValueMessage: "-",
            },
            {
              field: {
                isDefault: true,
              },
              title: "Default",
              type: FieldType.Boolean,
              getElement: (item: LlmProvider): ReactElement => {
                if (item.isDefault) {
                  return <Pill text="Default" color={Green} />;
                }
                return <span className="text-gray-400">-</span>;
              },
            },
          ]}
        />

        {testedProviderId ? (
          <TestLlmProviderModal
            llmProviderId={testedProviderId}
            headers={ModelAPI.getCommonHeaders()}
            onClose={() => {
              setTestedProviderId(null);
            }}
          />
        ) : null}
      </>
    </Fragment>
  );
};

export default LlmPage;
