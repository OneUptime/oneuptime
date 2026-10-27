import ExternalStatusPageComponentNames, {
  EXTERNAL_STATUS_PAGE_MAX_COMPARED_LENGTH,
  EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAME_LENGTH,
  EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAMES,
} from "../../../Utils/Monitor/ExternalStatusPageComponentNames";
import { GITHUB_PAGE, FixtureComponent } from "../../Helpers/ExternalStatusPageFixtures";
import { fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A NAME AN EXTERNAL STATUS PAGE MONITOR KEEPS PICKS A PAGE'S
 * COMPONENTS (issue #5156).
 *
 * The customer watches GitHub's status page and depends on Git Operations
 * and Pull Requests, not Copilot. A monitor now keeps the components it
 * watches as names: a name picks the component of exactly that name (case
 * and white space aside), a "*" in it stands for any text, and on a feed a
 * name is looked for in the items' titles. A monitor saved with the one
 * Component Name Filter it had before - which matched every component whose
 * name contained it - reads as that name between stars, and watches exactly
 * what it watched before; a probe that has not been upgraded is handed one
 * name it understands, which never watches less than the list.
 */

const githubNames: Array<string> = GITHUB_PAGE.components.map(
  (component: FixtureComponent): string => {
    return component.name;
  },
);

// The components of GitHub's page a name picks.
function picked(name: string): Array<string> {
  return githubNames.filter((componentName: string): boolean => {
    return ExternalStatusPageComponentNames.matchesComponent(
      name,
      componentName,
    );
  });
}

/*
 * A reference matcher for patterns whose only wildcard is "*", by dynamic
 * programming over every prefix of the pattern and the text: slow, plain,
 * and right.
 */
function referenceMatches(pattern: string, text: string): boolean {
  const rows: number = pattern.length + 1;
  const columns: number = text.length + 1;
  const table: Array<Array<boolean>> = [];

  for (let row: number = 0; row < rows; row++) {
    table.push(new Array<boolean>(columns).fill(false));
  }

  table[0]![0] = true;

  for (let row: number = 1; row < rows; row++) {
    const piece: string = pattern.charAt(row - 1);

    for (let column: number = 0; column < columns; column++) {
      if (piece === "*") {
        table[row]![column] =
          table[row - 1]![column]! || (column > 0 && table[row]![column - 1]!);
      } else {
        table[row]![column] =
          column > 0 &&
          table[row - 1]![column - 1]! &&
          text.charAt(column - 1) === piece;
      }
    }
  }

  return table[rows - 1]![columns - 1]!;
}

describe("a name picks the component of exactly that name", () => {
  test.each([
    ["Git Operations", ["Git Operations"]],
    ["Pull Requests", ["Pull Requests"]],
    ["Actions", ["Actions"]],
    ["Webhooks", ["Webhooks"]],
  ])("%s picks %p on GitHub's page", (name: string, expected: Array<string>) => {
    expect(picked(name)).toEqual(expected);
  });

  test("case and white space do not count", () => {
    for (const spelling of [
      "git operations",
      "GIT OPERATIONS",
      "  Git Operations  ",
      "Git   Operations",
      "Git\tOperations",
      "Git Operations",
    ]) {
      expect({ spelling, picked: picked(spelling) }).toEqual({
        spelling,
        picked: ["Git Operations"],
      });
    }
  });

  test("a picked component never takes a longer name along with it", () => {
    // GitHub's page lists both; the customer depends on neither.
    expect(picked("Copilot")).toEqual(["Copilot"]);
    expect(
      ExternalStatusPageComponentNames.matchesComponent("Workers", "Workers KV"),
    ).toBe(false);
    expect(
      ExternalStatusPageComponentNames.matchesComponent("API", "API Requests"),
    ).toBe(false);
    // Nor a shorter one inside it.
    expect(
      ExternalStatusPageComponentNames.matchesComponent(
        "Copilot AI Model Providers",
        "Copilot",
      ),
    ).toBe(false);
  });

  test("a name the page does not have picks nothing", () => {
    expect(picked("Webhook")).toEqual([]);
    expect(picked("Git")).toEqual([]);
    expect(picked("")).toEqual([]);
  });
});

describe("a * stands for any text", () => {
  test.each([
    ["*Copilot*", ["Copilot", "Copilot AI Model Providers"]],
    ["Copilot*", ["Copilot", "Copilot AI Model Providers"]],
    ["*Requests", ["API Requests", "Pull Requests"]],
    ["P*s", ["Pull Requests", "Packages", "Pages"]],
    ["*", githubNames],
    ["*githubstatus*", ["Visit www.githubstatus.com for more information"]],
  ])("%s picks %p on GitHub's page", (name: string, expected: Array<string>) => {
    expect(picked(name)).toEqual(expected);
  });

  test("the pieces between stars must come in order", () => {
    expect(
      ExternalStatusPageComponentNames.matchesComponent(
        "*us*east*1*",
        "Amazon EC2 (us-east-1)",
      ),
    ).toBe(true);
    expect(
      ExternalStatusPageComponentNames.matchesComponent(
        "*east*us*",
        "Amazon EC2 (us-east-1)",
      ),
    ).toBe(false);
    // A piece found once cannot be both the start and the end.
    expect(ExternalStatusPageComponentNames.matchesComponent("ab*ab", "ab")).toBe(
      false,
    );
    expect(
      ExternalStatusPageComponentNames.matchesComponent("ab*ab", "abab"),
    ).toBe(true);
  });

  test("matches as a reference matcher does, on twenty thousand names and patterns", () => {
    const patterns: Array<string> = generatedTexts(20000, 5156, [
      "a",
      "b",
      "*",
    ], 8);
    const texts: Array<string> = generatedTexts(20000, 5157, ["a", "b"], 10);
    const disagreements: Array<string> = [];

    for (let index: number = 0; index < patterns.length; index++) {
      const pattern: string = patterns[index] as string;
      const text: string = texts[index] as string;

      if (!pattern) {
        continue;
      }

      const expected: boolean = referenceMatches(pattern, text);
      const actual: boolean = ExternalStatusPageComponentNames.matchesComponent(
        pattern,
        text,
      );

      if (expected !== actual) {
        disagreements.push(`${pattern} / ${text}: ${String(actual)}`);
      }
    }

    expect(disagreements).toEqual([]);
  });
});

describe("on a feed, a name is looked for in an item's title", () => {
  test.each([
    ["Git Operations", "Incident with Git Operations", true],
    ["git operations", "Degraded performance for GIT OPERATIONS", true],
    ["Pull Requests", "Incident with Git Operations", false],
    ["*east*1", "Degraded performance in us-east-1 for EC2", true],
    ["Copilot", "Incident with Copilot AI Model Providers", true],
  ])("%s in %s: %s", (name: string, title: string, expected: boolean) => {
    expect(ExternalStatusPageComponentNames.isFoundIn(name, title)).toBe(
      expected,
    );
  });

  test("an empty name is in no title", () => {
    expect(ExternalStatusPageComponentNames.isFoundIn("", "Anything")).toBe(
      false,
    );
    expect(ExternalStatusPageComponentNames.isFoundIn("   ", "Anything")).toBe(
      false,
    );
  });
});

describe("the names a monitor keeps", () => {
  test("are trimmed, each once as names compare, the first spelling kept", () => {
    expect(
      ExternalStatusPageComponentNames.normalize([
        "  Git Operations ",
        "git operations",
        "Pull Requests",
        "PULL  REQUESTS",
        "Actions",
      ]),
    ).toEqual(["Git Operations", "Pull Requests", "Actions"]);
  });

  test("leave out what is not a name: nothing, white space, stars alone, what is not text", () => {
    expect(
      ExternalStatusPageComponentNames.normalize([
        "",
        "   ",
        "*",
        "**",
        " * ",
        42,
        null,
        { name: "Git Operations" },
        "Webhooks",
      ]),
    ).toEqual(["Webhooks"]);
  });

  test("are none for anything but a list", () => {
    for (const value of [undefined, null, "Git Operations", 7, {}]) {
      expect(ExternalStatusPageComponentNames.normalize(value)).toEqual([]);
    }
  });

  test("are at most so many, each at most so long", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 2000; index++) {
      many.push(`Component ${index}`);
    }

    const kept: Array<string> = ExternalStatusPageComponentNames.normalize(many);

    expect(kept).toHaveLength(EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAMES);
    expect(kept[0]).toBe("Component 0");

    const long: Array<string> = ExternalStatusPageComponentNames.normalize([
      "x".repeat(10000),
    ]);

    expect(long[0]).toHaveLength(EXTERNAL_STATUS_PAGE_MAX_COMPONENT_NAME_LENGTH);
  });

  test("compare as their comparable form says", () => {
    expect(
      ExternalStatusPageComponentNames.comparable(" \n Git \t  Operations 　"),
    ).toBe("git operations");
    expect(
      ExternalStatusPageComponentNames.comparable("y".repeat(5000)),
    ).toHaveLength(EXTERNAL_STATUS_PAGE_MAX_COMPARED_LENGTH);
  });

  test("a name with a star is a pattern; one without is a name", () => {
    expect(ExternalStatusPageComponentNames.isPattern("*us-east-1*")).toBe(true);
    expect(ExternalStatusPageComponentNames.isPattern("Git Operations")).toBe(
      false,
    );
  });
});

