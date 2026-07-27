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
import { APP_API_URL, MicrosoftTeamsAppClientId } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import OneUptimeDate from "Common/Types/Date";

interface ChatItem {
  id: string;
  name: string;
  chatType: "personal" | "groupChat";
  addedAt?: string | null;
}

const MicrosoftTeamsChatsCard: FunctionComponent = (): ReactElement => {
  const [chats, setChats] = useState<Array<ChatItem>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadChats: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError("");
      setIsLoading(true);

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute("/microsoft-teams/chats"),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const data: JSONObject = response.data as JSONObject;
      const list: Array<ChatItem> = ((data["chats"] as Array<JSONObject>) || [])
        .map((chat: JSONObject) => {
          return {
            id: (chat["id"] as string) || "",
            name: (chat["name"] as string) || "",
            chatType:
              (chat["chatType"] as string) === "personal"
                ? ("personal" as const)
                : ("groupChat" as const),
            addedAt: (chat["addedAt"] as string) || null,
          };
        })
        .filter((chat: ChatItem) => {
          return Boolean(chat.id);
        });

      setChats(list);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChats().catch((err: Exception) => {
      setError(API.getFriendlyErrorMessage(err));
    });
  }, []);

  return (
    <Card
      title="Microsoft Teams Chats"
      description="Send notifications straight into group chats and one-on-one chats. Add the OneUptime app to any chat in Microsoft Teams and it will show up here as a destination for your notification rules."
      buttons={[
        {
          title: "Refresh Chats",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Refresh,
          isLoading: isLoading,
          onClick: () => {
            loadChats().catch((err: Exception) => {
              setError(API.getFriendlyErrorMessage(err));
            });
          },
        },
      ]}
    >
      <div className="mt-2">
        {isLoading && <ComponentLoader />}

        {!isLoading && error && <ErrorMessage message={error} />}

        {!isLoading && !error && chats.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Icon
                icon={IconProp.ChatBubbleLeftRight}
                size={SizeProp.Large}
                thick={ThickProp.Thick}
                className="h-6 w-6"
              />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-900">
              No chats connected yet
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              Add the OneUptime app to a chat in Microsoft Teams and it will
              appear here, ready to receive notifications.
            </p>
            <div className="mx-auto mt-6 max-w-md text-left">
              <ol className="space-y-3 text-sm text-gray-600">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
                    1
                  </span>
                  Open Microsoft Teams and go to the group chat or one-on-one
                  chat you want to notify.
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
                    2
                  </span>
                  Click the + (Add an app) button at the top of the chat, or
                  type @OneUptime in the message box, and add the OneUptime app.
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
                    3
                  </span>
                  Come back here and click Refresh Chats — then pick the chat in
                  any notification rule.
                </li>
              </ol>
              <p className="mt-4 text-xs text-gray-500">
                Already have the OneUptime app in a chat? Just @mention
                OneUptime in that chat (or send the bot any message in a 1:1
                chat) — the chat registers here the moment the bot hears from
                you.
              </p>
            </div>
            {MicrosoftTeamsAppClientId && (
              <button
                type="button"
                className="mt-6 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
                onClick={() => {
                  window.open(
                    "https://teams.microsoft.com/l/app/" +
                      MicrosoftTeamsAppClientId,
                    "_blank",
                  );
                }}
              >
                <Icon
                  icon={IconProp.ExternalLink}
                  size={SizeProp.Regular}
                  className="h-4 w-4"
                />
                Open OneUptime in Microsoft Teams
              </button>
            )}
          </div>
        )}

        {!isLoading && !error && chats.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm text-gray-600">
              Connected chats ({chats.length})
            </div>
            <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 overflow-hidden bg-white">
              {chats.map((chat: ChatItem) => {
                return (
                  <li
                    key={chat.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div
                      className={`h-9 w-9 flex flex-none items-center justify-center rounded-full ${
                        chat.chatType === "personal"
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-indigo-50 text-indigo-600"
                      }`}
                    >
                      <Icon
                        icon={
                          chat.chatType === "personal"
                            ? IconProp.ChatBubbleLeft
                            : IconProp.ChatBubbleLeftRight
                        }
                        size={SizeProp.Large}
                        thick={ThickProp.Thick}
                        className="h-5 w-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 truncate">
                        {chat.name}
                      </div>
                      {chat.addedAt && (
                        <div className="text-xs text-gray-500">
                          Connected{" "}
                          {OneUptimeDate.getDateAsLocalFormattedString(
                            chat.addedAt,
                            true,
                          )}
                        </div>
                      )}
                    </div>
                    <span
                      className={`inline-flex flex-none items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                        chat.chatType === "personal"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                          : "bg-indigo-50 text-indigo-700 ring-indigo-700/10"
                      }`}
                    >
                      {chat.chatType === "personal" ? "1:1 chat" : "Group chat"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-gray-500">
              To connect more chats, add the OneUptime app to a chat in
              Microsoft Teams and click Refresh Chats. Removing the app from a
              chat disconnects it automatically.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default MicrosoftTeamsChatsCard;
