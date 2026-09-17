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
import UserMicrosoftTeams from "Common/Models/DatabaseModels/UserMicrosoftTeams";
import React, { ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";

/*
 * Same shape as the Slack method component: adding Microsoft Teams is
 * pointing at the Teams account the user has already connected via OAuth
 * (User Settings > Microsoft Teams Integration). The server resolves the
 * Microsoft Entra user id from that link and refuses the add when the link
 * does not exist. The test button matters more here than anywhere else - a
 * Teams direct message additionally needs the OneUptime app installed for
 * the user, and the test surfaces that error before a real page depends on
 * it.
 */
const MicrosoftTeams: () => JSX.Element = (): ReactElement => {
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");
  const [testResult, setTestResult] = useState<string>("");
  const [isTestLoading, setIsTestLoading] = useState<boolean>(false);

  const deleteGuard: NotificationMethodDeleteGuard<UserMicrosoftTeams> =
    useNotificationMethodDeleteGuard<UserMicrosoftTeams>({
      modelType: UserMicrosoftTeams,
      relationName: "userMicrosoftTeams",
      singularName: "Microsoft Teams Account",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  const addMicrosoftTeamsAccount: () => Promise<void> =
    async (): Promise<void> => {
      setIsAdding(true);
      setAddError("");

      try {
        const userMicrosoftTeams: UserMicrosoftTeams = new UserMicrosoftTeams();
        userMicrosoftTeams.projectId = ProjectUtil.getCurrentProjectId()!;
        userMicrosoftTeams.userId = User.getUserId();

        await ModelAPI.create<UserMicrosoftTeams>({
          model: userMicrosoftTeams,
          modelType: UserMicrosoftTeams,
        });

        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      } catch (err) {
        setAddError(API.getFriendlyMessage(err));
      }

      setIsAdding(false);
    };

  const sendTestMessage: (item: UserMicrosoftTeams) => Promise<void> = async (
    item: UserMicrosoftTeams,
  ): Promise<void> => {
    setIsTestLoading(true);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-microsoft-teams/test",
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
            "Test message sent. Check your Microsoft Teams chats.",
        );
      }
    } catch (err) {
      setTestResult(API.getFriendlyMessage(err));
    }

    setIsTestLoading(false);
  };

  return (
    <>
      <ModelTable<UserMicrosoftTeams>
        modelType={UserMicrosoftTeams}
        userPreferencesKey={"user-microsoft-teams-table"}
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
              item: UserMicrosoftTeams,
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
        id="user-microsoft-teams"
        name="User Settings > Notification Methods > Microsoft Teams"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: "Microsoft Teams Account for Notifications",
          description:
            "Receive OneUptime notifications as Microsoft Teams direct messages from this project's Teams workspace.",
          buttons: [
            {
              title: "Add Microsoft Teams Account",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              isLoading: isAdding,
              onClick: () => {
                addMicrosoftTeamsAccount().catch((err: Error) => {
                  setAddError(API.getFriendlyMessage(err));
                  setIsAdding(false);
                });
              },
            },
          ],
        }}
        noItemsMessage={
          "No Microsoft Teams account added. Connect your Microsoft Teams account under User Settings > Microsoft Teams Integration, then click 'Add Microsoft Teams Account'."
        }
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              microsoftTeamsUserName: true,
            },
            title: "Microsoft Teams Account",
            type: FieldType.Text,
            noValueMessage: "-",
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
          title={`Could not add Microsoft Teams`}
          description={addError}
          submitButtonText={"Open Microsoft Teams Integration Settings"}
          closeButtonText={"Close"}
          onClose={() => {
            setAddError("");
          }}
          onSubmit={() => {
            setAddError("");
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION]!,
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

export default MicrosoftTeams;
