import ServerTwilioEnvironment, {
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VALUES,
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE,
  ServerTwilioEnvironmentAnswer,
  ServerTwilioEnvironmentVariable,
  ServerTwilioProjectCallVoicesReading,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import ProjectCallVoice from "../../../Types/Call/ProjectCallVoice";
import {
  MAX_REFUSED_VALUE_LENGTH,
  REFUSED_VALUE_CUT_MARK,
} from "../../../Utils/RefusedValue";
import { describe, expect, test } from "@jest/globals";

/*
 * WHETHER PROJECTS CHOOSE THEIR CALL VOICE, SET BY AN ENVIRONMENT VARIABLE
 * (#11462).
 *
 * GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE gives what a master admin
 * gives with Let projects choose their call voice - twilio.letProjects
 * ChooseCallVoice in the Helm chart's values, config.env with Docker
 * Compose - with the account's variables or without them. It is true or
 * false, in any case; anything else is a problem the server names by the
 * variable, and leaves every project on the server's voice: a consent to
 * a bill is never read into a typo, nor taken from the saved switch nobody
 * set the variable to. On OneUptime Cloud it is never the switch. These
 * pin the reading: what it takes and refuses, what the Admin Dashboard is
 * told, and what the server says as it starts.
 */

type Values = Record<string, string | undefined>;

const SELF_HOSTED: { isBillingEnabled: boolean } = { isBillingEnabled: false };
const CLOUD: { isBillingEnabled: boolean } = { isBillingEnabled: true };

function read(
  value: string | undefined,
  options: { isBillingEnabled: boolean } = SELF_HOSTED,
): ServerTwilioProjectCallVoicesReading {
  return ServerTwilioEnvironment.readLetProjectsChooseCallVoice(
    { [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: value },
    options,
  );
}

// What the Admin Dashboard is told, with only this variable set, as it reads it back.
function answerFor(
  values: Values,
  options: { isBillingEnabled: boolean } = SELF_HOSTED,
): ServerTwilioEnvironmentAnswer {
  const answer: ServerTwilioEnvironmentAnswer =
    ServerTwilioEnvironment.toAnswer(
      ServerTwilioEnvironment.read(values),
      ServerTwilioEnvironment.readCallVoice(values),
      ServerTwilioEnvironment.readLetProjectsChooseCallVoice(values, options),
    );

  return ServerTwilioEnvironment.answerFromJSON(
    JSON.parse(JSON.stringify(answer)),
  );
}

describe("the variable", () => {
  test("is named GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE, beside the call voice's", () => {
    expect(SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE).toBe(
      "GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE",
    );
    expect(
      SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE.startsWith(
        "GLOBAL_TWILIO_",
      ),
    ).toBe(true);
    expect(SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE).not.toBe(
      SERVER_TWILIO_CALL_VOICE_VARIABLE,
    );
  });

  test("is not one of the account's variables: it does not turn the account on, and the account does not need it", () => {
    expect(
      (SERVER_TWILIO_ENVIRONMENT_VARIABLES as ReadonlyArray<string>).includes(
        SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE,
      ),
    ).toBe(false);

    // Set alone, the account is not set by the environment.
    expect(
      ServerTwilioEnvironment.read({
        [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "true",
      }),
    ).toEqual({ isSet: false, account: null, problems: [] });
  });

  test("takes true and false, as the docs, the chart and config.example.env write them", () => {
    expect([...SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VALUES]).toEqual([
      "true",
      "false",
    ]);
  });

  test("a write the variable makes is refused with where it is changed instead", () => {
    expect(
      SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_SET_BY_ENVIRONMENT_MESSAGE,
    ).toBe(
      "Whether projects choose their call voice is set by the GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE environment variable on this server, so it cannot be changed in the Admin Dashboard. Change it - twilio.letProjectsChooseCallVoice in the Helm chart's values, or config.env with Docker Compose - and restart OneUptime.",
    );
  });
});

describe("unset", () => {
  test.each([
    ["left out", {}],
    [
      "undefined",
      { [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: undefined },
    ],
    ["empty", { [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "" }],
    [
      "spaces",
      { [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "   " },
    ],
    [
      "a tab and a newline",
      { [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "\t\n" },
    ],
  ])(
    "%s: not set, so the switch saved in the Admin Dashboard applies",
    (_label: string, values: Values) => {
      for (const options of [SELF_HOSTED, CLOUD]) {
        expect(
          ServerTwilioEnvironment.readLetProjectsChooseCallVoice(
            values,
            options,
          ),
        ).toEqual({ isSet: false, letProjectsChoose: false, problem: null });
      }
    },
  );

  test("anything that is not text is not set", () => {
    expect(
      ServerTwilioEnvironment.readLetProjectsChooseCallVoice(
        {
          [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]:
            true as unknown as string,
        },
        SELF_HOSTED,
      ),
    ).toEqual({ isSet: false, letProjectsChoose: false, problem: null });
  });

  test("says nothing as the server starts", () => {
    const reading: ServerTwilioProjectCallVoicesReading = read(undefined);

    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupNotice(
        reading,
      ),
    ).toBeNull();
    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupWarning(
        reading,
      ),
    ).toBeNull();
  });

  test("a reading is a new object each time: one caller cannot change another's", () => {
    expect(read(undefined)).not.toBe(read(undefined));
  });
});

describe("set to true or false, on a self-hosted server", () => {
  test.each([
    ["true", true],
    ["false", false],
    ["TRUE", true],
    ["False", false],
    ["tRuE", true],
    ["  true\n", true],
    ["\tfalse ", false],
    ["true\r\n", true],
  ])("%j is the switch, %s, with no problem", (value: string, on: boolean) => {
    expect(read(value)).toEqual({
      isSet: true,
      letProjectsChoose: on,
      problem: null,
    });
  });

  test("true says so as the server starts, by the variable's name, and that the switch in the Admin Dashboard is not used", () => {
    const reading: ServerTwilioProjectCallVoicesReading = read("true");

    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupNotice(
        reading,
      ),
    ).toBe(
      "Projects choose the voice of their calls through the server's Twilio account: GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE is true. The switch in the Admin Dashboard is not used.",
    );
    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupWarning(
        reading,
      ),
    ).toBeNull();
  });

  test("false says so too: it is as much the switch as true is", () => {
    const reading: ServerTwilioProjectCallVoicesReading = read("false");

    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupNotice(
        reading,
      ),
    ).toBe(
      "Projects do not choose the voice of their calls through the server's Twilio account: GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE is false. The switch in the Admin Dashboard is not used.",
    );
    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupWarning(
        reading,
      ),
    ).toBeNull();
  });

  test("true offers projects a voice, false does not, as the master admin's switch would", () => {
    expect(
      ProjectCallVoice.areOffered({
        isBillingEnabled: false,
        letProjectsChooseCallVoice: read("true").letProjectsChoose,
      }),
    ).toBe(true);
    expect(
      ProjectCallVoice.areOffered({
        isBillingEnabled: false,
        letProjectsChooseCallVoice: read("false").letProjectsChoose,
      }),
    ).toBe(false);
  });

  test("it is read with the account's variables or without them, and never stops the account from being read", () => {
    const values: Values = {
      [ServerTwilioEnvironmentVariable.AccountSid]:
        "AC00000000000000000000000000000001",
      [ServerTwilioEnvironmentVariable.AuthToken]: "token",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
      [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "true",
    };

    expect(
      ServerTwilioEnvironment.readLetProjectsChooseCallVoice(
        values,
        SELF_HOSTED,
      ),
    ).toEqual({ isSet: true, letProjectsChoose: true, problem: null });
    expect(ServerTwilioEnvironment.read(values).problems).toEqual([]);
    expect(
      ServerTwilioEnvironment.isUsable(ServerTwilioEnvironment.read(values)),
    ).toBe(true);
  });
});

describe("set to anything else, on a self-hosted server", () => {
  test.each([
    ["yes"],
    ["no"],
    ["1"],
    ["0"],
    ["on"],
    ["off"],
    ["truee"],
    ["true false"],
    ["t"],
    ['"true"'],
    ["'false'"],
    ["null"],
    ["undefined"],
    ["Polly.Joanna-Neural"],
    ["wahr"],
    ["真"],
  ])(
    "%j is the switch - no - and a problem, by the variable's name",
    (value: string) => {
      const reading: ServerTwilioProjectCallVoicesReading = read(value);

      expect(reading.isSet).toBe(true);
      expect(reading.letProjectsChoose).toBe(false);
      expect(reading.problem).toBe(
        `GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE: "${value}" is neither true nor false, so projects speak with the server's voice until it is fixed. Set it to true or false, or leave it empty to set Let projects choose their call voice in the Admin Dashboard.`,
      );
    },
  );

  test("the value is repeated without the whitespace around it", () => {
    expect(read("  yes \n").problem).toContain('"yes" is neither');
  });

  test("a value of any length is repeated cut, never whole", () => {
    const value: string = "y".repeat(10000);
    const problem: string = read(value).problem!;

    expect(problem).toContain(
      `"${"y".repeat(MAX_REFUSED_VALUE_LENGTH)}${REFUSED_VALUE_CUT_MARK}"`,
    );
    expect(problem.length).toBeLessThan(400);
  });

  test("it is said as the server starts, as a warning, and no notice says it is in effect", () => {
    const reading: ServerTwilioProjectCallVoicesReading = read("yes");

    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupWarning(
        reading,
      ),
    ).toBe(reading.problem);
    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupNotice(
        reading,
      ),
    ).toBeNull();
  });

  test("it offers projects no voice: never the switch saved in the Admin Dashboard, whatever that says", () => {
    expect(
      ProjectCallVoice.areOffered({
        isBillingEnabled: false,
        letProjectsChooseCallVoice: read("yes").letProjectsChoose,
      }),
    ).toBe(false);
  });
});

