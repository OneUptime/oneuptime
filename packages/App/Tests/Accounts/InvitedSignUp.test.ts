import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import {
  isInvitedSignUp,
  shouldAskForCompanyDetails,
} from "../../FeatureSet/Accounts/src/Utils/InvitedSignUp";

/*
 * THE SIGN-UP OF SOMEBODY WHO WAS INVITED (issue #6807): email (locked),
 * name and password - no company name and no phone number, on OneUptime
 * Cloud and on a self-hosted server alike. Everybody else signs up as
 * before.
 */

const REGISTER: string = fs.readFileSync(
  nodePath.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Accounts",
    "src",
    "Pages",
    "Register.tsx",
  ),
  "utf8",
);

const INVITATION: { email: string; token: string } = {
  email: "grace@example.com",
  token: "a-claim-token",
};

describe("who signs up from an invitation", () => {
  test("an invitation link carries the email and its claim token", () => {
    expect(isInvitedSignUp(INVITATION)).toBe(true);
  });

  test("an email alone is not an invitation, nor a token alone, nor blanks", () => {
    expect(isInvitedSignUp({ email: INVITATION.email, token: null })).toBe(
      false,
    );
    expect(isInvitedSignUp({ email: null, token: INVITATION.token })).toBe(
      false,
    );
    expect(isInvitedSignUp({ email: " ", token: " " })).toBe(false);
    expect(isInvitedSignUp({ email: undefined, token: undefined })).toBe(false);
  });
});

describe("what the sign-up form asks", () => {
  test("somebody invited is not asked for a company or a phone", () => {
    expect(shouldAskForCompanyDetails({ isInvitedSignUp: true })).toBe(false);
  });

  test("everybody else is asked as before", () => {
    expect(shouldAskForCompanyDetails({ isInvitedSignUp: false })).toBe(true);
  });

  test("the form reads the invitation from its own address", () => {
    expect(REGISTER).toContain(
      'email: Navigation.getQueryStringByName("email")',
    );
    expect(REGISTER).toContain(
      'token: Navigation.getQueryStringByName("token")',
    );
  });

  test("on OneUptime Cloud, the company and phone fields are left out of an invited sign-up", () => {
    const cloud: number = REGISTER.indexOf(
      "if (BILLING_ENABLED && asksForCompanyDetails) {",
    );

    expect(cloud).toBeGreaterThan(-1);
    expect(REGISTER.indexOf("companyName: true", cloud)).toBeGreaterThan(
      cloud,
    );
    expect(REGISTER.indexOf("companyPhoneNumber: true", cloud)).toBeGreaterThan(
      cloud,
    );
  });

  test("on a self-hosted server, so are the optional company and phone", () => {
    const selfHosted: number = REGISTER.indexOf(
      "if (!BILLING_ENABLED && asksForCompanyDetails) {",
    );

    expect(selfHosted).toBeGreaterThan(-1);
    expect(
      REGISTER.indexOf("selfHostedCompanyName: true", selfHosted),
    ).toBeGreaterThan(selfHosted);
    expect(
      REGISTER.indexOf("selfHostedPhoneNumber: true", selfHosted),
    ).toBeGreaterThan(selfHosted);
  });

  test("no company or phone field is added anywhere else", () => {
    for (const field of [
      "companyName: true",
      "companyPhoneNumber: true",
      "selfHostedCompanyName: true",
      "selfHostedPhoneNumber: true",
    ]) {
      expect(REGISTER.split(field)).toHaveLength(2);
    }
  });
});
