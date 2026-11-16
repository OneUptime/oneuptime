import { describe, expect, test } from "@jest/globals";
import { getPagingLadderSaveBody } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PagingLadderApi";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import {
  PagingLadderCell,
  getPagingLadderCells,
  readPagingLadderKeptCells,
} from "../../../Types/NotificationRule/PagingLadder";
import ObjectID from "../../../Types/ObjectID";

/*
 * What How to Reach Me sends when it saves a ladder (#6820), and the cards
 * that keep their own rules (#8890): sent as the server reads them, and
 * left out when none are kept, so a save without them is the save it
 * always was.
 */

const CRITICAL: string = "b0000000-0000-4000-8000-000000000001";
const HIGH: string = "b0000000-0000-4000-8000-000000000003";
const SMS: string = "c0000000-0000-4000-8000-000000000002";
const ANA: string = "a0000000-0000-4000-8000-0000000000a1";

const CELLS: Array<PagingLadderCell> = getPagingLadderCells({
  incidentSeverities: [{ id: CRITICAL, name: "Critical Incident" }],
  alertSeverities: [{ id: HIGH, name: "High" }],
});

describe("the body a ladder save sends", () => {
  test("no kept cards: only the steps, and the member when there is one", () => {
    expect(
      getPagingLadderSaveBody({
        steps: [
          { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: 0 },
        ],
        keepCards: [],
      }),
    ).toEqual({
      steps: [
        { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: 0 },
      ],
    });

    expect(
      getPagingLadderSaveBody({
        userId: new ObjectID(ANA),
        steps: [
          { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: 0 },
        ],
      })["userId"],
    ).toBe(ANA);
  });

  test("kept cards are sent by rule type and severity, and the server reads them back as those cards", () => {
    const kept: Array<PagingLadderCell> = [CELLS[0]!, CELLS[CELLS.length - 1]!];

    const body: Record<string, unknown> = getPagingLadderSaveBody({
      steps: [
        { methodColumn: "userSmsId", methodId: SMS, notifyAfterMinutes: 0 },
      ],
      keepCards: kept,
    });

    expect(body["keepCards"]).toEqual([
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: CRITICAL,
      },
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        severityId: HIGH,
      },
    ]);

    // Through JSON, as the request carries it.
    expect(
      readPagingLadderKeptCells(
        JSON.parse(JSON.stringify(body))["keepCards"] as unknown,
      ),
    ).toEqual([
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}|${CRITICAL}`,
      `${NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE}|${HIGH}`,
    ]);
  });
});
