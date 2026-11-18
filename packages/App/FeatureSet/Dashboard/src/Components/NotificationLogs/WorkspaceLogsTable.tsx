import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationLog from "Common/Models/DatabaseModels/WorkspaceNotificationLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Green, Blue, Purple, Orange, Yellow } from "Common/Types/BrandColors";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "Common/Types/Workspace/WorkspaceNotificationActionType";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Query from "Common/Types/BaseDatabase/Query";
import BaseModel from "Common/Types/Workflow/Components/BaseModel";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import WorkspaceLogReason, {
  getWorkspaceLogReason,
  getWorkspaceLogStatusText,
} from "./WorkspaceLogReason";

export interface WorkspaceLogsTableProps {
  query?: Query<BaseModel>;
  singularName?: string;
}

/*
 * A workspace by its product's name - "Microsoft Teams", never the stored
 * "MicrosoftTeams" - in the Workspace filter's menu, its chip and the
 * Workspace column alike. A product's name reads as it is written in every
 * language, so it is no key of the locales.
 */
const getWorkspaceName: (
  workspaceType: WorkspaceType | undefined,
) => string | undefined = (
  workspaceType: WorkspaceType | undefined,
): string | undefined => {
  return workspaceType ? getWorkspaceTypeDisplayName(workspaceType) : undefined;
};

const WORKSPACE_FILTER_OPTIONS: Array<DropdownOption> = Object.values(
  WorkspaceType,
).map((workspaceType: WorkspaceType): DropdownOption => {
  return {
    value: workspaceType,
    label: getWorkspaceTypeDisplayName(workspaceType),
    isUserContent: true,
  };
});

