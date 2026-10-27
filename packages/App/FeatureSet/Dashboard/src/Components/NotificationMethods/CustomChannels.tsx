import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The custom channels on a person's Notification Methods
 * (CustomNotificationChannel): ways to reach them that the server's admin set
 * up for everyone. Nothing to add or verify - the channel's service is told
 * who each page is for - so each one is a name and a Send test, to see a page
 * reach them before a real one does. They are picked in the on-call rules
 * like any other method.
 */

export interface ComponentProps {
  channels: Array<CustomNotificationChannel>;
}

export const CUSTOM_CHANNELS_CARD_TEST_ID: string = "custom-channels-card";

// The line under a channel's name: how it reaches the person. English, looked up when shown.
export const getCustomChannelReachSentence: (
  channel: CustomNotificationChannel,
) => string = (channel: CustomNotificationChannel): string => {
  return channel.pageEveryoneByDefault !== false
    ? translationKey(
        "Already in your on-call rules: your administrator pages everyone through it.",
      )
    : translationKey("Add it to your on-call rules to be paged through it.");
};

const CustomChannels: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [testedChannel, setTestedChannel] =
    useState<CustomNotificationChannel | null>(null);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testMessage, setTestMessage] = useState<string>("");
  const [testError, setTestError] = useState<string>("");

  const email: string = User.getEmail()?.toString() || "";

  const sendTest: (
    channel: CustomNotificationChannel,
  ) => Promise<void> = async (
    channel: CustomNotificationChannel,
  ): Promise<void> => {
    setTestedChannel(channel);
    setIsTesting(true);
    setTestMessage("");
    setTestError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/custom-notification-channel/test",
          ),
          data: {
            customNotificationChannelId: channel.id?.toString() || "",
            projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
          },
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        setTestError(API.getFriendlyMessage(response));
      } else {
        const data: JSONObject = response.data as JSONObject;
        const message: string = (data["statusMessage"] as string) || "";

        if (data["ok"]) {
          setTestMessage(message);
        } else {
          setTestError(message);
        }
      }
    } catch (err) {
      setTestError(API.getFriendlyMessage(err));
    }

    setIsTesting(false);
  };

  return (
    <div data-testid={CUSTOM_CHANNELS_CARD_TEST_ID}>
      <Card
        title="Custom Channels"
        description={
          email
            ? translator.translateTemplate(
                "Ways to reach you that your administrator set up for everyone. There is nothing to set up: OneUptime sends your pages to them as {{email}}.",
                { email: email },
              )
            : translator.translateText(
                "Ways to reach you that your administrator set up for everyone. There is nothing to set up: OneUptime sends your pages to them as you.",
              )
        }
      >
        <ul className="divide-y divide-gray-200">
          {props.channels.map((channel: CustomNotificationChannel) => {
            return (
              <li
                key={channel.id?.toString() || channel.name || ""}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {channel.name}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {translator.translateText(
                      getCustomChannelReachSentence(channel),
                    )}
                  </p>
                </div>
                <div className="flex-none">
                  <Button
                    title="Send test"
                    icon={IconProp.Play}
                    buttonStyle={ButtonStyleType.NORMAL}
                    onClick={() => {
                      void sendTest(channel);
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {testedChannel ? (
        <ConfirmModal
          title={translator.translateTemplate("Send test: {{name}}", {
            name: testedChannel.name || "",
          })}
          error={testError}
          description={
            isTesting
              ? translator.translateText("Sending a test request…")
              : testMessage ||
                (testError
                  ? ""
                  : translator.translateText(
                      "Sending a test request to the channel.",
                    ))
          }
          submitButtonText={"Close"}
          isLoading={isTesting}
          onSubmit={() => {
            setTestedChannel(null);
            setTestMessage("");
            setTestError("");
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default CustomChannels;
