import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../../Server/Services/AlertGroupingEngineService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../../Server/Services/IncidentGroupingEngineService";
import {
  clearPlaceholders,
  clearPlaceholdersExcept,
} from "../../../../Server/Utils/Rules/GroupingRuleEpisodeTemplate";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * AN EPISODE'S TEMPLATE IS CLEARED OF ITS PLACEHOLDERS IN TIME IN LINE WITH
 * ITS LENGTH, AND CLEARED OF EXACTLY WHAT IT WAS CLEARED OF BEFORE.
 *
 * A grouping rule's episode title and description templates are filled with
 * the first incident's (or alert's) own title and description - text a
 * monitor, an incoming request or telemetry can make long - and then cleared
 * of every {{...}} still in them: when the engine opens the episode, and each
 * time the episode service writes the title and description again as members
 * join or leave. The pattern that cleared them read on to the next "}" from
 * every "{{" that starts no placeholder, each try reading the same characters
 * again, so a long run of "{" with no "}" after it took time that grew with
 * the square of its length. clearPlaceholders reads each once and clears
 * exactly what the pattern cleared.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

// The pattern as it was: the reference the reader must agree with.
const PLACEHOLDER_BEFORE: RegExp = /\{\{[^}]+\}\}/g;

const clearedBefore: (text: string) => string = (text: string): string => {
  return text.replace(new RegExp(PLACEHOLDER_BEFORE.source, "g"), "");
};

const clearedExceptBefore: (text: string, kept: string) => string = (
  text: string,
  kept: string,
): string => {
  return text
    .split(kept)
    .map((part: string): string => {
      return clearedBefore(part);
    })
    .join(kept);
};

const WORST_CASES: Array<[string, string]> = [
  ["a run of opening braces", repeat("{", LENGTH)],
  ["openings with a letter each", repeat("{{a", LENGTH)],
  ["openings, then one closing brace far away", repeat("{{", LENGTH) + "}"],
  ["empty openings", repeat("{{}", LENGTH)],
  ["openings across lines", repeat("{{\n", LENGTH)],
];

type AnyFunction = (...args: Array<unknown>) => unknown;

const engineRender: (
  engine: unknown,
  values: Record<string, string>,
  template: string,
) => unknown = (
  engine: unknown,
  values: Record<string, string>,
  template: string,
): unknown => {
  const methods: Record<string, AnyFunction> = engine as Record<
    string,
    AnyFunction
  >;

  return methods["replaceTemplatePlaceholders"]!.call(
    engine,
    values,
    template,
    2,
  );
};

const serviceRender: (service: unknown, template: string) => unknown = (
  service: unknown,
  template: string,
): unknown => {
  const methods: Record<string, AnyFunction> = service as Record<
    string,
    AnyFunction
  >;

  return methods["renderTemplateWithDynamicValues"]!.call(service, template, 2);
};

describe("an episode's template is cleared in time in line with its length", () => {
  test.each(WORST_CASES)(
    "clearPlaceholders: %s",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          return clearPlaceholders(text);
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "clearPlaceholdersExcept: %s",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          return clearPlaceholdersExcept(text, "{{alertCount}}");
        }),
      ).toBeLessThan(2000);
    },
  );

  // The real paths: an engine opening an episode with an alert's own description in it.
  test.each(WORST_CASES)(
    "the alert grouping engine, an alert's description: %s",
    (_label: string, description: string) => {
      expect(
        timeOf(() => {
          return engineRender(
            AlertGroupingEngineService,
            { alertDescription: description },
            "{{alertDescription}} ({{alertCount}})",
          );
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "the incident grouping engine, an incident's description: %s",
    (_label: string, description: string) => {
      expect(
        timeOf(() => {
          return engineRender(
            IncidentGroupingEngineService,
            { incidentDescription: description },
            "{{incidentDescription}} ({{incidentCount}})",
          );
        }),
      ).toBeLessThan(2000);
    },
  );

  // And each time an episode's title and description are written again.
  test.each(WORST_CASES)(
    "the alert episode, written again: %s",
    (_label: string, template: string) => {
      expect(
        timeOf(() => {
          return serviceRender(AlertEpisodeService, template);
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "the incident episode, written again: %s",
    (_label: string, template: string) => {
      expect(
        timeOf(() => {
          return serviceRender(IncidentEpisodeService, template);
        }),
      ).toBeLessThan(2000);
    },
  );
});

describe("an episode's template is cleared of exactly what it was cleared of", () => {
  test("what is cleared, and what stays", () => {
    expect(clearPlaceholders("{{monitorName}}: down")).toBe(": down");
    expect(clearPlaceholders("{{a}}{{b}} x {{c\nd}}")).toBe(" x ");
    // A "{" more inside the braces is part of the placeholder.
    expect(clearPlaceholders("{{{a}}}")).toBe("}");
    // No character, a "}" inside, or no closing pair: left as written.
    expect(clearPlaceholders("{{}} {{a}b}} {{a")).toBe("{{}} {{a}b}} {{a");
    expect(
      clearPlaceholdersExcept("{{x}} {{alertCount}}", "{{alertCount}}"),
    ).toBe(" {{alertCount}}");
  });

  test("the engines and the episodes clear as before", () => {
    expect(
      engineRender(
        AlertGroupingEngineService,
        { alertDescription: "Disk {{full}} on {{host" },
        "{{alertDescription}} ({{alertCount}}) {{monitorName}}",
      ),
    ).toBe("Disk  on {{host (2) ");
    expect(
      serviceRender(IncidentEpisodeService, "{{incidentCount}} {{x}} {{"),
    ).toBe("2  {{");
  });

  const ALPHABET: ReadonlyArray<string> = [
    "{",
    "{{",
    "}",
    "}}",
    "a",
    "b",
    " ",
    "\n",
    "{{alertCount}}",
    "{{a}}",
    "$&",
  ];

  test("clearPlaceholders, on forty thousand drawn texts", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];
    let cleared: number = 0;

    for (const text of generatedTexts(40000, 5353, ALPHABET, 18)) {
      const expected: string = clearedBefore(text);
      const actual: string = clearPlaceholders(text);

      if (expected !== text) {
        cleared++;
      }

      if (actual !== expected) {
        mismatches.push({ text, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(cleared).toBeGreaterThan(10000);
  });

  test("clearPlaceholdersExcept, on forty thousand drawn texts", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];

    for (const text of generatedTexts(40000, 6464, ALPHABET, 18)) {
      const expected: string = clearedExceptBefore(text, "{{alertCount}}");
      const actual: string = clearPlaceholdersExcept(text, "{{alertCount}}");

      if (actual !== expected) {
        mismatches.push({ text, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});
