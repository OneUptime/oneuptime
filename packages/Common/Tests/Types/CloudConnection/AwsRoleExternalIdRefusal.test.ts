import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import { getRoleWithoutExternalIdMessage } from "../../../Server/Utils/CloudConnection/Aws/AwsSts";
import {
  AWS_EXTERNAL_ID_CONDITION_SHAPE,
  AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL,
  AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS,
  isAwsRoleWithoutExternalIdRefusal,
  readAwsRoleWithoutExternalIdCondition,
} from "../../../Types/CloudConnection/AwsRoleExternalIdRefusal";
import {
  AWS_EXTERNAL_ID_DIGITS,
  formatAwsExternalId,
  getAwsExternalIdConditionText,
  getAwsExternalIdForProject,
  getAwsRoleSetupCommand,
  getAwsTrustPolicyDocument,
} from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { getRefusalText } from "../../../Types/Exception/RefusalWithValues";
import { Translator } from "../../../Types/Translator";
import { sayErrorMessage } from "../../../UI/Utils/ErrorInSentence";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * AN AWS ROLE THAT LETS ONEUPTIME IN WITHOUT THE PROJECT'S EXTERNAL ID, IN
 * THE READER'S LANGUAGE (#10425).
 *
 * The server refuses such a role in English, naming the condition to add
 * as the setup command's trust policy writes it (#10405). The sentence is a
 * key of the Dashboard's locales with the condition as its value, so the
 * Dashboard reads the condition back out of the English and says the
 * sentence in the reader's language around it, word for word: the exact
 * condition, with the project's own external id, in every language. Any
 * other message is not taken for it.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT: string = "22222222-2222-4222-8222-222222222222";
const CONDITION: string = getAwsExternalIdConditionText(
  getAwsExternalIdForProject(PROJECT),
);

// The refusal as #10410 sent it, word for word.
const AS_SENT_BEFORE: (condition: string) => string = (
  condition: string,
): string => {
  return `This role lets OneUptime sign in without your project's external ID, so any project that knows its ARN could read your AWS account through OneUptime. OneUptime does not use it until its trust policy requires the external ID: add ${condition} to the statement that trusts OneUptime, or run the setup command again and connect the role it prints.`;
};

const LANGUAGES: ReadonlyArray<string> = DASHBOARD_LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

describe("the refusal the server sends", () => {
  test("is the sentence with the project's own condition, word for word what it said before", () => {
    const message: string = getRoleWithoutExternalIdMessage(PROJECT);

    expect(message).toBe(AS_SENT_BEFORE(CONDITION));
    expect(message).toBe(
      getRefusalText(AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL, {
        condition: CONDITION,
      }),
    );
    expect(message).not.toContain(getAwsExternalIdForProject(OTHER_PROJECT));
  });

  test("names the condition the setup command's trust policy writes", () => {
    const setup: { trustedPrincipalArn: string; externalId: string } = {
      trustedPrincipalArn: "arn:aws:iam::999988887777:root",
      externalId: getAwsExternalIdForProject(PROJECT),
    };

    expect(getAwsTrustPolicyDocument(setup)).toContain(CONDITION);
    expect(getAwsRoleSetupCommand(setup)).toContain(CONDITION);
    // Nothing of OneUptime's identity.
    expect(getRoleWithoutExternalIdMessage(PROJECT)).not.toContain(
      "999988887777",
    );
  });

  test("is a whole sentence with one value, the condition, which is code: no word of it is translated", () => {
    expect(
      placeholdersOf(AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL.template),
    ).toEqual(["{{condition}}"]);
    expect(AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL.terms).toEqual([]);
    expect(AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL.template.endsWith(".")).toBe(
      true,
    );
  });
});