const WorkspaceLogsTable: FunctionComponent<WorkspaceLogsTableProps> = (
  props: WorkspaceLogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");
  const defaultColumns: Columns<WorkspaceNotificationLog> = [
    {
      field: { workspaceType: true },
      title: "Workspace",
      type: FieldType.Text,
      getLineText: (item: WorkspaceNotificationLog): string | undefined => {
        return getWorkspaceName(item.workspaceType);
      },
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        const name: string | undefined = getWorkspaceName(item.workspaceType);

        return name ? <IsolatedText text={name} /> : <TableEmptyValue />;
      },
    },
    {
      field: { actionType: true },
      title: "Action",
      type: FieldType.Text,
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        const actionType: WorkspaceNotificationActionType | undefined = item[
          "actionType"
        ] as WorkspaceNotificationActionType | undefined;

        if (!actionType) {
          return <></>;
        }

        // Map action type to a brand color
        const colorMap: Record<WorkspaceNotificationActionType, typeof Blue> = {
          [WorkspaceNotificationActionType.SendMessage]: Blue,
          [WorkspaceNotificationActionType.CreateChannel]: Purple,
          [WorkspaceNotificationActionType.InviteUser]: Orange,
          [WorkspaceNotificationActionType.ButtonPressed]: Yellow,
          [WorkspaceNotificationActionType.StartVideoCall]: Green,
        };

        const textMap: Record<WorkspaceNotificationActionType, string> = {
          [WorkspaceNotificationActionType.SendMessage]:
            translationKey("Send Message"),
          [WorkspaceNotificationActionType.CreateChannel]:
            translationKey("Create Channel"),
          [WorkspaceNotificationActionType.InviteUser]:
            translationKey("Invite User"),
          [WorkspaceNotificationActionType.ButtonPressed]:
            translationKey("Button Pressed"),
          [WorkspaceNotificationActionType.StartVideoCall]:
            translationKey("Start Video Call"),
        };

        return (
          <Pill
            isMinimal={true}
            color={colorMap[actionType] || Blue}
            text={textMap[actionType] || "Unknown Action"}
          />
        );
      },
    },
    /*
     * A row in no channel - a summary that cannot be sent as it is set up
     * (#7116) - shows the quiet dash an empty cell has, as User does: a
     * "-" of its own was drawn as dark as a channel's name.
     */
    {
      field: { channelName: true },
      title: "Channel",
      type: FieldType.Text,
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
      hideOnMobile: true,
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        if (!item["user"]) {
          return <TableEmptyValue />;
        }

        return <UserElement user={item["user"] as User} />;
      },
    },
    { field: { createdAt: true }, title: "Sent at", type: FieldType.DateTime },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        if (item["status"]) {
          return (
            <Pill
              isMinimal={false}
              tone={
                item["status"] === WorkspaceNotificationStatus.Success
                  ? PillTone.Success
                  : PillTone.Danger
              }
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
    /*
     * Why a post failed, in the row (#7121): the workspace's refusal in
     * OneUptime's words, two lines at most and the whole of it under the
     * pointer (WorkspaceLogReason). It was only under the row's ⋯ > View
     * Status Message, so a page of Error rows could not be read for which
     * were the same problem. A row that went out has none. On a narrow
     * table, or a phone's card, it gives way first: under the row's
     * Status.
     */
    {
      field: { statusMessage: true },
      title: "Reason",
      type: FieldType.Element,
      disableSort: true,
      wrapContent: true,
      hideBelowLargeScreen: true,
      foldInto: "status",
      getElement: (item: WorkspaceNotificationLog): ReactElement => {
        return (
          <WorkspaceLogReason
            status={item.status}
            statusMessage={item.statusMessage}
            workspaceType={item.workspaceType}
          />
        );
      },
      getExportValue: (item: WorkspaceNotificationLog): string => {
        return getWorkspaceLogReason({
          status: item.status,
          statusMessage: item.statusMessage,
          workspaceType: item.workspaceType,
        })
          ? getWorkspaceLogStatusText({
              status: item.status,
              statusMessage: item.statusMessage,
              workspaceType: item.workspaceType,
            })
          : "";
      },
    },
  ];

  const defaultFilters: Array<Filter<WorkspaceNotificationLog>> = [
    { field: { createdAt: true }, title: "Sent at", type: FieldType.Date },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Dropdown,
      filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        WorkspaceNotificationStatus,
      ),
    },
    {
      field: { workspaceType: true },
      title: "Workspace",
      type: FieldType.Dropdown,
      filterDropdownOptions: WORKSPACE_FILTER_OPTIONS,
    },
  ];

  return (
    <>
      <ModelTable<WorkspaceNotificationLog>
        modelType={WorkspaceNotificationLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-workspace-logs-table`
            : "workspace-logs-table"
        }
        name="Workspace Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-workspace-logs-table`
            : "workspace-logs-table"
        }
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          statusMessage: true,
          message: true,
          channelId: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
        }}
        /*
         * Mattermost's posts are listed too: it said "Messages sent to
         * Slack / Teams." Worded as the other logs' are ("Emails sent for
         * this project.").
         */
        cardProps={{
          title: "Workspace Logs",
          description: props.singularName
            ? translator.translateTemplate(
                "Slack, Microsoft Teams and Mattermost messages sent for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "Slack, Microsoft Teams and Mattermost messages sent for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? translator.translateTemplate(
                "No Workspace logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "No Workspace logs."
        }
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: WorkspaceNotificationLog,
              onCompleteAction: VoidFunction,
            ) => {
              setModalText(item["message"] as string);
              setModalTitle("Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
          {
            title: "View Status Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            onClick: async (
              item: WorkspaceNotificationLog,
              onCompleteAction: VoidFunction,
            ) => {
              /*
               * The whole of it: a failure's reason with what the
               * workspace answered after it - an old row's raw code said
               * in words too (getWorkspaceLogStatusText).
               */
              setModalText(
                getWorkspaceLogStatusText({
                  status: item.status,
                  statusMessage: item.statusMessage,
                  workspaceType: item.workspaceType,
                }),
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
          description={<MarkdownViewer text={modalText} />}
          onSubmit={() => {
            setShowModal(false);
          }}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}
    </>
  );
};

export default WorkspaceLogsTable;
