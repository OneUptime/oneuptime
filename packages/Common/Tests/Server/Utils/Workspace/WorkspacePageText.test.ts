import { describe, expect, test } from "@jest/globals";
import WorkspacePageTextReader, {
  WorkspacePagePerson,
  WorkspacePageText,
  WorkspacePageToken,
} from "../../../../Server/Utils/Workspace/WorkspacePageText";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * WHAT FOLLOWS "page": WHO, THEN THE MESSAGE (customer feedback #4: "How can
 * we manually trigger a page to someone -- e.g. /oneuptime page @nawaz
 * some-message?").
 *
 * Slack and Microsoft Teams hand the text after the word over as tokens -
 * the people it @mentions, the groups, the text around them - and both are
 * read here alike: the people @mentioned first are who to page, the rest is
 * the message. Nothing else is read as somebody to page: a name typed at the
 * start only fills the form in (startsWithName), never pages by itself.
 */

const NAWAZ: WorkspacePagePerson = {
  workspaceUserId: "U0NAWAZ",
  name: "nawaz",
};
const SIMON: WorkspacePagePerson = {
  workspaceUserId: "U0SIMON",
  name: "simon",
};
const ANA: WorkspacePagePerson = { workspaceUserId: "U0ANA", name: "Ana Ruiz" };

function person(who: WorkspacePagePerson): WorkspacePageToken {
  return { kind: "person", person: who };
}

function text(value: string): WorkspacePageToken {
  return { kind: "text", text: value };
}

// A user group or tag with the chat's id for it; @here has none.
function group(name: string, workspaceGroupId?: string): WorkspacePageToken {
  return { kind: "group", name: name, workspaceGroupId: workspaceGroupId };
}

function read(...tokens: Array<WorkspacePageToken>): WorkspacePageText {
  return WorkspacePageTextReader.read(tokens);
}

describe("who: the people @mentioned before the message", () => {
  test("/oneuptime page @nawaz The checkout API is throwing 500s", () => {
    expect(
      read(
        text(" "),
        person(NAWAZ),
        text(" The checkout API is throwing 500s"),
      ),
    ).toEqual({
      people: [NAWAZ],
      groups: [],
      unknownNames: [],
      message: "The checkout API is throwing 500s",
    });
  });

  test.each<[string, Array<WorkspacePageToken>]>([
    [
      "spaces",
      [person(NAWAZ), text(" "), person(SIMON), text(" the replica is behind")],
    ],
    [
      "a comma",
      [
        person(NAWAZ),
        text(", "),
        person(SIMON),
        text(" the replica is behind"),
      ],
    ],
    [
      "a comma with no space",
      [person(NAWAZ), text(","), person(SIMON), text(" the replica is behind")],
    ],
    [
      '"and"',
      [
        person(NAWAZ),
        text(" and "),
        person(SIMON),
        text(" the replica is behind"),
      ],
    ],
    [
      '"AND", in any case',
      [
        person(NAWAZ),
        text(" AND "),
        person(SIMON),
        text(" the replica is behind"),
      ],
    ],
    [
      '"&"',
      [
        person(NAWAZ),
        text(" & "),
        person(SIMON),
        text(" the replica is behind"),
      ],
    ],
    [
      '"+"',
      [
        person(NAWAZ),
        text(" + "),
        person(SIMON),
        text(" the replica is behind"),
      ],
    ],
    [
      "nothing at all",
      [person(NAWAZ), person(SIMON), text(" the replica is behind")],
    ],
  ])(
    "two people with %s between them",
    (_label: string, tokens: Array<WorkspacePageToken>) => {
      expect(WorkspacePageTextReader.read(tokens)).toEqual({
        people: [NAWAZ, SIMON],
        groups: [],
        unknownNames: [],
        message: "the replica is behind",
      });
    },
  );

  test("a person @mentioned twice is paged once", () => {
    expect(
      read(person(NAWAZ), text(" "), person(NAWAZ), text(" db down")).people,
    ).toEqual([NAWAZ]);
  });

  test("a name as Slack or Teams wrote it is kept, without the white space around it", () => {
    expect(
      read(
        person({ workspaceUserId: "29:1ana", name: "  Ana Ruiz " }),
        text(" db"),
      ).people,
    ).toEqual([{ workspaceUserId: "29:1ana", name: "Ana Ruiz" }]);
  });

  test('"and" joins only two mentions: "@nawaz and the DB is down" is a message that starts with "and"', () => {
    expect(read(person(NAWAZ), text(" and the DB is down"))).toEqual({
      people: [NAWAZ],
      groups: [],
      unknownNames: [],
      message: "and the DB is down",
    });
  });

  test('"and" with nobody named before it is the message', () => {
    expect(read(text("and "), person(NAWAZ), text(" db")).message).toBe(
      "and @nawaz db",
    );
    expect(read(text("and "), person(NAWAZ), text(" db")).people).toEqual([]);
  });

  test("an @mention inside the message is part of it: who to page is only the run the text starts with", () => {
    expect(
      read(
        person(NAWAZ),
        text(" the DB is down, ask "),
        person(SIMON),
        text(" to join"),
      ),
    ).toEqual({
      people: [NAWAZ],
      groups: [],
      unknownNames: [],
      message: "the DB is down, ask @simon to join",
    });
  });

  test("a person in the message with no name the chat gave is written @someone", () => {
    expect(
      read(
        person(NAWAZ),
        text(" ping "),
        person({ workspaceUserId: "U0X", name: "" }),
      ).message,
    ).toBe("ping @someone");
  });

  test("text before any mention: nobody is named, and all of it is the message", () => {
    expect(read(text("the DB is down "), person(NAWAZ))).toEqual({
      people: [],
      groups: [],
      unknownNames: [],
      message: "the DB is down @nawaz",
    });
  });
});

describe("the message: everything after who, as typed", () => {
  test.each([
    [": the DB is down", "the DB is down"],
    [" : the DB is down", "the DB is down"],
    [" - the DB is down", "the DB is down"],
    [" – the DB is down", "the DB is down"],
    [" — the DB is down", "the DB is down"],
    ["  the DB is down  ", "the DB is down"],
  ])(
    "a separator after the names is dropped: %j",
    (after: string, message: string) => {
      expect(read(person(NAWAZ), text(after)).message).toBe(message);
    },
  );

  test("only one separator is dropped: the message's own marks are kept", () => {
    expect(read(person(NAWAZ), text(": - db: down -")).message).toBe(
      "- db: down -",
    );
  });

  test("a message over several lines keeps its lines", () => {
    expect(read(person(NAWAZ), text("\nline one\nline two\n")).message).toBe(
      "line one\nline two",
    );
  });

  test("a message with marks that mean something in Markdown is kept as typed: it is text", () => {
    expect(
      read(person(NAWAZ), text(" **db** _down_ <script> [x](y)")).message,
    ).toBe("**db** _down_ <script> [x](y)");
  });

  test("nobody, and nothing: no people, no message", () => {
    expect(read()).toEqual({
      people: [],
      groups: [],
      unknownNames: [],
      message: "",
    });
    expect(read(text("   "))).toEqual({
      people: [],
      groups: [],
      unknownNames: [],
      message: "",
    });
  });

  test("people and no message: the form asks for one", () => {
    expect(read(person(NAWAZ), text("  "), person(SIMON))).toEqual({
      people: [NAWAZ, SIMON],
      groups: [],
      unknownNames: [],
      message: "",
    });
  });

  test("white space a person types: a no-break space and the ideographic space of CJK input part words too", () => {
    expect(
      read(person(NAWAZ), text("\u{a0}and\u{3000}"), person(SIMON), text(" db"))
        .people,
    ).toEqual([NAWAZ, SIMON]);
  });

  test("readText: a text with no mentions in it", () => {
    expect(WorkspacePageTextReader.readText("the DB is down")).toEqual({
      people: [],
      groups: [],
      unknownNames: [],
      message: "the DB is down",
    });
  });
});

describe("groups, and names sent as text", () => {
  test("a user group, or @here, before the message is a group - with the chat's id for it, which @here has none of", () => {
    expect(
      read(
        group("oncall-db", "S0DB"),
        text(" "),
        group("here"),
        text(" db down"),
      ),
    ).toEqual({
      people: [],
      groups: [
        { name: "oncall-db", workspaceGroupId: "S0DB" },
        { name: "here", workspaceGroupId: "" },
      ],
      unknownNames: [],
      message: "db down",
    });
  });

  test("people and a group together", () => {
    expect(
      read(
        person(NAWAZ),
        text(", "),
        group("payments-oncall", "S0PAY"),
        text(": db down"),
      ),
    ).toEqual({
      people: [NAWAZ],
      groups: [{ name: "payments-oncall", workspaceGroupId: "S0PAY" }],
      unknownNames: [],
      message: "db down",
    });
  });

  test("a group mentioned twice is one group: by its id, or by its name when it has none", () => {
    expect(
      read(
        group("payments-oncall", "S0PAY"),
        text(" and "),
        group("Payments on-call", "S0PAY"),
        text(" "),
        group("here"),
        text(" "),
        group("here"),
        text(" db down"),
      ).groups,
    ).toEqual([
      { name: "payments-oncall", workspaceGroupId: "S0PAY" },
      { name: "here", workspaceGroupId: "" },
    ]);
  });

  test("two groups of one name but different ids are two groups", () => {
    expect(
      read(
        group("oncall", "S0ONE"),
        text(" "),
        group("oncall", "S0TWO"),
        text(" db down"),
      ).groups,
    ).toEqual([
      { name: "oncall", workspaceGroupId: "S0ONE" },
      { name: "oncall", workspaceGroupId: "S0TWO" },
    ]);
  });

  test("a group inside the message is part of it, by name - not paged", () => {
    expect(
      read(
        person(NAWAZ),
        text(" ask "),
        group("payments-oncall", "S0PAY"),
        text(" to look"),
      ),
    ).toEqual({
      people: [NAWAZ],
      groups: [],
      unknownNames: [],
      message: "ask @payments-oncall to look",
    });
  });

  test('"@nawaz" sent as plain text - a Slack app created from an older manifest sends names, not people', () => {
    expect(read(text("@nawaz the DB is down"))).toEqual({
      people: [],
      groups: [],
      unknownNames: ["@nawaz"],
      message: "the DB is down",
    });
  });

  test("names sent as text, with their punctuation dropped, each once", () => {
    expect(
      read(text("@nawaz, @simon: @nawaz and @ana. the DB is down")),
    ).toEqual({
      people: [],
      groups: [],
      unknownNames: ["@nawaz", "@simon", "@ana"],
      message: "the DB is down",
    });
  });

  test('a lone "@" is no name: it starts the message', () => {
    expect(read(person(ANA), text(" @ is down")).message).toBe("@ is down");
  });

  test("an email address in the message is not a name", () => {
    expect(read(person(NAWAZ), text(" mail ops@example.com"))).toEqual({
      people: [NAWAZ],
      groups: [],
      unknownNames: [],
      message: "mail ops@example.com",
    });
  });
});

describe("startsWithName: a schedule's, a team's or a policy's name typed first fills the form in", () => {
  const names: Array<string> = [
    "Primary",
    "Primary On-Call",
    "Database",
    "  ",
    "",
  ];

  test.each<[string, string | null]>([
    ["Primary the DB is down", "Primary"],
    ["primary on-call the DB is down", "Primary On-Call"],
    ["PRIMARY ON-CALL", "Primary On-Call"],
    ["Database: replication lag", "Database"],
    ["Database - replication lag", "Database"],
    ["Database, replication lag", "Database"],
    ["  Database replication lag", "Database"],
    ["Databases are slow", null],
    ["Primaryish", null],
    ["the Primary is down", null],
    ["", null],
  ])("%j starts with %j", (typed: string, name: string | null) => {
    expect(WorkspacePageTextReader.startsWithName(typed, names)).toBe(name);
  });

  test("the longest name the text starts with wins", () => {
    expect(
      WorkspacePageTextReader.startsWithName("Primary On-Call down", [
        "Primary On-Call",
        "Primary",
      ]),
    ).toBe("Primary On-Call");
  });

  test("afterName: the message after the name, without its separator", () => {
    expect(
      WorkspacePageTextReader.afterName(
        "  Primary On-Call: the DB is down",
        "Primary On-Call",
      ),
    ).toBe("the DB is down");
    expect(WorkspacePageTextReader.afterName("Primary", "Primary")).toBe("");
  });
});

describe("text as long as a chat sends, and longer: read in time that grows with it", () => {
  /*
   * What a person types reaches the server as it is. Each of these took no
   * time to write and must take none to read.
   */
  const LENGTH: number = 400_000;

  test.each<[string, () => Array<WorkspacePageToken>]>([
    [
      "a run of joining words",
      (): Array<WorkspacePageToken> => {
        return [person(NAWAZ), text(" and".repeat(LENGTH / 4))];
      },
    ],
    [
      "a run of names sent as text",
      (): Array<WorkspacePageToken> => {
        return [text("@a ".repeat(LENGTH / 3))];
      },
    ],
    [
      "a name of separators",
      (): Array<WorkspacePageToken> => {
        return [text(`@${",:;.!?".repeat(LENGTH / 6)}x`)];
      },
    ],
    [
      "a run of commas",
      (): Array<WorkspacePageToken> => {
        return [person(NAWAZ), text(",".repeat(LENGTH))];
      },
    ],
    [
      "a run of mentions",
      (): Array<WorkspacePageToken> => {
        const tokens: Array<WorkspacePageToken> = [];

        for (let index: number = 0; index < 20_000; index++) {
          tokens.push(
            person({ workspaceUserId: `U${index % 50}`, name: "n" }),
            text(" and "),
          );
        }

        return tokens;
      },
    ],
    [
      "a message of white space",
      (): Array<WorkspacePageToken> => {
        return [person(NAWAZ), text(" ".repeat(LENGTH)), text("x")];
      },
    ],
  ])("%s", (_label: string, build: () => Array<WorkspacePageToken>) => {
    const tokens: Array<WorkspacePageToken> = build();
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        WorkspacePageTextReader.read(tokens);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  test("a name the text starts with, against a long text and many names", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        WorkspacePageTextReader.startsWithName(
          "a".repeat(LENGTH),
          Array.from(
            { length: 300 },
            (_value: unknown, index: number): string => {
              return `${"a".repeat(index)}b`;
            },
          ),
        );
        WorkspacePageTextReader.withoutSeparator(
          `${" ".repeat(LENGTH)}:${" ".repeat(LENGTH)}x`,
        );
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
