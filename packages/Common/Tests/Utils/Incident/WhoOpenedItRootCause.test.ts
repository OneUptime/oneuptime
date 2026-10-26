import { describe, expect, test } from "@jest/globals";
import isWhoOpenedItRootCause from "../../../Utils/Incident/WhoOpenedItRootCause";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A ROOT CAUSE THAT ONLY SAYS WHO OPENED THE RECORD.
 *
 * The lines OneUptime used to write into an empty root cause - who opened
 * the incident or alert, in four ways - read as no root cause; anything a
 * person wrote, however it starts, is a root cause.
 */

const PERSON_LINK: string =
  "https://oneuptime.example/dashboard/10000000-0000-4000-8000-000000000001/settings/users/80000000-0000-4000-8000-000000000001";

describe("the lines OneUptime wrote for who opened a record", () => {
  test("an incident or an alert opened by a person, as the services wrote it", () => {
    expect(
      isWhoOpenedItRootCause(
        mdText`Incident created by [${"Maya Chen"}](${PERSON_LINK})`.toString(),
      ),
    ).toBe(true);
    expect(
      isWhoOpenedItRootCause(
        mdText`Alert created by [${"Maya Chen"}](${PERSON_LINK})`.toString(),
      ),
    ).toBe(true);
  });

  test("a name with Markdown characters, escaped as the services escaped it", () => {
    for (const name of [
      "Maya [ops] Chen",
      "maya_chen*",
      "M]aya",
      "Maya \\ Chen",
      "<!channel>",
    ]) {
      const written: string =
        mdText`Incident created by [${name}](${PERSON_LINK})`.toString();

      expect([name, isWhoOpenedItRootCause(written)]).toEqual([name, true]);
    }
  });

  test("Slack's and Microsoft Teams' Declare Incident", () => {
    expect(
      isWhoOpenedItRootCause(
        mdText`Incident created by @${"maya.chen"} on Slack.`.toString(),
      ),
    ).toBe(true);
    expect(
      isWhoOpenedItRootCause(
        mdText`Incident created by @${"maya_chen"} on Slack.`.toString(),
      ),
    ).toBe(true);
    expect(isWhoOpenedItRootCause("Incident created via Microsoft Teams")).toBe(
      true,
    );
  });

  test("the AI copilot's Create Incident", () => {
    expect(
      isWhoOpenedItRootCause("Incident created via the OneUptime AI copilot."),
    ).toBe(true);
  });

  test("with the space or line breaks around it a stored value may carry", () => {
    expect(
      isWhoOpenedItRootCause(
        `  Incident created by [Maya Chen](${PERSON_LINK})\n`,
      ),
    ).toBe(true);
    expect(
      isWhoOpenedItRootCause("\nIncident created via Microsoft Teams  "),
    ).toBe(true);
  });
});

describe("a root cause somebody wrote", () => {
  test.each([
    "Incident created by a bad deploy of checkout-api.",
    "Incident created by Maya Chen",
    `Incident created by [Maya Chen](${PERSON_LINK}), who rolled back the pool size change.`,
    `The pool was cut to 10.\n\nIncident created by [Maya Chen](${PERSON_LINK})`,
    `Incident created by [Maya Chen](${PERSON_LINK})\nThe pool was cut to 10.`,
    `Episode created by [Maya Chen](${PERSON_LINK})`,
    "Incident created by @maya on Slack. The pool was cut to 10.",
    "Incident created by @ on Slack.",
    "Incident created via Microsoft Teams after a bad deploy",
    "Incident created via Slack",
    "The pool was cut to 10.",
  ])("%p is a root cause", (written: string) => {
    expect(isWhoOpenedItRootCause(written)).toBe(false);
  });

  test("nothing, and only space, is no line of OneUptime's", () => {
    expect(isWhoOpenedItRootCause("")).toBe(false);
    expect(isWhoOpenedItRootCause("   \n")).toBe(false);
    expect(isWhoOpenedItRootCause(null)).toBe(false);
    expect(isWhoOpenedItRootCause(undefined)).toBe(false);
  });
});

/*
 * A root cause is text somebody wrote, of any length: it is read in time in
 * line with it. Past a thousand characters it is never one of OneUptime's
 * lines, and is not read further.
 */
describe("a long root cause", () => {
  test.each([
    ["an unclosed name", `Incident created by [${"\\]".repeat(200000)}`],
    [
      "a Slack line that never ends",
      `Incident created by @${"a on Slack".repeat(40000)}`,
    ],
    ["a link that never closes", `Alert created by [a](${"(".repeat(400000)}`],
  ])("%s is answered within two seconds", (_name: string, text: string) => {
    const timed: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isWhoOpenedItRootCause(text);
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe(false);
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("a line of OneUptime's past a thousand characters is not one", () => {
    expect(
      isWhoOpenedItRootCause(
        `Incident created by [${"a".repeat(1000)}](${PERSON_LINK})`,
      ),
    ).toBe(false);
  });
});
