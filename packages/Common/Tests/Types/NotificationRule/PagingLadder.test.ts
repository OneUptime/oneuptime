import { describe, expect, test } from "@jest/globals";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import OnCallRuleKind from "../../../Types/NotificationRule/OnCallRuleKind";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  MAX_PAGING_LADDER_WAIT_IN_MINUTES,
  PAGING_METHOD_COLUMNS,
  PagingLadderCell,
  PagingLadderPlan,
  PagingLadderReading,
  PagingLadderRule,
  PagingLadderRuleToCreate,
  PagingLadderStep,
  comparePagingLadderSteps,
  getChannelForPagingMethodColumn,
  getLivePagingLadderCells,
  getPagingLadderCellKey,
  getPagingLadderCells,
  getPagingLadderRules,
  getPagingLadderStepFromRule,
  getPagingLadderStepsProblem,
  getPagingMethodColumnForChannel,
  getSeverityColumnForOnCallRuleKind,
  isEmptyPagingLadderPlan,
  normalizePagingLadderSteps,
  planPagingLadderSave,
  readPagingId,
  readPagingLadder,
  readPagingLadderSteps,
} from "../../../Types/NotificationRule/PagingLadder";

/*
 * The ladder (#6820) is read from a person's rule rows and written back as
 * them. These tests hold the two directions to each other and to the grid:
 * a ladder saved is exactly what a person adding the same rules to every
 * card by hand would have, and reading those rows back gives the ladder.
 */

// A new project's severities: three incident, two alert (ProjectService).
const CRITICAL: string = "11111111-1111-4111-8111-111111111111";
const MAJOR: string = "22222222-2222-4222-8222-222222222222";
const MINOR: string = "33333333-3333-4333-8333-333333333333";
const ALERT_HIGH: string = "44444444-4444-4444-8444-444444444444";
const ALERT_LOW: string = "55555555-5555-4555-8555-555555555555";
const ARCHIVED_INCIDENT: string = "66666666-6666-4666-8666-666666666666";

const EMAIL: string = "aaaaaaaa-0000-4000-8000-000000000001";
const SMS: string = "aaaaaaaa-0000-4000-8000-000000000002";
const CALL: string = "aaaaaaaa-0000-4000-8000-000000000003";
const PUSH: string = "aaaaaaaa-0000-4000-8000-000000000004";

const newProjectCells: () => Array<PagingLadderCell> =
  (): Array<PagingLadderCell> => {
    return getPagingLadderCells({
      incidentSeverities: [
        { id: CRITICAL, name: "Critical Incident" },
        { id: MAJOR, name: "Major Incident" },
        { id: MINOR, name: "Minor Incident" },
      ],
      alertSeverities: [
        { id: ALERT_HIGH, name: "High" },
        { id: ALERT_LOW, name: "Low" },
      ],
    });
  };

const withArchived: () => Array<PagingLadderCell> =
  (): Array<PagingLadderCell> => {
    return getPagingLadderCells({
      incidentSeverities: [
        { id: CRITICAL, name: "Critical Incident" },
        { id: ARCHIVED_INCIDENT, name: "[DONOTUSE] Sev 4", isArchived: true },
      ],
      alertSeverities: [{ id: ALERT_HIGH, name: "High" }],
    });
  };

const step: (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
  extra?: Partial<PagingLadderStep>,
) => PagingLadderStep = (
  methodColumn: PagingLadderStep["methodColumn"],
  methodId: string,
  notifyAfterMinutes: number,
  extra?: Partial<PagingLadderStep>,
): PagingLadderStep => {
  return {
    methodColumn: methodColumn,
    methodId: methodId,
    notifyAfterMinutes: notifyAfterMinutes,
    ...(extra || {}),
  };
};

// "Push, then SMS, then a call after five minutes" - the issue's sentence.
const PUSH_SMS_CALL: Array<PagingLadderStep> = [
  step("userCallId", CALL, 5),
  step("userSmsId", SMS, 0),
  step("userPushId", PUSH, 0),
];

let ruleCounter: number = 0;

// A rule row as the database holds it, the way UserNotificationRuleService writes one.
const ruleRow: (data: {
  cell: PagingLadderCell;
  methodColumn?: PagingLadderStep["methodColumn"];
  methodId?: string;
  notifyAfterMinutes?: number;
  isOptOut?: boolean;
  pushNotificationLevel?: string;
  repeatEveryMinutes?: number;
}) => PagingLadderRule = (data: {
  cell: PagingLadderCell;
  methodColumn?: PagingLadderStep["methodColumn"];
  methodId?: string;
  notifyAfterMinutes?: number;
  isOptOut?: boolean;
  pushNotificationLevel?: string;
  repeatEveryMinutes?: number;
}): PagingLadderRule => {
  ruleCounter++;

  const row: Record<string, unknown> = {
    _id: `bbbbbbbb-0000-4000-8000-${String(ruleCounter).padStart(12, "0")}`,
    ruleType: data.cell.ruleType,
    [data.cell.severityColumn]: data.cell.severityId,
    notifyAfterMinutes: data.notifyAfterMinutes ?? 0,
    isOptOut: data.isOptOut ?? false,
    // The column's defaults, on every row whatever it pages.
    pushNotificationLevel: data.pushNotificationLevel ?? "Critical",
    repeatEveryMinutes: data.repeatEveryMinutes ?? 0,
  };

  if (data.methodColumn && data.methodId) {
    row[data.methodColumn] = data.methodId;
  }

  return row as PagingLadderRule;
};