describe("reading the condition back", () => {
  test("of every project's refusal, it is the project's own condition, as written", () => {
    for (let index: number = 0; index < 25; index++) {
      const projectId: string = crypto.randomUUID();
      const message: string = getRoleWithoutExternalIdMessage(projectId);

      expect(readAwsRoleWithoutExternalIdCondition(message)).toBe(
        getAwsExternalIdConditionText(getAwsExternalIdForProject(projectId)),
      );
      expect(isAwsRoleWithoutExternalIdRefusal(message)).toBe(true);
    }
  });

  test("the condition's shape is the one the setup command writes, for any external id of every project's shape", () => {
    for (let index: number = 0; index < 50; index++) {
      const externalId: string = formatAwsExternalId(
        crypto.randomBytes(AWS_EXTERNAL_ID_DIGITS / 2).toString("hex"),
      );

      expect(
        AWS_EXTERNAL_ID_CONDITION_SHAPE.test(
          getAwsExternalIdConditionText(externalId),
        ),
      ).toBe(true);
    }

    for (const other of [
      // Another external id: not of every project's shape.
      getAwsExternalIdConditionText("acme-external-id"),
      getAwsExternalIdConditionText(`oneuptime-${"A".repeat(32)}`),
      getAwsExternalIdConditionText(`oneuptime-${"a".repeat(31)}`),
      // Another condition, or the right one written another way.
      CONDITION.replace("StringEquals", "StringLike"),
      CONDITION.replace(":", ": "),
      ` ${CONDITION}`,
      `${CONDITION}}`,
      "",
    ]) {
      expect(AWS_EXTERNAL_ID_CONDITION_SHAPE.test(other)).toBe(false);
    }
  });

  test.each([
    ["a cloud's answer", "AWS role sign-in failed with HTTP 403: AccessDenied"],
    [
      "another refusal of the role's",
      "OneUptime could not check that the role requires your project's external ID, so it does not sign in to it. Check that the role ARN is right, then test the connection again.",
    ],
    ["the refusal cut short", AS_SENT_BEFORE(CONDITION).slice(0, 200)],
    [
      "the refusal inside a warning of an organization's account",
      `Could not read Production (210987654321): ${AS_SENT_BEFORE(CONDITION)}`,
    ],
    [
      "the refusal with something else where the condition goes",
      AS_SENT_BEFORE("the condition"),
    ],
    [
      "the refusal with a condition of another id",
      AS_SENT_BEFORE(getAwsExternalIdConditionText("acme-external-id")),
    ],
    ["nothing", ""],
  ])("%s is not this refusal", (_what: string, message: string) => {
    expect(readAwsRoleWithoutExternalIdCondition(message)).toBeNull();
    expect(isAwsRoleWithoutExternalIdRefusal(message)).toBe(false);
  });

  test("no message at all is not this refusal", () => {
    expect(readAwsRoleWithoutExternalIdCondition(undefined)).toBeNull();
    expect(readAwsRoleWithoutExternalIdCondition(null)).toBeNull();
  });
});

describe("in every Dashboard language", () => {
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s words the refusal, its headline and its advice, keeping the condition's place",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL.template,
        AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS.headline,
        AWS_ROLE_WITHOUT_EXTERNAL_ID_WORDS.advice,
      ]) {
        const worded: string | undefined = words[key];

        expect(worded).toBeDefined();
        expect(worded).not.toBe(key);
        expect(placeholdersOf(worded!)).toEqual(placeholdersOf(key));
      }
    },
  );

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s says the server's English in its own words, around the exact condition",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const said: string = withoutIsolateMarks(
        sayErrorMessage(getRoleWithoutExternalIdMessage(PROJECT), translator),
      );

      expect(said).toBe(
        withoutIsolateMarks(
          translator.translateTemplate(
            AWS_ROLE_WITHOUT_EXTERNAL_ID_REFUSAL.template,
            { condition: CONDITION },
          ),
        ),
      );
      // The condition, word for word, once.
      expect(said.split(CONDITION)).toHaveLength(2);
      // None of the English sentence around it.
      expect(said).not.toContain("to the statement that trusts OneUptime");
      expect(said).not.toContain("could read your AWS account");
    },
  );

  test("English reads the server's sentence as it was sent", () => {
    expect(
      sayErrorMessage(
        getRoleWithoutExternalIdMessage(PROJECT),
        dashboardTranslator("en"),
      ),
    ).toBe(AS_SENT_BEFORE(CONDITION));
  });
});