describe("a monitor saved with one Component Name Filter", () => {
  test("reads as that name between stars", () => {
    expect(ExternalStatusPageComponentNames.fromLegacyName("API")).toEqual([
      "*API*",
    ]);
    expect(
      ExternalStatusPageComponentNames.fromLegacyName("  Checkout  "),
    ).toEqual(["*Checkout*"]);
  });

  test("with no filter, or one of nothing, watches the whole page", () => {
    for (const value of [undefined, null, "", "   ", 7, "*"]) {
      expect(ExternalStatusPageComponentNames.fromLegacyName(value)).toEqual([]);
    }
  });

  test("watches the components it watched before: every one whose name contains it", () => {
    expect(picked("*Copilot*")).toEqual(
      githubNames.filter((name: string): boolean => {
        return name.toLowerCase().includes("copilot");
      }),
    );

    /*
     * The old rule, as the probe ran it: the name, lower-cased, contains the
     * filter, lower-cased. Over twenty thousand filters and names of
     * letters without white space (where the new reading also collapses
     * nothing), the new reading picks exactly the same.
     */
    const filters: Array<string> = generatedTexts(20000, 1, ["a", "B", "c"], 4);
    const names: Array<string> = generatedTexts(20000, 2, ["A", "b", "c"], 9);
    const differences: Array<string> = [];

    for (let index: number = 0; index < filters.length; index++) {
      const filter: string = filters[index] as string;
      const name: string = names[index] as string;

      if (!filter) {
        continue;
      }

      const before: boolean = name.toLowerCase().includes(filter.toLowerCase());
      const now: boolean = ExternalStatusPageComponentNames.fromLegacyName(
        filter,
      ).some((entry: string): boolean => {
        return ExternalStatusPageComponentNames.matchesComponent(entry, name);
      });

      if (before !== now) {
        differences.push(`${filter} / ${name}`);
      }
    }

    expect(differences).toEqual([]);
  });

  test("never watches fewer components than before, white space and all", () => {
    // Before, " API" missed "API Requests" for the space it asked for.
    const filters: Array<string> = generatedTexts(5000, 3, ["a", " ", "b"], 5);
    const names: Array<string> = generatedTexts(5000, 4, ["a", " ", "b"], 9);

    for (let index: number = 0; index < filters.length; index++) {
      const filter: string = filters[index] as string;
      const name: string = names[index] as string;

      if (!filter.trim()) {
        continue;
      }

      if (name.toLowerCase().includes(filter.toLowerCase())) {
        expect({
          filter,
          name,
          picked: ExternalStatusPageComponentNames.fromLegacyName(filter).some(
            (entry: string): boolean => {
              return ExternalStatusPageComponentNames.matchesComponent(
                entry,
                name,
              );
            },
          ),
        }).toEqual({ filter, name, picked: true });
      }
    }
  });
});

