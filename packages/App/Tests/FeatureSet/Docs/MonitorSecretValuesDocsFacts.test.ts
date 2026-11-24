import { describe, expect, it } from "@jest/globals";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { toLatinDigits } from "./DocsTranslationChecks";
import MonitorSecretValueRedaction, {
  HIDDEN_SECRET_MARKER,
  HiddenSecretValues,
  MINIMUM_HIDDEN_SECRET_LENGTH,
} from "Common/Server/Utils/Monitor/MonitorSecretValueRedaction";

/*
 * What the Monitor Secrets page says OneUptime hides of a secret's value in
 * what a check reports (#10825), held to the code in every docs language:
 *
 *   - the text that stands where a value was is the one the code writes;
 *   - the page's example - a page at
 *     https://app.example.com/login?token={{monitorSecrets.Token}} that
 *     fails to load - is reported as the code reports it, the rest of the
 *     URL kept;
 *   - a value shorter than the code's minimum is not hidden, and the page
 *     names that minimum;
 *   - a criteria is written against the text around a secret, which the
 *     code keeps;
 *   - the troubleshooting entry names the marker.
 */

const PAGE: string = "monitor/monitor-secrets";

const EXAMPLE: string =
  "https://app.example.com/login?token={{monitorSecrets.Token}}";
const REPORTED: string = "https://app.example.com/login?token=[REDACTED]";

// A value as a secret might hold one, filled in where the example has its reference.
const VALUE: string = 'Sk_Live "Q1w2" é';

function compile(value: string): HiddenSecretValues | null {
  return MonitorSecretValueRedaction.compile([value]);
}

describe("what the code hides, as the page says it", () => {
  it("writes the page's marker where a value was", () => {
    expect(HIDDEN_SECRET_MARKER).toBe("[REDACTED]");
  });

  it("reports the page's example as the page shows it, however the browser wrote the value", () => {
    const filled: string = EXAMPLE.replace("{{monitorSecrets.Token}}", VALUE);
    const asLoaded: string = new globalThis.URL(filled).href;

    for (const reported of [filled, asLoaded]) {
      expect(
        MonitorSecretValueRedaction.redactText(
          `page.goto: net::ERR_NAME_NOT_RESOLVED at ${reported}`,
          compile(VALUE),
        ),
      ).toBe(`page.goto: net::ERR_NAME_NOT_RESOLVED at ${REPORTED}`);
    }
  });

  it("hides a value from the page's minimum on, and none shorter", () => {
    expect(MINIMUM_HIDDEN_SECRET_LENGTH).toBe(4);
    expect(compile("x".repeat(MINIMUM_HIDDEN_SECRET_LENGTH - 1))).toBeNull();
    expect(
      compile(`  ${"x".repeat(MINIMUM_HIDDEN_SECRET_LENGTH - 1)}  `),
    ).toBeNull();
    expect(compile("x".repeat(MINIMUM_HIDDEN_SECRET_LENGTH))).not.toBeNull();
  });
});

describe.each(DOCS_LANGUAGES)(
  "%s: the Monitor Secrets page",
  (language: string) => {
    const page: string = readPage(language, PAGE);
    const lines: Array<string> = page.split("\n");
    const exampleLine: number = lines.findIndex((line: string): boolean => {
      return line.includes(`\`${EXAMPLE}\``);
    });

    it("shows the example and how a check reports it, with the code's marker", () => {
      expect(exampleLine).toBeGreaterThan(-1);
      expect(lines[exampleLine]).toContain(`\`${REPORTED}\``);
      expect(lines[exampleLine]).toContain(`\`${HIDDEN_SECRET_MARKER}\``);
    });

    it("names the code's minimum in the list of what is not hidden, after the example", () => {
      const listItems: Array<string> = [];

      for (let index: number = exampleLine + 1; index < lines.length; index++) {
        const line: string = lines[index] as string;

        if (line.startsWith("#")) {
          break;
        }

        if (line.startsWith("- ")) {
          listItems.push(toLatinDigits(line));
        }
      }

      expect(listItems).toHaveLength(2);
      expect(listItems[0]).toMatch(
        new RegExp(`(^|\\D)${MINIMUM_HIDDEN_SECRET_LENGTH}(\\D|$)`),
      );
    });

    it("writes a criteria against the text around a secret, which the code keeps", () => {
      const criteriaLine: string =
        lines.find((line: string): boolean => {
          return (
            line.includes("`ERR_NAME_NOT_RESOLVED`") &&
            line.includes("`token=`")
          );
        }) || "";

      expect(criteriaLine).not.toBe("");
    });

    it("explains, under Troubleshooting, a check that shows the marker", () => {
      expect(
        lines.some((line: string): boolean => {
          return (
            line.startsWith(":::details") &&
            line.includes(`\`${HIDDEN_SECRET_MARKER}\``)
          );
        }),
      ).toBe(true);
      expect(page).toContain("`token=[REDACTED]`");
    });
  },
);