// The rows a person who added `steps` to every live card by hand would have.
const gridEditedByHand: (
  cells: ReadonlyArray<PagingLadderCell>,
  steps: ReadonlyArray<PagingLadderStep>,
) => Array<PagingLadderRule> = (
  cells: ReadonlyArray<PagingLadderCell>,
  steps: ReadonlyArray<PagingLadderStep>,
): Array<PagingLadderRule> => {
  const rows: Array<PagingLadderRule> = [];

  for (const cell of cells) {
    if (cell.isArchived) {
      continue;
    }

    for (const ladderStep of steps) {
      rows.push(
        ruleRow({
          cell: cell,
          methodColumn: ladderStep.methodColumn,
          methodId: ladderStep.methodId,
          notifyAfterMinutes: ladderStep.notifyAfterMinutes,
          ...(ladderStep.methodColumn === "userPushId"
            ? {
                pushNotificationLevel:
                  ladderStep.pushNotificationLevel || "Critical",
                repeatEveryMinutes: ladderStep.repeatEveryMinutes || 0,
              }
            : {}),
        }),
      );
    }
  }

  return rows;
};

// What a created rule says, compared column by column.
const describeCreate: (rule: PagingLadderRuleToCreate) => string = (
  rule: PagingLadderRuleToCreate,
): string => {
  return [
    rule.ruleType,
    rule.severityColumn,
    rule.severityId,
    rule.methodColumn,
    rule.methodId,
    rule.notifyAfterMinutes,
    rule.pushNotificationLevel || "-",
    rule.repeatEveryMinutes,
  ].join(" ");
};

const describeRow: (rule: PagingLadderRule) => string = (
  rule: PagingLadderRule,
): string => {
  const methodColumn: PagingLadderStep["methodColumn"] =
    PAGING_METHOD_COLUMNS.find((column: PagingLadderStep["methodColumn"]) => {
      return Boolean(rule[column]);
    })!;
  const severityColumn: string = rule.incidentSeverityId
    ? "incidentSeverityId"
    : "alertSeverityId";

  return [
    rule.ruleType,
    severityColumn,
    readPagingId(rule.incidentSeverityId || rule.alertSeverityId),
    methodColumn,
    readPagingId(rule[methodColumn]),
    rule.notifyAfterMinutes,
    methodColumn === "userPushId" ? rule.pushNotificationLevel : "-",
    rule.repeatEveryMinutes,
  ].join(" ");
};

describe("the grid's cards", () => {
  test("are the four kinds, each with its severities, in the grid's order", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();

    expect(
      cells.map((cell: PagingLadderCell): string => {
        return `${cell.kind}:${cell.severityName}`;
      }),
    ).toEqual([
      "incidents:Critical Incident",
      "incidents:Major Incident",
      "incidents:Minor Incident",
      "incident-episodes:Critical Incident",
      "incident-episodes:Major Incident",
      "incident-episodes:Minor Incident",
      "alerts:High",
      "alerts:Low",
      "alert-episodes:High",
      "alert-episodes:Low",
    ]);
  });

  test("a new project has ten cards: three incident and two alert severities, twice", () => {
    expect(newProjectCells()).toHaveLength(10);
  });

  test("incident episodes are banded by incident severity, alert episodes by alert severity", () => {
    expect(getSeverityColumnForOnCallRuleKind(OnCallRuleKind.Incidents)).toBe(
      "incidentSeverityId",
    );
    expect(
      getSeverityColumnForOnCallRuleKind(OnCallRuleKind.IncidentEpisodes),
    ).toBe("incidentSeverityId");
    expect(getSeverityColumnForOnCallRuleKind(OnCallRuleKind.Alerts)).toBe(
      "alertSeverityId",
    );
    expect(
      getSeverityColumnForOnCallRuleKind(OnCallRuleKind.AlertEpisodes),
    ).toBe("alertSeverityId");

    const cells: Array<PagingLadderCell> = newProjectCells();

    for (const cell of cells) {
      expect(cell.severityColumn).toBe(
        getSeverityColumnForOnCallRuleKind(cell.kind),
      );
    }

    expect(
      cells
        .filter((cell: PagingLadderCell): boolean => {
          return cell.kind === OnCallRuleKind.IncidentEpisodes;
        })
        .map((cell: PagingLadderCell): string => {
          return cell.ruleType;
        }),
    ).toEqual([
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    ]);
  });

  test("severity ids are read from ObjectIDs, strings and un-hydrated JSON", () => {
    const cells: Array<PagingLadderCell> = getPagingLadderCells({
      incidentSeverities: [
        { _id: new ObjectID(CRITICAL) },
        { id: { _type: "ObjectID", value: MAJOR } },
        { id: undefined },
      ],
      alertSeverities: [{ id: ` ${ALERT_HIGH} ` }],
    });

    expect(
      cells.map((cell: PagingLadderCell): string => {
        return cell.severityId;
      }),
    ).toEqual([CRITICAL, MAJOR, CRITICAL, MAJOR, ALERT_HIGH, ALERT_HIGH]);
  });

  test("archived severities are cards, marked, and are not live", () => {
    const cells: Array<PagingLadderCell> = withArchived();

    expect(
      cells
        .filter((cell: PagingLadderCell): boolean => {
          return cell.isArchived;
        })
        .map((cell: PagingLadderCell): string => {
          return cell.kind;
        }),
    ).toEqual(["incidents", "incident-episodes"]);

    expect(getLivePagingLadderCells(cells)).toHaveLength(4);
  });
});