describe("the one name a probe that has not been upgraded reads", () => {
  test("is the name itself, for one name", () => {
    expect(
      ExternalStatusPageComponentNames.toLegacyName(["Git Operations"]),
    ).toBe("Git Operations");
  });

  test("is the longest run of text of a pattern", () => {
    expect(ExternalStatusPageComponentNames.toLegacyName(["*us-east-1*"])).toBe(
      "us-east-1",
    );
    expect(
      ExternalStatusPageComponentNames.toLegacyName(["Workers*KV"]),
    ).toBe("Workers");
  });

  test("is none for two names or more, nor for no names: such a probe watches the whole page", () => {
    expect(
      ExternalStatusPageComponentNames.toLegacyName([
        "Git Operations",
        "Pull Requests",
      ]),
    ).toBeUndefined();
    expect(ExternalStatusPageComponentNames.toLegacyName([])).toBeUndefined();
  });

  test("never watches fewer components than the name does", () => {
    const names: Array<string> = generatedTexts(10000, 5, ["a", "b", "*"], 6);
    const components: Array<string> = generatedTexts(10000, 6, ["a", "b"], 9);

    for (let index: number = 0; index < names.length; index++) {
      const name: string = names[index] as string;
      const component: string = components[index] as string;
      const legacy: string | undefined =
        ExternalStatusPageComponentNames.toLegacyName([name]);

      if (
        !legacy ||
        !ExternalStatusPageComponentNames.matchesComponent(name, component)
      ) {
        continue;
      }

      expect({
        name,
        component,
        oldProbePicks: component.toLowerCase().includes(legacy.toLowerCase()),
      }).toEqual({ name, component, oldProbePicks: true });
    }
  });
});

describe("in time in line with the text", () => {
  /*
   * A page's names and an item's titles are outside text, and a megabyte
   * name is read for its first thousand characters; a pattern of many
   * stars is matched piece by piece, each piece found once.
   */
  test("a pattern of many stars against a name of a megabyte", () => {
    const name: string = "a".repeat(1000000);
    const pattern: string = `${"*a".repeat(120)}*b`;

    const run: { inMs: number; result: boolean } = fastestRun({
      run: (): boolean => {
        let matched: boolean = false;

        for (let repeat: number = 0; repeat < 200; repeat++) {
          matched =
            ExternalStatusPageComponentNames.matchesComponent(pattern, name) ||
            ExternalStatusPageComponentNames.isFoundIn(pattern, name);
        }

        return matched;
      },
      limitInMs: 2000,
    });

    expect(run.result).toBe(false);
    expect(run.inMs).toBeLessThan(2000);
  });

  test("a list of a hundred thousand names", () => {
    const many: Array<string> = [];

    for (let index: number = 0; index < 100000; index++) {
      many.push(` Component  ${index % 300} `);
    }

    const run: { inMs: number; result: Array<string> } = fastestRun({
      run: (): Array<string> => {
        return ExternalStatusPageComponentNames.normalize(many);
      },
      limitInMs: 2000,
    });

    expect(run.result).toHaveLength(300);
    expect(run.inMs).toBeLessThan(2000);
  });
});
