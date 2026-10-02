import NumberPrefixUtil, {
  NUMBER_PREFIX_COLUMNS,
  NumberPrefixColumnInfo,
  NumberPrefixProblem,
} from "../../../Utils/Project/NumberPrefix";
import Project from "../../../Models/DatabaseModels/Project";
import ColumnLength from "../../../Types/Database/ColumnLength";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NumberPrefixUtil is the one definition of a number prefix: what a prefix
 * may hold, what is stored for one, and the number it makes. ProjectService
 * stores what normalize() returns; the incident, alert, episode and
 * scheduled maintenance services number new records with formatNumber();
 * and the dashboard's Number Prefix pages preview with getExample() and
 * refuse what getError() refuses. If any of them drifted, the page would
 * preview a number the server never makes, or accept a prefix the server
 * then refuses.
 */

describe("NumberPrefixUtil.formatNumber - the number a prefix makes", () => {
  test("puts the prefix in front of the number, exactly as stored", () => {
    expect(NumberPrefixUtil.formatNumber("INC-", 42)).toBe("INC-42");
    expect(NumberPrefixUtil.formatNumber("IE-", 7)).toBe("IE-7");
    expect(NumberPrefixUtil.formatNumber("SEV#", 1)).toBe("SEV#1");
  });

  test("uses # when the project has no prefix", () => {
    expect(NumberPrefixUtil.formatNumber(undefined, 42)).toBe("#42");
    expect(NumberPrefixUtil.formatNumber(null, 42)).toBe("#42");
    expect(NumberPrefixUtil.formatNumber("", 42)).toBe("#42");
  });

  /*
   * The server never trimmed a prefix when numbering. A prefix stored
   * before prefixes were trimmed on save keeps its spaces in the numbers
   * it makes, and the preview must show what the server makes.
   */
  test("does not trim, as the server never did", () => {
    expect(NumberPrefixUtil.formatNumber("INC ", 42)).toBe("INC 42");
  });

  test("works for the first number and for large ones", () => {
    expect(NumberPrefixUtil.formatNumber("INC-", 1)).toBe("INC-1");
    expect(NumberPrefixUtil.formatNumber("INC-", 123456)).toBe("INC-123456");
    expect(NumberPrefixUtil.formatNumber(undefined, 0)).toBe("#0");
  });
});

describe("NumberPrefixUtil.getExample", () => {
  test("is the number 42 with the prefix", () => {
    expect(NumberPrefixUtil.EXAMPLE_NUMBER).toBe(42);
    expect(NumberPrefixUtil.getExample("INC-")).toBe("INC-42");
    expect(NumberPrefixUtil.getExample("ALT-")).toBe("ALT-42");
  });

  test("is #42 without a prefix", () => {
    expect(NumberPrefixUtil.getExample(undefined)).toBe("#42");
    expect(NumberPrefixUtil.getExample(null)).toBe("#42");
    expect(NumberPrefixUtil.getExample("")).toBe("#42");
  });

  test("the default prefix is #", () => {
    expect(NumberPrefixUtil.DEFAULT_PREFIX).toBe("#");
  });
});

