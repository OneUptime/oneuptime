import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import TestLlmProviderModal from "Common/UI/Components/AI/TestLlmProviderModal";
import {
  getGlobalLlmProviderFormFields,
  getLlmProviderFormSteps,
} from "Common/UI/Components/AI/LlmProviderFormFields";
import {
  getLlmProviderShownModelName,
  getLlmProviderTypeCopy,
} from "Common/UI/Components/AI/LlmProviderFormCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { BILLING_ENABLED } from "Common/UI/Config";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();

  // The global provider whose Test dialog is open.
  const [testedProviderId, setTestedProviderId] = useState<string | null>(null);

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.globalLlmProviders"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_LLM_PROVIDERS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* LLM Provider Settings View  */}

      <Banner
        openInNewTab={true}
        title={t("pages.settings.llmProviders.bannerTitle")}
        description={t("pages.settings.llmProviders.bannerDescription")}
        link={Route.fromString("/docs/ai/llm-provider")}
        hideOnMobile={true}
      />

      <ModelTable<LlmProvider>
        userPreferencesKey={"admin-llms-table"}
        modelType={LlmProvider}
        id="llms-table"
        name="Settings > Global LLM Providers"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        actionButtons={[
          {
            title: "Test",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            onClick: (item: LlmProvider, onCompleteAction: VoidFunction) => {
              setTestedProviderId(item.id?.toString() || null);
              onCompleteAction();
            },
          },
        ]}
        cardProps={{
          title: t("pages.settings.llmProviders.cardTitle"),
          description: t("pages.settings.llmProviders.cardDescription"),
        }}
        query={{
          projectId: new IsNull(),
          isGlobalLlm: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={t("pages.settings.llmProviders.noItems")}
        showRefreshButton={true}
        onBeforeCreate={(item: LlmProvider) => {
          item.isGlobalLlm = true;
          return Promise.resolve(item);
        }}
        /*
         * The form every LLM provider is added with: which provider, then
         * only what it needs (Common LlmProviderFormFields), as on a
         * project's LLM Providers. Where projects are billed for AI, its
         * price waits under More fields.
         */
        formSteps={getLlmProviderFormSteps()}
        formFields={getGlobalLlmProviderFormFields({
          includeCost: BILLING_ENABLED,
        })}
        selectMoreFields={{
          apiKey: true,
          // The Model column names a Claude deployment's default by it.
          baseUrl: true,
        }}
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
            type: FieldType.LongText,
          },
          {
            field: {
              llmType: true,
            },
            title: "Provider",
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
              llmType: true,
            },
            title: "Provider",
            type: FieldType.Text,
            // As the form's cards name it: "Azure OpenAI / Microsoft Foundry".
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
            /*
             * Left blank, the model the server asks for, by name - as a
             * project's LLM Providers list shows it ("gpt-5.1 (default)",
             * or "First model the server lists").
             */
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
          ...(BILLING_ENABLED
            ? [
                {
                  field: {
                    costPerMillionTokensInUSDCents: true,
                  },
                  title: "Cost (cents/1M)",
                  type: FieldType.Number,
                  noValueMessage: "0",
                },
              ]
            : []),
        ]}
      />

      {testedProviderId ? (
        <TestLlmProviderModal
          llmProviderId={testedProviderId}
          // No project: a global provider is the instance's own.
          headers={AdminModelAPI.getCommonHeaders()}
          onClose={() => {
            setTestedProviderId(null);
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
