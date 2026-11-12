import ChannelVerification, {
  ChannelVerificationMessages,
  ChannelVerificationOutcome,
  SEND_FAILURE_NOT_EXPLAINED,
} from "../../../Server/Utils/ChannelVerification";
import {
  getAccountAlreadyExistsMessage,
  INCOMPLETE_RESET_LINK_MESSAGE,
  INCOMPLETE_VERIFICATION_LINK_MESSAGE,
  TWO_FACTOR_MESSAGES,
} from "../../../Types/Accounts/SignInMessages";
import {
  isEmptyErrorPhrase,
  meetsErrorMessageRule,
} from "../../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";

/*
 * The first-hour refusals kept as constants (#6836). ErrorMessagesGuard reads
 * the messages written where they are thrown; these are named once and
 * thrown from several routes, so they are held to the rule here: a
 * sentence, more than an empty phrase, and - for each - what to do next.
 */

const SIGN_IN: Record<string, string> = {
  ...TWO_FACTOR_MESSAGES,
  incompleteVerificationLink: INCOMPLETE_VERIFICATION_LINK_MESSAGE,
  incompleteResetLink: INCOMPLETE_RESET_LINK_MESSAGE,
  accountExists: getAccountAlreadyExistsMessage("ana@example.com"),
};

const VERIFY: Record<string, string> = {
  ...ChannelVerificationMessages,
  sendFailureNotExplained: SEND_FAILURE_NOT_EXPLAINED,
};

describe("every first-hour constant meets the rule", () => {
  test.each(Object.entries({ ...SIGN_IN, ...VERIFY }))(
    "%s",
    (_name: string, message: string) => {
      expect(meetsErrorMessageRule(message)).toBe(true);
      expect(isEmptyErrorPhrase(message)).toBe(false);
    },
  );

  test("none names an internal field or says only 'invalid'", () => {
    for (const message of Object.values({ ...SIGN_IN, ...VERIFY })) {
      expect(message).not.toMatch(/\b(itemId|userId|ID\b|Invalid)\b/);
    }
  });
});

describe("signing in says what to do next", () => {
  test("a wrong authenticator code: the code the app shows now", () => {
    expect(TWO_FACTOR_MESSAGES.wrongCode).toContain("authenticator app");
  });

  test("a backup code: one answer for wrong and used, so a list cannot be checked", () => {
    expect(TWO_FACTOR_MESSAGES.wrongBackupCode).toContain("already used");
    expect(TWO_FACTOR_MESSAGES.wrongBackupCode).toContain("not right");
  });

  test("an address that already has an account: sign in, or reset the password", () => {
    const message: string = getAccountAlreadyExistsMessage("ana@example.com");

    expect(message).toContain("ana@example.com");
    expect(message).toContain("Sign in");
    expect(message).toContain("reset your password");
  });

  test("a link that lost its token: open it again, or ask for a new one", () => {
    expect(INCOMPLETE_VERIFICATION_LINK_MESSAGE).toContain("Open the link");
    expect(INCOMPLETE_RESET_LINK_MESSAGE).toContain("Forgot Password");
  });
});

describe("verifying a notification method says what to do next", () => {
  test("a wrong code: the latest message's code, or a new one", () => {
    expect(
      ChannelVerification.getFailureException(
        ChannelVerificationOutcome.IncorrectCode,
      ).message,
    ).toBe(ChannelVerificationMessages.incorrectCode);
  });

  test("somebody else's row is answered exactly like a missing one", () => {
    const missing: string = ChannelVerification.getFailureException(
      ChannelVerificationOutcome.NotFound,
    ).message;

    expect(
      ChannelVerification.getFailureException(
        ChannelVerificationOutcome.NotOwner,
      ).message,
    ).toBe(missing);
    expect(
      ChannelVerification.getFailureException(
        ChannelVerificationOutcome.NotProjectMember,
      ).message,
    ).toBe(missing);
  });

  test("a row already verified: nothing left to do", () => {
    expect(
      ChannelVerification.getFailureException(
        ChannelVerificationOutcome.AlreadyVerified,
      ).message,
    ).toBe(ChannelVerificationMessages.alreadyVerified);
  });

  test("a send nobody explained is not 'Something went wrong'", () => {
    expect(SEND_FAILURE_NOT_EXPLAINED.toLowerCase()).not.toContain(
      "something went wrong",
    );
  });
});
