import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_AI_AREA_COPY,
  SECURITY_CASE_AI_MODE_LABELS,
  SECURITY_CASE_AI_OFF_MEANING,
  SecurityCaseAiLimitsCopy,
  getSecurityCaseAiModeMeaning,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/SecurityCaseAiLimitsCopy";
import { SECURITY_AI_SWITCHES } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  SecurityCaseAiResponseStage,
  SecurityCaseAiResponseView,
  canRespondWithAi,
  getActionReasonKey,
  getActionTitleKey,
  getActionsWaitingForPeople,
  getClosingReport,
  getSecurityCaseAiResponseStage,
  parseSecurityCaseAiResponse,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/AiResponse/SecurityCaseAiResponseModel";
import { parseSecurityAiOverviewMeasures } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApiTypes";
import {
  SECURITY_CASE_AI_AREAS,
  SECURITY_CASE_AI_MODES,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiMode,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_AI_ACTION_REASON_SENTENCES,
  SECURITY_CASE_HAND_OFF_SENTENCES,
} from "../../../Types/SecurityCase/SecurityCaseAiWords";
import { JSONObject } from "../../../Types/JSON";

/*
 * WHAT PEOPLE SEE OF ONEUPTIME AI WORKING A CASE (#10352), React-free: the
 * case's OneUptime AI card read from what the server sends - where it
 * stands, its log, what it asks, its closing report - the rows of What
 * OneUptime AI may do on a case, each saying what each choice means, and
 * the Overview's figures read defensively.
 */

function view(json: JSONObject): SecurityCaseAiResponseView {
  return parseSecurityCaseAiResponse(json);
}

const ASKED_CLOSE: JSONObject = {
  _id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  kind: SecurityCaseAiActionKind.CloseCase,
  status: SecurityCaseAiActionStatus.Asked,
  reason: SecurityCaseAiActionReason.SettingAsks,
  area: SecurityCaseAiArea.Close,
  mode: SecurityCaseAiMode.Ask,
  stepKey: "close",
  evidence: { verdict: "True Positive" },
  report: "### What happened\n\nA scanner.",
  askedAt: "2026-11-22T10:00:00.000Z",
  createdAt: "2026-11-22T10:00:00.000Z",
  securityPlaybookRunId: "55555555-5555-4555-8555-555555555555",
};

describe("the case's OneUptime AI card", () => {
  test("reads what the server sends, and drops what it cannot read", () => {
    const read: SecurityCaseAiResponseView = view({
      isOn: true,
      modes: { Case: "OnItsOwn", Edge: "Ask", Accounts: "nonsense" },
      state: SecurityCaseAiResponseState.WaitingForPeople,
      actions: [ASKED_CLOSE, { _id: "x", kind: "Unknown", status: "Done" }, 3],
      notStartedReason: null,
    });

    expect(read.isOn).toBe(true);
    expect(read.modes[SecurityCaseAiArea.Case]).toBe(
      SecurityCaseAiMode.OnItsOwn,
    );
    // A mode it cannot read is Off: a doubt falls toward a person.
    expect(read.modes[SecurityCaseAiArea.Accounts]).toBe(
      SecurityCaseAiMode.Off,
    );
    expect(read.modes[SecurityCaseAiArea.Close]).toBe(SecurityCaseAiMode.Off);
    expect(
      read.actions.map((action: { id: string }): string => {
        return action.id;
      }),
    ).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-000000000001"]);
    expect(read.actions[0]!.askedAt).toEqual(
      new Date("2026-11-22T10:00:00.000Z"),
    );
  });

  test.each([
    [null, false, SecurityCaseAiResponseStage.Off],
    [null, true, SecurityCaseAiResponseStage.NotWorking],
    [
      SecurityCaseAiResponseState.Working,
      true,
      SecurityCaseAiResponseStage.Working,
    ],
    [
      SecurityCaseAiResponseState.WaitingForPeople,
      true,
      SecurityCaseAiResponseStage.WaitingForPeople,
    ],
    [
      SecurityCaseAiResponseState.HandedToPeople,
      true,
      SecurityCaseAiResponseStage.HandedToPeople,
    ],
    [
      SecurityCaseAiResponseState.Finished,
      false,
      SecurityCaseAiResponseStage.Finished,
    ],
  ])(
    "state %s, working cases on: %s - the card says %s",
    (
      state: SecurityCaseAiResponseState | null,
      isOn: boolean,
      stage: SecurityCaseAiResponseStage,
    ) => {
      expect(getSecurityCaseAiResponseStage(view({ state, isOn }))).toBe(stage);
    },
  );

  test("Respond with AI is offered only while working cases is on, nothing works the case, and nothing stops it", () => {
    expect(canRespondWithAi(view({ isOn: true }))).toBe(true);
    expect(canRespondWithAi(view({ isOn: false }))).toBe(false);
    expect(
      canRespondWithAi(
        view({ isOn: true, state: SecurityCaseAiResponseState.Working }),
      ),
    ).toBe(false);
    expect(
      canRespondWithAi(
        view({
          isOn: true,
          notStartedReason: { code: "highest_priority", message: "…" },
        }),
      ),
    ).toBe(false);
    // Handed to people: a person may ask it to work the case again.
    expect(
      canRespondWithAi(
        view({ isOn: true, state: SecurityCaseAiResponseState.HandedToPeople }),
      ),
    ).toBe(true);
  });

  test("each step reads with its title and why, a hand-off with its own reason", () => {
    const read: SecurityCaseAiResponseView = view({
      isOn: true,
      actions: [
        ASKED_CLOSE,
        {
          _id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
          kind: SecurityCaseAiActionKind.HandToPeople,
          status: SecurityCaseAiActionStatus.Done,
          reason: SecurityCaseAiActionReason.HandedOff,
          handOffReason: SecurityCaseHandOffReason.ProtectedTarget,
        },
      ],
    });

    expect(getActionTitleKey(read.actions[0]!)).toBe(
      "Asks to close the case as {{verdict}}",
    );
    expect(getActionReasonKey(read.actions[0]!)).toBe(
      SECURITY_CASE_AI_ACTION_REASON_SENTENCES[
        SecurityCaseAiActionReason.SettingAsks
      ],
    );
    expect(getActionReasonKey(read.actions[1]!)).toBe(
      SECURITY_CASE_HAND_OFF_SENTENCES[
        SecurityCaseHandOffReason.ProtectedTarget
      ],
    );
    expect(getActionsWaitingForPeople(read)).toEqual([read.actions[0]]);
    expect(getClosingReport(read)?.report).toContain("### What happened");
  });
});