describe("methods and channels", () => {
  test("every channel has its method column, and back", () => {
    for (const channel of Object.values(OnCallPageChannel)) {
      const column: PagingLadderStep["methodColumn"] | null =
        getPagingMethodColumnForChannel(channel);

      expect(column).not.toBeNull();
      expect(getChannelForPagingMethodColumn(column!)).toBe(channel);
    }

    expect(getPagingMethodColumnForChannel("Carrier pigeon")).toBeNull();
    expect(PAGING_METHOD_COLUMNS).toHaveLength(11);
  });
});

describe("a ladder's steps", () => {
  test("are in the order they page: by wait, then gentlest first", () => {
    expect(normalizePagingLadderSteps(PUSH_SMS_CALL)).toEqual([
      step("userPushId", PUSH, 0, {
        pushNotificationLevel: PushNotificationLevel.Critical,
        repeatEveryMinutes: 0,
      }),
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
    ]);

    // Email is gentler than SMS, a call the loudest of the three.
    expect(
      [
        step("userCallId", CALL, 0),
        step("userSmsId", SMS, 0),
        step("userEmailId", EMAIL, 0),
      ]
        .sort(comparePagingLadderSteps)
        .map((ladderStep: PagingLadderStep): string => {
          return ladderStep.methodColumn;
        }),
    ).toEqual(["userEmailId", "userSmsId", "userCallId"]);
  });

  test("a step said twice is kept once; one at another wait is a step of its own", () => {
    expect(
      normalizePagingLadderSteps([
        step("userCallId", CALL, 0),
        step("userCallId", CALL, 0),
        step("userCallId", CALL, 10),
      ]),
    ).toEqual([step("userCallId", CALL, 0), step("userCallId", CALL, 10)]);
  });

  test("push settings are made explicit on a push step, and dropped from any other", () => {
    expect(
      normalizePagingLadderSteps([
        step("userEmailId", EMAIL, 0, {
          pushNotificationLevel: PushNotificationLevel.Standard,
          repeatEveryMinutes: 5,
        }),
        step("userPushId", PUSH, 0, {
          pushNotificationLevel: PushNotificationLevel.Standard,
        }),
      ]),
    ).toEqual([
      step("userPushId", PUSH, 0, {
        pushNotificationLevel: PushNotificationLevel.Standard,
        repeatEveryMinutes: 0,
      }),
      step("userEmailId", EMAIL, 0),
    ]);
  });

  test("a step with no method, or an unknown kind of method, is left out", () => {
    expect(
      normalizePagingLadderSteps([
        step("userEmailId", "", 0),
        {
          methodColumn: "userFaxId",
          methodId: EMAIL,
          notifyAfterMinutes: 0,
        } as unknown as PagingLadderStep,
        step("userSmsId", SMS, 0),
      ]),
    ).toEqual([step("userSmsId", SMS, 0)]);
  });

  test("a rule is a step; an opt-out row and a row with no method are not", () => {
    const [cell] = newProjectCells();

    expect(
      getPagingLadderStepFromRule(
        ruleRow({
          cell: cell!,
          methodColumn: "userSmsId",
          methodId: SMS,
          notifyAfterMinutes: 5,
        }),
      ),
    ).toEqual(step("userSmsId", SMS, 5));

    expect(
      getPagingLadderStepFromRule(ruleRow({ cell: cell!, isOptOut: true })),
    ).toBeNull();
    expect(getPagingLadderStepFromRule(ruleRow({ cell: cell! }))).toBeNull();
  });
});