describe("on OneUptime Cloud", () => {
  test.each([["true"], ["false"], ["yes"], ["TRUE"]])(
    "%j is never the switch: it is ignored, and said to be",
    (value: string) => {
      const reading: ServerTwilioProjectCallVoicesReading = read(value, CLOUD);

      expect(reading.isSet).toBe(false);
      expect(reading.letProjectsChoose).toBe(false);
      expect(reading.problem).toBe(
        "GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE is set, but this server bills its projects for calls, as OneUptime Cloud does: projects never choose the voice of their calls through its Twilio account, so the variable is ignored. Remove it.",
      );
    },
  );

  test("the server says so as it starts, as a warning, and nothing says the variable is in effect", () => {
    const reading: ServerTwilioProjectCallVoicesReading = read("true", CLOUD);

    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupWarning(
        reading,
      ),
    ).toContain("is ignored");
    expect(
      ServerTwilioEnvironment.getLetProjectsChooseCallVoiceStartupNotice(
        reading,
      ),
    ).toBeNull();
  });

  test("true there offers projects no voice", () => {
    expect(
      ProjectCallVoice.areOffered({
        isBillingEnabled: true,
        letProjectsChooseCallVoice: read("true", CLOUD).letProjectsChoose,
      }),
    ).toBe(false);
  });
});

