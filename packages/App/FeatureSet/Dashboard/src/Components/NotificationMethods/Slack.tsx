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
import UserSlack from "Common/Models/DatabaseModels/UserSlack";
import React, { ReactElement, useState } from "react";
import OneUptimeDate from "Common/Types/Date";
import {
  NotificationMethodDeleteGuard,
  useNotificationMethodDeleteGuard,
} from "./NotificationMethod";

/*
 * Unlike phone-style methods there is nothing to type and nothing to verify
 * here: adding Slack is pointing at the Slack account the user has already
 * connected via OAuth (User Settings > Slack Integration). The server resolves
 * the Slack member id from that link and refuses the add when the link does
 * not exist, so this component's whole job is one button, one table, and
 * routing the "connect your account first" error somewhere actionable.
 */
const Slack: () => JSX.Element = (): ReactElement => {
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");
  const [testResult, setTestResult] = useState<string>("");
  const [isTestLoading, setIsTestLoading] = useState<boolean>(false);

  const deleteGuard: NotificationMethodDeleteGuard<UserSlack> =
    useNotificationMethodDeleteGuard<UserSlack>({
      modelType: UserSlack,
      relationName: "userSlack",
      singularName: "Slack Account",
      onDeleted: () => {
        setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
      },
    });

  const addSlackAccount: () => Promise<void> = async (): Promise<void> => {
    setIsAdding(true);
    setAddError("");

    try {
      const userSlack: UserSlack = new UserSlack();
      userSlack.projectId = ProjectUtil.getCurrentProjectId()!;
      userSlack.userId = User.getUserId();

      await ModelAPI.create<UserSlack>({
        model: userSlack,
        modelType: UserSlack,
      });

      setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
    } catch (err) {
      setAddError(API.getFriendlyMessage(err));
    }

    setIsAdding(false);
  };

  const sendTestMessage: (item: UserSlack) => Promise<void> = async (
    item: UserSlack,
  ): Promise<void> => {
    setIsTestLoading(true);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-slack/test",
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
            "Test message sent. Check your Slack direct messages.",
        );
      }
    } catch (err) {
      setTestResult(API.getFriendlyMessage(err));
    }

    setIsTestLoading(false);
  };

  return (
    <>
      <ModelTable<UserSlack>
        modelType={UserSlack}
        userPreferencesKey={"user-slack-table"}
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
              item: UserSlack,
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
        id="user-slack"
        name="User Settings > Notification Methods > Slack"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        cardProps={{
          title: "Slack Account for Notifications",
          description:
            "Receive OneUptime notifications as Slack direct messages from this project's Slack workspace.",
          buttons: [
            {
              title: "Add Slack Account",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.NORMAL,
              isLoading: isAdding,
              onClick: () => {
                addSlackAccount().catch((err: Error) => {
                  setAddError(API.getFriendlyMessage(err));
                  setIsAdding(false);
                });
              },
            },
          ],
        }}
        noItemsMessage={
          "No Slack account added. Connect your Slack account under User Settings > Slack Integration, then click 'Add Slack Account'."
        }
        showRefreshButton={true}
        filters={[]}
        columns={[
          {
            field: {
              slackUserName: true,
            },
            title: "Slack Username",
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
          title={`Could not add Slack`}
          description={addError}
          submitButtonText={"Open Slack Integration Settings"}
          closeButtonText={"Close"}
          onClose={() => {
            setAddError("");
          }}
          onSubmit={() => {
            setAddError("");
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.USER_SETTINGS_SLACK_INTEGRATION]!,
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

export default Slack;