describe("reading a ladder from the rules", () => {
  test("a person with no rules has an empty ladder, and it is one ladder", () => {
    const reading: PagingLadderReading = readPagingLadder({
      cells: newProjectCells(),
      rules: [],
    });

    expect(reading.steps).toEqual([]);
    expect(reading.isOneLadder).toBe(true);
    expect(reading.differences).toEqual([]);
    expect(reading.cells).toHaveLength(10);
  });

  test("the defaults a verified method starts with are one ladder: that method, at once", () => {
    // UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod.
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = gridEditedByHand(cells, [
      step("userEmailId", EMAIL, 0),
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 0),
    ]);

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: rules,
    });

    expect(reading.isOneLadder).toBe(true);
    expect(reading.steps).toEqual([
      step("userEmailId", EMAIL, 0),
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 0),
    ]);
  });

  test("a card with an extra step differs, and says what it adds", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = [
      ...gridEditedByHand(cells, [step("userSmsId", SMS, 0)]),
      // Critical incidents: also a call at once.
      ruleRow({ cell: cells[0]!, methodColumn: "userCallId", methodId: CALL }),
    ];

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: rules,
    });

    expect(reading.isOneLadder).toBe(false);
    expect(reading.steps).toEqual([step("userSmsId", SMS, 0)]);
    expect(reading.differences).toHaveLength(1);
    expect(reading.differences[0]!.cell.severityName).toBe("Critical Incident");
    expect(reading.differences[0]!.cell.kind).toBe(OnCallRuleKind.Incidents);
    expect(reading.differences[0]!.extra).toEqual([
      step("userCallId", CALL, 0),
    ]);
    expect(reading.differences[0]!.missing).toEqual([]);
    expect(reading.differences[0]!.changed).toEqual([]);
    expect(reading.differences[0]!.isMuted).toBe(false);
  });

  test("a card without a step, or with it at another wait, differs and says so", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const ladder: Array<PagingLadderStep> = [
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
    ];
    const rules: Array<PagingLadderRule> = gridEditedByHand(
      cells.slice(1),
      ladder,
    );

    // Critical incidents: the call at once rather than after five minutes, and no SMS.
    rules.push(
      ruleRow({ cell: cells[0]!, methodColumn: "userCallId", methodId: CALL }),
    );

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: rules,
    });

    expect(reading.steps).toEqual(ladder);
    expect(reading.differences).toHaveLength(1);
    expect(reading.differences[0]!.extra).toEqual([
      step("userCallId", CALL, 0),
    ]);
    expect(reading.differences[0]!.missing).toEqual([
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
    ]);
  });

  test("a push step that sounds differently on one card is changed, not missing", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = gridEditedByHand(cells.slice(0, 9), [
      step("userPushId", PUSH, 0),
    ]);

    rules.push(
      ruleRow({
        cell: cells[9]!,
        methodColumn: "userPushId",
        methodId: PUSH,
        pushNotificationLevel: "Standard",
      }),
    );

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: rules,
    });

    expect(reading.differences).toHaveLength(1);
    expect(reading.differences[0]!.cell.kind).toBe(
      OnCallRuleKind.AlertEpisodes,
    );
    expect(reading.differences[0]!.extra).toEqual([]);
    expect(reading.differences[0]!.missing).toEqual([]);
    expect(reading.differences[0]!.changed).toEqual([
      {
        step: step("userPushId", PUSH, 0, {
          pushNotificationLevel: PushNotificationLevel.Standard,
          repeatEveryMinutes: 0,
        }),
        ladderStep: step("userPushId", PUSH, 0, {
          pushNotificationLevel: PushNotificationLevel.Critical,
          repeatEveryMinutes: 0,
        }),
      },
    ]);
  });

  test("a muted card (an opt-out row and nothing else) differs as muted", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = [
      ...gridEditedByHand(cells.slice(0, 7), [step("userEmailId", EMAIL, 0)]),
      ...gridEditedByHand(cells.slice(8), [step("userEmailId", EMAIL, 0)]),
      ruleRow({ cell: cells[7]!, isOptOut: true }),
    ];

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: rules,
    });

    expect(reading.differences).toHaveLength(1);
    expect(reading.differences[0]!.cell.severityName).toBe("Low");
    expect(reading.differences[0]!.isMuted).toBe(true);
    expect(reading.differences[0]!.missing).toEqual([
      step("userEmailId", EMAIL, 0),
    ]);
  });

  test("an opt-out row beside real rules does not mute the card", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = [
      ...gridEditedByHand(cells, [step("userEmailId", EMAIL, 0)]),
      ruleRow({ cell: cells[3]!, isOptOut: true }),
    ];

    expect(readPagingLadder({ cells: cells, rules: rules }).isOneLadder).toBe(
      true,
    );
  });

  test("the ladder is what most cards page, and the rest are the differences", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const common: Array<PagingLadderStep> = [step("userEmailId", EMAIL, 0)];
    const rare: Array<PagingLadderStep> = [step("userCallId", CALL, 0)];

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: [
        ...gridEditedByHand(cells.slice(0, 3), rare),
        ...gridEditedByHand(cells.slice(3), common),
      ],
    });

    expect(reading.steps).toEqual(common);
    expect(
      reading.differences.map((difference: { cell: PagingLadderCell }) => {
        return difference.cell.kind;
      }),
    ).toEqual(["incidents", "incidents", "incidents"]);
  });

  test("a tie goes to the card first in the grid's order", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: [
        ...gridEditedByHand(cells.slice(0, 5), [step("userCallId", CALL, 0)]),
        ...gridEditedByHand(cells.slice(5), [step("userEmailId", EMAIL, 0)]),
      ],
    });

    expect(reading.steps).toEqual([step("userCallId", CALL, 0)]);
    expect(reading.differences).toHaveLength(5);
  });

  test("an empty card differs from a ladder that pages, by missing every step", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: gridEditedByHand(cells.slice(0, 9), [step("userSmsId", SMS, 0)]),
    });

    expect(reading.differences).toHaveLength(1);
    expect(reading.differences[0]!.missing).toEqual([
      step("userSmsId", SMS, 0),
    ]);
    expect(reading.differences[0]!.isMuted).toBe(false);
  });

  test("archived severities are neither read nor counted as differing", () => {
    const cells: Array<PagingLadderCell> = withArchived();
    const rules: Array<PagingLadderRule> = [
      ...gridEditedByHand(cells, [step("userSmsId", SMS, 0)]),
      // The archived Sev 4 still pages by email, for incidents that keep it.
      ruleRow({
        cell: cells.find((cell: PagingLadderCell): boolean => {
          return cell.isArchived;
        })!,
        methodColumn: "userEmailId",
        methodId: EMAIL,
      }),
    ];

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: rules,
    });

    expect(reading.isOneLadder).toBe(true);
    expect(reading.cells).toHaveLength(4);
  });

  test("shift rules and rules on a severity the project no longer has are not read", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = [
      ...gridEditedByHand(cells, [step("userSmsId", SMS, 0)]),
      {
        _id: "cccccccc-0000-4000-8000-000000000001",
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        userEmailId: EMAIL,
        notifyAfterMinutes: 0,
      },
      {
        _id: "cccccccc-0000-4000-8000-000000000002",
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: "dddddddd-0000-4000-8000-000000000000",
        userCallId: CALL,
        notifyAfterMinutes: 0,
      },
      // A NULL-severity episode rule, as an old bug wrote them.
      {
        _id: "cccccccc-0000-4000-8000-000000000003",
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        userCallId: CALL,
        notifyAfterMinutes: 0,
      },
    ];

    expect(readPagingLadder({ cells: cells, rules: rules }).isOneLadder).toBe(
      true,
    );
  });

  test("rules read from models (ObjectIDs) read as rules read from JSON", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const asModels: Array<PagingLadderRule> = gridEditedByHand(cells, [
      step("userSmsId", SMS, 0),
    ]).map((rule: PagingLadderRule): PagingLadderRule => {
      return {
        ...rule,
        _id: new ObjectID(readPagingId(rule._id)),
        incidentSeverityId: rule.incidentSeverityId
          ? new ObjectID(readPagingId(rule.incidentSeverityId))
          : undefined,
        alertSeverityId: rule.alertSeverityId
          ? { _type: "ObjectID", value: readPagingId(rule.alertSeverityId) }
          : undefined,
        userSmsId: new ObjectID(SMS),
      };
    });

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: asModels,
    });

    expect(reading.isOneLadder).toBe(true);
    expect(reading.steps).toEqual([step("userSmsId", SMS, 0)]);
  });
});

