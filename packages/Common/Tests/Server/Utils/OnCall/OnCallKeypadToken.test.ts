import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import CustomChannelActionToken from "../../../../Server/Utils/OnCall/CustomChannelActionToken";
import OnCallKeypadToken, {
  ON_CALL_KEYPAD_TOKEN_EXPIRES_IN_SECONDS,
  ON_CALL_KEYPAD_TOKEN_PARAM,
  ON_CALL_KEYPAD_TOKEN_PURPOSE,
  OnCallKeypadTokenReading,
  OnCallKeypadTokenRefusal,
  getOnCallKeypadTokenRefusalSentence,
} from "../../../../Server/Utils/OnCall/OnCallKeypadToken";
import OnCallPageLinkToken from "../../../../Server/Utils/OnCall/OnCallPageLinkToken";
import { OnCallInputRequest } from "../../../../Types/Call/CallRequest";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * THE TOKEN A KEY PRESSED ON AN ON-CALL CALL CARRIES (#10025).
 *
 * A call's <Gather> posts the key to the keypad route with the call's own
 * token: what each key answers, and the one notification the call was
 * placed for. These pin what it accepts and refuses - as the keypad route
 * reads it, from the claims NotificationMiddleware verified - and the
 * window a call placed before this release is still taken in: while its
 * call token lasts, a day, and bound to its page by the page link token
 * its earlier address carried.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fb00000-0000-4000-8000-000000000001",
);
const OTHER_NOTIFICATION: ObjectID = new ObjectID(
  "0fb00000-0000-4000-8000-000000000002",
);

const ANSWERS: OnCallInputRequest = {
  "1": { sayMessage: "You have acknowledged this incident. Good bye" },
  default: { sayMessage: "Invalid input. Good bye" },
};

const DAY_MS: number = 24 * 60 * 60 * 1000;

// The claims of a token, as NotificationMiddleware hands them to the route.
function claimsOf(token: string): JSONObject {
  return JSONFunctions.deserialize(JSONWebToken.decodeJsonPayload(token));
}

// A call token as calls placed before this release signed it.
function earlierCallToken(
  lifetimeInSeconds: number = OneUptimeDate.getDayInSeconds(),
): string {
  return JSONWebToken.signJsonPayload(
    JSONFunctions.serialize(ANSWERS as unknown as JSONObject),
    lifetimeInSeconds,
  );
}

// An earlier call's token, signed `ms` ago.
function signedAgo(ms: number): string {
  const clock: jest.SpyInstance = jest
    .spyOn(Date, "now")
    .mockReturnValue(Date.now() - ms);

  const token: string = earlierCallToken();

  clock.mockRestore();

  return token;
}

function pageTokenFor(notification: ObjectID): string {
  return OnCallPageLinkToken.sign({ userOnCallLogTimelineId: notification });
}

