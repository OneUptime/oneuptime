import { describe, expect, test } from "@jest/globals";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import { Translator } from "../../../Types/Translator";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  DropdownOption,
  getDropdownOptionText,
} from "../../../UI/Components/Dropdown/Dropdown";
import {
  getSecurityCasePriorityOptions,
  getSecurityCaseStatusOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseValueOptions";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestPriority,
  buildTestStatus,
} from "../../Helpers/SecurityCaseValues";

/*
 * A CASE'S PRIORITIES AND STATUSES, AS A FILTER AND A PICKER OFFER THEM
 * (#7690).
 *
 * The names a new project starts with ("High", "Investigating") are
 * OneUptime's words: a Spanish menu and chip read "Alta" and "Investigando",
 * as the case pages read them. A name a project gives one of its own is
 * drawn as written (DropdownOption.isUserContent): a priority named
 * "Network" is never "Red" in a Spanish menu or in the chip its filter
 * leaves above the cases.
 */

const SPANISH: Translator = dashboardTranslator("es");
const SPANISH_WORDS: Record<string, string> = readDashboardLocale("es");

// An option as the menu, the picked value and a filter's chip draw it.
function drawn(option: DropdownOption): string {
  return getDropdownOptionText(option, SPANISH.translateText);
}

// Spanish's words for English ones, each a word of its own.
function inSpanish(words: Array<string>): Array<string> {
  return words.map((word: string): string => {
    const spanish: string | undefined = SPANISH_WORDS[word];

    expect(spanish).toBeTruthy();
    expect(spanish).not.toBe(word);

    return spanish as string;
  });
}

test("Spanish has a word of its own for the name the projects below give one of theirs", () => {
  expect(SPANISH_WORDS["Network"]).toBe("Red");
});

describe("a project's case priorities, offered in Spanish", () => {
  const priorities: Array<SecurityCasePriority> = [
    ...buildDefaultTestPriorities(),
    buildTestPriority({
      id: "76900000-0000-4000-8000-0000000000a1",
      name: "Network",
      order: 6,
    }),
  ];

  test("a new project's names in Spanish, the project's own name as written", () => {
    const options: Array<DropdownOption> = getSecurityCasePriorityOptions(
      priorities,
      { forFilter: true },
    );

    expect(options.map(drawn)).toEqual([
      ...inSpanish(["Critical", "High", "Medium", "Low", "Informational"]),
      "Network",
    ]);
  });

  test("marks the project's own name, and none of a new project's", () => {
    expect(
      getSecurityCasePriorityOptions(priorities).map(
        (option: DropdownOption) => {
          return [option.label, option.isUserContent];
        },
      ),
    ).toEqual([
      ["Critical", false],
      ["High", false],
      ["Medium", false],
      ["Low", false],
      ["Informational", false],
      ["Network", true],
    ]);
  });
});

describe("a project's case statuses, offered in Spanish", () => {
  test("a new project's names in Spanish, the project's own name as written", () => {
    const statuses: Array<SecurityCaseStatus> = [
      ...buildDefaultTestStatuses(),
      buildTestStatus({
        id: "76900000-0000-4000-8000-0000000000b1",
        name: "Network",
        order: 5,
        stage: SecurityCaseStage.Acknowledged,
      }),
    ];

    expect(
      getSecurityCaseStatusOptions(statuses, { forFilter: true }).map(drawn),
    ).toEqual([
      ...inSpanish(["New", "Investigating", "Contained", "Closed"]),
      "Network",
    ]);
  });
});
