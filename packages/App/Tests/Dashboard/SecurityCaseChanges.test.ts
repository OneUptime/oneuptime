import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Team from "Common/Models/DatabaseModels/Team";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriorityLevel from "Common/Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "Common/Types/SecurityCase/SecurityCaseVerdict";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestPriority,
  buildTestStatus,
  testPriorityId,
  testStatusId,
} from "Common/Tests/Helpers/SecurityCaseValues";
import {
  ASSIGN_TO_ME,
  ASSIGN_TO_SOMEONE_ELSE,
  CHANGE_PRIORITY,
  CHANGE_STATUS,
  SECURITY_CASE_CHANGE_ICONS,
  SKIP_REASON_TEXT,
  SecurityCaseSkipReason,
  SecurityCaseValueChoice,
  doesStatusCloseAnySecurityCase,
  doesStatusCloseSecurityCase,
  getSecurityCaseAssignSkipReason,
  getSecurityCaseAssignWrite,
  getSecurityCaseAssigneeId,
  getSecurityCasePriorityChoices,
  getSecurityCasePriorityId,
  getSecurityCasePrioritySkipReason,
  getSecurityCasePriorityWrite,
  getSecurityCaseStatusChoices,
  getSecurityCaseStatusId,
  getSecurityCaseStatusSkipReason,
  getSecurityCaseStatusWrite,
  getSecurityCaseTeamId,
  getSecurityCaseValueName,
  hasSecurityCaseAssignee,
  isAssignToMeOffered,
  isAssignToSomeoneElseOffered,
  isSecurityCaseClosed,
  isSecurityCaseMine,
  readSecurityCaseId,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseChanges";

/*
 * What working a case from a list does to it (SecurityCaseChanges): which
 * moves a case is offered, what each writes, when a case is left as it is
 * and why, and the statuses and priorities the dialogs offer. The row's ⋯,
 * Bulk Actions and the case's header all read these rules, so a case
 * changes the same way wherever it is worked; the components' suites
 * (Common's SecurityCaseListActions.test.tsx, SecurityCaseHeader and
 * SecurityCaseViewLayout) check they are wired, these the rules themselves.
 */

const ME: string = "80000000-0000-4000-8000-000000000001";
const DIEGO: string = "80000000-0000-4000-8000-000000000002";
const SOC_TEAM: string = "70000000-0000-4000-8000-000000000001";
const OTHER_TEAM: string = "70000000-0000-4000-8000-000000000002";

// The project's own statuses: Eradicating after Contained, Closed - Duplicate after Closed.
const ERADICATING_ID: string = "c2000000-0000-4000-8000-0000000000a2";
const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";
const RETIRED_ID: string = "c2000000-0000-4000-8000-0000000000a4";

const STATUSES: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
const PRIORITIES: Array<SecurityCasePriority> = buildDefaultTestPriorities();

function teamStatuses(): Array<SecurityCaseStatus> {
  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
  statuses[3]!.order = 6; // Closed

  return [
    ...statuses,
    buildTestStatus({
      id: ERADICATING_ID,
      name: "Eradicating",
      order: 4,
      color: "#0d9488",
    }),
    // Retired, between Contained and Closed: nobody picks it again.
    buildTestStatus({
      id: RETIRED_ID,
      name: "Escalated",
      order: 5,
      color: "#64748b",
      isArchived: true,
    }),
    buildTestStatus({
      id: DUPLICATE_ID,
      name: "Closed - Duplicate",
      order: 7,
      color: "#6b7280",
    }),
  ];
}

function buildCase(
  fields: {
    stage?: SecurityCaseStage;
    statusId?: string;
    priority?: SecurityCasePriorityLevel;
    priorityId?: string;
    userId?: string;
    teamId?: string;
  } = {},
): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = "20000000-0000-4000-8000-000000000141";
  securityCase.caseNumberWithPrefix = "CASE-141";
  securityCase.title = "Known-bad domain resolved by build-runner-07";
  securityCase.securityCaseStatusId = new ObjectID(
    fields.statusId ||
      testStatusId(fields.stage || SecurityCaseStage.New).toString(),
  );
  securityCase.securityCasePriorityId = new ObjectID(
    fields.priorityId ||
      testPriorityId(
        fields.priority || SecurityCasePriorityLevel.High,
      ).toString(),
  );

  if (fields.userId) {
    securityCase.assignedToUserId = new ObjectID(fields.userId);
  }

  if (fields.teamId) {
    securityCase.assignedToTeamId = new ObjectID(fields.teamId);
  }

  return securityCase;
}

