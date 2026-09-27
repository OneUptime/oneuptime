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
import UserDiscord from "Common/Models/DatabaseModels/UserDiscord";
import React, { ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";

/*
 * Same shape as the Slack and Microsoft Teams method components: adding
 * Discord is pointing at the Discord account the user has already connected
 * via OAuth (User Settings > Discord). The server resolves the Discord user
 * id from that link and refuses the add when the link does not exist. The
 * test button matters here because Discord refuses a direct message when the
 * user blocks DMs from server members or has left the connected server, and
 * the test surfaces that before a real page depends on it.
 */
const Discord: () => JSX.Element = (): ReactElement => {
  /*
   * Millisecond resolution: Date.toString() only changes once a second, so an
   * add within a second of mount set the same value and the table never refetched.
   */
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toISOString(),
  );
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");
  const [testResult, setTestResult] = useState<string>("");
  const [isTestLoading, setIsTestLoading] = useState<boolean>(false);

  const deleteGuard: NotificationMethodDeleteGuard<UserDiscord> =
    useNotificationMethodDeleteGuard<UserDiscord>({
      modelType: UserDiscord,
      relationName: "userDiscord",
      singularName: "Discord Account",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
      },
    });

  const addDiscordAccount: () => Promise<void> = async (): Promise<void> => {
    setIsAdding(true);
    setAddError("");

    try {
      const userDiscord: UserDiscord = new UserDiscord();
      userDiscord.projectId = ProjectUtil.getCurrentProjectId()!;
      userDiscord.userId = User.getUserId();

      await ModelAPI.create<UserDiscord>({
        model: userDiscord,
        modelType: UserDiscord,
      });

      setRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
    } catch (err) {
      setAddError(API.getFriendlyMessage(err));
    }

    setIsAdding(false);
  };

  const sendTestMessage: (item: UserDiscord) => Promise<void> = async (
    item: UserDiscord,
  ): Promise<void> => {
    setIsTestLoading(true);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-discord/test",
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
            "Test message sent. Check your Discord direct messages.",
        );
      }
    } catch (err) {
      setTestResult(API.getFriendlyMessage(err));
    }

    setIsTestLoading(false);
  };

  return (
    <>
      <ModelTable<UserDiscord>
        modelType={UserDiscord}
        userPreferencesKey={"user-discord-table"}
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
              item: UserDiscord,
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
        id="user-discord"
        name="User Settings > Notification Methods > Discord"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: "Discord Account for Notifications",
          description:
            "Receive OneUptime notifications as Discord direct messages from this project's Discord bot.",
          buttons: [
            {
              title: "Add Discord Account",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              isLoading: isAdding,
              onClick: () => {
                addDiscordAccount().catch((err: Error) => {
                  setAddError(API.getFriendlyMessage(err));
                  setIsAdding(false);
                });
              },
            },
          ],
        }}
        noItemsMessage={
          "No Discord account added. Connect your Discord account under User Settings > Discord, then click 'Add Discord Account'."
        }
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              discordUserName: true,
            },
            title: "Discord Account",
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
          title={`Could not add Discord`}
          description={addError}
          submitButtonText={"Open Discord Integration Settings"}
          closeButtonText={"Close"}
          onClose={() => {
            setAddError("");
          }}
          onSubmit={() => {
            setAddError("");
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_SETTINGS_DISCORD_INTEGRATION]!,
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

export default Discord;
