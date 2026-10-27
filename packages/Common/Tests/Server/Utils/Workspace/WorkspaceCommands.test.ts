import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceCommands, {
  WORKSPACE_COMMANDS,
  WorkspaceCommandDefinition,
  WorkspaceCommandInput,
  WorkspaceCommandName,
} from "../../../../Server/Utils/Workspace/WorkspaceCommands";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * CUSTOMER FEEDBACK #5: "I noticed it registers as /incident, /maintenance.
 * This can easily conflict with the other apps we have. Can we have a prefix
 * namespace e.g. /irm incident, /irm maintenance?"
 *
 * Every command is now a word after /oneuptime in Slack - and the same word
 * typed to the Microsoft Teams bot. WorkspaceCommands reads those words for
 * both chats and lists them for both. These pin how text is read (every
 * command, its aliases, letter case, spaces, punctuation, empty text, a
 * question, a misspelt command) and what the help says, word for word.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

function parse(text: string | null | undefined): WorkspaceCommandInput {
  return WorkspaceCommands.parse(text);
}

describe("WorkspaceCommands.parse: each command", () => {
  test.each([
    [
      "incident Checkout is down",
      WorkspaceCommandName.Incident,
      "Checkout is down",
    ],
    ["incident", WorkspaceCommandName.Incident, ""],
    [
      "maintenance Database upgrade",
      WorkspaceCommandName.Maintenance,
      "Database upgrade",
    ],
    ["maintenance", WorkspaceCommandName.Maintenance, ""],
    ["oncall", WorkspaceCommandName.OnCall, ""],
    [
      "page @nawaz The checkout API is down",
      WorkspaceCommandName.Page,
      "@nawaz The checkout API is down",
    ],
    ["page", WorkspaceCommandName.Page, ""],
    [
      "ask which monitors are down?",
      WorkspaceCommandName.Ask,
      "which monitors are down?",
    ],
    ["help", WorkspaceCommandName.Help, ""],
  ])(
    "%j is the %s command, followed by %j",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test.each([
    [
      "create incident Checkout is down",
      WorkspaceCommandName.Incident,
      "Checkout is down",
    ],
    [
      "create maintenance Database upgrade",
      WorkspaceCommandName.Maintenance,
      "Database upgrade",
    ],
    ["on-call", WorkspaceCommandName.OnCall, ""],
    ["on call", WorkspaceCommandName.OnCall, ""],
    ["?", WorkspaceCommandName.Help, ""],
  ])(
    "the alias %j is the %s command",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test("every name and alias of every command reads as that command", () => {
    for (const definition of WORKSPACE_COMMANDS) {
      for (const spelling of [definition.name, ...definition.aliases]) {
        const input: WorkspaceCommandInput = parse(
          definition.argument ? `${spelling} something` : spelling,
        );

        expect({ spelling, command: input.command }).toEqual({
          spelling,
          command: definition.name,
        });
      }
    }
  });

  test("the commands are incident, maintenance, oncall, page, ask and help, in that order", () => {
    expect(
      WORKSPACE_COMMANDS.map((definition: WorkspaceCommandDefinition) => {
        return definition.name;
      }),
    ).toEqual(["incident", "maintenance", "oncall", "page", "ask", "help"]);
  });

  /*
   * Like incident and maintenance, page takes what follows it: a question
   * that only starts with the word ("page views this week?") opens the page
   * form, which pages nobody until it is submitted. `ask` asks it.
   */
  test("page keeps everything after it, as typed; ask asks a question that starts with the word", () => {
    expect(parse("Page: @nawaz, @simon - db down")).toEqual({
      command: WorkspaceCommandName.Page,
      text: "@nawaz, @simon - db down",
    });
    expect(parse("page views this week?")).toEqual({
      command: WorkspaceCommandName.Page,
      text: "views this week?",
    });
    expect(parse("ask page views this week?")).toEqual({
      command: WorkspaceCommandName.Ask,
      text: "page views this week?",
    });
  });

  test("page is never read as a misspelling: it is too short to tell from the words a question starts with", () => {
    for (const word of ["pages", "paged", "pace", "sage", "pgae"]) {
      expect(parse(`${word} the database`).misspelt).toBeUndefined();
      expect(parse(`${word} the database`).command).toBeNull();
    }
  });
});

describe("WorkspaceCommands.getArgumentHint", () => {
  test("what may follow each command, as the help and the Slack app's usage hint write it", () => {
    expect(
      WORKSPACE_COMMANDS.map((definition: WorkspaceCommandDefinition) => {
        return [definition.name, WorkspaceCommands.getArgumentHint(definition)];
      }),
    ).toEqual([
      ["incident", "[title or number]"],
      ["maintenance", "[title]"],
      ["oncall", ""],
      ["page", "[who] [message]"],
      ["ask", "[question]"],
      ["help", ""],
    ]);
  });
});

describe("WorkspaceCommands.parse: letter case, spaces and punctuation", () => {
  test.each([
    [
      "INCIDENT Checkout is down",
      WorkspaceCommandName.Incident,
      "Checkout is down",
    ],
    [
      "Incident API p99 > 2s on EU-West",
      WorkspaceCommandName.Incident,
      "API p99 > 2s on EU-West",
    ],
    ["Create Incident Disk full", WorkspaceCommandName.Incident, "Disk full"],
    [
      "MAINTENANCE Q3 Kernel Upgrade (Frankfurt)",
      WorkspaceCommandName.Maintenance,
      "Q3 Kernel Upgrade (Frankfurt)",
    ],
    ["OnCall", WorkspaceCommandName.OnCall, ""],
    ["ON-CALL", WorkspaceCommandName.OnCall, ""],
    ["HELP", WorkspaceCommandName.Help, ""],
    [
      "Ask Why did checkout latency spike?",
      WorkspaceCommandName.Ask,
      "Why did checkout latency spike?",
    ],
  ])(
    "%j: the command in any case, what follows as typed",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test.each([
    ["   incident    Checkout   is down   ", "Checkout   is down"],
    ["\tincident\tCheckout is down\n", "Checkout is down"],
    ["incident\u{00a0}Checkout is down", "Checkout is down"],
    ["create    incident   Disk full", "Disk full"],
  ])(
    "%j: spaces around the command are dropped, those inside the title kept",
    (text: string, rest: string) => {
      expect(parse(text)).toEqual({
        command: WorkspaceCommandName.Incident,
        text: rest,
      });
    },
  );

  test("a form takes the title on one line, each run of space one space", () => {
    expect(WorkspaceCommands.toTitle("  Checkout   is\n down\t now ")).toBe(
      "Checkout is down now",
    );
    expect(WorkspaceCommands.toTitle("")).toBe("");
  });

  test.each([
    ["help?", WorkspaceCommandName.Help, ""],
    ["help!", WorkspaceCommandName.Help, ""],
    ["oncall?", WorkspaceCommandName.OnCall, ""],
    ["on call?", WorkspaceCommandName.OnCall, ""],
    [
      "incident: Checkout is down",
      WorkspaceCommandName.Incident,
      "Checkout is down",
    ],
    [
      "maintenance, Database upgrade",
      WorkspaceCommandName.Maintenance,
      "Database upgrade",
    ],
  ])(
    "%j: a command may be typed with punctuation after it",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test.each([
    ["help?!", WorkspaceCommandName.Help, ""],
    ["help...", WorkspaceCommandName.Help, ""],
    ["HELP!!!", WorkspaceCommandName.Help, ""],
    ["oncall.,:!?", WorkspaceCommandName.OnCall, ""],
    ["on-call...", WorkspaceCommandName.OnCall, ""],
    ["on call?!", WorkspaceCommandName.OnCall, ""],
    [
      "incident:: Checkout is down",
      WorkspaceCommandName.Incident,
      "Checkout is down",
    ],
    [
      "create incident!!! Disk full",
      WorkspaceCommandName.Incident,
      "Disk full",
    ],
    [
      "maintenance,,, Database upgrade",
      WorkspaceCommandName.Maintenance,
      "Database upgrade",
    ],
    [
      "ask: which monitors are down?",
      WorkspaceCommandName.Ask,
      "which monitors are down?",
    ],
  ])(
    "%j: every mark after a command is dropped, however many",
    (text: string, command: WorkspaceCommandName, rest: string) => {
      expect(parse(text)).toEqual({ command: command, text: rest });
    },
  );

  test.each([":", ",", ".", "!", "?"])(
    "%j is punctuation a command may be typed with",
    (mark: string) => {
      expect(parse(`help${mark}`)).toEqual({
        command: WorkspaceCommandName.Help,
        text: "",
      });
      expect(parse(`incident${mark} Checkout is down`)).toEqual({
        command: WorkspaceCommandName.Incident,
        text: "Checkout is down",
      });
    },
  );

  test.each([";", "-", "…", ")", '"', "'", "/", "*", "~"])(
    "%j is not: a command typed with it is a question",
    (mark: string) => {
      expect(parse(`help${mark}`)).toEqual({
        command: null,
        text: `help${mark}`,
      });
    },
  );

  test.each([
    // The marks are before the word, or inside it.
    "?help",
    "!incident Checkout is down",
    "he!p",
    "help?me",
    "help?!x",
    "on.call",
    // The mark is after a first word of two, not after the command.
    "create: incident Disk full",
    "on, call",
  ])(
    "%j: only marks at the very end of a command are dropped",
    (text: string) => {
      expect(parse(text).command).toBeNull();
      expect(parse(text).text).toBe(text);
    },
  );

  test.each(["??", "?!", "...", "!!!", ":", ",.!?:"])(
    "%j - marks alone - is a question, and never a command misspelt",
    (text: string) => {
      expect(parse(text)).toEqual({ command: null, text: text });
    },
  );

  /*
   * Every word of up to five characters that can be made of a letter and
   * the five marks, after a command: 9,330 of them. It is the command when
   * all of them are marks, and never otherwise.
   */
  test("a command followed by any characters is that command only when every one of them is a mark", () => {
    const alphabet: Array<string> = ["x", ":", ",", ".", "!", "?"];
    const wrong: Array<string> = [];
    let endings: Array<string> = [""];
    let checked: number = 0;

    for (let length: number = 1; length <= 5; length++) {
      endings = endings.flatMap((ending: string): Array<string> => {
        return alphabet.map((character: string): string => {
          return ending + character;
        });
      });

      for (const ending of endings) {
        const isMarksOnly: boolean = !ending.includes("x");
        checked++;

        for (const [command, name] of [
          ["help", WorkspaceCommandName.Help],
          ["on call", WorkspaceCommandName.OnCall],
        ] as Array<[string, WorkspaceCommandName]>) {
          const input: WorkspaceCommandInput = parse(`${command}${ending}`);

          if (input.command !== (isMarksOnly ? name : null)) {
            wrong.push(`${command}${ending}`);
          }
        }

        // A command that takes a title keeps the title as typed.
        const withTitle: WorkspaceCommandInput = parse(
          `incident${ending} Disk full${ending}`,
        );

        if (
          isMarksOnly &&
          (withTitle.command !== WorkspaceCommandName.Incident ||
            withTitle.text !== `Disk full${ending}`)
        ) {
          wrong.push(`incident${ending} Disk full${ending}`);
        }

        if (!isMarksOnly && withTitle.command !== null) {
          wrong.push(`incident${ending} Disk full${ending}`);
        }
      }
    }

    expect(checked).toBe(9330);
    expect(wrong).toEqual([]);
  });

  test("a single ? is the help", () => {
    expect(parse("?")).toEqual({
      command: WorkspaceCommandName.Help,
      text: "",
    });
    expect(parse(" ? ")).toEqual({
      command: WorkspaceCommandName.Help,
      text: "",
    });
  });

  test("the marks after a command are dropped; those of what follows it are kept", () => {
    expect(parse("incident: Checkout is down!!!")).toEqual({
      command: WorkspaceCommandName.Incident,
      text: "Checkout is down!!!",
    });
    expect(parse("ask, is checkout down?!")).toEqual({
      command: WorkspaceCommandName.Ask,
      text: "is checkout down?!",
    });
  });

  test.each(["", "   ", "\n\t ", null, undefined])(
    "%j - nothing at all - asks for the commands",
    (text: string | null | undefined) => {
      expect(parse(text)).toEqual({
        command: WorkspaceCommandName.Help,
        text: "",
      });
    },
  );

  test.each(["ask", "ASK", "  ask  ", "ask?"])(
    "%j - ask with no question - asks for the commands",
    (text: string) => {
      expect(parse(text)).toEqual({
        command: WorkspaceCommandName.Help,
        text: "",
      });
    },
  );

  test("ask keeps everything after it, a command's words included", () => {
    expect(parse("ask   incident Checkout is down")).toEqual({
      command: WorkspaceCommandName.Ask,
      text: "incident Checkout is down",
    });
  });
});

/*
 * A chat sends whatever a person typed, and a "word" is as long as they made
 * it: Slack sends up to 40,000 characters. The marks after a command were
 * read with a pattern for "punctuation up to the end", which was tried from
 * every mark of a run that is not at the end ("!!!!x!") - in time that grows
 * with the square of the word, and once for each command's name. One
 * 40,000-character word took 2 seconds a name. These read ten times that.
 */
describe("WorkspaceCommands.parse: text as long as a chat sends, and longer", () => {
  const LONG: number = 400000;
  const LIMIT_MS: number = 2000;

  function timed(text: string): { input: WorkspaceCommandInput; ms: number } {
    const startedAt: number = performance.now();
    const input: WorkspaceCommandInput = parse(text);

    return { input: input, ms: performance.now() - startedAt };
  }

  test.each([":", ",", ".", "!", "?"])(
    "a word of %j, with one letter before the last, is read in time that grows with its length",
    (mark: string) => {
      const word: string = `${mark.repeat(LONG)}x${mark}`;
      const { input, ms } = timed(word);

      expect(input).toEqual({ command: null, text: word });
      expect(ms).toBeLessThan(LIMIT_MS);
    },
  );

  test("a word of every mark in turn, with one letter before the last", () => {
    const word: string = `${":,.!?".repeat(LONG / 5)}x?`;
    const { input, ms } = timed(word);

    expect(input).toEqual({ command: null, text: word });
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  test.each([
    ["help", WorkspaceCommandName.Help],
    ["oncall", WorkspaceCommandName.OnCall],
    ["on-call", WorkspaceCommandName.OnCall],
    ["on call", WorkspaceCommandName.OnCall],
    ["?", WorkspaceCommandName.Help],
  ])(
    "%j with that many marks after it is still the command",
    (command: string, name: WorkspaceCommandName) => {
      // "?" followed by marks is marks alone: a question (see above).
      const text: string = `${command}${"!".repeat(LONG)}`;
      const { input, ms } = timed(text);

      expect(input).toEqual(
        command === "?"
          ? { command: null, text: text }
          : { command: name, text: "" },
      );
      expect(ms).toBeLessThan(LIMIT_MS);
    },
  );

  test("a command with that many marks after it, then a title", () => {
    const { input, ms } = timed(`incident${":".repeat(LONG)} Checkout is down`);

    expect(input).toEqual({
      command: WorkspaceCommandName.Incident,
      text: "Checkout is down",
    });
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  test("a command, then a run of marks that does not end the word: a question", () => {
    const text: string = `help${"?".repeat(LONG)}x? me`;
    const { input, ms } = timed(text);

    expect(input).toEqual({ command: null, text: text });
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  test("a second word of marks, where a command of two words would end", () => {
    const text: string = `create ${"!".repeat(LONG)}x! Disk full`;
    const { input, ms } = timed(text);

    expect(input).toEqual({ command: null, text: text });
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  test("a title of marks is kept as typed", () => {
    const title: string = `${"!".repeat(LONG)}x!`;
    const { input, ms } = timed(`incident ${title}`);

    expect(input).toEqual({
      command: WorkspaceCommandName.Incident,
      text: title,
    });
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  test.each([
    ["letters", "a".repeat(LONG)],
    ["a misspelt command run on", `incidnet${"a".repeat(LONG)}`],
    ["a misspelt command, then marks", `incidnet${"!".repeat(LONG)}x!`],
    ["a command run on", `incident${"s".repeat(LONG)}`],
  ])(
    "one long word of %s is a question, and no command misspelt",
    (_name: string, word: string) => {
      const { input, ms } = timed(word);

      expect(input).toEqual({ command: null, text: word });
      expect(input.misspelt).toBeUndefined();
      expect(ms).toBeLessThan(LIMIT_MS);
    },
  );

  test("a misspelt command with that many marks after it is still read as one", () => {
    const text: string = `incidnet${"!".repeat(LONG)} Checkout is down`;
    const { input, ms } = timed(text);

    expect(input).toEqual({
      command: null,
      text: text,
      misspelt: {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: "Checkout is down",
      },
    });
    expect(ms).toBeLessThan(LIMIT_MS);
  });

  test.each([
    ["short words", "a ".repeat(LONG / 2), null],
    ["marks, each a word", "! ".repeat(LONG / 2), null],
    [
      "spaces, then a command",
      `${" ".repeat(LONG)}help`,
      WorkspaceCommandName.Help,
    ],
    [
      "tabs and new lines between a command's two words",
      `on${"\t\n".repeat(LONG / 2)}call`,
      WorkspaceCommandName.OnCall,
    ],
    [
      "spaces between a command and its title",
      `incident${" ".repeat(LONG)}Checkout is down`,
      WorkspaceCommandName.Incident,
    ],
  ])(
    "that many characters of %s",
    (_name: string, text: string, command: WorkspaceCommandName | null) => {
      const { input, ms } = timed(text);

      expect(ms).toBeLessThan(LIMIT_MS);

      if (command === null) {
        // A question, as typed.
        expect(input).toEqual({ command: null, text: text.trim() });
        return;
      }

      expect(input).toEqual({
        command: command,
        text:
          command === WorkspaceCommandName.Incident ? "Checkout is down" : "",
      });
    },
  );

  test("a long title is put on one line in time that grows with its length", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const title: string = WorkspaceCommands.toTitle(
          `Checkout${" \t\n".repeat(LONG / 3)}is down`,
        );

        expect(title).toBe("Checkout is down");
      },
      limitInMs: LIMIT_MS,
    });
    expect(timed.inMs).toBeLessThan(LIMIT_MS);
  });

  test("words far apart in length are never compared letter by letter", () => {
    const distance: SpyInstance<typeof WorkspaceCommands.getEditDistance> =
      jest.spyOn(WorkspaceCommands, "getEditDistance");

    parse("a".repeat(LONG));
    parse(`incidnet${"a".repeat(LONG)}`);

    expect(distance).not.toHaveBeenCalled();

    /*
     * A word is compared with the commands at most two letters longer or
     * shorter (incident, maintenance) or one (oncall), and with no other.
     */
    const compared: (word: string) => Array<string> = (
      word: string,
    ): Array<string> => {
      distance.mockClear();
      parse(word);

      return distance.mock.calls.map((call: [string, string]) => {
        return call[1];
      });
    };

    // 5 letters: three short of "incident", one short of "oncall".
    expect(compared("check")).toEqual(["oncall"]);
    // 6: two short of "incident", as long as "oncall".
    expect(compared("status")).toEqual(["incident", "oncall"]);
    // 7: one short of "incident", one over "oncall".
    expect(compared("deploys")).toEqual(["incident", "oncall"]);
    // 8: as long as "incident", two over "oncall", three short of "maintenance".
    expect(compared("deployed")).toEqual(["incident"]);
    // 9: one over "incident", two short of "maintenance".
    expect(compared("deploying")).toEqual(["incident", "maintenance"]);
    // 10: two over "incident".
    expect(compared("deployment")).toEqual(["incident", "maintenance"]);
    // 11: three over "incident", as long as "maintenance".
    expect(compared("deployments")).toEqual(["maintenance"]);
    // 13: two over "maintenance"; 14: three over.
    expect(compared("deploymentsxy")).toEqual(["maintenance"]);
    expect(compared("deploymentsxyz")).toEqual([]);
    // Shorter than any misspelling is read from.
    expect(compared("dep")).toEqual([]);
  });
});

describe("WorkspaceCommands.parse: a command misspelt, by how long the word is", () => {
  test.each([
    // Two letters short of "incident", and of "maintenance".
    ["incide Checkout", "incide", WorkspaceCommandName.Incident, "Checkout"],
    [
      "maintenan Database",
      "maintenan",
      WorkspaceCommandName.Maintenance,
      "Database",
    ],
    // Two letters over.
    ["incidentxy", "incidentxy", WorkspaceCommandName.Incident, ""],
    ["maintenancexy", "maintenancexy", WorkspaceCommandName.Maintenance, ""],
    // One letter short of "oncall", and one over.
    ["oncal", "oncal", WorkspaceCommandName.OnCall, ""],
    ["oncalll", "oncalll", WorkspaceCommandName.OnCall, ""],
  ])(
    "%j is as far in length as a misspelling goes",
    (
      text: string,
      word: string,
      command: WorkspaceCommandName,
      rest: string,
    ) => {
      expect(parse(text)).toEqual({
        command: null,
        text: text,
        misspelt: { word: word, command: command, text: rest },
      });
    },
  );

  test.each(["incid", "incidentxyz", "maintena", "maintenancexyz", "oncalllx"])(
    "%j is further in length than a misspelling goes: a question",
    (text: string) => {
      expect(parse(text)).toEqual({ command: null, text: text });
    },
  );
});

describe("WorkspaceCommands.parse: questions for OneUptime AI", () => {
  test.each([
    "which monitors are down?",
    "why did checkout latency spike last night?",
    "status",
    "incidents today?",
    "incidents",
    "maintenances this week",
    "oncalls",
    "creative incident",
    "create incidents",
    "create incident-report for yesterday",
    "create maintenance-window for db",
    "please create incident Database Is Down",
    "show active incidents",
    "what is incident 42 about?",
  ])("%j is a question, as typed", (text: string) => {
    expect(parse(text)).toEqual({ command: null, text: text });
  });

  test.each([
    "help me find slow queries",
    "oncall for the database team?",
    "on call this weekend?",
    "help?? me",
  ])(
    "%j - a command that takes nothing, with more after it - is a question",
    (text: string) => {
      expect(parse(text)).toEqual({ command: null, text: text });
    },
  );

  test.each([
    // Short words sit too close to a question's: never read as a misspelling.
    "helm upgrade failed",
    "ack INC-42",
    "hlep",
    "inc 42",
    // A word with an apostrophe is a sentence's.
    "incident's root cause?",
    "incident\u{2019}s root cause?",
  ])("%j is a question, not a misspelt command", (text: string) => {
    const input: WorkspaceCommandInput = parse(text);

    expect(input.command).toBeNull();
    expect(input.misspelt).toBeUndefined();
    expect(input.text).toBe(text);
  });
});

describe("WorkspaceCommands.parse: a command misspelt", () => {
  test.each([
    [
      "incidnet Checkout is down",
      "incidnet",
      WorkspaceCommandName.Incident,
      "Checkout is down",
    ],
    ["indicent", "indicent", WorkspaceCommandName.Incident, ""],
    [
      "Incidnet: Checkout",
      "Incidnet",
      WorkspaceCommandName.Incident,
      "Checkout",
    ],
    [
      "maintenence Database upgrade",
      "maintenence",
      WorkspaceCommandName.Maintenance,
      "Database upgrade",
    ],
    ["maintainance", "maintainance", WorkspaceCommandName.Maintenance, ""],
    [
      "maintanance window",
      "maintanance",
      WorkspaceCommandName.Maintenance,
      "window",
    ],
    ["oncal", "oncal", WorkspaceCommandName.OnCall, ""],
    ["onclal", "onclal", WorkspaceCommandName.OnCall, ""],
  ])(
    "%j looks like a command misspelt: answered with the command it looks like, never sent to AI",
    (
      text: string,
      word: string,
      command: WorkspaceCommandName,
      rest: string,
    ) => {
      expect(parse(text)).toEqual({
        command: null,
        text: text,
        misspelt: { word: word, command: command, text: rest },
      });
    },
  );

  test("how many letters it takes to turn one word into another, a swap of two counting once", () => {
    expect(WorkspaceCommands.getEditDistance("incident", "incident")).toBe(0);
    expect(WorkspaceCommands.getEditDistance("incidnet", "incident")).toBe(1);
    expect(WorkspaceCommands.getEditDistance("incidet", "incident")).toBe(1);
    expect(WorkspaceCommands.getEditDistance("inncident", "incident")).toBe(1);
    expect(WorkspaceCommands.getEditDistance("indicent", "incident")).toBe(2);
    expect(
      WorkspaceCommands.getEditDistance("maintenence", "maintenance"),
    ).toBe(1);
    expect(
      WorkspaceCommands.getEditDistance("maintainance", "maintenance"),
    ).toBe(2);
    expect(WorkspaceCommands.getEditDistance("", "abc")).toBe(3);
    expect(WorkspaceCommands.getEditDistance("abc", "")).toBe(3);
    expect(WorkspaceCommands.getEditDistance("status", "oncall")).toBe(6);
  });
});

describe("WorkspaceCommands.getUsage", () => {
  test("Slack types each command after /oneuptime - or after the command the workspace runs OneUptime with", () => {
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.Slack,
        command: WorkspaceCommandName.Incident,
      }),
    ).toBe("/oneuptime incident");
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.Slack,
        command: WorkspaceCommandName.OnCall,
        slackCommand: "/irm",
      }),
    ).toBe("/irm oncall");
    // Not a command: the default.
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.Slack,
        command: WorkspaceCommandName.Help,
        slackCommand: "irm",
      }),
    ).toBe("/oneuptime help");
  });

  test("Microsoft Teams types the word alone", () => {
    expect(
      WorkspaceCommands.getUsage({
        workspaceType: WorkspaceType.MicrosoftTeams,
        command: WorkspaceCommandName.Maintenance,
        slackCommand: "/irm",
      }),
    ).toBe("maintenance");
  });
});

/*
 * The help, word for word. One short line a command - a list a person scans
 * in a chat, on a phone too - then one example of a command and one of a
 * question.
 */
const SLACK_HELP_LINES: Array<string> = [
  "👋 **Here's what `/oneuptime` can do**",
  "- `/oneuptime incident [title or number]`: declare an incident, or act on one by its number",
  "- `/oneuptime maintenance [title]`: schedule maintenance",
  "- `/oneuptime oncall`: see who is on call right now",
  "- `/oneuptime page [who] [message]`: page a person, a team or whoever is on call",
  "- `/oneuptime ask [question]`: ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
  "- `/oneuptime help`: list every command",
  "",
  "For example: `/oneuptime incident Checkout is down`. Anything else after `/oneuptime` is a question for OneUptime AI too, such as `/oneuptime which monitors are down?`",
];

const TEAMS_HELP_LINES: Array<string> = [
  "👋 **Here's what I can do.** In a channel or a group chat, mention @OneUptime first.",
  "- **incident [title or number]**: declare an incident, or act on one by its number",
  "- **maintenance [title]**: schedule maintenance",
  "- **oncall**: see who is on call right now",
  "- **page [who] [message]**: page a person, a team or whoever is on call",
  "- **ask [question]**: ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
  "- **help**: list every command",
  "",
  'For example: "incident Checkout is down". Anything else you type is a question for OneUptime AI too, such as "which monitors are down right now?"',
];

// Words that read only beside the help's list: "show these commands".
const POINTS_AT_THE_LIST: RegExp = /\b(?:these|this list|above|below)\b/;

describe("WorkspaceCommands.getSummary", () => {
  test("each command's summary is a few words: the help is a list a person scans", () => {
    expect(
      WORKSPACE_COMMANDS.map((definition: WorkspaceCommandDefinition) => {
        return [definition.name, WorkspaceCommands.getSummary(definition.name)];
      }),
    ).toEqual([
      ["incident", "declare an incident, or act on one by its number"],
      ["maintenance", "schedule maintenance"],
      ["oncall", "see who is on call right now"],
      ["page", "page a person, a team or whoever is on call"],
      [
        "ask",
        "ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
      ],
      ["help", "list every command"],
    ]);
  });

  test("no summary points at the list around it: Teams' command menu and welcome card show each alone", () => {
    for (const definition of WORKSPACE_COMMANDS) {
      const summary: string = WorkspaceCommands.getSummary(definition.name);

      expect(summary).not.toMatch(POINTS_AT_THE_LIST);
      // A fragment: the help writes no full stop after it.
      expect(summary.endsWith(".")).toBe(false);
    }
  });
});

describe("WorkspaceCommands.getHelpAnswer", () => {
  test("Slack: every command as code, one short line each, then an example of a command and of a question", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
    });

    expect(answer).toEqual({
      markdown: SLACK_HELP_LINES.join("\n"),
      text: "Here's what /oneuptime can do: incident, maintenance, oncall, page, ask, help",
    });
  });

  test("Slack: the title keeps its code span away from the bold's closing marker, so Slack draws both", () => {
    const title: string = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
    }).markdown.split("\n")[0]!;

    expect(title.endsWith("`**")).toBe(false);
    expect(title).toContain("`/oneuptime` can do**");
  });

  test("Slack, in a workspace that runs OneUptime with another command: every usage names it", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
      slackCommand: "/irm",
    });

    expect(answer.markdown).toBe(
      SLACK_HELP_LINES.join("\n").split("/oneuptime").join("/irm"),
    );
    expect(answer.text).toBe(
      "Here's what /irm can do: incident, maintenance, oncall, page, ask, help",
    );
  });

  test("Microsoft Teams: every command in bold, as typed to the bot, and how to reach the bot in a channel", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(answer).toEqual({
      markdown: TEAMS_HELP_LINES.join("\n"),
      text: "Here's what I can do: incident, maintenance, oncall, page, ask, help",
    });
    // A card shows no code: nothing is written as code in Teams.
    expect(answer.markdown).not.toContain("`");
  });

  test("Microsoft Teams: a chat's own commands are listed before help", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      extraCommands: [
        {
          usages: ["show active incidents", "show active alerts"],
          summary: "list what is open right now",
        },
      ],
    });

    const lines: Array<string> = answer.markdown.split("\n");

    expect(lines[6]).toBe(
      "- **show active incidents**, **show active alerts**: list what is open right now",
    );
    expect(lines[7]).toBe("- **help**: list every command");
  });

  test("Microsoft Teams: the bot is @mentioned by the name Teams shows for it, whatever the product is called", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    const named: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      botName: "OneUptime",
    });

    expect(named.markdown.split("\n")[0]).toBe(
      "👋 **Here's what I can do.** In a channel or a group chat, mention @OneUptime first.",
    );
    // The AI is the product's, by the installation's name.
    expect(named.markdown).toContain("a question for Acme Ops AI too");

    // A message that names no bot: the product's name.
    expect(
      WorkspaceCommands.getHelpAnswer({
        workspaceType: WorkspaceType.MicrosoftTeams,
        botName: "   ",
      }).markdown.split("\n")[0],
    ).toBe(
      "👋 **Here's what I can do.** In a channel or a group chat, mention @Acme Ops first.",
    );
  });

  test("the product's name is the one the installation goes by", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    const slack: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
    });
    const teams: WorkspaceAnswer = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

    expect(slack.markdown).toContain("ask Acme Ops AI about your logs");
    expect(slack.markdown).toContain("is a question for Acme Ops AI too");
    expect(slack.markdown).not.toContain("OneUptime AI");
    expect(teams.markdown).toContain("mention @Acme Ops first.");
    expect(teams.markdown).not.toContain("OneUptime");
  });

  test("every command the parser reads is listed in both chats' help", () => {
    const slack: string = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.Slack,
    }).markdown;
    const teams: string = WorkspaceCommands.getHelpAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
    }).markdown;

    for (const definition of WORKSPACE_COMMANDS) {
      expect(slack).toContain(`\`/oneuptime ${definition.name}`);
      expect(teams).toContain(`**${definition.name}`);
    }
  });

  test("the help's examples are commands the parser reads as the help says", () => {
    expect(WorkspaceCommands.parse("incident Checkout is down")).toEqual({
      command: WorkspaceCommandName.Incident,
      text: "Checkout is down",
    });
    // The question examples are no command: they go to AI.
    for (const question of [
      "which monitors are down?",
      "which monitors are down right now?",
    ]) {
      expect(WorkspaceCommands.parse(question)).toEqual({
        command: null,
        text: question,
      });
    }
  });
});

