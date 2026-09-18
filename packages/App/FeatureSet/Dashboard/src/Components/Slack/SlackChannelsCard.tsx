import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

interface ChannelItem {
  id: string;
  name: string;
}

const SlackChannelsCard: FunctionComponent = (): ReactElement => {
  const [channels, setChannels] = useState<Array<ChannelItem>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadChannels: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError("");
      setIsLoading(true);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute("/slack/channels"),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const list: Array<ChannelItem> = (
        (data["channels"] as Array<JSONObject>) || []
      )
        .map((channel: JSONObject) => {
          return {
            id: (channel["id"] as string) || "",
            name: (channel["name"] as string) || "",
          };
        })
        .filter((channel: ChannelItem) => {
          return Boolean(channel.id && channel.name);
        });

      setChannels(list);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChannels().catch((err: Exception) => {
      setError(API.getFriendlyErrorMessage(err));
    });
  }, []);

  return (
    <Card
      title="Slack Channels"
      description="Channels OneUptime can see in your Slack workspace. Use these names when a notification rule posts to an existing channel."
      buttons={[
        {
          title: "Refresh Channels",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Refresh,
          isLoading: isLoading,
          onClick: () => {
            loadChannels().catch((err: Exception) => {
              setError(API.getFriendlyErrorMessage(err));
            });
          },
        },
      ]}
    >
      <div className="mt-2">
        {isLoading && <ComponentLoader />}

        {!isLoading && error && <ErrorMessage message={error} />}

        {!isLoading && !error && channels.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Icon
                icon={IconProp.Hashtag}
                size={SizeProp.Large}
                thick={ThickProp.Thick}
                className="h-6 w-6"
              />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-900">
              No channels found
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              Create a channel in Slack and click Refresh Channels. Private
              channels appear once the OneUptime app is invited to them.
            </p>
          </div>
        )}

        {!isLoading && !error && channels.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm text-gray-600">
              Channels ({channels.length})
            </div>
            <div className="max-h-96 overflow-y-auto pr-1">
              <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 overflow-hidden bg-white">
                {channels.map((channel: ChannelItem) => {
                  return (
                    <li
                      key={channel.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="h-9 w-9 flex flex-none items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                        <Icon
                          icon={IconProp.Hashtag}
                          size={SizeProp.Large}
                          thick={ThickProp.Thick}
                          className="h-5 w-5"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">
                          {channel.name}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-xs text-gray-500">
              Private channels appear only after the OneUptime app is invited to
              them in Slack.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default SlackChannelsCard;
