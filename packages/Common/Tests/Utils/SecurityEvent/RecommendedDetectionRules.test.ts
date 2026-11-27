import { describe, expect, test } from "@jest/globals";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import ObjectID from "../../../Types/ObjectID";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
  getRecommendedDetectionRules,
  isRecommendedDetectionRule,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  ProjectRuleState,
  RULES_ADDED_BY_ONEUPTIME_SHOWN_FOR_IN_DAYS,
  SecurityRuleAddedByOneUptime,
  getRecommendedRulesNotAdded,
  getRulesAddedByOneUptime,
  hasEveryOtherRecommendedRuleOn,
  readRecommendedRulesNotAdded,
  readRulesAddedByOneUptime,
} from "../../../Utils/SecurityEvent/RecommendedDetectionRules";
import { buildDetectionRuleFromLibrary } from "../../../Utils/SecurityEvent/SecurityTemplateRecords";

/*
 * WHICH RECOMMENDED RULES A PROJECT DOES NOT HAVE, AND WHICH ONEUPTIME ADDED
 * (#11037).
 *
 * Sensitive file served became a recommended rule after many projects had
 * clicked Turn on recommended; the Overview read one fewer than all of them
 * and never said which. Pinned here, as the server, the Dashboard and the
 * upgrade read it:
 *
 *   - the recommended rules a project has no rule of, in the library's
 *     order - a rule renamed, or added under the library's name, counts as
 *     there; one turned off is there too, and only missing from "on";
 *   - whether a project runs every other recommended rule, which is what
 *     the upgrade asks before it adds the new one;
 *   - the rules OneUptime added itself, for a month, while they are on;
 *   - the Dashboard's defensive read of both.
 */

const PROJECT: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-0000000e1037");
const NOW: Date = new Date("2026-11-27T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;

function entryOf(id: string): DetectionRuleLibraryEntry {
  return getDetectionRuleLibraryEntry(id)!;
}

// A project's rule of a library entry, as Turn on recommended adds it.
function ruleOf(
  entry: DetectionRuleLibraryEntry,
  state: { isEnabled?: boolean; name?: string; addedByOneUptimeAt?: Date } = {},
): DetectionRule {
  const rule: DetectionRule = buildDetectionRuleFromLibrary({
    projectId: PROJECT,
    entry,
  });
  rule.id = ObjectID.generate();
  rule.isEnabled = state.isEnabled === undefined ? true : state.isEnabled;

  if (state.name !== undefined) {
    rule.name = state.name;
  }

  if (state.addedByOneUptimeAt) {
    rule.addedByOneUptimeAt = state.addedByOneUptimeAt;
  }

  return rule;
}

// Every recommended rule, on - but these.
function allRecommendedBut(...exceptIds: Array<string>): Array<DetectionRule> {
  return getRecommendedDetectionRules()
    .filter((entry: DetectionRuleLibraryEntry): boolean => {
      return !exceptIds.includes(entry.id);
    })
    .map((entry: DetectionRuleLibraryEntry): DetectionRule => {
      return ruleOf(entry);
    });
}

function ids(entries: Array<DetectionRuleLibraryEntry>): Array<string> {
  return entries.map((entry: DetectionRuleLibraryEntry): string => {
    return entry.id;
  });
}

describe("the recommended rules a project has no rule of", () => {
  test("a project that turned them on before Sensitive file served existed is missing exactly that one", () => {
    expect(
      ids(
        getRecommendedRulesNotAdded(
          allRecommendedBut(SENSITIVE_FILE_SERVED_RULE_ID),
        ),
      ),
    ).toEqual([SENSITIVE_FILE_SERVED_RULE_ID]);
  });

  test("a new project is missing every one, in the library's order", () => {
    expect(ids(getRecommendedRulesNotAdded([]))).toEqual(
      ids(getRecommendedDetectionRules()),
    );
    expect(getRecommendedDetectionRules()).toHaveLength(
      RECOMMENDED_DETECTION_RULE_IDS.length,
    );
  });

  test("a rule the team renamed, or turned off, is still the project's: never named missing", () => {
    const served: DetectionRuleLibraryEntry = entryOf(
      SENSITIVE_FILE_SERVED_RULE_ID,
    );
    const scanning: DetectionRuleLibraryEntry = entryOf(
      SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
    );

    expect(
      getRecommendedRulesNotAdded([
        ...allRecommendedBut(served.id, scanning.id),
        ruleOf(served, { name: "Leaked .env (ours)" }),
        ruleOf(scanning, { isEnabled: false }),
      ]),
    ).toEqual([]);
  });

  test("a rule of the library's name whose YAML lost its id counts as there", () => {
    const served: DetectionRuleLibraryEntry = entryOf(
      SENSITIVE_FILE_SERVED_RULE_ID,
    );
    const named: ProjectRuleState = {
      name: "  sensitive FILE served ",
      sigmaRuleYaml:
        "title: ours\ndetection:\n  sel:\n    a: b\n  condition: sel\n",
      isEnabled: true,
    };

    expect(
      getRecommendedRulesNotAdded([...allRecommendedBut(served.id), named]),
    ).toEqual([]);
  });

  test("only recommended rules are ever named: one the library holds for a product the project has not connected is not", () => {
    const notRecommended: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return !isRecommendedDetectionRule(entry);
        },
      );

    expect(notRecommended.length).toBeGreaterThan(0);

    for (const entry of getRecommendedRulesNotAdded([])) {
      expect(isRecommendedDetectionRule(entry)).toBe(true);
    }
  });
});

