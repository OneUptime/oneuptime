import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import { jest } from "@jest/globals";

/*
 * The Dashboard's read of the server's custom channels that are on
 * (Utils/CustomNotificationChannels posts to
 * /custom-notification-channel/available), answered from the list the test
 * holds - none, unless it passes some - instead of a request to a host
 * that is not there. Every other post goes where it went before: the real
 * API, or a stub a suite already put in place.
 *
 * `hold` keeps the answer back until the test calls `release`, for a screen
 * that must wait for it. A test that holds it releases it before it ends:
 * screens share a read that is still on its way, so one left held would
 * keep every later screen of the file waiting too. `fail` answers HTTP 500.
 */
export interface StubbedDashboardCustomNotificationChannels {
  // The channels answered, as the server lists them: _id, name, pageEveryoneByDefault.
  channels: Array<JSONObject>;
  // How often they were read.
  reads: number;
  release: () => void;
}

export const CUSTOM_NOTIFICATION_CHANNELS_ROUTE: string =
  "/custom-notification-channel/available";

export function stubDashboardCustomNotificationChannels(
  options: {
    channels?: Array<JSONObject> | undefined;
    hold?: boolean | undefined;
    fail?: boolean | undefined;
  } = {},
): StubbedDashboardCustomNotificationChannels {
  let releaseHeld: () => void = (): void => {
    return undefined;
  };
  const held: Promise<void> = options.hold
    ? new Promise<void>((resolve: () => void): void => {
        releaseHeld = resolve;
      })
    : Promise.resolve();

  const stubbed: StubbedDashboardCustomNotificationChannels = {
    channels: options.channels || [],
    reads: 0,
    release: (): void => {
      releaseHeld();
    },
  };

  type Post = (data: unknown) => Promise<unknown>;
  const current: unknown = API.post;
  const otherPosts: Post | undefined = jest.isMockFunction(current)
    ? ((
        current as unknown as { getMockImplementation: () => unknown }
      ).getMockImplementation() as Post | undefined)
    : (current as Post).bind(API);

  jest.spyOn(API, "post").mockImplementation((async (data: {
    url: unknown;
  }): Promise<unknown> => {
    if (String(data.url).includes(CUSTOM_NOTIFICATION_CHANNELS_ROUTE)) {
      stubbed.reads++;
      await held;

      if (options.fail) {
        return new HTTPResponse<JSONObject>(
          500,
          { message: "Custom channels could not be read." },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(
        200,
        { channels: stubbed.channels },
        {},
      );
    }

    return otherPosts ? otherPosts(data) : undefined;
  }) as never);

  return stubbed;
}
