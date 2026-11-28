import ServerTwilioEnvironment, {
  SERVER_TWILIO_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ServerTwilioCallVoiceReading,
  ServerTwilioEnvironmentAnswer,
  ServerTwilioEnvironmentReading,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import {
  CALL_VOICES,
  CALL_VOICE_VALUES,
  CallVoice,
  CALL_LANGUAGE_VOICES,
  SpokenCallVoice,
} from "../../../Types/Call/CallVoice";
import {
  MAX_REFUSED_VALUE_LENGTH,
  REFUSED_VALUE_CUT_MARK,
} from "../../../Utils/RefusedValue";
import { describe, expect, test } from "@jest/globals";

/*
 * THE VOICE OF THE SERVER'S CALLS, SET BY AN ENVIRONMENT VARIABLE (#11064).
 *
 * GLOBAL_TWILIO_CALL_VOICE sets the voice the server's calls speak with -
 * twilio.callVoice in the Helm chart's values, config.env with Docker
 * Compose - with the account's variables or without them. It names one of
 * OneUptime's voices as the list writes them; anything else is a problem
 * the server names by the variable, and the calls then speak with the
 * account's default voice: never the saved voice nobody set it to, and
 * never no call at all. These pin the reading: what it takes and refuses,
 * what the Admin Dashboard is told, and what the server says as it starts.
 */

const SID: string = "AC00000000000000000000000000000001";
const TOKEN: string = "twilio-auth-token-sentinel-11064";
const US: string = "+14155550100";

type Values = Record<string, string | undefined>;

function voiceOf(value: string | undefined): ServerTwilioCallVoiceReading {
  return ServerTwilioEnvironment.readCallVoice({
    [SERVER_TWILIO_CALL_VOICE_VARIABLE]: value,
  });
}

function account(values: Values = {}): Values {
  return {
    [ServerTwilioEnvironmentVariable.AccountSid]: SID,
    [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: US,
    ...values,
  };
}

describe("the variable", () => {
  test("is named GLOBAL_TWILIO_CALL_VOICE, beside the account's", () => {
    expect(SERVER_TWILIO_CALL_VOICE_VARIABLE).toBe("GLOBAL_TWILIO_CALL_VOICE");
    expect(SERVER_TWILIO_CALL_VOICE_VARIABLE.startsWith("GLOBAL_TWILIO_")).toBe(
      true,
    );
  });

  test("is not one of the account's variables: it does not turn the account on, and the account does not need it", () => {
    expect(
      (SERVER_TWILIO_ENVIRONMENT_VARIABLES as ReadonlyArray<string>).includes(
        SERVER_TWILIO_CALL_VOICE_VARIABLE,
      ),
    ).toBe(false);
  });
});

describe("unset", () => {
  test.each([
    ["left out", {}],
    ["undefined", { [SERVER_TWILIO_CALL_VOICE_VARIABLE]: undefined }],
    ["empty", { [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "" }],
    ["spaces", { [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "   " }],
    ["a tab and a newline", { [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "\t\n" }],
  ])(
    "%s: not set, so the voice saved in the Admin Dashboard applies",
    (_label: string, values: Values) => {
      expect(ServerTwilioEnvironment.readCallVoice(values)).toEqual({
        isSet: false,
        voice: undefined,
        problem: null,
      });
    },
  );

  test("says nothing as the server starts", () => {
    const reading: ServerTwilioCallVoiceReading = voiceOf(undefined);

    expect(ServerTwilioEnvironment.getCallVoiceStartupNotice(reading)).toBe(
      null,
    );
    expect(ServerTwilioEnvironment.getCallVoiceStartupWarning(reading)).toBe(
      null,
    );
  });

  test("a reading is a new object each time: one caller cannot change another's", () => {
    const first: ServerTwilioCallVoiceReading = voiceOf(undefined);
    const second: ServerTwilioCallVoiceReading = voiceOf(undefined);

    expect(first).not.toBe(second);
  });
});

describe("set to one of OneUptime's voices", () => {
  test.each(
    CALL_VOICE_VALUES.map((value: string) => {
      return [value];
    }),
  )("%s is the voice, with no problem", (value: string) => {
    expect(voiceOf(value)).toEqual({
      isSet: true,
      voice: value,
      problem: null,
    });
  });

  test("the whitespace around it is let go, as a value read from a file has it", () => {
    expect(voiceOf("  Polly.Joanna-Neural\n").voice).toBe(
      "Polly.Joanna-Neural",
    );
    expect(voiceOf("\tGoogle.en-US-Neural2-J ").voice).toBe(
      "Google.en-US-Neural2-J",
    );
  });

  test("the server says once, as it starts, which voice the variable sets", () => {
    const notice: string | null =
      ServerTwilioEnvironment.getCallVoiceStartupNotice(
        voiceOf("Polly.Brian-Neural"),
      );

    expect(notice).toBe(
      "The voice of the server's calls is set by GLOBAL_TWILIO_CALL_VOICE: Polly.Brian-Neural. The voice chosen in the Admin Dashboard is not used.",
    );
    expect(
      ServerTwilioEnvironment.getCallVoiceStartupWarning(
        voiceOf("Polly.Brian-Neural"),
      ),
    ).toBe(null);
  });
});

describe("set to anything else", () => {
  const OTHER_LANGUAGE_VOICES: Array<string> = Array.from(
    new Set(
      CALL_LANGUAGE_VOICES.map((voice: SpokenCallVoice): string => {
        return voice.value;
      }),
    ),
  ).filter((value: string): boolean => {
    return !CALL_VOICE_VALUES.includes(value);
  });

  test.each([
    ["a misspelt voice", "Polly.Joana-Neural"],
    ["a voice without its Neural", "Polly.Joanna"],
    ["another casing", "polly.joanna-neural"],
    ["all capitals", "POLLY.JOANNA-NEURAL"],
    ["a Basic voice", "alice"],
    ["Twilio's man", "man"],
    ["a Polly Standard voice", "Polly.Joanna"],
    ["a Google voice not listed", "Google.en-US-Standard-C"],
    ["a voice's display name", "Joanna"],
    ["a sentence", "the default voice please"],
    ["two voices", "Polly.Joanna-Neural,Polly.Matthew-Neural"],
  ])(
    "%s (%s) is set, names no voice, and is a problem named by the variable",
    (_label: string, value: string) => {
      const reading: ServerTwilioCallVoiceReading = voiceOf(value);

      expect(reading.isSet).toBe(true);
      expect(reading.voice).toBeUndefined();
      expect(reading.problem).toBe(
        `GLOBAL_TWILIO_CALL_VOICE: "${value}" is not a voice OneUptime offers, so calls speak with your Twilio account's default voice. Set it to one of ${CALL_VOICE_VALUES.join(", ")}, or leave it empty to choose the voice in the Admin Dashboard.`,
      );
    },
  );

  test("another language's voice is refused too: a call picks its language's voice itself, of the kind the voice chosen is", () => {
    expect(OTHER_LANGUAGE_VOICES.length).toBeGreaterThan(10);

    for (const value of OTHER_LANGUAGE_VOICES) {
      const reading: ServerTwilioCallVoiceReading = voiceOf(value);

      expect(reading.isSet).toBe(true);
      expect(reading.voice).toBeUndefined();
      expect(reading.problem).toContain(`"${value}"`);
    }
  });

  test("the problem names every voice there is to choose, as the list writes them", () => {
    const problem: string = voiceOf("nope").problem || "";

    for (const voice of CALL_VOICES) {
      expect(problem).toContain(voice.value);
    }
  });

  test("a long value is repeated only as far as a refused value is", () => {
    const long: string = "Polly." + "x".repeat(MAX_REFUSED_VALUE_LENGTH * 5);
    const problem: string = voiceOf(long).problem || "";

    expect(problem).toContain(
      `"${long.slice(0, MAX_REFUSED_VALUE_LENGTH)}${REFUSED_VALUE_CUT_MARK}"`,
    );
    expect(problem).not.toContain(long);
  });

  test("the server warns as it starts, and says no voice is set by it", () => {
    const reading: ServerTwilioCallVoiceReading = voiceOf("alice");

    expect(ServerTwilioEnvironment.getCallVoiceStartupWarning(reading)).toBe(
      reading.problem,
    );
    expect(ServerTwilioEnvironment.getCallVoiceStartupNotice(reading)).toBe(
      null,
    );
  });
});

describe("independent of the account", () => {
  test("a voice problem is never one of the account's: the account still sends", () => {
    const values: Values = account({
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Nobody-Neural",
    });
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read(values);

    expect(reading.problems).toEqual([]);
    expect(ServerTwilioEnvironment.isUsable(reading)).toBe(true);
    expect(ServerTwilioEnvironment.readCallVoice(values).problem).not.toBe(
      null,
    );
  });

  test("the voice alone does not set the account, nor count among the variables nothing reads", () => {
    const values: Values = {
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Amy-Neural",
    };
    const reading: ServerTwilioEnvironmentReading =
      ServerTwilioEnvironment.read(values);

    expect(reading).toEqual({ isSet: false, account: null, problems: [] });
    expect(ServerTwilioEnvironment.getStartupNotice(reading)).toBe(null);
    expect(ServerTwilioEnvironment.readCallVoice(values)).toEqual({
      isSet: true,
      voice: "Polly.Amy-Neural",
      problem: null,
    });
  });

  test("the account's variables never change the voice's reading", () => {
    for (const values of [
      {},
      account(),
      account({ [ServerTwilioEnvironmentVariable.AuthToken]: "" }),
      { [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN },
    ] as Array<Values>) {
      expect(
        ServerTwilioEnvironment.readCallVoice({
          ...values,
          [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Google.en-US-Neural2-F",
        }),
      ).toEqual({
        isSet: true,
        voice: "Google.en-US-Neural2-F",
        problem: null,
      });
    }
  });
});

describe("what the Admin Dashboard is told", () => {
  test("with the account's variables: the account and the voice, each on its own", () => {
    const values: Values = account({
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Matthew-Neural",
    });
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(
        ServerTwilioEnvironment.read(values),
        ServerTwilioEnvironment.readCallVoice(values),
      );

    expect(answer.isSetByEnvironment).toBe(true);
    expect(answer.accountSid).toBe(SID);
    expect(answer.isCallVoiceSetByEnvironment).toBe(true);
    expect(answer.callVoice).toBe("Polly.Matthew-Neural");
    expect(answer.callVoiceProblem).toBe(null);
    expect(answer.problems).toEqual([]);
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
  });

  test("without them: no account, and the voice", () => {
    const values: Values = {
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Google.en-US-Neural2-J",
    };
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(
        ServerTwilioEnvironment.read(values),
        ServerTwilioEnvironment.readCallVoice(values),
      );

    expect(answer).toEqual({
      isSetByEnvironment: false,
      usedFor: null,
      accountSid: null,
      hasAuthToken: false,
      primaryPhoneNumber: null,
      secondaryPhoneNumbers: null,
      smsPhoneNumbers: null,
      problems: [],
      isCallVoiceSetByEnvironment: true,
      callVoice: "Google.en-US-Neural2-J",
      callVoiceProblem: null,
      isLetProjectsChooseCallVoiceSetByEnvironment: false,
      letProjectsChooseCallVoice: false,
      letProjectsChooseCallVoiceProblem: null,
    });
  });

  test("a voice OneUptime does not offer: set, no voice, and the problem", () => {
    const values: Values = {
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Vicki-Neural",
    };
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(
        ServerTwilioEnvironment.read(values),
        ServerTwilioEnvironment.readCallVoice(values),
      );

    expect(answer.isCallVoiceSetByEnvironment).toBe(true);
    expect(answer.callVoice).toBe(null);
    expect(answer.callVoiceProblem).toContain("GLOBAL_TWILIO_CALL_VOICE");
    expect(answer.callVoiceProblem).toContain('"Polly.Vicki-Neural"');
    // The account's problems are the account's.
    expect(answer.problems).toEqual([]);
  });

  test("an answer made without the voice's reading says it is not set, as before #11064", () => {
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(ServerTwilioEnvironment.read(account()));

    expect(answer.isCallVoiceSetByEnvironment).toBe(false);
    expect(answer.callVoice).toBe(null);
    expect(answer.callVoiceProblem).toBe(null);
  });

  test("reads back as it was sent", () => {
    for (const values of [
      {},
      { [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Joanna-Neural" },
      { [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "nope" },
      account({ [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Brian-Neural" }),
      account({ [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "polly.brian-neural" }),
    ] as Array<Values>) {
      const answer: ServerTwilioEnvironmentAnswer =
        ServerTwilioEnvironment.toAnswer(
          ServerTwilioEnvironment.read(values),
          ServerTwilioEnvironment.readCallVoice(values),
        );

      expect(
        ServerTwilioEnvironment.answerFromJSON(
          JSON.parse(JSON.stringify(answer)),
        ),
      ).toEqual(answer);
    }
  });

  test("an older server's answer, without the voice's fields, reads as not set", () => {
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.answerFromJSON({
        isSetByEnvironment: true,
        usedFor: "calls-and-sms",
        accountSid: SID,
        hasAuthToken: true,
        primaryPhoneNumber: US,
        problems: [],
      });

    expect(answer.isCallVoiceSetByEnvironment).toBe(false);
    expect(answer.callVoice).toBe(null);
    expect(answer.callVoiceProblem).toBe(null);
  });

  test("each of the voice's fields is read only as its own type, and a voice only from OneUptime's list", () => {
    expect(
      ServerTwilioEnvironment.answerFromJSON({
        isCallVoiceSetByEnvironment: "true",
        callVoice: "Polly.Nobody-Neural",
        callVoiceProblem: 7,
      }),
    ).toMatchObject({
      isCallVoiceSetByEnvironment: false,
      callVoice: null,
      callVoiceProblem: null,
    });

    expect(
      ServerTwilioEnvironment.answerFromJSON({
        isCallVoiceSetByEnvironment: true,
        callVoice: " Polly.Amy-Neural ",
        callVoiceProblem: "   ",
      }),
    ).toMatchObject({
      isCallVoiceSetByEnvironment: true,
      callVoice: "Polly.Amy-Neural",
      callVoiceProblem: null,
    });
  });
});

describe("what a write to the saved voice is told", () => {
  test("names the variable, and where it is changed", () => {
    expect(SERVER_TWILIO_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE).toBe(
      "This server's call voice is set by the GLOBAL_TWILIO_CALL_VOICE environment variable, so it cannot be changed in the Admin Dashboard. Change it - twilio.callVoice in the Helm chart's values, or config.env with Docker Compose - and restart OneUptime.",
    );
  });
});

describe("the voices the variable takes", () => {
  test("are exactly the voices a master admin can choose in the Admin Dashboard", () => {
    expect(
      CALL_VOICES.map((voice: CallVoice): string => {
        return voice.value;
      }),
    ).toEqual([...CALL_VOICE_VALUES]);

    for (const value of CALL_VOICE_VALUES) {
      expect(voiceOf(value).voice).toBe(value);
    }
  });
});