describe("saving a ladder writes the rows the grid edited by hand would hold", () => {
  test("for a person with no rules: one rule per step in every card", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();

    const created: Array<PagingLadderRuleToCreate> = getPagingLadderRules({
      cells: cells,
      steps: PUSH_SMS_CALL,
    });

    expect(created).toHaveLength(30);

    expect(created.map(describeCreate).sort()).toEqual(
      gridEditedByHand(cells, normalizePagingLadderSteps(PUSH_SMS_CALL))
        .map(describeRow)
        .sort(),
    );
  });

  test("a push step's rule carries its level and repeat; an SMS rule sends once", () => {
    const [cell] = newProjectCells();

    const created: Array<PagingLadderRuleToCreate> = getPagingLadderRules({
      cells: [cell!],
      steps: [
        step("userPushId", PUSH, 0, {
          pushNotificationLevel: PushNotificationLevel.Standard,
          repeatEveryMinutes: 5,
        }),
        step("userSmsId", SMS, 0),
      ],
    });

    expect(created).toEqual([
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityColumn: "incidentSeverityId",
        severityId: CRITICAL,
        methodColumn: "userPushId",
        methodId: PUSH,
        notifyAfterMinutes: 0,
        pushNotificationLevel: PushNotificationLevel.Standard,
        repeatEveryMinutes: 5,
      },
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityColumn: "incidentSeverityId",
        severityId: CRITICAL,
        methodColumn: "userSmsId",
        methodId: SMS,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 0,
      },
    ]);
  });

  test("reading back what a ladder wrote gives the ladder, and one ladder", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();

    const written: Array<PagingLadderRule> = getPagingLadderRules({
      cells: cells,
      steps: PUSH_SMS_CALL,
    }).map(
      (rule: PagingLadderRuleToCreate, index: number): PagingLadderRule => {
        return {
          _id: `eeeeeeee-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ruleType: rule.ruleType,
          [rule.severityColumn]: rule.severityId,
          [rule.methodColumn]: rule.methodId,
          notifyAfterMinutes: rule.notifyAfterMinutes,
          pushNotificationLevel: rule.pushNotificationLevel || "Critical",
          repeatEveryMinutes: rule.repeatEveryMinutes,
        } as PagingLadderRule;
      },
    );

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: written,
    });

    expect(reading.isOneLadder).toBe(true);
    expect(reading.steps).toEqual(normalizePagingLadderSteps(PUSH_SMS_CALL));
  });

  test("the same ladder again writes nothing", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = gridEditedByHand(
      cells,
      normalizePagingLadderSteps(PUSH_SMS_CALL),
    );

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: rules,
      steps: PUSH_SMS_CALL,
    });

    expect(isEmptyPagingLadderPlan(plan)).toBe(true);
    expect(plan.unchangedCount).toBe(30);
  });

  test("from the defaults to the issue's ladder: the push and SMS rows stay, the call rows wait five minutes, email goes", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const defaults: Array<PagingLadderRule> = gridEditedByHand(cells, [
      step("userEmailId", EMAIL, 0),
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 0),
      step("userPushId", PUSH, 0),
    ]);

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: defaults,
      steps: PUSH_SMS_CALL,
    });

    expect(plan.create).toEqual([]);
    expect(plan.unchangedCount).toBe(20);
    expect(plan.update).toHaveLength(10);
    for (const update of plan.update) {
      expect(update).toEqual({ id: update.id, notifyAfterMinutes: 5 });
    }

    const callRowIds: Array<string> = defaults
      .filter((rule: PagingLadderRule): boolean => {
        return Boolean(rule.userCallId);
      })
      .map((rule: PagingLadderRule): string => {
        return readPagingId(rule._id);
      });
    expect(
      plan.update.map((update: { id: string }): string => {
        return update.id;
      }),
    ).toEqual(callRowIds);

    const emailRowIds: Array<string> = defaults
      .filter((rule: PagingLadderRule): boolean => {
        return Boolean(rule.userEmailId);
      })
      .map((rule: PagingLadderRule): string => {
        return readPagingId(rule._id);
      });
    expect(plan.delete).toEqual(emailRowIds);
  });

  test("applying the plan gives the same rows as the grid edited by hand", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const before: Array<PagingLadderRule> = [
      ...gridEditedByHand(cells, [
        step("userEmailId", EMAIL, 0),
        step("userCallId", CALL, 0),
      ]),
      ruleRow({ cell: cells[4]!, isOptOut: true }),
      ruleRow({
        cell: cells[6]!,
        methodColumn: "userEmailId",
        methodId: EMAIL,
      }),
    ];

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: before,
      steps: PUSH_SMS_CALL,
    });

    // Apply it the way the server does.
    const deleted: Set<string> = new Set<string>(plan.delete);
    const after: Array<PagingLadderRule> = before
      .filter((rule: PagingLadderRule): boolean => {
        return !deleted.has(readPagingId(rule._id));
      })
      .map((rule: PagingLadderRule): PagingLadderRule => {
        const update: PagingLadderPlan["update"][number] | undefined =
          plan.update.find((candidate: { id: string }): boolean => {
            return candidate.id === readPagingId(rule._id);
          });

        if (!update) {
          return rule;
        }

        return {
          ...rule,
          ...(update.notifyAfterMinutes !== undefined
            ? { notifyAfterMinutes: update.notifyAfterMinutes }
            : {}),
          ...(update.pushNotificationLevel !== undefined
            ? { pushNotificationLevel: update.pushNotificationLevel }
            : {}),
          ...(update.repeatEveryMinutes !== undefined
            ? { repeatEveryMinutes: update.repeatEveryMinutes }
            : {}),
        };
      });

    for (const created of plan.create) {
      after.push({
        _id: "ffffffff-0000-4000-8000-000000000000",
        ruleType: created.ruleType,
        [created.severityColumn]: created.severityId,
        [created.methodColumn]: created.methodId,
        notifyAfterMinutes: created.notifyAfterMinutes,
        pushNotificationLevel: created.pushNotificationLevel || "Critical",
        repeatEveryMinutes: created.repeatEveryMinutes,
      } as PagingLadderRule);
    }

    expect(after.map(describeRow).sort()).toEqual(
      gridEditedByHand(cells, normalizePagingLadderSteps(PUSH_SMS_CALL))
        .map(describeRow)
        .sort(),
    );
  });

  test("a second copy of a step and an opt-out row are deleted", () => {
    const cells: Array<PagingLadderCell> = newProjectCells().slice(0, 1);
    const first: PagingLadderRule = ruleRow({
      cell: cells[0]!,
      methodColumn: "userSmsId",
      methodId: SMS,
    });
    const copy: PagingLadderRule = ruleRow({
      cell: cells[0]!,
      methodColumn: "userSmsId",
      methodId: SMS,
    });
    const optOut: PagingLadderRule = ruleRow({
      cell: cells[0]!,
      isOptOut: true,
    });

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: [first, copy, optOut],
      steps: [step("userSmsId", SMS, 0)],
    });

    expect(plan.unchangedCount).toBe(1);
    expect(plan.delete).toEqual([
      readPagingId(copy._id),
      readPagingId(optOut._id),
    ]);
    expect(plan.create).toEqual([]);
  });

  test("a push row changes its level and repeat in place", () => {
    const cells: Array<PagingLadderCell> = newProjectCells().slice(0, 1);
    const push: PagingLadderRule = ruleRow({
      cell: cells[0]!,
      methodColumn: "userPushId",
      methodId: PUSH,
    });

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: [push],
      steps: [
        step("userPushId", PUSH, 0, {
          pushNotificationLevel: PushNotificationLevel.Standard,
          repeatEveryMinutes: 10,
        }),
      ],
    });

    expect(plan.update).toEqual([
      {
        id: readPagingId(push._id),
        pushNotificationLevel: PushNotificationLevel.Standard,
        repeatEveryMinutes: 10,
      },
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.delete).toEqual([]);
  });

  test("a method is never re-pointed: another phone is a new row, and the old one goes", () => {
    const cells: Array<PagingLadderCell> = newProjectCells().slice(0, 1);
    const otherSms: string = "aaaaaaaa-0000-4000-8000-000000000099";
    const old: PagingLadderRule = ruleRow({
      cell: cells[0]!,
      methodColumn: "userSmsId",
      methodId: SMS,
    });

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: [old],
      steps: [step("userSmsId", otherSms, 0)],
    });

    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([readPagingId(old._id)]);
    expect(plan.create.map(describeCreate)).toEqual([
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT} incidentSeverityId ${CRITICAL} userSmsId ${otherSms} 0 - 0`,
    ]);
  });

  test("an archived severity is never written: no rule created, changed or deleted", () => {
    const cells: Array<PagingLadderCell> = withArchived();
    const archivedRules: Array<PagingLadderRule> = cells
      .filter((cell: PagingLadderCell): boolean => {
        return cell.isArchived;
      })
      .map((cell: PagingLadderCell): PagingLadderRule => {
        return ruleRow({
          cell: cell,
          methodColumn: "userEmailId",
          methodId: EMAIL,
        });
      });

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: archivedRules,
      steps: PUSH_SMS_CALL,
    });

    for (const created of plan.create) {
      expect(created.severityId).not.toBe(ARCHIVED_INCIDENT);
    }
    expect(plan.create).toHaveLength(4 * 3);
    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
  });

  test("a severity added later is a card like the others: the next save fills it", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const rules: Array<PagingLadderRule> = gridEditedByHand(cells, [
      step("userSmsId", SMS, 0),
    ]);

    const withNewSeverity: Array<PagingLadderCell> = getPagingLadderCells({
      incidentSeverities: [
        { id: CRITICAL, name: "Critical Incident" },
        { id: MAJOR, name: "Major Incident" },
        { id: MINOR, name: "Minor Incident" },
        { id: "77777777-7777-4777-8777-777777777777", name: "Sev 4" },
      ],
      alertSeverities: [
        { id: ALERT_HIGH, name: "High" },
        { id: ALERT_LOW, name: "Low" },
      ],
    });

    // Before the backfill gives it rules, the new cards differ by missing the ladder...
    const reading: PagingLadderReading = readPagingLadder({
      cells: withNewSeverity,
      rules: rules,
    });

    expect(reading.steps).toEqual([step("userSmsId", SMS, 0)]);
    expect(
      reading.differences.map((difference: { cell: PagingLadderCell }) => {
        return `${difference.cell.kind}:${difference.cell.severityName}`;
      }),
    ).toEqual(["incidents:Sev 4", "incident-episodes:Sev 4"]);

    // ...and saving the ladder creates exactly their rules.
    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: withNewSeverity,
      rules: rules,
      steps: reading.steps,
    });

    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(
      plan.create.map((created: PagingLadderRuleToCreate): string => {
        return `${created.ruleType}:${created.severityId}`;
      }),
    ).toEqual([
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}:77777777-7777-4777-8777-777777777777`,
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE}:77777777-7777-4777-8777-777777777777`,
    ]);
  });

  test("shift rules and rules of no card are left as they are", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const shiftRule: PagingLadderRule = {
      _id: "cccccccc-0000-4000-8000-000000000001",
      ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
      userEmailId: EMAIL,
      notifyAfterMinutes: 0,
    };
    const orphan: PagingLadderRule = {
      _id: "cccccccc-0000-4000-8000-000000000002",
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: "dddddddd-0000-4000-8000-000000000000",
      userCallId: CALL,
      notifyAfterMinutes: 0,
    };

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: [shiftRule, orphan],
      steps: [step("userSmsId", SMS, 0)],
    });

    expect(plan.delete).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.create).toHaveLength(10);
  });

  test("a card that differs loses its difference: the person sees it before saving", () => {
    const cells: Array<PagingLadderCell> = newProjectCells();
    const extraCall: PagingLadderRule = ruleRow({
      cell: cells[0]!,
      methodColumn: "userCallId",
      methodId: CALL,
    });
    const rules: Array<PagingLadderRule> = [
      ...gridEditedByHand(cells, [step("userSmsId", SMS, 0)]),
      extraCall,
    ];

    const reading: PagingLadderReading = readPagingLadder({
      cells: cells,
      rules: rules,
    });

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: rules,
      steps: reading.steps,
    });

    expect(plan.delete).toEqual([readPagingId(extraCall._id)]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  test("rules without an id cannot be changed, so a plan never names them", () => {
    const cells: Array<PagingLadderCell> = newProjectCells().slice(0, 1);
    const unsaved: PagingLadderRule = {
      ruleType: cells[0]!.ruleType,
      incidentSeverityId: CRITICAL,
      userEmailId: EMAIL,
    };

    const plan: PagingLadderPlan = planPagingLadderSave({
      cells: cells,
      rules: [unsaved],
      steps: [step("userSmsId", SMS, 0)],
    });

    expect(plan.delete).toEqual([]);
    expect(plan.create).toHaveLength(1);
  });

  test("the cell key is the rule type and the severity", () => {
    expect(
      getPagingLadderCellKey({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        severityId: ALERT_LOW,
      }),
    ).toBe(`${NotificationRuleType.ON_CALL_EXECUTED_ALERT}|${ALERT_LOW}`);
  });
});

