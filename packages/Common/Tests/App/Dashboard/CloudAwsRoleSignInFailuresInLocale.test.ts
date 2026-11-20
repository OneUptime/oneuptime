import { describe, expect, test } from "@jest/globals";
import {
  AwsRolePurpose,
  assumeRole,
  probeRoleExternalId,
} from "../../../Server/Utils/CloudConnection/Aws/AwsSts";
import { CloudConnectorTransport } from "../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  AwsRoleSignInWords,
  CLOUD_CONNECT_ROLE_SIGN_IN_WORDS,
  getAwsRoleSignInSentences,
} from "../../../Types/CloudConnection/AwsRoleSignInFailures";
import {
  AMAZON_SES_ROLE_SENTENCES,
  AMAZON_SES_ROLE_SIGN_IN_WORDS,
} from "../../../Types/Email/AmazonSesRoleWords";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { drawCloudFailureDetails } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionWords";

/*
 * ONEUPTIME'S OTHER AWS ROLE SIGN-IN FAILURES, IN THE READER'S LANGUAGE
 * (#10474).
 *
 * When Cloud Connect's check of a role, or its sign-in to it, fails, the
 * server says why in OneUptime's own words (AwsSts.describeRoleFailure).
 * Each sentence is a key of the Dashboard's locales
 * (Types/CloudConnection/AwsRoleSignInFailures), so wherever a failure's
 * details are drawn - a test, View error, the Not working pill's tooltip
 * (drawCloudFailureDetails) - a German, Japanese or Persian reader reads it
 * in their language, not in English. This holds:
 *
 *   - what the server sends for each way a check or a sign-in fails is one
 *     of these sentences, word for word;
 *   - every Dashboard language words every one, and drawCloudFailureDetails
 *     draws that wording;
 *   - a project's Amazon SES role (#7378) is said in email's words, each
 *     worded in every language too.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const ROLE_ARN: string = "arn:aws:iam::210987654321:role/OneUptimeReadOnly";
const SERVER_KEY: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: "AKIAONEUPTIMESERVER1",
  secretAccessKey: "oneuptime-server-secret",
};

interface Answer {
  status: number;
  body: string;
}

function stsError(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`,
  };
}

const ACCESS_DENIED: Answer = stsError(
  403,
  "AccessDenied",
  "User: arn:aws:sts::999988887777:assumed-role/oneuptime-app/x is not authorized to perform: sts:AssumeRole",
);

// STS answering each AssumeRole with the next answer, the last one again.
function transportAnswering(answers: Array<Answer>): CloudConnectorTransport {
  let asked: number = 0;

  return async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    expect(String(request.body)).toContain("Action=AssumeRole");

    const answer: Answer = answers[Math.min(asked, answers.length - 1)]!;

    asked++;

    return {
      statusCode: answer.status,
      bodyText: answer.body,
      bodyJson: undefined,
      headers: {},
    };
  };
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return (error as LlmProviderError).message;
  }

  throw new Error("It went through.");
}

// How a check of the role fails, and what the project is told.
const CHECK_FAILURES: Array<[string, Answer, keyof AwsRoleSignInWords]> = [
  [
    "throttled",
    stsError(400, "Throttling", "Rate exceeded"),
    "checkRateLimited",
  ],
  [
    "unanswered",
    stsError(503, "ServiceUnavailable", "Try later"),
    "checkUnanswered",
  ],
  [
    "OneUptime's own credentials refused",
    stsError(403, "ExpiredToken", "The security token is expired"),
    "serverCredentialsRefused",
  ],
  [
    "refused for another reason",
    stsError(403, "RegionDisabledException", "STS is not activated"),
    "checkFailed",
  ],
  [
    "a request AWS would not take",
    stsError(400, "ValidationError", "1 validation error detected"),
    "checkFailed",
  ],
];

// How the sign-in fails once the check passed, and what the project is told.
const SIGN_IN_FAILURES: Array<[string, Answer, keyof AwsRoleSignInWords]> = [
  [
    "throttled",
    stsError(400, "Throttling", "Rate exceeded"),
    "signInRateLimited",
  ],
  [
    "unanswered",
    stsError(503, "ServiceUnavailable", "Try later"),
    "signInUnanswered",
  ],
  ["refused by the trust policy", ACCESS_DENIED, "signInNotPermitted"],
  [
    "a request AWS would not take",
    stsError(400, "ValidationError", "1 validation error detected"),
    "signInRefused",
  ],
];

describe("what the server sends is one of OneUptime's sentences, word for word", () => {
  for (const [purpose, words] of [
    [AwsRolePurpose.CloudConnect, CLOUD_CONNECT_ROLE_SIGN_IN_WORDS],
    [AwsRolePurpose.AmazonSes, AMAZON_SES_ROLE_SIGN_IN_WORDS],
  ] as Array<[AwsRolePurpose, AwsRoleSignInWords]>) {
    test.each(CHECK_FAILURES)(
      `${purpose}: a check %s`,
      async (_what: string, answer: Answer, word: keyof AwsRoleSignInWords) => {
        const message: string = await messageOf(
          probeRoleExternalId({
            transport: transportAnswering([answer]),
            credentials: SERVER_KEY,
            roleArn: ROLE_ARN,
            roleSessionName: "OneUptime-test",
            region: "us-east-1",
            purpose,
            sleep: async (): Promise<void> => {},
          }),
        );

        expect(message).toBe(words[word]);
      },
    );

    test.each(SIGN_IN_FAILURES)(
      `${purpose}: a sign-in %s`,
      async (_what: string, answer: Answer, word: keyof AwsRoleSignInWords) => {
        const message: string = await messageOf(
          assumeRole({
            purpose,
            // The check passes (AWS refuses its id); the sign-in meets the answer.
            transport: transportAnswering([ACCESS_DENIED, answer]),
            credentials: SERVER_KEY,
            roleArn: ROLE_ARN,
            projectId: "11111111-1111-4111-8111-111111111111",
            connectionId: "22222222-2222-4222-8222-222222222222",
            region: "us-east-1",
            noCache: true,
            sleep: async (): Promise<void> => {},
          }),
        );

        expect(message).toBe(words[word]);
      },
    );
  }

  test("Cloud Connect's sentences are word for word what #10405 sent before they were keys", () => {
    expect(CLOUD_CONNECT_ROLE_SIGN_IN_WORDS.checkRateLimited).toBe(
      "AWS asked OneUptime to slow down while it checked that the role requires your project's external ID, so nothing was read through it. OneUptime tries again on the next read.",
    );
    expect(CLOUD_CONNECT_ROLE_SIGN_IN_WORDS.signInRefused).toBe(
      "AWS did not let OneUptime sign in to the role. Check that the role ARN is right and that the role trusts OneUptime with your project's external ID: run the setup command again.",
    );
    expect(CLOUD_CONNECT_ROLE_SIGN_IN_WORDS.noServerIdentity).toBe(
      "This OneUptime has no AWS identity to sign in to the role with: no Cloud Connect access key is set, and the server's own AWS credentials did not work. The server's log says why. Connect with an access key instead.",
    );
  });
});

describe("in every Dashboard language", () => {
  const CLOUD_SENTENCES: Array<string> = getAwsRoleSignInSentences(
    CLOUD_CONNECT_ROLE_SIGN_IN_WORDS,
  );

  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s says each Cloud Connect sign-in failure in its own words where a failure's details are drawn",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const translator: Translator = dashboardTranslator(language);

      for (const sentence of CLOUD_SENTENCES) {
        const worded: string | undefined = words[sentence];

        expect({ sentence, worded: Boolean(worded) }).toEqual({
          sentence,
          worded: true,
        });
        expect(worded).not.toBe(sentence);

        const drawn: string = withoutIsolateMarks(
          drawCloudFailureDetails(translator, sentence),
        );

        expect(drawn).not.toBe(sentence);

        // OneUptime, AWS and Cloud Connect are names, kept as the English writes them.
        for (const name of ["OneUptime", "AWS", "Cloud Connect", "ARN"]) {
          if (sentence.includes(name)) {
            expect({ sentence, name, kept: drawn.includes(name) }).toEqual({
              sentence,
              name,
              kept: true,
            });
          }
        }
      }
    },
  );

  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s words every sentence a project is told of its Amazon SES role, its code as written",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of AMAZON_SES_ROLE_SENTENCES) {
        const worded: string | undefined = words[sentence];

        expect({ sentence, worded: Boolean(worded) }).toEqual({
          sentence,
          worded: true,
        });
        expect(worded).not.toBe(sentence);

        for (const code of [
          "sts:ExternalId",
          "arn:aws:iam::123456789012:role/OneUptimeSes",
          "us-east-1",
          '"Access Key"',
          '"IAM Role"',
        ]) {
          if (sentence.includes(code)) {
            expect({ sentence, code, kept: worded!.includes(code) }).toEqual({
              sentence,
              code,
              kept: true,
            });
          }
        }
      }
    },
  );

  test("in English, each is drawn as it came", () => {
    for (const sentence of CLOUD_SENTENCES) {
      expect(drawCloudFailureDetails(ENGLISH, sentence)).toBe(sentence);
    }
  });
});
