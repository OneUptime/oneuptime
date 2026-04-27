import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import { Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import AIAgentElement from "Common/UI/Components/AIAgent/AIAgent";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentAIAgent, setCurrentAIAgent] = useState<AIAgent | null>(null);

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
          title: t("breadcrumbs.globalAiAgents"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_AI_AGENTS] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* Project Settings View  */}

      <Banner
        openInNewTab={true}
        title={t("pages.settings.aiAgents.bannerTitle")}
        description={t("pages.settings.aiAgents.bannerDescription")}
        link={Route.fromString("/docs/ai/ai-agent")}
        hideOnMobile={true}
      />

      <ModelTable<AIAgent>
        userPreferencesKey={"admin-ai-agents-table"}
        modelType={AIAgent}
        id="ai-agents-table"
        name="Settings > Global AI Agents"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: t("pages.settings.aiAgents.cardTitle"),
          description: t("pages.settings.aiAgents.cardDescription"),
        }}
        query={{
          projectId: new IsNull(),
          isGlobalAIAgent: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={t("pages.settings.aiAgents.noItems")}
        showRefreshButton={true}
        onBeforeCreate={(item: AIAgent) => {
          item.isGlobalAIAgent = true;
          return Promise.resolve(item);
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "my-ai-agent",
            validation: {
              minLength: 2,
            },
          },

          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "This AI agent handles automated incident management.",
          },

          {
            field: {
              iconFile: true,
            },
            title: "AI Agent Logo",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload logo",
          },
        ]}
        selectMoreFields={{
          key: true,
          iconFileId: true,
        }}
        actionButtons={[
          {
            title: t("pages.settings.aiAgents.showIdKey"),
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: AIAgent,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setCurrentAIAgent(item);
                setShowKeyModal(true);

                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
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
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,

            getElement: (item: AIAgent): ReactElement => {
              return <AIAgentElement aiAgent={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              lastAlive: true,
            },
            title: "Status",
            type: FieldType.Text,

            getElement: (item: AIAgent): ReactElement => {
              if (
                item &&
                item["lastAlive"] &&
                OneUptimeDate.getNumberOfMinutesBetweenDates(
                  OneUptimeDate.fromString(item["lastAlive"]),
                  OneUptimeDate.getCurrentDate(),
                ) < 5
              ) {
                return (
                  <Statusbubble
                    text={t("common.connected")}
                    color={Green}
                    shouldAnimate={true}
                  />
                );
              }

              return (
                <Statusbubble
                  text={t("common.disconnected")}
                  color={Red}
                  shouldAnimate={false}
                />
              );
            },
          },
        ]}
      />

      {showKeyModal && currentAIAgent ? (
        <ConfirmModal
          title={t("pages.settings.aiAgents.keyModalTitle")}
          description={
            <div>
              <span>{t("pages.settings.aiAgents.keyModalDescription")}</span>
              <br />
              <br />
              <span>
                <b>{t("pages.settings.aiAgents.agentIdLabel")} </b>{" "}
                {currentAIAgent["_id"]?.toString()}
              </span>
              <br />
              <br />
              <span>
                <b>{t("pages.settings.aiAgents.agentKeyLabel")} </b>{" "}
                {currentAIAgent["key"]?.toString()}
              </span>
            </div>
          }
          submitButtonText={t("common.close")}
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={async () => {
            setShowKeyModal(false);
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default Settings;