describe("what the Admin Dashboard is told", () => {
  test("unset: the switch is the saved one", () => {
    expect(answerFor({})).toMatchObject({
      isLetProjectsChooseCallVoiceSetByEnvironment: false,
      letProjectsChooseCallVoice: false,
      letProjectsChooseCallVoiceProblem: null,
    });
  });

  test("true: set, and on", () => {
    expect(
      answerFor({
        [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "true",
      }),
    ).toMatchObject({
      isLetProjectsChooseCallVoiceSetByEnvironment: true,
      letProjectsChooseCallVoice: true,
      letProjectsChooseCallVoiceProblem: null,
    });
  });

  test("false: set, and off", () => {
    expect(
      answerFor({
        [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "False",
      }),
    ).toMatchObject({
      isLetProjectsChooseCallVoiceSetByEnvironment: true,
      letProjectsChooseCallVoice: false,
      letProjectsChooseCallVoiceProblem: null,
    });
  });

  test("anything else: set, off, and what is wrong", () => {
    const answer: ServerTwilioEnvironmentAnswer = answerFor({
      [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "maybe",
    });

    expect(answer.isLetProjectsChooseCallVoiceSetByEnvironment).toBe(true);
    expect(answer.letProjectsChooseCallVoice).toBe(false);
    expect(answer.letProjectsChooseCallVoiceProblem).toContain(
      '"maybe" is neither true nor false',
    );
  });

  test("on OneUptime Cloud: not set, whatever it says, with why", () => {
    const answer: ServerTwilioEnvironmentAnswer = answerFor(
      { [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "true" },
      CLOUD,
    );

    expect(answer.isLetProjectsChooseCallVoiceSetByEnvironment).toBe(false);
    expect(answer.letProjectsChooseCallVoice).toBe(false);
    expect(answer.letProjectsChooseCallVoiceProblem).toContain("is ignored");
  });

  test("beside the account's variables and the call voice's, each read on its own", () => {
    const answer: ServerTwilioEnvironmentAnswer = answerFor({
      [ServerTwilioEnvironmentVariable.AccountSid]:
        "AC00000000000000000000000000000001",
      [ServerTwilioEnvironmentVariable.AuthToken]: "token",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
      [SERVER_TWILIO_CALL_VOICE_VARIABLE]: "Polly.Brian-Neural",
      [SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE]: "true",
    });

    expect(answer).toMatchObject({
      isSetByEnvironment: true,
      hasAuthToken: true,
      isCallVoiceSetByEnvironment: true,
      callVoice: "Polly.Brian-Neural",
      isLetProjectsChooseCallVoiceSetByEnvironment: true,
      letProjectsChooseCallVoice: true,
    });
    // Never the auth token.
    expect(JSON.stringify(answer)).not.toContain('"token"');
  });

  test("toAnswer without the switch's reading says it is not set, as a caller of the release before passes none", () => {
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.toAnswer(
        ServerTwilioEnvironment.read({}),
        ServerTwilioEnvironment.readCallVoice({}),
      );

    expect(answer.isLetProjectsChooseCallVoiceSetByEnvironment).toBe(false);
    expect(answer.letProjectsChooseCallVoice).toBe(false);
    expect(answer.letProjectsChooseCallVoiceProblem).toBeNull();
  });
});

describe("the answer read back", () => {
  test("from a server of the release before, which says nothing of the switch: not set, so the saved switch applies", () => {
    const answer: ServerTwilioEnvironmentAnswer =
      ServerTwilioEnvironment.answerFromJSON({
        isSetByEnvironment: false,
        problems: [],
        isCallVoiceSetByEnvironment: false,
        callVoice: null,
        callVoiceProblem: null,
      });

    expect(answer.isLetProjectsChooseCallVoiceSetByEnvironment).toBe(false);
    expect(answer.letProjectsChooseCallVoice).toBe(false);
    expect(answer.letProjectsChooseCallVoiceProblem).toBeNull();
  });

  test("only true is true, and only while the variable is the switch", () => {
    for (const [set, on, expected] of [
      [true, true, true],
      [true, false, false],
      [false, true, false],
      ["true", true, false],
      [true, "true", false],
      [1, 1, false],
      [null, null, false],
    ] as Array<[unknown, unknown, boolean]>) {
      const answer: ServerTwilioEnvironmentAnswer =
        ServerTwilioEnvironment.answerFromJSON({
          isLetProjectsChooseCallVoiceSetByEnvironment: set,
          letProjectsChooseCallVoice: on,
        });

      expect([set, on, answer.letProjectsChooseCallVoice]).toEqual([
        set,
        on,
        expected,
      ]);
      expect(answer.isLetProjectsChooseCallVoiceSetByEnvironment).toBe(
        set === true,
      );
    }
  });

  test("a problem that is not words is none", () => {
    for (const problem of [7, "", "   ", null, [], {}]) {
      expect(
        ServerTwilioEnvironment.answerFromJSON({
          isLetProjectsChooseCallVoiceSetByEnvironment: true,
          letProjectsChooseCallVoiceProblem: problem,
        }).letProjectsChooseCallVoiceProblem,
      ).toBeNull();
    }
  });

  test("nothing that is an answer reads as nothing set", () => {
    for (const json of [null, undefined, "true", 42, [], true]) {
      const answer: ServerTwilioEnvironmentAnswer =
        ServerTwilioEnvironment.answerFromJSON(json);

      expect(answer.isLetProjectsChooseCallVoiceSetByEnvironment).toBe(false);
      expect(answer.letProjectsChooseCallVoice).toBe(false);
      expect(answer.letProjectsChooseCallVoiceProblem).toBeNull();
    }
  });
});