describe("WorkspaceCommands.getCommandListLines: the help's list, alone", () => {
  test("the lines between the help's title and its examples - Teams' welcome card lists the same", () => {
    const lines: Array<string> = WorkspaceCommands.getCommandListLines({
      workspaceType: WorkspaceType.MicrosoftTeams,
    }).map((line: { toString: () => string }): string => {
      return line.toString();
    });

    expect(lines).toEqual(TEAMS_HELP_LINES.slice(1, 7));
    expect(
      WorkspaceCommands.getCommandListLines({
        workspaceType: WorkspaceType.Slack,
      }).map((line: { toString: () => string }): string => {
        return line.toString();
      }),
    ).toEqual(SLACK_HELP_LINES.slice(1, 7));
  });
});

describe("WorkspaceCommands.getMisspellingAnswer: a command misspelt", () => {
  test("Slack: the command it looks like, with what followed it, ready to run - and how to ask AI instead; one paragraph, not the whole help", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getMisspellingAnswer({
      workspaceType: WorkspaceType.Slack,
      misspelt: {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: "Checkout   is down",
      },
    });

    expect(answer).toEqual({
      markdown:
        "🤔 `/oneuptime incidnet` is not a command. Did you mean `/oneuptime incident Checkout is down`? To ask OneUptime AI instead, start with `/oneuptime ask`.",
      text: "/oneuptime incidnet is not a command. Did you mean /oneuptime incident Checkout is down?",
    });
    expect(answer.markdown).not.toContain("\n");
  });

  test("Microsoft Teams: the same, in bold, as typed to the bot", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getMisspellingAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      misspelt: {
        word: "oncal",
        command: WorkspaceCommandName.OnCall,
        text: "",
      },
    });

    expect(answer).toEqual({
      markdown:
        "🤔 **oncal** is not a command. Did you mean **oncall**? To ask OneUptime AI instead, start with **ask**.",
      text: "oncal is not a command. Did you mean oncall?",
    });
  });

  test("in a workspace that runs OneUptime with another command: that command, in the suggestion and in the way to ask", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getMisspellingAnswer({
      workspaceType: WorkspaceType.Slack,
      slackCommand: "/irm",
      misspelt: {
        word: "maintenence",
        command: WorkspaceCommandName.Maintenance,
        text: "",
      },
    });

    expect(answer.markdown).toBe(
      "🤔 `/irm maintenence` is not a command. Did you mean `/irm maintenance`? To ask OneUptime AI instead, start with `/irm ask`.",
    );
  });

  test("a misspelt command that takes nothing: the suggestion is the command alone", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getMisspellingAnswer({
      workspaceType: WorkspaceType.Slack,
      misspelt: {
        word: "oncal",
        command: WorkspaceCommandName.OnCall,
        text: "please",
      },
    });

    expect(answer.text).toBe(
      "/oneuptime oncal is not a command. Did you mean /oneuptime oncall?",
    );
  });

  test("a long title after a misspelt command is cut in the suggestion", () => {
    const title: string = "a".repeat(150);

    const answer: WorkspaceAnswer = WorkspaceCommands.getMisspellingAnswer({
      workspaceType: WorkspaceType.Slack,
      misspelt: {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: title,
      },
    });

    expect(answer.markdown).toBe(
      `🤔 \`/oneuptime incidnet\` is not a command. Did you mean \`/oneuptime incident ${"a".repeat(100)}…\`? To ask OneUptime AI instead, start with \`/oneuptime ask\`.`,
    );
  });

  test("text typed after a misspelt command is text: it cannot become a link, a mention or code", () => {
    const answer: WorkspaceAnswer = WorkspaceCommands.getMisspellingAnswer({
      workspaceType: WorkspaceType.MicrosoftTeams,
      misspelt: {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: "**[x](https://evil.example)** <at>All</at> `code`",
      },
    });

    /*
     * Every character that would make Markdown of it - the bold, the
     * link's brackets, the <at> tag of a Teams mention, the code span's
     * backticks - has its backslash: the text reads as typed.
     */
    expect(answer.markdown).toBe(
      String.raw`🤔 **incidnet** is not a command. Did you mean **incident \*\*\[x\](https://evil.example)\*\* \<at>All\</at> \`code\`**? To ask OneUptime AI instead, start with **ask**.`,
    );
  });

  test("the way to ask AI instead is a command the parser reads as a question", () => {
    expect(WorkspaceCommands.parse("ask incidnet Checkout is down")).toEqual({
      command: WorkspaceCommandName.Ask,
      text: "incidnet Checkout is down",
    });
  });

  test("the product's name is the one the installation goes by", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    expect(
      WorkspaceCommands.getMisspellingAnswer({
        workspaceType: WorkspaceType.MicrosoftTeams,
        misspelt: {
          word: "oncal",
          command: WorkspaceCommandName.OnCall,
          text: "",
        },
      }).markdown,
    ).toContain("To ask Acme Ops AI instead");
  });
});
