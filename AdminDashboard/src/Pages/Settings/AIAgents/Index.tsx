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

const Settings: FunctionComponent = (): ReactElement => {
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentAIAgent, setCurrentAIAgent] = useState<AIAgent | null>(null);

  return (
    <Page
      title={"Admin Settings"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Global AI Agents",
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
        title="Need help with setting up Global AI Agents?"
        description="Here is a guide which will help you get set up"
        link={Route.fromString("/docs/ai-agent/custom-ai-agent")}
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
          title: "Global AI Agents",
          description:
            "Global AI Agents help you automate incident management with AI-powered responses from different locations around the world.",
        }}
        query={{
          projectId: new IsNull(),
          isGlobalAIAgent: true,
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={"No AI agents found."}
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
            title: "Show ID and Key",
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
                    text={"Connected"}
                    color={Green}
                    shouldAnimate={true}
                  />
                );
              }

              return (
                <Statusbubble
                  text={"Disconnected"}
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
          title={`AI Agent Key`}
          description={
            <div>
              <span>Here is your AI agent key. Please keep this a secret.</span>
              <br />
              <br />
              <span>
                <b>AI Agent ID: </b> {currentAIAgent["_id"]?.toString()}
              </span>
              <br />
              <br />
              <span>
                <b>AI Agent Key: </b> {currentAIAgent["key"]?.toString()}
              </span>
            </div>
          }
          submitButtonText={"Close"}
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
