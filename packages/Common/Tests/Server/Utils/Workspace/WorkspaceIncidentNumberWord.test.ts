import { describe, expect, test } from "@jest/globals";
import WorkspaceIncidentNumberWordReader, {
  WorkspaceIncidentNumberWord,
} from "../../../../Server/Utils/Workspace/WorkspaceIncidentNumberWord";
import WorkspaceIncidentActions from "../../../../Server/Utils/Workspace/WorkspaceIncidentActions";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * `/oneuptime incident 42` - and `incident 42` typed to the Microsoft Teams
 * bot - shows incident 42, with its buttons, instead of opening the
 * incident form titled "42". The number may be written as OneUptime shows
 * it: #42, or with the project's prefix, INC-42. Anything else is the new
 * incident's title, as the command always took it.
 */

describe("WorkspaceIncidentNumberWordReader.read: a word naming an incident by its number", () => {
  test.each([
    ["42", 42, true],
    ["#42", 42, true],
    ["  42  ", 42, true],
    ["INC-42", 42, false],
    ["inc-42", 42, false],
    ["SEV-1", 1, false],
    ["OPS_7", 7, false],
    ["ops.7", 7, false],
    ["team/inc:12", 12, false],
    ["ИНЦ-42", 42, false],
    ["事件-42", 42, false],
    ["0", 0, true],
    ["999999999", 999999999, true],
  ])(
    "%p is incident %p (any incident of that number: %p)",
    (typed: string, number: number, isPlainNumber: boolean) => {
      expect(WorkspaceIncidentNumberWordReader.read(typed)).toEqual({
        word: typed.trim(),
        number: number,
        isPlainNumber: isPlainNumber,
      });
    },
  );

  test.each([
    ["", "nothing typed"],
    ["   ", "only spaces"],
    ["Checkout is down", "a title of words"],
    ["500 errors", "a number, then words"],
    ["INC 42", "a prefix and a number apart"],
    ["42abc", "digits before letters"],
    ["#", "a # alone"],
    ["INC-", "a prefix alone"],
    ["<b>42", "a character no prefix may hold"],
    ["**42**", "Markdown"],
    ["1234567890", "more digits than an incident number holds"],
    [`${"A".repeat(40)}1`, "a word longer than a prefix and a number"],
  ])("%p is not an incident's number: %s", (typed: string) => {
    const read: WorkspaceIncidentNumberWord | null =
      WorkspaceIncidentNumberWordReader.read(typed);

    expect(read).toBeNull();
  });

  test("a line break around the number is space around it: still the number", () => {
    expect(WorkspaceIncidentNumberWordReader.read("42\n")).toEqual({
      word: "42",
      number: 42,
      isPlainNumber: true,
    });
  });

  test("null and undefined are no number", () => {
    expect(WorkspaceIncidentNumberWordReader.read(null)).toBeNull();
    expect(WorkspaceIncidentNumberWordReader.read(undefined)).toBeNull();
  });

  test("WorkspaceIncidentActions reads a word the same way", () => {
    for (const typed of ["42", "#7", "INC-42", "Checkout is down", ""]) {
      expect(WorkspaceIncidentActions.readNumberWord(typed)).toEqual(
        WorkspaceIncidentNumberWordReader.read(typed),
      );
    }
  });

  /*
   * A command's text is whatever a person typed: read a character at a
   * time, in time that grows with the text, whatever its shape.
   */
  test.each([
    ["400,000 digits", "4".repeat(400000)],
    ["400,000 letters and a digit", `${"a".repeat(400000)}1`],
    ["400,000 spaces then a digit", `${" ".repeat(400000)}1`],
    ["a prefix of 400,000 dashes", `${"-".repeat(400000)}42`],
  ])(
    "%s: answered in well under two seconds",
    (_name: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          WorkspaceIncidentNumberWordReader.read(text);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});
