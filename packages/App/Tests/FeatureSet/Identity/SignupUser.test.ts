import SignupUser, {
  SIGNUP_USER_COLUMNS,
} from "../../../FeatureSet/Identity/Utils/SignupUser";
import User from "Common/Models/DatabaseModels/User";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { JSONObject } from "Common/Types/JSON";
import {
  UtmPropertyKeys,
  UtmUrlPropertyKey,
} from "Common/Types/Marketing/Attribution";
import Permission from "Common/Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * /signup builds the new User from an allow-list, not from the whole body.
 *
 * The create runs as root, which skips column create permissions, so every
 * column in the body used to be written. The one that mattered most was the
 * primary key: an `_id` (or `id`) naming an existing user turned the INSERT
 * into an UPDATE of that user's row -- email and password included -- which is
 * an account takeover for anybody who knows a user id. See
 * Common/Tests/Server/Services/UserSignupIdTakeoverPostgres.test.ts for that
 * against a real table, and SignupMassAssignment.test.ts for the route.
 * ---------------------------------------------------------------------------
 */

const VICTIM_ID: string = "33333333-3333-4333-8333-333333333333";

// What the Register page posts, in the wire format ModelForm serializes to.
const registerPageBody: JSONObject = {
  email: { _type: "Email", value: "new-user@example.com" },
  name: { _type: "Name", value: "New User" },
  password: { _type: "HashedString", value: "correct-horse-battery-staple" },
  companyName: "Example Inc",
  companyPhoneNumber: { _type: "Phone", value: "+11234567890" },
  utmSource: "newsletter",
  utmMedium: "email",
  utmCampaign: "launch",
  utmTerm: "uptime",
  utmContent: "cta",
  utmId: "abc123",
  utmSourcePlatform: "google",
  utmCreativeFormat: "banner",
  utmMarketingTactic: "prospecting",
  utmUrl: "https://oneuptime.com/?utm_source=newsletter",
  clickIds: { gclid: "gclid-value" },
  firstTouchAttribution: { utmSource: "newsletter" },
};

/*
 * Columns a signup must never set, each with a value an attacker would send.
 * Several of these are `create: []` on the model and were written only because
 * the create runs as root.
 */
const privilegedBody: JSONObject = {
  _id: VICTIM_ID,
  isMasterAdmin: true,
  isEmailVerified: true,
  isBlocked: true,
  isDisabled: true,
  twoFactorAuthEnabled: true,
  enableTwoFactorAuth: true,
  resetPasswordToken: "attacker-chosen-reset-token",
  resetPasswordExpires: "2099-01-01T00:00:00.000Z",
  paymentProviderCustomerId: "cus_attacker",
  paymentFailedDate: "2099-01-01T00:00:00.000Z",
  promotionName: "free-forever",
  slug: "someone-elses-slug",
  passwordSalt: "attacker-chosen-salt",
  timezone: "Europe/London",
  lastActive: "2099-01-01T00:00:00.000Z",
  profilePictureId: "44444444-4444-4444-8444-444444444444",
  createdByUserId: "55555555-5555-4555-8555-555555555555",
  deletedByUserId: "55555555-5555-4555-8555-555555555555",
  newUnverifiedTemporaryEmail: {
    _type: "Email",
    value: "victim@example.com",
  },
  webauthnRegistrationChallenge: "attacker-challenge",
  webauthnAuthenticationChallenge: "attacker-challenge",
  alertPhoneVerificationCode: "123456",
  tempAlertPhoneNumber: "+19999999999",
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
  deletedAt: "2000-01-01T00:00:00.000Z",
  version: 99,
};

type SetColumnsFunction = (user: User) => Array<string>;

// Every column the built model would hand to the INSERT.
const setColumns: SetColumnsFunction = (user: User): Array<string> => {
  return user.getTableColumns().columns.filter((column: string) => {
    return (user as unknown as JSONObject)[column] !== undefined;
  });
};