describe("whether a project runs every other recommended rule", () => {
  test("every other one added and on: yes", () => {
    expect(
      hasEveryOtherRecommendedRuleOn(
        allRecommendedBut(SENSITIVE_FILE_SERVED_RULE_ID),
        [SENSITIVE_FILE_SERVED_RULE_ID],
      ),
    ).toBe(true);
    // ...and with the new one too, it still runs every other.
    expect(
      hasEveryOtherRecommendedRuleOn(allRecommendedBut(), [
        SENSITIVE_FILE_SERVED_RULE_ID,
      ]),
    ).toBe(true);
  });

  test("one of them turned off: the project chose its own set", () => {
    const rules: Array<DetectionRule> = allRecommendedBut(
      SENSITIVE_FILE_SERVED_RULE_ID,
    );
    rules[3]!.isEnabled = false;

    expect(
      hasEveryOtherRecommendedRuleOn(rules, [SENSITIVE_FILE_SERVED_RULE_ID]),
    ).toBe(false);
  });

  test("one of them deleted: the project chose its own set", () => {
    expect(
      hasEveryOtherRecommendedRuleOn(
        allRecommendedBut(
          SENSITIVE_FILE_SERVED_RULE_ID,
          SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
        ),
        [SENSITIVE_FILE_SERVED_RULE_ID],
      ),
    ).toBe(false);
  });

  test("a rule whose on is not said reads as not on: never assumed", () => {
    const rules: Array<ProjectRuleState> = allRecommendedBut(
      SENSITIVE_FILE_SERVED_RULE_ID,
    ).map((rule: DetectionRule): ProjectRuleState => {
      return { name: rule.name, sigmaRuleYaml: rule.sigmaRuleYaml };
    });

    expect(
      hasEveryOtherRecommendedRuleOn(rules, [SENSITIVE_FILE_SERVED_RULE_ID]),
    ).toBe(false);
  });

  test("no project, and no other recommended rule, is no yes", () => {
    expect(
      hasEveryOtherRecommendedRuleOn([], [SENSITIVE_FILE_SERVED_RULE_ID]),
    ).toBe(false);
    expect(
      hasEveryOtherRecommendedRuleOn(allRecommendedBut(), [
        ...RECOMMENDED_DETECTION_RULE_IDS,
      ]),
    ).toBe(false);
  });
});

