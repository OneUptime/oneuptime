import DatabaseConfig from "../../../../Server/DatabaseConfig";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import CustomChannelActionToken, {
  CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS,
  CUSTOM_CHANNEL_ACTION_TOKEN_PARAM,
  CUSTOM_CHANNEL_ACTION_TOKEN_PURPOSE,
} from "../../../../Server/Utils/OnCall/CustomChannelActionToken";
import OnCallPageLinkToken from "../../../../Server/Utils/OnCall/OnCallPageLinkToken";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import {
  CUSTOM_CHANNEL_ACTIONS,
  CustomChannelAction,
  CustomChannelActionLinks,
} from "../../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

// The token a link carries, read the way a channel's service reads it.
function readToken(link: string): string {
  return (
    new globalThis.URL(link).searchParams.get(
      CUSTOM_CHANNEL_ACTION_TOKEN_PARAM,
    ) || ""
  );
}

/*
 * The token in a custom channel's action links is the only proof its service
 * shows, so it must name exactly one notification, only be good for these
 * links (never an on-call page link's purpose, and the other way round), and
 * stop working after a week.
 */

describe("CustomChannelActionToken", () => {
  const notificationId: ObjectID = ObjectID.generate();

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("a token signed for a notification is valid for it", () => {
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: notificationId,
    });

    expect(
      CustomChannelActionToken.isValid({
        token: token,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(true);
  });

  test("a token for one notification is refused for another", () => {
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: notificationId,
    });

    expect(
      CustomChannelActionToken.isValid({
        token: token,
        userOnCallLogTimelineId: ObjectID.generate(),
      }),
    ).toBe(false);
  });

  test("an id in another case is the same id", () => {
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: new ObjectID(
        notificationId.toString().toUpperCase(),
      ),
    });

    expect(
      CustomChannelActionToken.isValid({
        token: token,
        userOnCallLogTimelineId: new ObjectID(
          notificationId.toString().toLowerCase(),
        ),
      }),
    ).toBe(true);
  });

  test("an on-call page link's token is refused: it may not resolve", () => {
    const pageLinkToken: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: notificationId,
    });

    expect(
      CustomChannelActionToken.isValid({
        token: pageLinkToken,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(false);
  });

  test("this token is refused where an on-call page link's is asked for", () => {
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: notificationId,
    });

    expect(
      OnCallPageLinkToken.isValid({
        token: token,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(false);
  });

  test("a token with the right claims but no purpose is refused", () => {
    const token: string = JSONWebToken.signJsonPayload(
      { notification: notificationId.toString() },
      300,
    );

    expect(
      CustomChannelActionToken.isValid({
        token: token,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(false);
  });

  test("a token with the purpose but a notification that is not text is refused", () => {
    const token: string = JSONWebToken.signJsonPayload(
      { purpose: CUSTOM_CHANNEL_ACTION_TOKEN_PURPOSE, notification: 42 },
      300,
    );

    expect(
      CustomChannelActionToken.isValid({
        token: token,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(false);
  });

  test("an edited token is refused", () => {
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: notificationId,
    });
    const parts: Array<string> = token.split(".");
    const edited: string = `${parts[0]}.${parts[1]}x.${parts[2]}`;

    expect(
      CustomChannelActionToken.isValid({
        token: edited,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(false);
  });

  test("an expired token is refused", () => {
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: notificationId,
    });

    jest.useFakeTimers();
    jest.setSystemTime(
      Date.now() + (CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS + 60) * 1000,
    );

    expect(
      CustomChannelActionToken.isValid({
        token: token,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(false);
  });

  test("a token a day before it expires is still valid", () => {
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: notificationId,
    });

    jest.useFakeTimers();
    jest.setSystemTime(
      Date.now() +
        (CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS - 24 * 60 * 60) * 1000,
    );

    expect(
      CustomChannelActionToken.isValid({
        token: token,
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(true);
  });

  test("it lasts a week", () => {
    expect(CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS).toBe(
      7 * 24 * 60 * 60,
    );
  });

  test.each([undefined, null, "", 42, {}, [], true, "not-a-token"])(
    "refuses %p without throwing",
    (token: unknown) => {
      expect(
        CustomChannelActionToken.isValid({
          token: token,
          userOnCallLogTimelineId: notificationId,
        }),
      ).toBe(false);
    },
  );

  test("refuses a token far longer than any OneUptime signs", () => {
    expect(
      CustomChannelActionToken.isValid({
        token: "a".repeat(5000),
        userOnCallLogTimelineId: notificationId,
      }),
    ).toBe(false);
  });

  describe("getActionLinks", () => {
    beforeEach(() => {
      jest
        .spyOn(DatabaseConfig, "getHost")
        .mockResolvedValue(Hostname.fromString("oneuptime.example.com"));
      jest
        .spyOn(DatabaseConfig, "getHttpProtocol")
        .mockResolvedValue(Protocol.HTTPS);
    });

    test("one link per action, each to that action of this notification", async () => {
      const links: CustomChannelActionLinks =
        await CustomChannelActionToken.getActionLinks(notificationId);

      expect(Object.keys(links).sort()).toEqual(
        [...CUSTOM_CHANNEL_ACTIONS].sort(),
      );

      for (const action of CUSTOM_CHANNEL_ACTIONS) {
        const url: globalThis.URL = new globalThis.URL(links[action]);

        expect(url.origin).toBe("https://oneuptime.example.com");
        expect(url.pathname).toBe(
          `/api/custom-notification-channel/page/${notificationId.toString()}/${action}`,
        );
        expect(readToken(links[action])).toBeTruthy();
      }
    });

    test("every link carries a token valid for this notification alone", async () => {
      const links: CustomChannelActionLinks =
        await CustomChannelActionToken.getActionLinks(notificationId);

      for (const action of CUSTOM_CHANNEL_ACTIONS) {
        const token: string = readToken(links[action]);

        expect(
          CustomChannelActionToken.isValid({
            token: token,
            userOnCallLogTimelineId: notificationId,
          }),
        ).toBe(true);
        expect(
          CustomChannelActionToken.isValid({
            token: token,
            userOnCallLogTimelineId: ObjectID.generate(),
          }),
        ).toBe(false);
      }
    });

    test("the three links share one token: it names the notification, not the action", async () => {
      const links: CustomChannelActionLinks =
        await CustomChannelActionToken.getActionLinks(notificationId);

      const tokens: Set<string> = new Set<string>(
        CUSTOM_CHANNEL_ACTIONS.map((action: CustomChannelAction): string => {
          return readToken(links[action]);
        }),
      );

      expect(tokens.size).toBe(1);
    });
  });
});