function ids(choices: Array<SecurityCaseValueChoice>): Array<string> {
  return choices.map((choice: SecurityCaseValueChoice): string => {
    return choice.id;
  });
}

describe("the four moves", () => {
  test("are named as the case's header and Bulk Actions name them, each with its icon", () => {
    expect([
      ASSIGN_TO_ME,
      ASSIGN_TO_SOMEONE_ELSE,
      CHANGE_STATUS,
      CHANGE_PRIORITY,
    ]).toEqual([
      "Assign to Me",
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
    ]);
    expect(SECURITY_CASE_CHANGE_ICONS).toEqual({
      assignToMe: IconProp.User,
      assignToSomeoneElse: IconProp.UserPlus,
      changeStatus: IconProp.ArrowCircleRight,
      changePriority: IconProp.Signal,
    });
  });
});

describe("reading a row", () => {
  test("ids come off the column, or off the related row a list read instead", () => {
    const fromColumns: SecurityCase = buildCase({
      userId: ME,
      teamId: SOC_TEAM,
    });

    expect(getSecurityCaseStatusId(fromColumns)).toBe(
      TEST_STATUS_IDS[SecurityCaseStage.New],
    );
    expect(getSecurityCasePriorityId(fromColumns)).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
    );
    expect(getSecurityCaseAssigneeId(fromColumns)).toBe(ME);
    expect(getSecurityCaseTeamId(fromColumns)).toBe(SOC_TEAM);

    // Only the relations, as a list reading the pills' names and colours has them.
    const fromRelations: SecurityCase = new SecurityCase();
    const team: Team = new Team();
    team._id = OTHER_TEAM;
    fromRelations.assignedToTeam = team;
    fromRelations.securityCaseStatus = STATUSES[3]!;
    fromRelations.securityCasePriority = PRIORITIES[0]!;

    expect(getSecurityCaseStatusId(fromRelations)).toBe(
      TEST_STATUS_IDS[SecurityCaseStage.Closed],
    );
    expect(getSecurityCasePriorityId(fromRelations)).toBe(
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    );
    expect(getSecurityCaseTeamId(fromRelations)).toBe(OTHER_TEAM);
    expect(getSecurityCaseAssigneeId(fromRelations)).toBe("");
  });

  test.each([
    [undefined, ""],
    [null, ""],
    ["  " + ME + " ", ME],
    [new ObjectID(ME), ME],
    [{ _id: ME }, ME],
    [{ id: new ObjectID(ME) }, ME],
    [{}, ""],
    [42, ""],
  ])("readSecurityCaseId(%p) is %p", (value: unknown, expected: string) => {
    expect(readSecurityCaseId(value)).toBe(expected);
  });

  test("a case is the reader's when its person is them; nobody signed in has none", () => {
    expect(isSecurityCaseMine(buildCase({ userId: ME }), ME)).toBe(true);
    expect(
      isSecurityCaseMine(buildCase({ userId: ME }), new ObjectID(ME)),
    ).toBe(true);
    expect(isSecurityCaseMine(buildCase({ userId: DIEGO }), ME)).toBe(false);
    expect(isSecurityCaseMine(buildCase(), ME)).toBe(false);
    expect(isSecurityCaseMine(buildCase(), undefined)).toBe(false);
    expect(isSecurityCaseMine(buildCase(), "")).toBe(false);
  });

  test("closed is the project's closed status, or one after it - never by a name", () => {
    const statuses: Array<SecurityCaseStatus> = teamStatuses();

    expect(
      isSecurityCaseClosed(
        buildCase({ stage: SecurityCaseStage.Closed }),
        statuses,
      ),
    ).toBe(true);
    expect(
      isSecurityCaseClosed(buildCase({ statusId: DUPLICATE_ID }), statuses),
    ).toBe(true);
    expect(
      isSecurityCaseClosed(buildCase({ statusId: ERADICATING_ID }), statuses),
    ).toBe(false);
    // A status the project does not have: not closed, so still worked.
    expect(
      isSecurityCaseClosed(
        buildCase({ statusId: "c2000000-0000-4000-8000-0000000000ff" }),
        statuses,
      ),
    ).toBe(false);
  });
});