describe("the rules OneUptime added itself", () => {
  const served: DetectionRuleLibraryEntry = entryOf(
    SENSITIVE_FILE_SERVED_RULE_ID,
  );

  test("named for a month, with the name the project's lists show, the latest first", () => {
    const rule: DetectionRule = ruleOf(served, {
      addedByOneUptimeAt: new Date(NOW.getTime() - 2 * DAY),
    });
    const older: DetectionRule = ruleOf(
      entryOf(SCANNING_FOR_SENSITIVE_FILES_RULE_ID),
      { addedByOneUptimeAt: new Date(NOW.getTime() - 20 * DAY) },
    );

    expect(
      getRulesAddedByOneUptime({
        rules: [older, ...allRecommendedBut(served.id), rule],
        now: NOW,
      }),
    ).toEqual([
      {
        ruleId: rule.id!.toString(),
        libraryRuleId: served.id,
        name: "Sensitive file served",
        addedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
      },
      {
        ruleId: older.id!.toString(),
        libraryRuleId: SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
        name: "Scanning for sensitive files",
        addedAt: new Date(NOW.getTime() - 20 * DAY).toISOString(),
      },
    ]);
  });

  test("not once it is more than a month old, turned off, added by a person, or no recommended rule's", () => {
    const old: DetectionRule = ruleOf(served, {
      addedByOneUptimeAt: new Date(
        NOW.getTime() - (RULES_ADDED_BY_ONEUPTIME_SHOWN_FOR_IN_DAYS + 1) * DAY,
      ),
    });
    const off: DetectionRule = ruleOf(served, {
      isEnabled: false,
      addedByOneUptimeAt: new Date(NOW.getTime() - DAY),
    });
    const byPerson: DetectionRule = ruleOf(served);
    const notRecommended: DetectionRule = ruleOf(
      DETECTION_RULE_LIBRARY.find(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return !isRecommendedDetectionRule(entry);
        },
      )!,
      { addedByOneUptimeAt: new Date(NOW.getTime() - DAY) },
    );

    expect(
      getRulesAddedByOneUptime({
        rules: [old, off, byPerson, notRecommended],
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("a renamed rule keeps its own name", () => {
    const rule: DetectionRule = ruleOf(served, {
      name: "Leaked secrets",
      addedByOneUptimeAt: new Date(NOW.getTime() - DAY),
    });

    expect(getRulesAddedByOneUptime({ rules: [rule], now: NOW })[0]!.name).toBe(
      "Leaked secrets",
    );
  });

  test("a time read back as text, as JSON hands it over, is read the same", () => {
    const rule: DetectionRule = ruleOf(served);
    (rule as unknown as { addedByOneUptimeAt: string }).addedByOneUptimeAt =
      new Date(NOW.getTime() - DAY).toISOString();

    expect(getRulesAddedByOneUptime({ rules: [rule], now: NOW })).toHaveLength(
      1,
    );
  });
});

describe("the Dashboard's read of them", () => {
  test("the rules not added: the recommended ones it knows, each once, in the library's order", () => {
    const scanning: string = SCANNING_FOR_SENSITIVE_FILES_RULE_ID;
    const served: string = SENSITIVE_FILE_SERVED_RULE_ID;
    const notRecommended: string = DETECTION_RULE_LIBRARY.find(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return !isRecommendedDetectionRule(entry);
      },
    )!.id;

    expect(
      ids(
        readRecommendedRulesNotAdded([
          served,
          "a rule a newer server knows",
          scanning,
          served,
          notRecommended,
          42,
        ] as never),
      ),
    ).toEqual([scanning, served]);

    for (const value of [undefined, null, "x", {}, 7]) {
      expect(readRecommendedRulesNotAdded(value as never)).toEqual([]);
    }
  });

  test("the rules OneUptime added: an entry it cannot read is left out", () => {
    const valid: SecurityRuleAddedByOneUptime = {
      ruleId: "0192f1a0-0000-7000-8000-0000000e1001",
      libraryRuleId: SENSITIVE_FILE_SERVED_RULE_ID,
      name: "Sensitive file served",
      addedAt: NOW.toISOString(),
    };

    expect(
      readRulesAddedByOneUptime([
        valid,
        { ...valid, ruleId: "" },
        { ...valid, libraryRuleId: "nope" },
        { ...valid, addedAt: "not a time" },
        { ...valid, name: "" },
        "x",
        null,
      ] as never),
    ).toEqual([
      valid,
      // A missing name reads as the library's.
      { ...valid, name: "Sensitive file served" },
    ]);
    expect(readRulesAddedByOneUptime(undefined)).toEqual([]);
  });
});