describe("NumberPrefixUtil.getProblem - what a prefix may hold", () => {
  test.each([
    "INC-",
    "IE-",
    "ALT-",
    "AE-",
    "SM-",
    "INC",
    "OPS_",
    "INC.",
    "INC/",
    "INC:",
    "INC#",
    "#",
    "SEV-2-",
    "inc-",
    "Incident-",
    "2024-",
  ])("accepts %j", (prefix: string) => {
    expect(NumberPrefixUtil.getProblem(prefix)).toBeNull();
    expect(NumberPrefixUtil.getError(prefix)).toBeNull();
  });

  // Letters of every script, with their vowel signs.
  test.each([
    "障害-",
    "インシデント-",
    "사건-",
    "Инц-",
    "घटना-",
    "حادثه-",
    "Störung-",
  ])("accepts a prefix in another script: %j", (prefix: string) => {
    expect(NumberPrefixUtil.getProblem(prefix)).toBeNull();
  });

  test("an empty prefix is fine: it means #", () => {
    expect(NumberPrefixUtil.getProblem("")).toBeNull();
    expect(NumberPrefixUtil.getProblem("   ")).toBeNull();
    expect(NumberPrefixUtil.getProblem(null)).toBeNull();
    expect(NumberPrefixUtil.getProblem(undefined)).toBeNull();
  });

  test("surrounding whitespace does not count - it is trimmed off", () => {
    expect(NumberPrefixUtil.getProblem("  INC-  ")).toBeNull();
    expect(NumberPrefixUtil.getProblem("\tINC-\n")).toBeNull();
  });

  test("allows 20 characters and no more", () => {
    expect(NumberPrefixUtil.MAX_LENGTH).toBe(20);
    expect(NumberPrefixUtil.getProblem("A".repeat(19) + "-")).toBeNull();
    expect(NumberPrefixUtil.getProblem("A".repeat(20) + "-")).toBe(
      NumberPrefixProblem.TooLong,
    );
    expect(NumberPrefixUtil.getProblem("A".repeat(40))).toBe(
      NumberPrefixProblem.TooLong,
    );
  });

  test("counts the length after trimming", () => {
    expect(
      NumberPrefixUtil.getProblem("   " + "A".repeat(19) + "-   "),
    ).toBeNull();
  });

  // A prefix is printed beside numbers in Markdown, Slack, Teams and email.
  test.each([
    "INC 1-",
    "IN C-",
    "INC\t-",
    "INC*",
    "INC`",
    "<b>",
    "INC|",
    "INC~",
    "INC[",
    "INC]",
    "INC(",
    "INC)",
    "INC&",
    'INC"',
    "INC'",
    "INC{",
    "INC}",
    "INC\\",
    "INC!",
    "INC?",
    "INC@",
    "INC%",
    "INC+",
    "INC=",
    "INC,",
    "INC;",
    "INC😀",
    "INC​-",
  ])("refuses %j: a character that is not allowed", (prefix: string) => {
    expect(NumberPrefixUtil.getProblem(prefix)).toBe(
      NumberPrefixProblem.NotAllowedCharacter,
    );
  });

  /*
   * A digit at the end runs into the number: with SEV1, incident 42 would
   * read SEV142 - and SEV142 could just as well be incident 142.
   */
  test.each(["SEV1", "2024", "INC-0", "V2", "INC٣", "INC९"])(
    "refuses %j: it ends with a digit",
    (prefix: string) => {
      expect(NumberPrefixUtil.getProblem(prefix)).toBe(
        NumberPrefixProblem.EndsWithDigit,
      );
    },
  );

  test("a digit anywhere else is fine", () => {
    expect(NumberPrefixUtil.getProblem("P1-")).toBeNull();
    expect(NumberPrefixUtil.getProblem("1-")).toBeNull();
    expect(NumberPrefixUtil.getProblem("2024/")).toBeNull();
  });

  test("checks the length first, then the characters, then the end", () => {
    expect(NumberPrefixUtil.getProblem("A B".repeat(10))).toBe(
      NumberPrefixProblem.TooLong,
    );
    expect(NumberPrefixUtil.getProblem("INC 1")).toBe(
      NumberPrefixProblem.NotAllowedCharacter,
    );
  });

  test("reads a value that is not text as its text, so a number ends with a digit", () => {
    expect(NumberPrefixUtil.getProblem(42)).toBe(
      NumberPrefixProblem.EndsWithDigit,
    );
  });
});