describe("which moves a row offers", () => {
  test("Assign to Me: an open case that is not the reader's - the header's own rule", () => {
    const offered: (securityCase: SecurityCase) => boolean = (
      securityCase: SecurityCase,
    ): boolean => {
      return isAssignToMeOffered({
        securityCase: securityCase,
        statuses: STATUSES,
        myUserId: new ObjectID(ME),
      });
    };

    expect(offered(buildCase())).toBe(true);
    expect(offered(buildCase({ userId: DIEGO }))).toBe(true);
    // Handed to a team, nobody on it: the reader may take it.
    expect(offered(buildCase({ teamId: SOC_TEAM }))).toBe(true);
    expect(offered(buildCase({ userId: ME }))).toBe(false);
    expect(offered(buildCase({ stage: SecurityCaseStage.Closed }))).toBe(false);
    expect(
      offered(buildCase({ stage: SecurityCaseStage.Contained, userId: DIEGO })),
    ).toBe(true);
  });

  test("Assign to Someone Else: any open case, the reader's own among them; never a closed one", () => {
    const statuses: Array<SecurityCaseStatus> = teamStatuses();

    for (const statusId of [
      TEST_STATUS_IDS[SecurityCaseStage.New],
      TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      ERADICATING_ID,
    ]) {
      expect(
        isAssignToSomeoneElseOffered({
          securityCase: buildCase({ statusId, userId: ME }),
          statuses,
        }),
      ).toBe(true);
    }

    for (const statusId of [
      TEST_STATUS_IDS[SecurityCaseStage.Closed],
      DUPLICATE_ID,
    ]) {
      expect(
        isAssignToSomeoneElseOffered({
          securityCase: buildCase({ statusId }),
          statuses,
        }),
      ).toBe(false);
    }
  });
});

describe("giving a case to someone else", () => {
  test("a person works it, and the team it is in stays", () => {
    expect(getSecurityCaseAssignWrite({ userId: DIEGO })).toEqual({
      assignedToUserId: DIEGO,
    });
  });

  test("a team takes it into its queue: the person on it comes off", () => {
    expect(getSecurityCaseAssignWrite({ teamId: SOC_TEAM })).toEqual({
      assignedToTeamId: SOC_TEAM,
      assignedToUserId: null,
    });
  });

  test("a pick of nobody writes nothing, and says it names nobody", () => {
    expect(getSecurityCaseAssignWrite({})).toEqual({});
    expect(getSecurityCaseAssignWrite({ userId: " ", teamId: "" })).toEqual({});
    expect(hasSecurityCaseAssignee({})).toBe(false);
    expect(hasSecurityCaseAssignee({ userId: DIEGO })).toBe(true);
    expect(hasSecurityCaseAssignee({ teamId: SOC_TEAM })).toBe(true);
  });

  test("a closed case is left as it is: it would be reopened first", () => {
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ stage: SecurityCaseStage.Closed }),
        pick: { userId: DIEGO },
        statuses: STATUSES,
        myUserId: ME,
      }),
    ).toBe(SecurityCaseSkipReason.Closed);
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ statusId: DUPLICATE_ID }),
        pick: { teamId: SOC_TEAM },
        statuses: teamStatuses(),
        myUserId: ME,
      }),
    ).toBe(SecurityCaseSkipReason.Closed);
  });

  test("the person it is with already: yours, or theirs", () => {
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ userId: ME }),
        pick: { userId: ME },
        statuses: STATUSES,
        myUserId: new ObjectID(ME),
      }),
    ).toBe(SecurityCaseSkipReason.AssignedToYou);
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ userId: DIEGO }),
        pick: { userId: DIEGO },
        statuses: STATUSES,
        myUserId: ME,
      }),
    ).toBe(SecurityCaseSkipReason.AssignedToThem);
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ userId: DIEGO }),
        pick: { userId: ME },
        statuses: STATUSES,
        myUserId: ME,
      }),
    ).toBeNull();
  });

  test("the team whose queue it waits in already, with nobody on it", () => {
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ teamId: SOC_TEAM }),
        pick: { teamId: SOC_TEAM },
        statuses: STATUSES,
        myUserId: ME,
      }),
    ).toBe(SecurityCaseSkipReason.InTeamQueue);
    // Someone on it: handing it to its team puts it back in the queue.
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ teamId: SOC_TEAM, userId: DIEGO }),
        pick: { teamId: SOC_TEAM },
        statuses: STATUSES,
        myUserId: ME,
      }),
    ).toBeNull();
    expect(
      getSecurityCaseAssignSkipReason({
        securityCase: buildCase({ teamId: OTHER_TEAM }),
        pick: { teamId: SOC_TEAM },
        statuses: STATUSES,
        myUserId: ME,
      }),
    ).toBeNull();
  });
});

