import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";

/*
 * The custom channels that are on (CustomNotificationChannel), for every
 * screen that offers them: a person's Notification Methods and their on-call
 * rules. They are the server's, read from CustomNotificationChannelAPI's list
 * of their ids and names - the only part of a channel that reaches the
 * browser - and turned into models so the method labels and the rule form
 * treat them like any other method (NotificationMethodUtil).
 */

// One read for everything on screen; a screen that mounts later asks again.
let pendingRead: Promise<Array<CustomNotificationChannel>> | null = null;

export const readCustomNotificationChannels: (
  data: JSONObject,
) => Array<CustomNotificationChannel> = (
  data: JSONObject,
): Array<CustomNotificationChannel> => {
  const rows: JSONArray = (data["channels"] as JSONArray | undefined) || [];

  return rows
    .filter((row: unknown): boolean => {
      const id: unknown = (row as JSONObject | null)?.["_id"];
      return typeof id === "string" && ObjectID.isValidUUID(id);
    })
    .map((row: unknown): CustomNotificationChannel => {
      const json: JSONObject = row as JSONObject;
      const channel: CustomNotificationChannel =
        new CustomNotificationChannel();
      channel.id = new ObjectID(json["_id"] as string);
      channel.name = (json["name"] as string) || "";
      channel.pageEveryoneByDefault = json["pageEveryoneByDefault"] !== false;
      channel.isEnabled = true;
      return channel;
    });
};

export const loadCustomNotificationChannels: () => Promise<
  Array<CustomNotificationChannel>
> = async (): Promise<Array<CustomNotificationChannel>> => {
  if (!pendingRead) {
    pendingRead = (async (): Promise<Array<CustomNotificationChannel>> => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/custom-notification-channel/available",
          ),
          data: {},
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        throw new Error(API.getFriendlyMessage(response));
      }

      return readCustomNotificationChannels(response.data as JSONObject);
    })();

    // The next screen to ask reads again: a channel may have been added since.
    pendingRead
      .finally(() => {
        pendingRead = null;
      })
      .catch(() => {
        // Each caller hears about a failure from its own await.
      });
  }

  return await pendingRead;
};

export interface CustomNotificationChannelsState {
  // Null while the answer is on its way.
  channels: Array<CustomNotificationChannel> | null;
  error: string | null;
}

/*
 * The channels, for a component. A read that failed answers no channels
 * with its error: nothing is offered that could not be read.
 */
export const useCustomNotificationChannels: () => CustomNotificationChannelsState =
  (): CustomNotificationChannelsState => {
    const [state, setState] = useState<CustomNotificationChannelsState>({
      channels: null,
      error: null,
    });

    useEffect(() => {
      let isMounted: boolean = true;

      loadCustomNotificationChannels()
        .then((channels: Array<CustomNotificationChannel>) => {
          if (isMounted) {
            setState({ channels: channels, error: null });
          }
        })
        .catch((err: unknown) => {
          if (isMounted) {
            setState({ channels: [], error: API.getFriendlyMessage(err) });
          }
        });

      return () => {
        isMounted = false;
      };
    }, []);

    return state;
  };
