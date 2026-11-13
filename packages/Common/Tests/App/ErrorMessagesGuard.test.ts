// UX rule: Docs/ux/README.md#errors
import {
  findCapitalisedStringLiterals,
  findThrownMessages,
  listScanFiles,
  REPOSITORY_ROOT,
  scanThrownMessages,
  ThrownMessage,
} from "../ErrorMessagesScan";
import {
  isEmptyErrorPhrase,
  isErrorSentence,
} from "../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY ERROR A PERSON READS SAYS WHAT HAPPENED (#6836).
 *
 * An error is the moment a person most needs the product to be clear. The
 * server throws a message in about six thousand places, and a few said
 * only "Invalid request" or "An error occurred"; the last resort said
 * "Server Error". This guard reads every message thrown with its words
 * written where it is thrown (`new <Something>Exception("...")`,
 * Common/Tests/ErrorMessagesScan) and holds them to the part of the rule a
 * program can check (Common/Types/Exception/ErrorMessageRule):
 *
 *   1. None is an empty phrase on its own - "Server Error", "Something went
 *      wrong", "Invalid request", "Bad request", "An error occurred" and the
 *      rest of EMPTY_ERROR_PHRASES. Say what happened instead: "Slack sent an
 *      action OneUptime does not recognise."
 *
 *   2. In the files of the first-hour flows (FIRST_HOUR_FILES: sign-up and
 *      sign-in, a project, inviting a person, a monitor, verifying a
 *      notification method, on-call, a status page, an ingestion key) every
 *      message is a sentence: a capital letter first, a full stop last.
 *
 *   3. Everywhere else, the number of messages that are not sentences may
 *      not grow, file by file (ErrorMessagesBaseline.json, today's count).
 *      A file that has fewer than its baseline does not fail - fixing a
 *      message must never turn main red - but the run names it: lower the
 *      baseline with UPDATE_ERROR_MESSAGES_BASELINE=true, so the room it
 *      left is not used again by a new message that is not a sentence.
 *
 *   4. The last resort - what the server answers and the Dashboard shows
 *      when nobody put a failure into words - says none of the empty
 *      phrases (LAST_RESORT_FILES).
 *
 * What a program cannot check - that a message says what to do next, in
 * the person's words, without blaming them - is in the rule's text.
 */

// The flows a new person meets in their first hour, by the files that refuse them.
export const FIRST_HOUR_FILES: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Identity/API/Authentication.ts",
  "packages/App/FeatureSet/Identity/Utils/CredentialGuard.ts",
  "packages/Common/Server/Services/TeamMemberService.ts",
  "packages/Common/Server/Utils/ChannelVerification.ts",
  "packages/Common/Server/API/ChannelVerificationResendRoute.ts",
  "packages/Common/Server/API/ChannelVerificationStatusRoute.ts",
  "packages/Common/Server/API/UserEmailAPI.ts",
  "packages/Common/Server/API/UserSmsAPI.ts",
  "packages/Common/Server/API/UserCallAPI.ts",
  "packages/Common/Server/API/UserIncomingCallNumberAPI.ts",
  "packages/Common/Server/API/UserWhatsAppAPI.ts",
  "packages/Common/Server/Services/UserEmailService.ts",
  "packages/Common/Server/Services/UserSmsService.ts",
  "packages/Common/Server/Services/UserCallService.ts",
  "packages/Common/Server/Services/UserService.ts",
  "packages/Common/Server/Services/MonitorService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyEscalationRuleService.ts",
  "packages/Common/Server/Services/OnCallDutyPolicyScheduleService.ts",
  "packages/Common/Server/Services/StatusPageService.ts",
  "packages/Common/Server/Services/StatusPageResourceService.ts",
  "packages/Common/Server/Services/TelemetryIngestionKeyService.ts",
  "packages/Common/Server/Middleware/TelemetryIngest.ts",
];

/*
 * What the server answers and the Dashboard shows when nobody put a failure
 * into words. None of its words may be an empty phrase.
 */