describe("moving a case to a status", () => {
  test("a status that closes an open case asks for a verdict; one between open statuses does not", () => {
    const statuses: Array<SecurityCaseStatus> = teamStatuses();
    const open: SecurityCase = buildCase({ stage: SecurityCaseStage.New });

    expect(
      doesStatusCloseSecurityCase({
        securityCase: open,
        statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
        statuses,
      }),
    ).toBe(true);
    expect(
      doesStatusCloseSecurityCase({
        securityCase: open,
        statusId: DUPLICATE_ID,
        statuses,
      }),
    ).toBe(true);
    expect(
      doesStatusCloseSecurityCase({
        securityCase: open,
        statusId: ERADICATING_ID,
        statuses,
      }),
    ).toBe(false);
  });

  test("a closed case moving to another closing status keeps the verdict it closed with", () => {
    const statuses: Array<SecurityCaseStatus> = teamStatuses();
    const closed: SecurityCase = buildCase({
      stage: SecurityCaseStage.Closed,
    });

    expect(
      doesStatusCloseSecurityCase({
        securityCase: closed,
        statusId: DUPLICATE_ID,
        statuses,
      }),
    ).toBe(false);
    expect(
      getSecurityCaseStatusWrite({
        securityCase: closed,
        pick: {
          statusId: DUPLICATE_ID,
          verdict: SecurityCaseVerdict.FalsePositive,
          closingNote: "Duplicate of CASE-140.",
        },
        statuses,
      }),
    ).toEqual({ securityCaseStatusId: DUPLICATE_ID });
  });

  test("several cases ask for a verdict when the status closes any of them", () => {
    const statuses: Array<SecurityCaseStatus> = teamStatuses();
    const closed: SecurityCase = buildCase({
      stage: SecurityCaseStage.Closed,
    });
    const open: SecurityCase = buildCase({ stage: SecurityCaseStage.New });

    expect(
      doesStatusCloseAnySecurityCase({
        securityCases: [closed, open],
        statusId: DUPLICATE_ID,
        statuses,
      }),
    ).toBe(true);
    expect(
      doesStatusCloseAnySecurityCase({
        securityCases: [closed],
        statusId: DUPLICATE_ID,
        statuses,
      }),
    ).toBe(false);
    expect(
      doesStatusCloseAnySecurityCase({
        securityCases: [open],
        statusId: ERADICATING_ID,
        statuses,
      }),
    ).toBe(false);
  });

  test("closing writes the status, the verdict picked and the closing note, as Close Case does", () => {
    expect(
      getSecurityCaseStatusWrite({
        securityCase: buildCase(),
        pick: {
          statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
          verdict: SecurityCaseVerdict.BenignPositive,
          closingNote: "  Pen test window, confirmed with IT.  ",
        },
        statuses: STATUSES,
      }),
    ).toEqual({
      securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
      verdict: SecurityCaseVerdict.BenignPositive,
      closingNote: "Pen test window, confirmed with IT.",
    });
  });

  test("closing with no verdict - or one that is not a verdict - closes as Undetermined, and a blank note is left out", () => {
    for (const verdict of [undefined, "", "Maybe"]) {
      expect(
        getSecurityCaseStatusWrite({
          securityCase: buildCase(),
          pick: {
            statusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
            verdict: verdict,
            closingNote: "   ",
          },
          statuses: STATUSES,
        }),
      ).toEqual({
        securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
        verdict: SecurityCaseVerdict.Undetermined,
      });
    }
  });

  test("an open move, and a reopen, write the status alone - never a verdict", () => {
    expect(
      getSecurityCaseStatusWrite({
        securityCase: buildCase(),
        pick: {
          statusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
          verdict: SecurityCaseVerdict.TruePositive,
        },
        statuses: STATUSES,
      }),
    ).toEqual({
      securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
    });
    expect(
      getSecurityCaseStatusWrite({
        securityCase: buildCase({ stage: SecurityCaseStage.Closed }),
        pick: { statusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged] },
        statuses: STATUSES,
      }),
    ).toEqual({
      securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
    });
  });

  test("a case in the status already is left as it is", () => {
    expect(
      getSecurityCaseStatusSkipReason({
        securityCase: buildCase({ stage: SecurityCaseStage.Acknowledged }),
        statusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      }),
    ).toBe(SecurityCaseSkipReason.SameValue);
    expect(
      getSecurityCaseStatusSkipReason({
        securityCase: buildCase({ stage: SecurityCaseStage.New }),
        statusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      }),
    ).toBeNull();
  });
});