describe("NumberPrefixUtil messages", () => {
  /*
   * Pinned word for word: each message is also the key the dashboard's
   * locale files translate it by.
   */
  test("say what to do, in plain words", () => {
    expect(
      NumberPrefixUtil.getProblemMessage(NumberPrefixProblem.TooLong),
    ).toBe("Use 20 characters or fewer.");
    expect(
      NumberPrefixUtil.getProblemMessage(
        NumberPrefixProblem.NotAllowedCharacter,
      ),
    ).toBe("Use only letters, numbers and - _ . / : # (no spaces).");
    expect(
      NumberPrefixUtil.getProblemMessage(NumberPrefixProblem.EndsWithDigit),
    ).toBe(
      "End with a letter or a symbol such as -. A digit at the end runs into the number: SEV1 would make SEV142.",
    );
  });

  test("the length message names the real limit", () => {
    expect(
      NumberPrefixUtil.getProblemMessage(NumberPrefixProblem.TooLong),
    ).toContain(String(NumberPrefixUtil.MAX_LENGTH));
  });

  test("the character message lists exactly the separators the rule allows", () => {
    const message: string = NumberPrefixUtil.getProblemMessage(
      NumberPrefixProblem.NotAllowedCharacter,
    );

    for (const separator of ["-", "_", ".", "/", ":", "#"]) {
      expect(message).toContain(separator);
      expect(NumberPrefixUtil.getProblem(`INC${separator}`)).toBeNull();
    }

    expect(NumberPrefixUtil.ALLOWED_CHARACTERS).toBe(
      "letters, numbers and - _ . / : #",
    );
    expect(message).toContain(NumberPrefixUtil.ALLOWED_CHARACTERS);
  });

  test("the example in the digit message is what formatNumber makes", () => {
    expect(NumberPrefixUtil.formatNumber("SEV1", 42)).toBe("SEV142");
    expect(
      NumberPrefixUtil.getProblemMessage(NumberPrefixProblem.EndsWithDigit),
    ).toContain("SEV1 would make SEV142");
  });

  test("getError gives the message for the problem, or null", () => {
    expect(NumberPrefixUtil.getError("SEV1")).toBe(
      NumberPrefixUtil.getProblemMessage(NumberPrefixProblem.EndsWithDigit),
    );
    expect(NumberPrefixUtil.getError("IN C-")).toBe(
      NumberPrefixUtil.getProblemMessage(
        NumberPrefixProblem.NotAllowedCharacter,
      ),
    );
    expect(NumberPrefixUtil.getError("INC-")).toBeNull();
  });
});

describe("NumberPrefixUtil.normalize - what is stored", () => {
  const TITLE: string = "Incident Number Prefix";

  test("stores a valid prefix as typed", () => {
    expect(NumberPrefixUtil.normalize("INC-", TITLE)).toBe("INC-");
    expect(NumberPrefixUtil.normalize("障害-", TITLE)).toBe("障害-");
  });

  test("trims surrounding whitespace", () => {
    expect(NumberPrefixUtil.normalize("  OPS-  ", TITLE)).toBe("OPS-");
    expect(NumberPrefixUtil.normalize("\tOPS-\n", TITLE)).toBe("OPS-");
  });

  test("stores an empty or blank prefix as null, which numbers with #", () => {
    expect(NumberPrefixUtil.normalize("", TITLE)).toBeNull();
    expect(NumberPrefixUtil.normalize("    ", TITLE)).toBeNull();
    expect(NumberPrefixUtil.normalize(null, TITLE)).toBeNull();
    expect(NumberPrefixUtil.normalize(undefined, TITLE)).toBeNull();
  });

  test("refuses a value that is not text, naming the column", () => {
    expect(() => {
      NumberPrefixUtil.normalize(42, TITLE);
    }).toThrow(BadDataException);
    expect(() => {
      NumberPrefixUtil.normalize({ prefix: "INC-" }, TITLE);
    }).toThrow("Incident Number Prefix must be text.");
  });

  test("refuses a prefix that breaks a rule, naming the column and saying why", () => {
    expect(() => {
      NumberPrefixUtil.normalize("SEV1", TITLE);
    }).toThrow(
      "Incident Number Prefix: End with a letter or a symbol such as -. A digit at the end runs into the number: SEV1 would make SEV142.",
    );
    expect(() => {
      NumberPrefixUtil.normalize("IN C-", "Alert Number Prefix");
    }).toThrow(
      "Alert Number Prefix: Use only letters, numbers and - _ . / : # (no spaces).",
    );
    expect(() => {
      NumberPrefixUtil.normalize("A".repeat(21), TITLE);
    }).toThrow("Incident Number Prefix: Use 20 characters or fewer.");
  });

  test("what it stores is always a prefix getProblem accepts", () => {
    for (const value of ["INC-", "  OPS_  ", "#", "", "   "]) {
      expect(
        NumberPrefixUtil.getProblem(NumberPrefixUtil.normalize(value, TITLE)),
      ).toBeNull();
    }
  });
});