function read(
  claims: JSONObject,
  pageToken?: unknown,
  notification: ObjectID = NOTIFICATION,
): OnCallKeypadTokenReading {
  return OnCallKeypadToken.read({
    claims: claims,
    userOnCallLogTimelineId: notification,
    pageToken: pageToken,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a call's keypad token, as this release signs it", () => {
  test("names its purpose, its notification and what each key answers", () => {
    const claims: JSONObject = claimsOf(
      OnCallKeypadToken.sign({
        userOnCallLogTimelineId: NOTIFICATION,
        answers: ANSWERS,
      }),
    );

    expect(claims["purpose"]).toBe(ON_CALL_KEYPAD_TOKEN_PURPOSE);
    expect(claims["notification"]).toBe(NOTIFICATION.toString());
    expect(claims).toMatchObject(ANSWERS as unknown as JSONObject);
    expect(ON_CALL_KEYPAD_TOKEN_PARAM).toBe("token");
  });

  test("keeps what each key answers where a call token always held it: a keypad route of the release before reads it there while an upgrade rolls out", () => {
    const claims: JSONObject = claimsOf(
      OnCallKeypadToken.sign({
        userOnCallLogTimelineId: NOTIFICATION,
        answers: ANSWERS,
      }),
    );

    expect((claims["1"] as JSONObject)["sayMessage"]).toBe(
      "You have acknowledged this incident. Good bye",
    );
    expect((claims["default"] as JSONObject)["sayMessage"]).toBe(
      "Invalid input. Good bye",
    );
  });

  test("leaves the answers it is handed as they were", () => {
    const answers: OnCallInputRequest = JSON.parse(JSON.stringify(ANSWERS));

    OnCallKeypadToken.sign({
      userOnCallLogTimelineId: NOTIFICATION,
      answers: answers,
    });

    expect(answers).toEqual(ANSWERS);
  });

  test("lasts a day, as a call's token always has", () => {
    const claims: JSONObject = claimsOf(
      OnCallKeypadToken.sign({
        userOnCallLogTimelineId: NOTIFICATION,
        answers: ANSWERS,
      }),
    );

    expect(ON_CALL_KEYPAD_TOKEN_EXPIRES_IN_SECONDS).toBe(24 * 60 * 60);
    expect(Number(claims["exp"]) - Number(claims["iat"])).toBe(
      ON_CALL_KEYPAD_TOKEN_EXPIRES_IN_SECONDS,
    );
  });

  test("takes the notification's id as text too: the Notification service reads it from JSON", () => {
    const claims: JSONObject = claimsOf(
      OnCallKeypadToken.sign({
        userOnCallLogTimelineId: NOTIFICATION.toString(),
        answers: ANSWERS,
      }),
    );

    expect(claims["notification"]).toBe(NOTIFICATION.toString());
  });

  test("is accepted for the notification it names, with what each key answers", () => {
    const reading: OnCallKeypadTokenReading = read(
      claimsOf(
        OnCallKeypadToken.sign({
          userOnCallLogTimelineId: NOTIFICATION,
          answers: ANSWERS,
        }),
      ),
    );

    expect(reading).toEqual({
      isAccepted: true,
      answers: expect.objectContaining(ANSWERS),
      isEarlierCall: false,
    });
  });

  test("needs no page link token: the address carries none", () => {
    const claims: JSONObject = claimsOf(
      OnCallKeypadToken.sign({
        userOnCallLogTimelineId: NOTIFICATION,
        answers: ANSWERS,
      }),
    );

    for (const pageToken of [undefined, "", "nonsense"]) {
      expect(read(claims, pageToken).isAccepted).toBe(true);
    }
  });

  test("is refused for any other notification: a key press cannot be moved to another page", () => {
    const reading: OnCallKeypadTokenReading = read(
      claimsOf(
        OnCallKeypadToken.sign({
          userOnCallLogTimelineId: NOTIFICATION,
          answers: ANSWERS,
        }),
      ),
      // Even with the other page's own link token beside it.
      pageTokenFor(OTHER_NOTIFICATION),
      OTHER_NOTIFICATION,
    );

    expect(reading).toEqual({
      isAccepted: false,
      refusal: OnCallKeypadTokenRefusal.OtherNotification,
    });
  });

  test("a call placed for no notification answers no page", () => {
    const reading: OnCallKeypadTokenReading = read(
      claimsOf(
        OnCallKeypadToken.sign({
          userOnCallLogTimelineId: undefined,
          answers: ANSWERS,
        }),
      ),
    );

    expect(reading).toEqual({
      isAccepted: false,
      refusal: OnCallKeypadTokenRefusal.OtherNotification,
    });
  });

  test("compares the notification's id without regard to case", () => {
    const claims: JSONObject = claimsOf(
      OnCallKeypadToken.sign({
        userOnCallLogTimelineId: NOTIFICATION.toString().toUpperCase(),
        answers: ANSWERS,
      }),
    );

    expect(read(claims).isAccepted).toBe(true);
  });
});

describe("a token signed for anything else is no keypad token", () => {
  test("the page's own link token, which the earlier address carried", () => {
    // Signed for the very notification, and still refused as a call token.
    const reading: OnCallKeypadTokenReading = read(
      claimsOf(pageTokenFor(NOTIFICATION)),
      pageTokenFor(NOTIFICATION),
    );

    expect(reading).toEqual({
      isAccepted: false,
      refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
    });
  });

  test("a custom channel's action token", () => {
    const reading: OnCallKeypadTokenReading = read(
      claimsOf(
        CustomChannelActionToken.sign({
          userOnCallLogTimelineId: NOTIFICATION,
        }),
      ),
      pageTokenFor(NOTIFICATION),
    );

    expect(reading.isAccepted).toBe(false);
  });

  test("a token of another purpose, even one that names the notification and carries answers", () => {
    const claims: JSONObject = claimsOf(
      JSONWebToken.signJsonPayload(
        {
          ...JSONFunctions.serialize(ANSWERS as unknown as JSONObject),
          purpose: "sign-in",
          notification: NOTIFICATION.toString(),
        },
        3600,
      ),
    );

    expect(read(claims, pageTokenFor(NOTIFICATION))).toEqual({
      isAccepted: false,
      refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
    });
  });

  test("a keypad token whose answers are not answers: nothing for any other key", () => {
    for (const fallback of [undefined, null, "Good bye", { sayMessage: 42 }]) {
      const claims: JSONObject = claimsOf(
        JSONWebToken.signJsonPayload(
          {
            "1": ANSWERS["1"] as unknown as JSONObject,
            default: fallback as unknown as JSONObject,
            purpose: ON_CALL_KEYPAD_TOKEN_PURPOSE,
            notification: NOTIFICATION.toString(),
          },
          3600,
        ),
      );

      expect({ fallback, reading: read(claims) }).toEqual({
        fallback,
        reading: {
          isAccepted: false,
          refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
        },
      });
    }
  });

  test("no claims at all", () => {
    expect(
      read(undefined as unknown as JSONObject, pageTokenFor(NOTIFICATION))
        .isAccepted,
    ).toBe(false);
  });
});

/*
 * A CALL PLACED BEFORE THIS RELEASE. Its <Gather> action is the earlier
 * one: the page's link token, and a call token that says nothing of what
 * it is for and names no notification. Its call token lasts a day, and no
 * call of this release signs one like it, so these calls are taken for a
 * day after the upgrade at most - bound to their page by the link token
 * their address carries - and refused after.
 */
describe("a call placed before this release, while its call token lasts", () => {
  test("is taken with the page's link token in its address: what each key answers comes from its call token", () => {
    expect(
      read(claimsOf(earlierCallToken()), pageTokenFor(NOTIFICATION)),
    ).toEqual({
      isAccepted: true,
      answers: expect.objectContaining(ANSWERS),
      isEarlierCall: true,
    });
  });

  test("is refused without the page's link token: nothing binds it to the page", () => {
    for (const pageToken of [undefined, null, "", "nonsense", 42]) {
      expect({
        pageToken,
        reading: read(claimsOf(earlierCallToken()), pageToken),
      }).toEqual({
        pageToken,
        reading: {
          isAccepted: false,
          refusal: OnCallKeypadTokenRefusal.EarlierCallWithoutPageToken,
        },
      });
    }
  });

  test("is refused with another page's link token", () => {
    expect(
      read(claimsOf(earlierCallToken()), pageTokenFor(OTHER_NOTIFICATION)),
    ).toEqual({
      isAccepted: false,
      refusal: OnCallKeypadTokenRefusal.EarlierCallWithoutPageToken,
    });
  });

  test("a call placed 23 hours 59 minutes ago is still taken", () => {
    const token: string = signedAgo(DAY_MS - 60 * 1000);

    // Its signature and its expiry, as NotificationMiddleware checks them.
    expect(read(claimsOf(token), pageTokenFor(NOTIFICATION)).isAccepted).toBe(
      true,
    );
  });

  test("a call placed a day and a second ago is not: its call token has expired", () => {
    const token: string = signedAgo(DAY_MS + 1000);

    // NotificationMiddleware's check: the request never reaches the route.
    expect(() => {
      return JSONWebToken.decodeJsonPayload(token);
    }).toThrow();
  });

  test("a token that says nothing of its purpose but lives longer than a day is no call's", () => {
    // A page link token lives a week; nothing signed to outlive a call is one.
    for (const lifetime of [
      OneUptimeDate.getDayInSeconds() + 1,
      7 * OneUptimeDate.getDayInSeconds(),
    ]) {
      expect({
        lifetime,
        reading: read(
          claimsOf(earlierCallToken(lifetime)),
          pageTokenFor(NOTIFICATION),
        ),
      }).toEqual({
        lifetime,
        reading: {
          isAccepted: false,
          refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
        },
      });
    }
  });

  test("a token that says nothing of its purpose and carries no answers is no call's", () => {
    const claims: JSONObject = claimsOf(
      JSONWebToken.signJsonPayload({ data: "anything" }, 60),
    );

    expect(read(claims, pageTokenFor(NOTIFICATION))).toEqual({
      isAccepted: false,
      refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
    });
  });

  test("claims without the times a token is signed with are no call's either", () => {
    const claims: JSONObject = {
      ...(ANSWERS as unknown as JSONObject),
    };

    expect(read(claims, pageTokenFor(NOTIFICATION)).isAccepted).toBe(false);
  });
});

describe("why a key press is refused, for the server's log", () => {
  test("says why in a sentence, with no token in it", () => {
    for (const refusal of Object.values(OnCallKeypadTokenRefusal)) {
      const sentence: string = getOnCallKeypadTokenRefusalSentence(refusal);

      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).not.toMatch(/ey[A-Za-z0-9_-]{10,}/);
    }

    expect(
      getOnCallKeypadTokenRefusalSentence(
        OnCallKeypadTokenRefusal.OtherNotification,
      ),
    ).toBe("Its call token was signed for another notification.");
  });
});