export const LAST_RESORT_FILES: ReadonlyArray<string> = [
  "packages/Common/Server/Utils/StartServer.ts",
  "packages/Common/Server/Utils/Response.ts",
  "packages/Common/Server/Utils/UnexplainedServerError.ts",
  "packages/Common/UI/Utils/API/API.ts",
  "packages/Common/UI/Components/Error/PageError.tsx",
  "packages/Common/UI/Components/ErrorMessage/ErrorMessage.tsx",
  "packages/Common/UI/Components/ErrorMessage/ErrorExplanation.tsx",
  "packages/Common/Types/Exception/UnexplainedError.ts",
];

// Buttons whose words are an empty phrase's, and say what they do.
const BUTTON_LABELS: ReadonlyArray<string> = ["Try again"];

const BASELINE_FILE: string = path.join(
  __dirname,
  "ErrorMessagesBaseline.json",
);

type Baseline = Record<string, number>;

const describeFinding: (message: ThrownMessage) => string = (
  message: ThrownMessage,
): string => {
  return `${message.file}:${message.line} ${message.exception}(${JSON.stringify(message.message)})`;
};

describe("the scanner reads every thrown message, and only those", () => {
  const found: (source: string) => Array<string> = (
    source: string,
  ): Array<string> => {
    return findThrownMessages("Fixture.ts", source).map(
      (message: ThrownMessage): string => {
        return `${message.line}:${message.exception}:${message.message}`;
      },
    );
  };

  test("a double-quoted, a single-quoted and a template message", () => {
    expect(
      found(
        [
          'throw new BadDataException("Promo code is invalid.");',
          "throw new NotFoundException('Monitor not found');",
          "throw new BadDataException(`${name} is already taken.`);",
        ].join("\n"),
      ),
    ).toEqual([
      "1:BadDataException:Promo code is invalid.",
      "2:NotFoundException:Monitor not found",
      "3:BadDataException:${value} is already taken.",
    ]);
  });

  test("a message on the line after the bracket, with a value that holds braces and strings", () => {
    expect(
      found(
        [
          "throw new BadRequestException(",
          '  `Pick ${list.map((x) => { return `"${x}"`; }).join(", ")} or none.`,',
          ");",
        ].join("\n"),
      ),
    ).toEqual(["1:BadRequestException:Pick ${value} or none."]);
  });

  test("the message after a code for a program", () => {
    expect(
      found(
        'throw new RefusedException("invalid_request", "A resource command needs a type.");',
      ),
    ).toEqual(["1:RefusedException:A resource command needs a type."]);
  });

  test("leaves out a message that is not written where it is thrown", () => {
    expect(
      found(
        [
          "throw new BadDataException(Errors.ALREADY_INVITED);",
          "throw new BadDataException(getMessage());",
          'throw new BadDataException("Item with ID " + id + " not found");',
          "throw new BadDataException();",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("leaves out a comment that names one", () => {
    expect(
      found(
        [
          '// throw new BadDataException("Invalid request");',
          ' * new BadDataException("Server Error")',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("reads the product's code, not its tests, migrations or builds", () => {
    const files: Array<string> = listScanFiles();

    expect(files.length).toBeGreaterThan(3000);
    expect(files).toContain(
      "packages/App/FeatureSet/Identity/API/Authentication.ts",
    );
    // Named: wrap-regex wants a literal called on in parens, which Prettier drops.
    const notTheProduct: RegExp =
      /\/(Tests|node_modules|SchemaMigrations|dist)\//;
    const testFileName: RegExp = /\.(test|spec)\.tsx?$/;

    expect(
      files.some((file: string): boolean => {
        return notTheProduct.test(file) || testFileName.test(file);
      }),
    ).toBe(false);
  });
});

describe("the messages the product throws", () => {
  const messages: Array<ThrownMessage> = scanThrownMessages();

  test("are read in their thousands", () => {
    expect(messages.length).toBeGreaterThan(4000);
  });

  test("none is an empty phrase on its own", () => {
    const empty: Array<string> = messages
      .filter((message: ThrownMessage): boolean => {
        return isEmptyErrorPhrase(message.message);
      })
      .map(describeFinding);

    expect(empty).toEqual([]);
  });

  test("every first-hour file is still where this guard looks for it", () => {
    for (const file of FIRST_HOUR_FILES) {
      expect({
        file,
        exists: fs.existsSync(path.join(REPOSITORY_ROOT, file)),
      }).toEqual({ file, exists: true });
    }
  });

  test("in the first-hour flows, every message is a sentence", () => {
    const notSentences: Array<string> = messages
      .filter((message: ThrownMessage): boolean => {
        return (
          FIRST_HOUR_FILES.includes(message.file) &&
          !isErrorSentence(message.message)
        );
      })
      .map(describeFinding);

    expect(notSentences).toEqual([]);
  });

  test("everywhere else, no file has more messages that are not sentences than it had", () => {
    const counts: Baseline = {};

    for (const message of messages) {
      if (
        FIRST_HOUR_FILES.includes(message.file) ||
        isErrorSentence(message.message)
      ) {
        continue;
      }

      counts[message.file] = (counts[message.file] || 0) + 1;
    }

    const sorted: Baseline = {};

    for (const file of Object.keys(counts).sort()) {
      sorted[file] = counts[file] as number;
    }

    if (process.env["UPDATE_ERROR_MESSAGES_BASELINE"] === "true") {
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
    }

    const baseline: Baseline = JSON.parse(
      fs.readFileSync(BASELINE_FILE, "utf8"),
    ) as Baseline;

    const grew: Array<string> = [];
    const shrank: Array<string> = [];

    for (const file of Object.keys({ ...baseline, ...sorted }).sort()) {
      /*
       * A checkout without ee/ (Common's CI job moves it aside) has none of
       * its files: their counts are kept for the checkouts that do.
       */
      if (
        file.startsWith("ee/") &&
        !fs.existsSync(path.join(REPOSITORY_ROOT, "ee"))
      ) {
        continue;
      }

      const now: number = sorted[file] || 0;
      const before: number = baseline[file] || 0;

      if (now > before) {
        const examples: Array<string> = messages
          .filter((message: ThrownMessage): boolean => {
            return message.file === file && !isErrorSentence(message.message);
          })
          .map(describeFinding);

        grew.push(
          `${file}: ${now} messages are not sentences, ${before} before. Write each as a sentence that says what happened and what to do next:\n  ${examples.join("\n  ")}`,
        );
      } else if (now < before) {
        shrank.push(
          `${file}: ${now} messages are not sentences, down from ${before}. Lower its baseline (UPDATE_ERROR_MESSAGES_BASELINE=true).`,
        );
      }
    }

    expect(grew).toEqual([]);

    // Fixed messages are named, never failed (see the header).
    if (shrank.length > 0) {
      // eslint-disable-next-line no-console
      console.info(
        `Error messages rewritten as sentences; lower the baseline:\n${shrank.join("\n")}`,
      );
    }
  });
});

describe("the last resort", () => {
  test.each(LAST_RESORT_FILES)(
    "%s says none of the empty phrases",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      const empty: Array<string> = findCapitalisedStringLiterals(source)
        .filter((literal: { text: string }): boolean => {
          // A button that says what it does is not a message.
          return (
            !BUTTON_LABELS.includes(literal.text) &&
            isEmptyErrorPhrase(literal.text)
          );
        })
        .map((literal: { line: number; text: string }): string => {
          return `${file}:${literal.line} ${JSON.stringify(literal.text)}`;
        });

      expect(empty).toEqual([]);
    },
  );

  test("the reader of the last resort's files finds a capitalised empty phrase, and skips comments", () => {
    expect(
      findCapitalisedStringLiterals(
        [
          '// res.send({ error: "Server Error" });',
          'const key = "error";',
          'res.send({ error: "Server Error" });',
        ].join("\n"),
      ),
    ).toEqual([{ line: 3, text: "Server Error" }]);
  });
});
