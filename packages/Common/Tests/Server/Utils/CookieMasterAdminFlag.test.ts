import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressResponse } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import User from "../../../Models/DatabaseModels/User";
import CookieName from "../../../Types/CookieName";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE BROWSER'S MASTER ADMIN FLAG FOLLOWS THE ACCOUNT AT EVERY SIGN-IN AND
 * EVERY RENEWAL.
 *
 * Next to the session, a sign-in leaves a cookie the dashboards read to show
 * a master admin's links and settings (CookieName.IsMasterAdmin, read by
 * UserUtil.isMasterAdmin; the server never trusts it). It lasted 30 days and
 * was only ever set: a browser that last signed in as a master admin whose
 * access was removed kept showing the Admin Dashboard's link, and settings
 * the server now refuses, for a month. Every sign-in and every renewal
 * (/refresh-token, at most 15 minutes apart) writes it from the account as
 * it is: set for a master admin, taken away for everyone else.
 */

const USER_ID: ObjectID = new ObjectID("53535353-5353-4353-8353-535353535353");
const SESSION_ID: ObjectID = new ObjectID(
  "54545454-5454-4454-8454-545454545454",
);

function account(isMasterAdmin: boolean): User {
  const user: User = new User();
  user.id = USER_ID;
  user.email = new Email("someone@example.com");
  user.name = new Name("Someone");
  user.isMasterAdmin = isMasterAdmin;
  return user;
}

interface Written {
  set: Record<string, { value: string; options: JSONObject }>;
  cleared: Array<{ name: string; options: JSONObject }>;
}

function signIn(isMasterAdmin: boolean): Written {
  const written: Written = { set: {}, cleared: [] };

  const response: ExpressResponse = {
    cookie: jest.fn((name: string, value: string, options: JSONObject) => {
      written.set[name] = { value, options };
    }),
    clearCookie: jest.fn((name: string, options: JSONObject) => {
      written.cleared.push({ name, options });
    }),
  } as unknown as ExpressResponse;

  CookieUtil.setUserCookie({
    expressResponse: response,
    user: account(isMasterAdmin),
    isGlobalLogin: true,
    sessionId: SESSION_ID,
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });

  return written;
}

describe("CookieUtil.setUserCookie - the master admin flag", () => {
  test("is set for a master admin, for the dashboards to read", () => {
    const written: Written = signIn(true);

    expect(written.set[CookieName.IsMasterAdmin]).toEqual({
      value: "true",
      options: {
        path: "/",
        sameSite: "lax",
        maxAge: OneUptimeDate.getMillisecondsInDays(30),
        httpOnly: false,
      },
    });
    expect(
      written.cleared.map((cleared: { name: string }): string => {
        return cleared.name;
      }),
    ).not.toContain(CookieName.IsMasterAdmin);
  });

  /*
   * Someone whose master admin access was removed: their next renewal takes
   * the flag away, so the dashboards stop showing what the server refuses.
   */
  test("is taken away for anyone else, as a browser may hold it from before", () => {
    const written: Written = signIn(false);

    expect(written.set[CookieName.IsMasterAdmin]).toBeUndefined();
    expect(written.cleared).toEqual([
      {
        name: CookieName.IsMasterAdmin,
        options: { path: "/", sameSite: "lax" },
      },
    ]);
  });

  // The flag and the session it comes with say the same thing.
  test.each([true, false])(
    "matches what the session's access token says, for a master admin: %s",
    (isMasterAdmin: boolean) => {
      const written: Written = signIn(isMasterAdmin);
      const token: string = written.set[CookieUtil.getUserTokenKey()]!.value;

      expect(JSONWebToken.decodeJsonPayload(token)["isMasterAdmin"]).toBe(
        isMasterAdmin,
      );
      expect(Boolean(written.set[CookieName.IsMasterAdmin])).toBe(
        isMasterAdmin,
      );
    },
  );
});