describe("SignupUser.fromRequestData", () => {
  it("drops an `_id` naming another user", () => {
    const user: User = SignupUser.fromRequestData({
      ...registerPageBody,
      _id: VICTIM_ID,
    });

    expect(user._id).toBeUndefined();
    expect(user.id).toBeNull();
  });

  it("drops an `id` naming another user, which fromJSON would map onto `_id`", () => {
    const user: User = SignupUser.fromRequestData({
      ...registerPageBody,
      id: VICTIM_ID,
    });

    expect(user._id).toBeUndefined();
    expect(user.id).toBeNull();
  });

  it("drops every privileged column in the body", () => {
    const user: User = SignupUser.fromRequestData({
      ...registerPageBody,
      ...privilegedBody,
    });

    for (const column of Object.keys(privilegedBody)) {
      expect({
        column,
        value: (user as unknown as JSONObject)[column],
      }).toEqual({ column, value: undefined });
    }
  });

  it("never sets a column outside the allow-list, whatever the body holds", () => {
    const user: User = SignupUser.fromRequestData({
      ...registerPageBody,
      ...privilegedBody,
      profilePictureFile: { _id: "44444444-4444-4444-8444-444444444444" },
      createdByUser: { _id: "55555555-5555-4555-8555-555555555555" },
    });

    for (const column of setColumns(user)) {
      expect(SIGNUP_USER_COLUMNS).toContain(column);
    }
  });

  it("keeps everything the Register page sends", () => {
    const user: User = SignupUser.fromRequestData({
      ...registerPageBody,
      ...privilegedBody,
    });

    expect(user.email?.toString()).toBe("new-user@example.com");
    expect(user.name?.toString()).toBe("New User");
    expect(user.password?.toString()).toBe("correct-horse-battery-staple");
    expect(user.companyName).toBe("Example Inc");
    expect(user.companyPhoneNumber?.toString()).toBe("+11234567890");
    expect(user.utmSource).toBe("newsletter");
    expect(user.utmId).toBe("abc123");
    expect(user.utmMarketingTactic).toBe("prospecting");
    expect(user.utmUrl).toBe("https://oneuptime.com/?utm_source=newsletter");
    expect(user.clickIds).toEqual({ gclid: "gclid-value" });
    expect(user.firstTouchAttribution).toEqual({ utmSource: "newsletter" });

    expect(setColumns(user).sort()).toEqual(
      Object.keys(registerPageBody).sort(),
    );
  });

  it("keeps the descriptive columns the model lets anybody create", () => {
    const user: User = SignupUser.fromRequestData({
      jobRole: "Engineer",
      companySize: "1-10",
      referral: "a friend",
    });

    expect(user.jobRole).toBe("Engineer");
    expect(user.companySize).toBe("1-10");
    expect(user.referral).toBe("a friend");
  });

  it("does not copy inherited keys such as __proto__", () => {
    const body: JSONObject = JSON.parse(
      '{"email":"new-user@example.com","__proto__":{"_id":"' +
        VICTIM_ID +
        '","isMasterAdmin":true}}',
    ) as JSONObject;

    const user: User = SignupUser.fromRequestData(body);

    expect(user._id).toBeUndefined();
    expect(user.isMasterAdmin).toBeUndefined();
    expect(setColumns(user)).toEqual(["email"]);
  });

  it.each([undefined, null, "a string", ["email"], 42])(
    "returns an empty user for a body of %p, leaving the route's email check to reject it",
    (data: unknown) => {
      const user: User = SignupUser.fromRequestData(data);

      expect(setColumns(user)).toEqual([]);
    },
  );
});

describe("SIGNUP_USER_COLUMNS", () => {
  it("never includes the primary key", () => {
    expect(SIGNUP_USER_COLUMNS).not.toContain("_id");
    expect(SIGNUP_USER_COLUMNS).not.toContain("id");
  });

  it("only lists columns the User model already lets anybody create", () => {
    /*
     * The allow-list must never grant more than the model does. A column that
     * is `create: []` (isMasterAdmin, isEmailVerified, resetPasswordToken, ...)
     * belongs to the server, and adding one here would hand it to anybody who
     * can reach /signup.
     */
    const user: User = new User();

    for (const column of SIGNUP_USER_COLUMNS) {
      const accessControl: ColumnAccessControl | null =
        user.getColumnAccessControlFor(column);

      expect({ column, isColumn: user.hasColumn(column) }).toEqual({
        column,
        isColumn: true,
      });
      expect({
        column,
        publicCreate: accessControl?.create.includes(Permission.Public),
      }).toEqual({ column, publicCreate: true });
    }
  });

  it("accepts every UTM key in the shared attribution contract", () => {
    /*
     * The Register page posts whatever keys that contract lists. A key missing
     * here would be dropped on arrival with no error -- how utm_id and its
     * siblings were once lost at signup.
     */
    for (const column of [...UtmPropertyKeys, UtmUrlPropertyKey]) {
      expect(SIGNUP_USER_COLUMNS).toContain(column);
    }
  });
});