describe("setting a case's priority", () => {
  test("writes the priority; a case at it already is left as it is", () => {
    const critical: string =
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical];

    expect(getSecurityCasePriorityWrite(critical)).toEqual({
      securityCasePriorityId: critical,
    });
    expect(
      getSecurityCasePrioritySkipReason({
        securityCase: buildCase({
          priority: SecurityCasePriorityLevel.Critical,
        }),
        priorityId: critical,
      }),
    ).toBe(SecurityCaseSkipReason.SameValue);
    expect(
      getSecurityCasePrioritySkipReason({
        securityCase: buildCase({ priority: SecurityCasePriorityLevel.Low }),
        priorityId: critical,
      }),
    ).toBeNull();
  });
});

describe("what the dialogs offer", () => {
  test("one case: the project's statuses in order, the retired one left out, its own marked Current", () => {
    const choices: Array<SecurityCaseValueChoice> =
      getSecurityCaseStatusChoices({
        statuses: teamStatuses(),
        securityCases: [buildCase({ stage: SecurityCaseStage.Acknowledged })],
      });

    expect(
      choices.map((choice: SecurityCaseValueChoice): [string, boolean] => {
        return [choice.name, choice.isCurrent];
      }),
    ).toEqual([
      ["New", false],
      ["Investigating", true],
      ["Contained", false],
      ["Eradicating", false],
      ["Closed", false],
      ["Closed - Duplicate", false],
    ]);
    // Each with its colour, as the pills draw it.
    for (const choice of choices) {
      expect(choice.color?.toString()).toBeTruthy();
      expect(choice.isArchived).toBe(false);
    }
  });

  test("one case in a retired status keeps it listed, Archived and Current, where it sits", () => {
    const choices: Array<SecurityCaseValueChoice> =
      getSecurityCaseStatusChoices({
        statuses: teamStatuses(),
        securityCases: [buildCase({ statusId: RETIRED_ID })],
      });

    expect(ids(choices)).toEqual([
      TEST_STATUS_IDS[SecurityCaseStage.New],
      TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      TEST_STATUS_IDS[SecurityCaseStage.Contained],
      ERADICATING_ID,
      RETIRED_ID,
      TEST_STATUS_IDS[SecurityCaseStage.Closed],
      DUPLICATE_ID,
    ]);
    expect(
      choices.find((choice: SecurityCaseValueChoice): boolean => {
        return choice.id === RETIRED_ID;
      }),
    ).toEqual(
      expect.objectContaining({
        name: "Escalated",
        isArchived: true,
        isCurrent: true,
      }),
    );
  });

  test("several cases: every live status, none Current, the retired one left out", () => {
    const choices: Array<SecurityCaseValueChoice> =
      getSecurityCaseStatusChoices({
        statuses: teamStatuses(),
        securityCases: [
          buildCase({ statusId: RETIRED_ID }),
          buildCase({ stage: SecurityCaseStage.New }),
        ],
      });

    expect(ids(choices)).not.toContain(RETIRED_ID);
    expect(
      choices.some((choice: SecurityCaseValueChoice): boolean => {
        return choice.isCurrent;
      }),
    ).toBe(false);
    expect(choices).toHaveLength(6);
  });

  test("priorities: most urgent first, the project's own among them, the case's marked Current", () => {
    const emergency: SecurityCasePriority = buildTestPriority({
      id: "c1000000-0000-4000-8000-000000000009",
      name: "Emergency",
      order: 0,
      color: "#7f1d1d",
    });
    const retired: SecurityCasePriority = buildTestPriority({
      id: "c1000000-0000-4000-8000-000000000010",
      name: "Retired",
      order: 9,
      isArchived: true,
    });

    const choices: Array<SecurityCaseValueChoice> =
      getSecurityCasePriorityChoices({
        // In no order: the dialog sorts them.
        priorities: [retired, ...buildDefaultTestPriorities(), emergency],
        securityCases: [
          buildCase({ priority: SecurityCasePriorityLevel.Medium }),
        ],
      });

    expect(
      choices.map((choice: SecurityCaseValueChoice): [string, boolean] => {
        return [choice.name, choice.isCurrent];
      }),
    ).toEqual([
      ["Emergency", false],
      ["Critical", false],
      ["High", false],
      ["Medium", true],
      ["Low", false],
      ["Informational", false],
    ]);
  });

  test("a value's name by its id, for 'Already Investigating.'", () => {
    expect(
      getSecurityCaseValueName(
        STATUSES,
        TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      ),
    ).toBe("Investigating");
    expect(
      getSecurityCaseValueName(
        PRIORITIES,
        TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
      ),
    ).toBe("High");
    expect(getSecurityCaseValueName(STATUSES, "nope")).toBe("");
  });
});

