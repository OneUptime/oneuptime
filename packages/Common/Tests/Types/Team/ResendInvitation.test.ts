import BadDataException from "../../../Types/Exception/BadDataException";
import { meetsErrorMessageRule } from "../../../Types/Exception/ErrorMessageRule";
import ObjectID from "../../../Types/ObjectID";
import {
  RESEND_INVITATION_LOCK_TIMEOUT_IN_MS,
  RESEND_INVITATION_REFUSALS,
  RESEND_INVITATION_ROUTE_END,
  RESEND_INVITATION_SEND_TIMEOUT_IN_MS,
  TEAM_MEMBER_ROUTE,
  getInvitationMayNotBeResentMessage,
  getInvitationNotResentMessage,
  getResendInvitationRoute,
  readResendInvitationTeamMemberId,
  readResentInvitation,
  toResentInvitationJSON,
} from "../../../Types/Team/ResendInvitation";
import { describe, expect, test } from "@jest/globals";

/*
 * Resend Invitation's route, its answer and its refusals (#9519), read the
 * same way by the server and the dashboards.
 */

const MEMBERSHIP: string = "95230000-0000-4000-8000-000000000001";

describe("the route", () => {
  test("is under the team member route, after the membership's id", () => {
    expect(TEAM_MEMBER_ROUTE).toBe("/team-member");
    expect(RESEND_INVITATION_ROUTE_END).toBe("/resend-invitation");
    expect(getResendInvitationRoute(MEMBERSHIP)).toBe(
      `/team-member/${MEMBERSHIP}/resend-invitation`,
    );
    expect(getResendInvitationRoute(new ObjectID(MEMBERSHIP))).toBe(
      `/team-member/${MEMBERSHIP}/resend-invitation`,
    );
  });

  test("names a membership by its id, or is refused", () => {
    expect(readResendInvitationTeamMemberId(` ${MEMBERSHIP} `).toString()).toBe(
      MEMBERSHIP,
    );

    for (const value of [
      undefined,
      "",
      "not-an-id",
      "'; DROP TABLE TeamMember; --",
      42,
      [MEMBERSHIP],
    ]) {
      expect(() => {
        return readResendInvitationTeamMemberId(value);
      }).toThrow(BadDataException);
    }
  });
});

describe("the wait", () => {
  test("the server waits for the mail service a short while, and holds the person's invitation a little longer", () => {
    expect(RESEND_INVITATION_SEND_TIMEOUT_IN_MS).toBe(30 * 1000);
    expect(RESEND_INVITATION_LOCK_TIMEOUT_IN_MS).toBeGreaterThan(
      RESEND_INVITATION_SEND_TIMEOUT_IN_MS,
    );
  });
});

describe("the answer", () => {
  test("is the address it went to, read back as sent", () => {
    expect(toResentInvitationJSON({ email: "grace@example.com" })).toEqual({
      email: "grace@example.com",
    });
    expect(
      readResentInvitation(
        toResentInvitationJSON({ email: "grace@example.com" }),
      ),
    ).toEqual({ email: "grace@example.com" });
  });

  test.each([
    ["nothing", undefined],
    ["a list", ["grace@example.com"]],
    ["no address", {}],
    ["an address of spaces", { email: "   " }],
    ["an address that is no text", { email: { value: "x" } }],
  ])("of %s names no address", (_case: string, data: unknown) => {
    expect(readResentInvitation(data)).toBeNull();
  });
});

describe("the refusals", () => {
  test.each(Object.entries(RESEND_INVITATION_REFUSALS))(
    "%s is a sentence that says what happened and what to do",
    (_name: string, message: string) => {
      expect(meetsErrorMessageRule(message)).toBe(true);
    },
  );

  test("a server with no email set up sends anybody to its admin, and a master admin where to set it up", () => {
    expect(RESEND_INVITATION_REFUSALS.emailNotSetUp).toContain(
      "Ask your server's admin to set up email.",
    );
    expect(RESEND_INVITATION_REFUSALS.emailNotSetUpForMasterAdmin).toContain(
      "Set up email in the Admin Dashboard",
    );
    expect(
      RESEND_INVITATION_REFUSALS.emailNotSetUpForMasterAdmin,
    ).not.toContain("server's admin");
  });

  test("the mail service's refusal is said in OneUptime's words first, then its own", () => {
    const message: string = getInvitationNotResentMessage({
      email: "grace@example.com",
      reason: " 550 Mailbox unavailable ",
    });

    expect(message).toBe(
      "The invitation email to grace@example.com was not sent. 550 Mailbox unavailable",
    );
    // OneUptime's own sentence, whole, before the mail service's words.
    expect(
      meetsErrorMessageRule(
        "The invitation email to grace@example.com was not sent.",
      ),
    ).toBe(true);
    // As the guard reads a message with a value after its full stop.
    expect(
      meetsErrorMessageRule(
        "The invitation email to ${value} was not sent. ${value}",
      ),
    ).toBe(true);
  });

  test("a refusal that says nothing sends the reader to the Email Logs", () => {
    expect(
      getInvitationNotResentMessage({ email: "grace@example.com", reason: "" }),
    ).toBe(
      "The invitation email to grace@example.com was not sent. Check the Email tab of the project's Notification Logs to see why.",
    );
  });

  test("no answer in time tells nobody it was or was not sent", () => {
    const message: string = getInvitationMayNotBeResentMessage({
      email: "grace@example.com",
    });

    expect(message).toContain("may not have been sent");
    expect(message).toContain("before you send it again");
    expect(meetsErrorMessageRule(message)).toBe(true);
  });
});
