import ProjectUtil from "Common/UI/Utils/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import User from "Common/UI/Utils/User";
import UserMattermost from "Common/Models/DatabaseModels/UserMattermost";
import React, { ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * Same shape as the Slack method component: adding Mattermost is pointing at
 * the Mattermost account the user has already connected with the link the bot
 * sent them (User Settings > Workspace > Mattermost, which the empty table
 * names as the side menu draws it). The server resolves the Mattermost account
 * id from that connection and refuses the add when there is none.
 */
const Mattermost: () => JSX.Element = (): ReactElement => {
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");
  const [testResult, setTestResult] = useState<string>("");
  const [isTestLoading, setIsTestLoading] = useState<boolean>(false);

  const deleteGuard: NotificationMethodDeleteGuard<UserMattermost> =
    useNotificationMethodDeleteGuard<UserMattermost>({
      modelType: UserMattermost,
      relationName: "userMattermost",
      singularName: "Mattermost Account",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  const addMattermostAccount: () => Promise<void> = async (): Promise<void> => {
    setIsAdding(true);
    setAddError("");

    try {
      const userMattermost: UserMattermost = new UserMattermost();
      userMattermost.projectId = ProjectUtil.getCurrentProjectId()!;
      userMattermost.userId = User.getUserId();

      await ModelAPI.create<UserMattermost>({
        model: userMattermost,
        modelType: UserMattermost,
      });

      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    } catch (err) {
      setAddError(API.getFriendlyMessage(err));
    }

    setIsAdding(false);
  };

  const sendTestMessage: (item: UserMattermost) => Promise<void> = async (
    item: UserMattermost,
  ): Promise<void> => {
    setIsTestLoading(true);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-mattermost/test",
          ),
          data: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            itemId: item["_id"],
          },
        });

      if (response.isFailure()) {
        setTestResult(API.getFriendlyMessage(response));
      } else {
        const data: JSONObject = response.data as JSONObject;
        setTestResult(
          (data["statusMessage"] as string) ||
            translateTemplate(
              "Test message sent. Check your Mattermost direct messages.",
            ),
        );
      }
    } catch (err) {
      setTestResult(API.getFriendlyMessage(err));
    }

    setIsTestLoading(false);
  };

  return (
    <>
      <ModelTable<UserMattermost>
        modelType={UserMattermost}
        userPreferencesKey={"user-mattermost-table"}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          userId: User.getUserId().toString(),
        }}
        refreshToggle={refreshToggle}
        actionButtons={[
          {
            title: "Send Test Message",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.SendMessage,
            onClick: async (
              item: UserMattermost,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                await sendTestMessage(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          deleteGuard.deleteActionButton,
        ]}
        id="user-mattermost"
        name="User Settings > Notification Methods > Mattermost"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: "Mattermost Account for Notifications",
          description:
            "Receive OneUptime notifications as Mattermost direct messages from this project's Mattermost bot.",
          buttons: [
            {
              title: "Add Mattermost Account",
              phoneTitle: "Add",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              isLoading: isAdding,
              onClick: () => {
                addMattermostAccount().catch((err: Error) => {
                  setAddError(API.getFriendlyMessage(err));
                  setIsAdding(false);
                });
              },
            },
          ],
        }}
        noItemsMessage={
          "No Mattermost account added. Connect yours under User Settings > Workspace > Mattermost, then click 'Add Mattermost Account'."
        }
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              mattermostUserName: true,
            },
            title: "Mattermost Username",
            type: FieldType.Text,
          },
          {
            field: {
              isVerified: true,
            },
            title: "Verified",
            type: FieldType.Boolean,
          },
        ]}
      />

      {deleteGuard.deletionModal}

      {addError ? (
        <ConfirmModal
          title={`Could not add Mattermost`}
          description={addError}
          submitButtonText={"Open Mattermost Settings"}
          closeButtonText={"Close"}
          onClose={() => {
            setAddError("");
          }}
          onSubmit={() => {
            setAddError("");
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_SETTINGS_MATTERMOST_INTEGRATION]!,
              ),
            );
          }}
        />
      ) : null}

      {testResult ? (
        <ConfirmModal
          title={`Test Message`}
          description={testResult}
          submitButtonText={"Close"}
          isLoading={isTestLoading}
          onSubmit={() => {
            setTestResult("");
          }}
        />
      ) : null}
    </>
  );
};

export default Mattermost;
