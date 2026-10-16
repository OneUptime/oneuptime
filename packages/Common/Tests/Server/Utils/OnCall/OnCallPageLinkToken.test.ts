import DatabaseConfig from "../../../../Server/DatabaseConfig";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS,
  ON_CALL_PAGE_LINK_TOKEN_PARAM,
  ON_CALL_PAGE_LINK_TOKEN_PURPOSE,
} from "../../../../Server/Utils/OnCall/OnCallPageLinkToken";
import OnCallPageLinks from "../../../../Server/Utils/OnCall/OnCallPageLinks";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE LINKS IN A PERSON'S OWN PAGE, AND THE TOKEN THAT LETS THEM PASS IT ON.
 *
 * Passing a page on stops the person's notifications and wakes the next
 * people in line, so a link that does it has to be one OneUptime sent that
 * person - not any link somebody builds from a notification's id, which
 * people who may read the on-call policy can read. Each message's links
 * carry a token signed for that one notification; these pin what it
 * accepts, what it refuses, and the links that carry it.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0f600000-0000-4000-8000-000000000001",
);
const OTHER_NOTIFICATION: ObjectID = new ObjectID(
  "0f600000-0000-4000-8000-000000000002",
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the token", () => {
  test("is accepted for the notification it was signed for", () => {
    const token: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
    });

    expect(
      OnCallPageLinkToken.isValid({
        token: token,
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(true);
  });

  test("is refused for any other notification: a link's id cannot be swapped", () => {
    const token: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
    });

    expect(
      OnCallPageLinkToken.isValid({
        token: token,
        userOnCallLogTimelineId: OTHER_NOTIFICATION,
      }),
    ).toBe(false);
  });

  test("names the notification and what it is for", () => {
    const token: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
    });

    expect(JSONWebToken.decodeJsonPayload(token)).toMatchObject({
      purpose: ON_CALL_PAGE_LINK_TOKEN_PURPOSE,
      notification: NOTIFICATION.toString(),
    });
  });

  test("lasts a week", () => {
    const token: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
    });
    const payload: Record<string, unknown> = JSONWebToken.decodeJsonPayload(
      token,
    ) as Record<string, unknown>;

    expect(ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(Number(payload["exp"]) - Number(payload["iat"])).toBe(
      ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS,
    );
  });

  test("is refused once it has expired", () => {
    const token: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
    });

    const eightDaysLater: number = Date.now() + 8 * 24 * 60 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(eightDaysLater);

    expect(
      OnCallPageLinkToken.isValid({
        token: token,
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(false);
  });

  test("is refused when edited, even by one character", () => {
    const token: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
    });
    const last: string = token.slice(-1);
    const edited: string = token.slice(0, -1) + (last === "A" ? "B" : "A");

    expect(
      OnCallPageLinkToken.isValid({
        token: edited,
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(false);
  });

  test("a token OneUptime signed for something else is no page token", () => {
    // A sign-in's, say, or a call's keypad answer: signed, but not for this.
    const otherPurpose: string = JSONWebToken.signJsonPayload(
      { notification: NOTIFICATION.toString(), purpose: "sign-in" },
      3600,
    );
    const callAnswer: string = JSONWebToken.signJsonPayload(
      { "1": { sayMessage: "You have acknowledged this alert." } },
      3600,
    );

    for (const token of [otherPurpose, callAnswer]) {
      expect(
        OnCallPageLinkToken.isValid({
          token: token,
          userOnCallLogTimelineId: NOTIFICATION,
        }),
      ).toBe(false);
    }
  });

  test("is refused when missing, not text, empty or absurdly long", () => {
    for (const token of [undefined, null, 42, ["a"], "", "x".repeat(5000)]) {
      expect(
        OnCallPageLinkToken.isValid({
          token: token,
          userOnCallLogTimelineId: NOTIFICATION,
        }),
      ).toBe(false);
    }
  });

  test("a garbled token is refused, not thrown", () => {
    expect(
      OnCallPageLinkToken.isValid({
        token: "not.a.token",
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(false);
  });
});

describe("the links that carry it", () => {
  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.example.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
  });

  function tokenOf(url: URL): string | null {
    return url.getQueryParam(ON_CALL_PAGE_LINK_TOKEN_PARAM);
  }

  test("the acknowledge page: the page every message's Acknowledge opens, with the token", async () => {
    const url: URL = await OnCallPageLinks.getAcknowledgePageUrl(NOTIFICATION);
    const parsed: globalThis.URL = new globalThis.URL(url.toString());

    expect(parsed.origin).toBe("https://oneuptime.example.com");
    expect(parsed.pathname).toBe(
      `/api/user-notification-log-timeline/acknowledge-page/${NOTIFICATION.toString()}`,
    );
    expect(
      OnCallPageLinkToken.isValid({
        token: tokenOf(url),
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(true);
  });

  test("the pass-on page, with the token", async () => {
    const url: URL = await OnCallPageLinks.getPassOnPageUrl(NOTIFICATION);
    const parsed: globalThis.URL = new globalThis.URL(url.toString());

    expect(parsed.pathname).toBe(
      `/api/user-notification-log-timeline/pass-on-page/${NOTIFICATION.toString()}`,
    );
    expect(
      OnCallPageLinkToken.isValid({
        token: parsed.searchParams.get(ON_CALL_PAGE_LINK_TOKEN_PARAM),
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(true);
  });

  test("where the pass-on button posts: no token in the address - it rides in the form", async () => {
    const url: URL = await OnCallPageLinks.getPassOnUrl(NOTIFICATION);
    const parsed: globalThis.URL = new globalThis.URL(url.toString());

    expect(parsed.pathname).toBe(
      `/api/user-notification-log-timeline/pass-on/${NOTIFICATION.toString()}`,
    );
    expect(parsed.search).toBe("");
  });

  test("where a call sends its key press, with the token", async () => {
    const url: URL = await OnCallPageLinks.getCallResponseUrl(NOTIFICATION);
    const parsed: globalThis.URL = new globalThis.URL(url.toString());

    expect(parsed.pathname).toBe(
      `/api/user-notification-log-timeline/call/gather-input/${NOTIFICATION.toString()}`,
    );
    expect(
      OnCallPageLinkToken.isValid({
        token: tokenOf(url),
        userOnCallLogTimelineId: NOTIFICATION,
      }),
    ).toBe(true);
  });

  test("the acknowledge address itself is the one it always was", async () => {
    const url: URL = await OnCallPageLinks.getAcknowledgeUrl(NOTIFICATION);

    expect(new globalThis.URL(url.toString()).pathname).toBe(
      `/api/user-notification-log-timeline/acknowledge/${NOTIFICATION.toString()}`,
    );
  });

  test("each notification's links carry its own token", async () => {
    const mine: URL = await OnCallPageLinks.getPassOnPageUrl(NOTIFICATION);

    expect(
      OnCallPageLinkToken.isValid({
        token: tokenOf(mine),
        userOnCallLogTimelineId: OTHER_NOTIFICATION,
      }),
    ).toBe(false);
  });
});