describe("What OneUptime AI may do on a case", () => {
  test("a row for each kind of step, in the order a case is worked, with what each choice means", () => {
    expect(Object.keys(SECURITY_CASE_AI_AREA_COPY)).toEqual([
      ...SECURITY_CASE_AI_AREAS,
    ]);

    for (const area of SECURITY_CASE_AI_AREAS) {
      const meanings: Array<string> = SECURITY_CASE_AI_MODES.map(
        (mode: SecurityCaseAiMode): string => {
          return getSecurityCaseAiModeMeaning(area, mode);
        },
      );

      // Three choices, three different sentences; Off is the same for every row.
      expect(new Set(meanings).size).toBe(3);
      expect(meanings[0]).toBe(SECURITY_CASE_AI_OFF_MEANING);
    }

    expect(SECURITY_CASE_AI_MODE_LABELS).toEqual({
      Off: "Off",
      Ask: "Ask first",
      OnItsOwn: "On its own",
    });
  });

  test("the rows' words fit under a field, and the card's beside its title", () => {
    for (const area of SECURITY_CASE_AI_AREAS) {
      const copy: (typeof SECURITY_CASE_AI_AREA_COPY)[SecurityCaseAiArea] =
        SECURITY_CASE_AI_AREA_COPY[area];

      for (const text of [copy.description, copy.ask, copy.onItsOwn]) {
        expect({ area, length: text.length <= 150 }).toEqual({
          area,
          length: true,
        });
      }
    }

    expect(SecurityCaseAiLimitsCopy.cardDescription.length).toBeLessThanOrEqual(
      210,
    );
  });

  test("Block addresses on its own is confirmed by a Security Admin, never set without a word", () => {
    expect(SecurityCaseAiLimitsCopy.edgeConfirmButton).toBe(
      "Confirm and Turn On",
    );
    expect(SecurityCaseAiLimitsCopy.edgeConfirmDescription).toContain(
      "Security Admin",
    );
  });

  test("its switch sits beside triaging new cases", () => {
    expect(
      SECURITY_AI_SWITCHES.map((definition: { title: string }): string => {
        return definition.title;
      }),
    ).toEqual(["Triage new cases", "Work cases end to end"]);
  });
});

describe("the Overview's OneUptime AI figures", () => {
  test("read defensively: a figure the server left out is none, a server from before sends nothing", () => {
    expect(parseSecurityAiOverviewMeasures(undefined)).toBeNull();
    expect(parseSecurityAiOverviewMeasures([])).toBeNull();
    expect(
      parseSecurityAiOverviewMeasures({
        casesWorkedByAi: 3,
        casesResolvedByAi: 2,
        meanTimeToContainWithAiInMinutes: 12,
        meanTimeToContainWithoutAiInMinutes: "soon",
        approvalsAsked: 4,
        medianTimeToAnswerInMinutes: -1,
        hasActivity: true,
      }),
    ).toEqual({
      casesWorkedByAi: 3,
      casesResolvedByAi: 2,
      meanTimeToContainWithAiInMinutes: 12,
      meanTimeToContainWithoutAiInMinutes: null,
      meanTimeToCloseWithAiInMinutes: null,
      meanTimeToCloseWithoutAiInMinutes: null,
      approvalsAsked: 4,
      approvalsAnswered: 0,
      medianTimeToAnswerInMinutes: null,
      stepsUndone: 0,
      hasActivity: true,
    });
  });
});