describe("NUMBER_PREFIX_COLUMNS", () => {
  test("lists the five prefixes a project has, with what a new project starts with", () => {
    expect(
      NUMBER_PREFIX_COLUMNS.map(
        (info: NumberPrefixColumnInfo): [string, string] => {
          return [info.column, info.defaultForNewProjects];
        },
      ),
    ).toEqual([
      ["incidentNumberPrefix", "INC-"],
      ["incidentEpisodeNumberPrefix", "IE-"],
      ["alertNumberPrefix", "ALT-"],
      ["alertEpisodeNumberPrefix", "AE-"],
      ["scheduledMaintenanceNumberPrefix", "SM-"],
    ]);
  });

  test("covers every Project column that holds a number prefix", () => {
    const project: Project = new Project();
    const prefixColumns: Array<string> = Object.keys(
      project.getColumnAccessControlForAllColumns(),
    ).filter((column: string): boolean => {
      return column.endsWith("NumberPrefix");
    });

    expect(prefixColumns.sort()).toEqual(
      NUMBER_PREFIX_COLUMNS.map((info: NumberPrefixColumnInfo): string => {
        return info.column;
      }).sort(),
    );
  });

  test("names each column by the title the Project model gives it", () => {
    const project: Project = new Project();

    for (const info of NUMBER_PREFIX_COLUMNS) {
      expect(project.getTableColumnMetadata(info.column).title).toBe(
        info.title,
      );
    }
  });

  test("each default follows the rules", () => {
    for (const info of NUMBER_PREFIX_COLUMNS) {
      expect({
        column: info.column,
        problem: NumberPrefixUtil.getProblem(info.defaultForNewProjects),
      }).toEqual({ column: info.column, problem: null });
    }
  });

  test("the longest prefix and the longest number fit the columns they are stored in", () => {
    // ShortText holds the prefix, and the prefixed number on each record.
    expect(NumberPrefixUtil.MAX_LENGTH).toBeLessThan(ColumnLength.ShortText);
    expect(
      NumberPrefixUtil.formatNumber(
        "A".repeat(NumberPrefixUtil.MAX_LENGTH - 1) + "-",
        Number.MAX_SAFE_INTEGER,
      ).length,
    ).toBeLessThanOrEqual(ColumnLength.ShortText);
  });

  test("the model's descriptions state the same rules for API users", () => {
    const project: Project = new Project();

    for (const info of NUMBER_PREFIX_COLUMNS) {
      const description: string =
        project.getTableColumnMetadata(info.column).description || "";

      expect(description).toContain("If empty, '#' is used.");
      expect(description).toContain(
        "Up to 20 letters, numbers or - _ . / : #, not ending in a digit.",
      );
      expect(description).toMatch(
        /Changing it does not renumber .+ that already exist\./,
      );
    }
  });
});

/*
 * The numbers people see are built on the server when a record is created.
 * Each service builds them with formatNumber, so what the Number Prefix page
 * previews is what the next incident, alert, episode or event gets.
 */
describe("the server numbers new records with formatNumber", () => {
  const SERVICES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Server",
    "Services",
  );

  const SERVICES: Array<[string, string]> = [
    ["IncidentService.ts", "incidentNumberWithPrefix"],
    ["AlertService.ts", "alertNumberWithPrefix"],
    ["ScheduledMaintenanceService.ts", "scheduledMaintenanceNumberWithPrefix"],
    ["IncidentEpisodeService.ts", "episodeNumberWithPrefix"],
    ["AlertEpisodeService.ts", "episodeNumberWithPrefix"],
  ];

  function code(file: string): string {
    return fs
      .readFileSync(path.join(SERVICES_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ")
      .replace(/\s+/g, "");
  }

  test.each(SERVICES)(
    "%s sets %s from formatNumber",
    (file: string, column: string) => {
      const source: string = code(file);

      expect(source).toContain(
        'importNumberPrefixUtilfrom"../../Utils/Project/NumberPrefix";',
      );
      expect(source).toMatch(
        new RegExp(
          `createBy\\.data\\.${column}=NumberPrefixUtil\\.formatNumber\\(`,
        ),
      );
      // And not with a copy of the rule of its own.
      expect(source).not.toMatch(/:`#\$\{[A-Za-z]+CounterResult\.counter\}`/);
    },
  );
});
