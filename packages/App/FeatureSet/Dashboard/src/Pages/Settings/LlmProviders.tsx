import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { VoidFunction } from "Common/Types/FunctionTypes";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import TestLlmProviderModal from "Common/UI/Components/AI/TestLlmProviderModal";
import {
  getLlmProviderFormSteps,
  getProjectLlmProviderFormFields,
} from "Common/UI/Components/AI/LlmProviderFormFields";
import {
  getLlmProviderShownModelName,
  getLlmProviderTypeCopy,
} from "Common/UI/Components/AI/LlmProviderFormCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import TestLLMProvider from "Common/UI/Utils/TestLLMProvider";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import Navigation from "Common/UI/Utils/Navigation";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { Green } from "Common/Types/BrandColors";

/*
 * Project Settings > AI > LLM Providers: the providers this project's AI
 * uses, then the global ones it falls back to.
 *
 * The page used to open on a "What Can LLM Providers Do?" card - five
 * features, some long gone, ahead of anything to do - and its own providers
 * sat last, under "Bring Your Own Large Language Model". Now the project's
 * providers come first, as LLM Providers, and the global list follows with
 * what it is for. What AI does with a provider is the docs' to say.
 *
 * Creating one asks which provider first, then only what that provider
 * needs (LlmProviderFormFields), as a provider's own page and the Admin
 * Dashboard's Global LLM Providers do.
 */
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

  return (
    <Fragment>
      <>
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
            title: "LLM Providers",
            description: BILLING_ENABLED
              ? "The models this project's AI features use. A provider of your own uses no AI credits."
              : "The models this project's AI features use.",
          }}
          documentationLink={Route.fromString("/docs/ai/llm-provider")}
          noItemsMessage={
            "No LLM providers yet. Add one to choose the model this project's AI features use."
          }
          viewPageRoute={Navigation.getCurrentRoute()}
          formSteps={getLlmProviderFormSteps()}
          formFields={getProjectLlmProviderFormFields()}
          showRefreshButton={true}
          // The Model column names a Claude deployment's default by it.
          selectMoreFields={{ baseUrl: true }}
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
                llmType: true,
              },
              title: "Provider",
              type: FieldType.Text,
              getElement: (item: LlmProvider): ReactElement => {
                return (
                  <span>
                    {getLlmProviderTypeCopy(item.llmType)?.title ||
                      item.llmType ||
                      "-"}
                  </span>
                );
              },
            },
            {
              field: {
                modelName: true,
              },
              title: "Model",
              type: FieldType.Text,
              // Left blank, the model the server asks for, by name.
              getElement: (item: LlmProvider): ReactElement => {
                return (
                  <span>
                    {getLlmProviderShownModelName({
                      modelName: item.modelName,
                      llmType: item.llmType,
                      baseUrl: item.baseUrl,
                      translator: translator,
                    })}
                  </span>
                );
              },
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
                // The quiet dash every table leaves for "no".
                return <TableEmptyValue screenReaderText="No" />;
              },
            },
          ]}
        />

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
              "Ready to use with no setup. AI features use them while this project has no default provider of its own.",
          }}
          fetchRequestOptions={{
            overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
              "/llm-provider/global-llms",
            ),
          }}
          /*
           * The card's own line says the global providers are ready to use:
           * with none, it says where AI features turn instead.
           */
          noItemsMessage={
            "No global LLM providers. AI features use the providers you add above."
          }
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