describe("a ladder sent to the server", () => {
  test("is refused when it is empty, saying what to do", () => {
    expect(getPagingLadderStepsProblem([])).toBe(
      "A ladder needs at least one step. Add a way to reach you, then save.",
    );
    expect(
      getPagingLadderStepsProblem(undefined as unknown as Array<unknown>),
    ).not.toBeNull();
  });

  test.each([
    [null, "Each step of a ladder needs a notification method and a wait."],
    [
      { methodColumn: "userFaxId", methodId: SMS, notifyAfterMinutes: 0 },
      "OneUptime does not know",
    ],
    [
      { methodColumn: "userSmsId", methodId: "", notifyAfterMinutes: 0 },
      "A step has no notification method.",
    ],
    [
      { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: -1 },
      "from 0 to 1440",
    ],
    [
      { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: 2.5 },
      "from 0 to 1440",
    ],
    [
      {
        methodColumn: "userSmsId",
        methodId: SMS,
        notifyAfterMinutes: MAX_PAGING_LADDER_WAIT_IN_MINUTES + 1,
      },
      "from 0 to 1440",
    ],
    [
      { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: "5" },
      "from 0 to 1440",
    ],
    [
      {
        methodColumn: "userPushId",
        methodId: PUSH,
        notifyAfterMinutes: 0,
        pushNotificationLevel: "Deafening",
      },
      "Critical alert or a Standard notification",
    ],
    [
      {
        methodColumn: "userPushId",
        methodId: PUSH,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 4,
      },
      "repeats every 1, 2, 3, 5, 10, 15 or 30 minutes",
    ],
    [
      {
        methodColumn: "userSmsId",
        methodId: SMS,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      },
      "Only a push step can repeat",
    ],
  ])("refuses %j", (value: unknown, words: string) => {
    const problem: string | null = getPagingLadderStepsProblem([value]);

    expect(problem).toContain(words);
    // Every refusal is a sentence that says what to do next (#6836).
    expect(problem).toMatch(/^[A-Z].*\.$/);
    expect(problem).toMatch(/then save\.$/);
  });

  test("takes a good ladder, and reads it normalized", () => {
    const sent: Array<unknown> = [
      { methodColumn: "userCallId", methodId: CALL, notifyAfterMinutes: 5 },
      {
        methodColumn: "userPushId",
        methodId: PUSH,
        notifyAfterMinutes: 0,
        pushNotificationLevel: "Standard",
        repeatEveryMinutes: 5,
      },
      { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: 0 },
      { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: 0 },
    ];

    expect(getPagingLadderStepsProblem(sent)).toBeNull();
    expect(readPagingLadderSteps(sent)).toEqual([
      step("userPushId", PUSH, 0, {
        pushNotificationLevel: PushNotificationLevel.Standard,
        repeatEveryMinutes: 5,
      }),
      step("userSmsId", SMS, 0),
      step("userCallId", CALL, 5),
    ]);
  });
});
