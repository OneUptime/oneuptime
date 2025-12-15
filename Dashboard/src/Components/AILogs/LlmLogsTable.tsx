import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import LlmLog from "Common/Models/DatabaseModels/LlmLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import LlmLogStatus from "Common/Types/LlmLogStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";

export interface LlmLogsTableProps {
  query?: Query<LlmLog>;
  singularName?: string;
}

const LlmLogsTable: FunctionComponent<LlmLogsTableProps> = (
  props: LlmLogsTableProps,
): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const defaultColumns: Columns<LlmLog> = [
    {
      field: { llmProviderName: true },
      title: "Provider",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: { llmType: true },
      title: "Type",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: { modelName: true },
      title: "Model",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: { isGlobalProvider: true },
      title: "Global",
      type: FieldType.Boolean,
    },
    {
      field: { feature: true },
      title: "Feature",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: {
        user: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "User",
      type: FieldType.Text,
      noValueMessage: "-",
      getElement: (item: LlmLog): ReactElement => {
        if (!item["user"]) {
          return <p>-</p>;
        }

        return <UserElement user={item["user"] as User} />;
      },
    },
    {
      field: { inputTokens: true },
      title: "Input Tokens",
      type: FieldType.Number,
    },
    {
      field: { outputTokens: true },
      title: "Output Tokens",
      type: FieldType.Number,
    },
    {
      field: { costInUSDCents: true },
      title: "Cost (cents)",
      type: FieldType.Number,
    },
    {
      field: { createdAt: true },
      title: "Time",
      type: FieldType.DateTime,
    },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: LlmLog): ReactElement => {
        if (item["status"]) {
          let color = Green;
          if (item["status"] === LlmLogStatus.Error) {
            color = Red;
          }
          if (item["status"] === LlmLogStatus.InsufficientBalance) {
            color = Yellow;
          }
          return (
            <Pill
              isMinimal={false}
              color={color}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<LlmLog>> = [
    { field: { createdAt: true }, title: "Time", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Text },
    { field: { llmType: true }, title: "Provider Type", type: FieldType.Text },
    { field: { feature: true }, title: "Feature", type: FieldType.Text },
  ];

  return (
    <>
      <ModelTable<LlmLog>
        modelType={LlmLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-llm-logs-table`
            : "llm-logs-table"
        }
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-llm-logs-table`
            : "llm-logs-table"
        }
        name="AI Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          requestPrompt: true,
          responsePreview: true,
          statusMessage: true,
        }}
        cardProps={{
          title: "AI Logs",
          description: props.singularName
            ? `AI usage logs for this ${props.singularName}.`
            : "AI usage logs for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? `No AI logs for this ${props.singularName}.`
            : "No AI logs."
        }
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Request",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (item: LlmLog, onCompleteAction: VoidFunction) => {
              setModalText(
                (item["requestPrompt"] as string) || "No request data",
              );
              setModalTitle("Request Prompt");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Response",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.File,
            onClick: async (item: LlmLog, onCompleteAction: VoidFunction) => {
              setModalText(
                (item["responsePreview"] as string) || "No response data",
              );
              setModalTitle("Response Preview");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Error",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (item: LlmLog, onCompleteAction: VoidFunction) => {
              setModalText(
                (item["statusMessage"] as string) || "No error message",
              );
              setModalTitle("Status Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
        ]}
      />

      {showModal && (
        <ConfirmModal
          title={modalTitle}
          description={modalText}
          onSubmit={() => {
            return setShowModal(false);
          }}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}
    </>
  );
};

export default LlmLogsTable;
