import ServerTwilioEnvironment, {
  SERVER_TWILIO_ENVIRONMENT_ROUTE,
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE,
  SERVER_TWILIO_USED_FOR_VALUES,
  ServerTwilioEnvironmentAnswer,
  ServerTwilioEnvironmentReading,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import {
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "../../../Types/CallAndSMS/TwilioConfigUse";
import Phone from "../../../Types/Phone";
import {
  MAX_REFUSED_VALUE_LENGTH,
  REFUSED_VALUE_CUT_MARK,
} from "../../../Utils/RefusedValue";
import { describe, expect, test } from "@jest/globals";

/*
 * THE SERVER'S TWILIO ACCOUNT, SET BY ENVIRONMENT VARIABLES (#7515).
 *
 * A self-hosted customer keeps their installation in code (Terraform, Helm)
 * and asked to set the server's Twilio account there, not by hand in the
 * Admin Dashboard. Once GLOBAL_TWILIO_ACCOUNT_SID is set, the variables are
 * the whole account; anything wrong with them is said by the variable's
 * name, never with the auth token, and the account then sends nothing.
 * These pin the reading every other piece takes: the senders, the Admin
 * Dashboard's answer, the server's startup lines and the docs.
 */

const SID: string = "AC00000000000000000000000000000001";
// Never in a problem, an answer or a startup line.
const TOKEN: string = "twilio-auth-token-sentinel-0123456789";
const US: string = "+14155550100";
const UK: string = "+447700900123";
const SG: string = "+6581234567";

type Values = Record<string, string | undefined>;

function account(values: Values = {}): Values {
  return {
    [ServerTwilioEnvironmentVariable.AccountSid]: SID,
    [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: US,
    ...values,
  };
}

function problemsOf(values: Values): Array<string> {
  return ServerTwilioEnvironment.read(values).problems;
}

// Everything a reading says out loud: its problems, its answer, its startup lines.
function everythingSaid(reading: ServerTwilioEnvironmentReading): string {
  return JSON.stringify([
    reading.problems,
    ServerTwilioEnvironment.toAnswer(reading),
    ServerTwilioEnvironment.getStartupNotice(reading),
    ServerTwilioEnvironment.getStartupWarning(reading),
  ]);
}

describe("the variables", () => {
  test("are six GLOBAL_TWILIO_ names, the switch first", () => {
    expect([...SERVER_TWILIO_ENVIRONMENT_VARIABLES]).toEqual([
      "GLOBAL_TWILIO_ACCOUNT_SID",
      "GLOBAL_TWILIO_AUTH_TOKEN",
      "GLOBAL_TWILIO_USED_FOR",
      "GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER",
      "GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS",
      "GLOBAL_TWILIO_SMS_PHONE_NUMBERS",
    ]);
    expect(new Set(SERVER_TWILIO_ENVIRONMENT_VARIABLES).size).toBe(
      Object.values(ServerTwilioEnvironmentVariable).length,
    );
  });

  test("are new names: the legacy import's TWILIO_ variables are not read", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read({
        TWILIO_ACCOUNT_SID: SID,
        TWILIO_AUTH_TOKEN: TOKEN,
        TWILIO_PHONE_NUMBER: US,
      });

    expect(reading).toEqual({ isSet: false, account: null, problems: [] });
  });

  test("the Admin Dashboard asks for them at one route", () => {
    expect(SERVER_TWILIO_ENVIRONMENT_ROUTE).toBe(
      "/global-config/twilio-environment",
    );
  });

  test("the refusal of a write names the switch and where the account is changed", () => {
    expect(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "GLOBAL_TWILIO_ACCOUNT_SID",
    );
    expect(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "twilio in the Helm chart's values",
    );
    expect(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE).toContain("config.env");
    expect(SERVER_TWILIO_SET_BY_ENVIRONMENT_MESSAGE).toContain(
      "restart OneUptime",
    );
  });
});

describe("GLOBAL_TWILIO_USED_FOR", () => {
  test("is written calls-and-sms, sms-only or calls-only, one for each use", () => {
    expect(SERVER_TWILIO_USED_FOR_VALUES).toEqual({
      [TwilioConfigUse.CallsAndSms]: "calls-and-sms",
      [TwilioConfigUse.SmsOnly]: "sms-only",
      [TwilioConfigUse.CallsOnly]: "calls-only",
    });

    for (const use of TWILIO_CONFIG_USES) {
      expect(
        ServerTwilioEnvironment.readUse(SERVER_TWILIO_USED_FOR_VALUES[use]),
      ).toBe(use);
    }
  });

  test("unset or empty, is calls and SMS, as every account was before the choice", () => {
    for (const unset of [undefined, "", "   ", "\n"]) {
      expect(ServerTwilioEnvironment.readUse(unset)).toBe(
        TwilioConfigUse.CallsAndSms,
      );
    }
  });

  test.each([
    ["SMS only", TwilioConfigUse.SmsOnly],
    ["sms_only", TwilioConfigUse.SmsOnly],
    ["SMS-ONLY", TwilioConfigUse.SmsOnly],
    ["SmsOnly", TwilioConfigUse.SmsOnly],
    ["  sms-only\n", TwilioConfigUse.SmsOnly],
    ["Calls and SMS", TwilioConfigUse.CallsAndSms],
    ["CALLS_AND_SMS", TwilioConfigUse.CallsAndSms],
    ["callsAndSms", TwilioConfigUse.CallsAndSms],
    ["Calls only", TwilioConfigUse.CallsOnly],
    ["calls_only", TwilioConfigUse.CallsOnly],
  ] as Array<[string, TwilioConfigUse]>)(
    "takes the Admin Dashboard's words too, in any case: %j",
    (written: string, use: TwilioConfigUse) => {
      expect(ServerTwilioEnvironment.readUse(written)).toBe(use);
    },
  );

  test.each(["sms", "calls", "both", "voice-only", "sms-and-calls", "none"])(
    "names no use when it is none of the three: %j",
    (written: string) => {
      expect(ServerTwilioEnvironment.readUse(written)).toBeNull();
    },
  );
});

describe("with GLOBAL_TWILIO_ACCOUNT_SID unset", () => {
  test("no variable is no account and nothing to say", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read({});

    expect(reading).toEqual({ isSet: false, account: null, problems: [] });
    expect(ServerTwilioEnvironment.isUsable(reading)).toBe(false);
    expect(ServerTwilioEnvironment.getStartupNotice(reading)).toBeNull();
    expect(ServerTwilioEnvironment.getStartupWarning(reading)).toBeNull();
  });

  test("an empty or blank account SID is unset", () => {
    for (const blank of ["", "  ", "\n", "\t"]) {
      expect(
        ServerTwilioEnvironment.read({
          [ServerTwilioEnvironmentVariable.AccountSid]: blank,
        }),
      ).toEqual({ isSet: false, account: null, problems: [] });
    }
  });

  test("the other variables are read by nothing, and that is said, by name", () => {
    expect(
      problemsOf({
        [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
      }),
    ).toEqual([
      "GLOBAL_TWILIO_AUTH_TOKEN is set, but GLOBAL_TWILIO_ACCOUNT_SID is not, so nothing reads it: the Twilio account saved in the Admin Dashboard is used. Set GLOBAL_TWILIO_ACCOUNT_SID too, or remove it.",
    ]);
    expect(
      problemsOf({
        [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
        [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
        [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: SG,
      }),
    ).toEqual([
      "GLOBAL_TWILIO_AUTH_TOKEN, GLOBAL_TWILIO_USED_FOR and GLOBAL_TWILIO_SMS_PHONE_NUMBERS are set, but GLOBAL_TWILIO_ACCOUNT_SID is not, so nothing reads them: the Twilio account saved in the Admin Dashboard is used. Set GLOBAL_TWILIO_ACCOUNT_SID too, or remove them.",
    ]);
    expect(
      problemsOf({
        [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: US,
        [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: UK,
      })[0],
    ).toContain(
      "GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER and GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS are set",
    );
  });

  test("with variables nothing reads, the saved account still sends: no notice, only the warning", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read({
        [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
      });

    expect(reading.isSet).toBe(false);
    expect(reading.account).toBeNull();
    expect(ServerTwilioEnvironment.getStartupNotice(reading)).toBeNull();
    expect(ServerTwilioEnvironment.getStartupWarning(reading)).toBe(
      reading.problems.join(" "),
    );
    // Its value is never repeated: only the variable's name.
    expect(everythingSaid(reading)).not.toContain(TOKEN);
  });
});

describe("with GLOBAL_TWILIO_ACCOUNT_SID set", () => {
  test("the variables are the account, and it can send", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read(
        account({
          [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: `${UK}, ${SG}`,
          [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: SG,
        }),
      );

    expect(reading).toEqual({
      isSet: true,
      account: {
        twilioAccountSID: SID,
        twilioAuthToken: TOKEN,
        twilioUsedFor: TwilioConfigUse.CallsAndSms,
        twilioPrimaryPhoneNumber: new Phone(US),
        twilioSecondaryPhoneNumbers: `${UK}, ${SG}`,
        twilioSmsPhoneNumbers: SG,
      },
      problems: [],
    });
    expect(ServerTwilioEnvironment.isUsable(reading)).toBe(true);
  });

  test("each value is read without the whitespace around it: a token read from a file keeps its newline", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read({
        [ServerTwilioEnvironmentVariable.AccountSid]: `  ${SID}\n`,
        [ServerTwilioEnvironmentVariable.AuthToken]: `${TOKEN}\n`,
        [ServerTwilioEnvironmentVariable.UsedFor]: " sms-only ",
        [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: ` ${SG} \n`,
      });

    expect(reading.problems).toEqual([]);
    expect(reading.account?.twilioAccountSID).toBe(SID);
    expect(reading.account?.twilioAuthToken).toBe(TOKEN);
    expect(reading.account?.twilioUsedFor).toBe(TwilioConfigUse.SmsOnly);
    expect(reading.account?.twilioSmsPhoneNumbers).toBe(SG);
  });

  test("a variable left unset is empty, never anything else", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read(
        account({
          [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: undefined,
          [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: undefined,
        }),
      );

    expect(reading.account?.twilioSecondaryPhoneNumbers).toBe("");
    expect(reading.account?.twilioSmsPhoneNumbers).toBe("");
    expect(ServerTwilioEnvironment.isUsable(reading)).toBe(true);
  });

  test("without the auth token, it sends nothing, and says which variable is missing", () => {
    for (const unset of [undefined, "", "   "]) {
      const reading: ServerTwilioEnvironmentReading =
        ServerTwilioEnvironment.read(
          account({ [ServerTwilioEnvironmentVariable.AuthToken]: unset }),
        );

      expect(reading.isSet).toBe(true);
      expect(reading.problems).toEqual([
        "GLOBAL_TWILIO_AUTH_TOKEN is not set: Twilio refuses the account without its auth token.",
      ]);
      expect(ServerTwilioEnvironment.isUsable(reading)).toBe(false);
    }
  });

  test("a use it does not know sends nothing: never a use nobody chose", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read(
        account({ [ServerTwilioEnvironmentVariable.UsedFor]: "sms" }),
      );

    expect(reading.problems).toEqual([
      'GLOBAL_TWILIO_USED_FOR must be calls-and-sms, sms-only or calls-only, not "sms".',
    ]);
    expect(ServerTwilioEnvironment.isUsable(reading)).toBe(false);
  });

  test("a number that is not a phone number sends nothing, and is named with its variable", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read(
        account({
          [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]:
            "+1 415 555 CALL",
        }),
      );

    expect(reading.problems).toEqual([
      'GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER: "+1 415 555 CALL" is not a phone number. Write it with its country code, like +14155550100.',
    ]);
    expect(reading.account?.twilioPrimaryPhoneNumber).toBeUndefined();
    expect(ServerTwilioEnvironment.isUsable(reading)).toBe(false);
  });

  test("a number written without its country code is still a phone number, as on the Admin Dashboard's form", () => {
    // The docs say "a phone number OneUptime cannot read", not "without its country code".
    expect(
      ServerTwilioEnvironment.isUsable(
        ServerTwilioEnvironment.read(
          account({
            [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "4155550100",
          }),
        ),
      ),
    ).toBe(true);
  });

  test.each([
    [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers],
    [ServerTwilioEnvironmentVariable.SmsPhoneNumbers],
  ])(
    "a list with an entry that is not a phone number sends nothing: %s",
    (variable: ServerTwilioEnvironmentVariable) => {
      const reading: ServerTwilioEnvironmentReading =
        ServerTwilioEnvironment.read(
          account({ [variable]: `${UK}, not-a-number` }),
        );

      expect(reading.problems).toHaveLength(1);
      expect(reading.problems[0]).toMatch(
        new RegExp(`^${variable}: "not-a-number" is not a phone number\\.`),
      );
      expect(ServerTwilioEnvironment.isUsable(reading)).toBe(false);
    },
  );

  describe("the numbers its use takes, as the Admin Dashboard's form asks for them", () => {
    test.each([
      [TwilioConfigUse.CallsAndSms, "calls-and-sms"],
      [TwilioConfigUse.CallsOnly, "calls-only"],
      [TwilioConfigUse.CallsAndSms, ""],
    ] as Array<[TwilioConfigUse, string]>)(
      "used for %s (%j): needs the number calls go out from",
      (_use: TwilioConfigUse, written: string) => {
        const reading: ServerTwilioEnvironmentReading =
          ServerTwilioEnvironment.read(
            account({
              [ServerTwilioEnvironmentVariable.UsedFor]: written,
              [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
              [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: SG,
            }),
          );

        expect(reading.problems).toEqual([
          "GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER is not set: calls go out from it.",
        ]);
        expect(ServerTwilioEnvironment.isUsable(reading)).toBe(false);
      },
    );

    test("used for SMS only: needs SMS numbers, and no number to make calls from", () => {
      const without: ServerTwilioEnvironmentReading =
        ServerTwilioEnvironment.read(
          account({
            [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
            [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
          }),
        );

      expect(without.problems).toEqual([
        "GLOBAL_TWILIO_SMS_PHONE_NUMBERS is not set: an account used for SMS only sends every SMS from one of them.",
      ]);

      // A list of separators alone holds no number.
      expect(
        problemsOf(
          account({
            [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
            [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: " , ,",
          }),
        ),
      ).toEqual([
        "GLOBAL_TWILIO_SMS_PHONE_NUMBERS is not set: an account used for SMS only sends every SMS from one of them.",
      ]);

      const withNumbers: ServerTwilioEnvironmentReading =
        ServerTwilioEnvironment.read(
          account({
            [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
            [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
            [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: `${SG},${UK}`,
          }),
        );

      expect(withNumbers.problems).toEqual([]);
      expect(withNumbers.account?.twilioUsedFor).toBe(TwilioConfigUse.SmsOnly);
      expect(ServerTwilioEnvironment.isUsable(withNumbers)).toBe(true);
    });

    test("a use it does not know asks for no number: the use is the one problem", () => {
      expect(
        problemsOf(
          account({
            [ServerTwilioEnvironmentVariable.UsedFor]: "both",
            [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
          }),
        ),
      ).toEqual([
        'GLOBAL_TWILIO_USED_FOR must be calls-and-sms, sms-only or calls-only, not "both".',
      ]);
    });
  });

  test("everything wrong at once is said at once, in the variables' order", () => {
    const problems: Array<string> = problemsOf({
      [ServerTwilioEnvironmentVariable.AccountSid]: SID,
      [ServerTwilioEnvironmentVariable.UsedFor]: "voice",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "call me",
      [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: "x",
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: "y",
    });

    expect(
      problems.map((problem: string): string => {
        return problem.split(/[ :]/)[0] as string;
      }),
    ).toEqual([
      "GLOBAL_TWILIO_AUTH_TOKEN",
      "GLOBAL_TWILIO_USED_FOR",
      "GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER",
      "GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS",
      "GLOBAL_TWILIO_SMS_PHONE_NUMBERS",
    ]);
  });

  test("a refused value is repeated only in part, however long it is", () => {
    const long: string = "9".repeat(4000) + "x";
    const [problem] = problemsOf(
      account({ [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: long }),
    ) as [string];

    expect(problem).toContain(REFUSED_VALUE_CUT_MARK);
    expect(problem.length).toBeLessThan(MAX_REFUSED_VALUE_LENGTH + 200);
  });

  test("the auth token is never said: not in a problem, the answer or a startup line", () => {
    for (const values of [
      account(),
      account({ [ServerTwilioEnvironmentVariable.UsedFor]: "sms" }),
      account({ [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "x" }),
      account({ [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: "x" }),
      account({ [ServerTwilioEnvironmentVariable.AccountSid]: "" }),
    ]) {
      expect(
        everythingSaid(ServerTwilioEnvironment.read(values)),
      ).not.toContain(TOKEN);
    }
  });
});

describe("what the Admin Dashboard is told", () => {
  test("unset, no account and the problems nothing reads", () => {
    expect(
      ServerTwilioEnvironment.toAnswer(ServerTwilioEnvironment.read({})),
    ).toEqual({
      isSetByEnvironment: false,
      usedFor: null,
      accountSid: null,
      hasAuthToken: false,
      primaryPhoneNumber: null,
      secondaryPhoneNumbers: null,
      smsPhoneNumbers: null,
      problems: [],
    });

    const unused: ServerTwilioEnvironmentReading = ServerTwilioEnvironment.read(
      { [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN },
    );
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(unused);

    expect(answer.isSetByEnvironment).toBe(false);
    expect(answer.hasAuthToken).toBe(false);
    expect(answer.problems).toEqual(unused.problems);
    // A copy: the answer cannot change the reading.
    expect(answer.problems).not.toBe(unused.problems);
  });

  test("set, the account without its auth token: only whether there is one", () => {
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(
        ServerTwilioEnvironment.read(
          account({
            [ServerTwilioEnvironmentVariable.UsedFor]: "calls-only",
            [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: UK,
          }),
        ),
      );

    expect(answer).toEqual({
      isSetByEnvironment: true,
      usedFor: TwilioConfigUse.CallsOnly,
      accountSid: SID,
      hasAuthToken: true,
      primaryPhoneNumber: US,
      secondaryPhoneNumbers: UK,
      smsPhoneNumbers: null,
      problems: [],
    });
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(Object.keys(answer)).not.toContain("authToken");
  });

  test("set with problems, the account as far as it reads and every problem", () => {
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(
        ServerTwilioEnvironment.read(
          account({
            [ServerTwilioEnvironmentVariable.AuthToken]: "",
            [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "nope",
          }),
        ),
      );

    expect(answer.isSetByEnvironment).toBe(true);
    expect(answer.hasAuthToken).toBe(false);
    expect(answer.primaryPhoneNumber).toBeNull();
    expect(answer.problems).toHaveLength(2);
  });

  test("reads back as it was sent", () => {
    for (const values of [
      {},
      { [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN },
      account(),
      account({
        [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
        [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: `${SG}, ${UK}`,
        [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: "x",
      }),
    ] as Array<Values>) {
      const answer: ServerTwilioEnvironmentAnswer =
        ServerTwilioEnvironment.toAnswer(ServerTwilioEnvironment.read(values));

      expect(
        ServerTwilioEnvironment.answerFromJSON(
          JSON.parse(JSON.stringify(answer)),
        ),
      ).toEqual(answer);
    }
  });

  test.each([null, undefined, "", "set", 1, true, [], [{}]])(
    "anything that is not the answer's shape reads as unset, so the saved account shows: %j",
    (json: unknown) => {
      expect(ServerTwilioEnvironment.answerFromJSON(json)).toEqual({
        isSetByEnvironment: false,
        usedFor: null,
        accountSid: null,
        hasAuthToken: false,
        primaryPhoneNumber: null,
        secondaryPhoneNumbers: null,
        smsPhoneNumbers: null,
        problems: [],
      });
    },
  );

  test("each field is read only as its own type", () => {
    expect(
      ServerTwilioEnvironment.answerFromJSON({
        isSetByEnvironment: "true",
        usedFor: "sms-only",
        accountSid: 7,
        hasAuthToken: "yes",
        primaryPhoneNumber: "   ",
        secondaryPhoneNumbers: ["+447700900123"],
        smsPhoneNumbers: null,
        problems: ["one", 2, "", null, "two"],
      }),
    ).toEqual({
      isSetByEnvironment: false,
      // The answer's words for a use, never the variable's.
      usedFor: null,
      accountSid: null,
      hasAuthToken: false,
      primaryPhoneNumber: null,
      secondaryPhoneNumbers: null,
      smsPhoneNumbers: null,
      problems: ["one", "two"],
    });
  });
});

describe("what the server says as it starts", () => {
  test("set, that the saved account is not used: once, even with problems", () => {
    const notice: string | null = ServerTwilioEnvironment.getStartupNotice(
      ServerTwilioEnvironment.read(account()),
    );

    expect(notice).toBe(
      "The server's Twilio account is set by environment variables (GLOBAL_TWILIO_ACCOUNT_SID and the other GLOBAL_TWILIO_ variables): the account saved in the Admin Dashboard is not used.",
    );
    expect(
      ServerTwilioEnvironment.getStartupNotice(
        ServerTwilioEnvironment.read(
          account({ [ServerTwilioEnvironmentVariable.AuthToken]: "" }),
        ),
      ),
    ).toBe(notice);
    expect(
      ServerTwilioEnvironment.getStartupWarning(
        ServerTwilioEnvironment.read(account()),
      ),
    ).toBeNull();
  });

  test("set with problems, that it sends nothing until they are fixed, and each problem", () => {
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read(
        account({
          [ServerTwilioEnvironmentVariable.AuthToken]: "",
          [ServerTwilioEnvironmentVariable.UsedFor]: "sms",
        }),
      );

    expect(ServerTwilioEnvironment.getStartupWarning(reading)).toBe(
      `The Twilio account set by environment variables sends no SMS and makes no calls until this is fixed: ${reading.problems.join(" ")}`,
    );
  });
});