describe("why Bulk Actions leaves a case as it is", () => {
  test("each reason has its own words, the value named in 'Already ...'", () => {
    expect(SKIP_REASON_TEXT).toEqual({
      [SecurityCaseSkipReason.Closed]: "Closed. Reopen it to assign it.",
      [SecurityCaseSkipReason.AssignedToYou]: "Assigned to you already.",
      [SecurityCaseSkipReason.AssignedToThem]: "Assigned to them already.",
      [SecurityCaseSkipReason.InTeamQueue]: "In this team's queue already.",
      [SecurityCaseSkipReason.SameValue]: "Already {{value}}.",
    });
  });
});

describe("the rules stay React-free", () => {
  /*
   * App's tests and the docs suites read this module; App installs no
   * React, so it may import nothing that does (a .tsx, a component).
   */
  test("SecurityCaseChanges.ts imports no component and no .tsx", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseChanges.ts",
      ),
      "utf8",
    );
    const imports: Array<string> = source
      .split("\n")
      .filter((line: string): boolean => {
        return line.trim().startsWith("} from ") || line.startsWith("import ");
      });

    for (const line of imports) {
      expect(line).not.toContain("react");
      expect(line).not.toContain("/Components/");
      expect(line).not.toContain("UseTranslator");
    }
  });
});
