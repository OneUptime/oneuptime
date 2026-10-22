import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_PLAYBOOK_TRIGGER_DESCRIPTIONS,
  SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION,
  SecurityPlaybookTriggerOption,
  getSecurityPlaybookTriggerOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTriggerOptions";
import {
  getCloseVerdictAiRead,
  getInitialCloseVerdict,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseActionModals";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityPlaybookTrigger, {
  SECURITY_PLAYBOOK_TRIGGERS,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";

/*
 * Where OneUptime AI's read of a case meets the parts people already use:
 * the playbook Trigger picker (Triaged as Likely Malicious, offered while
 * AI is on) and the Close Case dialog (starts on the verdict the read
 * suggests; a person still picks).
 */

function valuesOf(
  options: Array<SecurityPlaybookTriggerOption>,
): Array<SecurityPlaybookTrigger> {
  return options.map(
    (option: SecurityPlaybookTriggerOption): SecurityPlaybookTrigger => {
      return option.value;
    },
  );
}

describe("a playbook's Trigger picker", () => {
  test("the field says one short thing; each trigger says when it runs", () => {
    expect(SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION).toBe(
      "When the playbook runs on its own.",
    );
    expect(SECURITY_PLAYBOOK_TRIGGER_DESCRIPTIONS).toEqual({
      [SecurityPlaybookTrigger.CaseOpened]: "Once, as a case opens.",
      [SecurityPlaybookTrigger.DetectionAdded]:
        "Each time a new detection joins an open case.",
      [SecurityPlaybookTrigger.TriagedAsLikelyMalicious]:
        "Once, when OneUptime AI's triage reads the case as Likely Malicious.",
      [SecurityPlaybookTrigger.Manual]: "Only when someone runs it.",
    });
  });

  test("with AI on, a new playbook is offered every trigger, in the order a case lives them", () => {
    const options: Array<SecurityPlaybookTriggerOption> =
      getSecurityPlaybookTriggerOptions({
        isAiOffered: true,
        isEditing: false,
      });

    expect(valuesOf(options)).toEqual([
      SecurityPlaybookTrigger.CaseOpened,
      SecurityPlaybookTrigger.DetectionAdded,
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      SecurityPlaybookTrigger.Manual,
    ]);
    expect(valuesOf(options)).toEqual(SECURITY_PLAYBOOK_TRIGGERS);

    for (const option of options) {
      expect(option.label).toBe(option.value);
      expect(option.description).toBe(
        SECURITY_PLAYBOOK_TRIGGER_DESCRIPTIONS[option.value],
      );
    }
  });

  test("with AI off, a new playbook is not offered the AI trigger", () => {
    expect(
      valuesOf(
        getSecurityPlaybookTriggerOptions({
          isAiOffered: false,
          isEditing: false,
        }),
      ),
    ).toEqual([
      SecurityPlaybookTrigger.CaseOpened,
      SecurityPlaybookTrigger.DetectionAdded,
      SecurityPlaybookTrigger.Manual,
    ]);
  });

  test("a playbook being edited keeps every trigger, so its own stays shown", () => {
    for (const isAiOffered of [true, false]) {
      expect(
        valuesOf(
          getSecurityPlaybookTriggerOptions({ isAiOffered, isEditing: true }),
        ),
      ).toEqual(SECURITY_PLAYBOOK_TRIGGERS);
    }
  });
});

describe("the verdict the Close Case dialog starts on", () => {
  function caseWith(values: Partial<SecurityCase>): SecurityCase {
    const securityCase: SecurityCase = new SecurityCase();
    Object.assign(securityCase, values);
    return securityCase;
  }

  test("a case with no verdict and no AI read starts on True Positive", () => {
    expect(getInitialCloseVerdict(caseWith({}))).toBe(
      SecurityCaseVerdict.TruePositive,
    );
  });

  test("the case's own verdict comes first, whatever the AI read", () => {
    expect(
      getInitialCloseVerdict(
        caseWith({
          verdict: SecurityCaseVerdict.FalsePositive,
          aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
        }),
      ),
    ).toBe(SecurityCaseVerdict.FalsePositive);
  });

  test.each([
    [SecurityCaseAiVerdict.LikelyMalicious, SecurityCaseVerdict.TruePositive],
    [SecurityCaseAiVerdict.LikelyBenign, SecurityCaseVerdict.BenignPositive],
    [
      SecurityCaseAiVerdict.LikelyFalsePositive,
      SecurityCaseVerdict.FalsePositive,
    ],
    // Inconclusive suggests nothing: the dialog's own default.
    [SecurityCaseAiVerdict.Inconclusive, SecurityCaseVerdict.TruePositive],
  ])(
    "an AI read of %s starts it on %s",
    (aiVerdict: SecurityCaseAiVerdict, expected: SecurityCaseVerdict) => {
      expect(getInitialCloseVerdict(caseWith({ aiVerdict }))).toBe(expected);
    },
  );

  test("a case whose data held text written to steer an AI never starts on a dismissing verdict", () => {
    for (const aiVerdict of [
      SecurityCaseAiVerdict.LikelyBenign,
      SecurityCaseAiVerdict.LikelyFalsePositive,
    ]) {
      expect(
        getInitialCloseVerdict(
          caseWith({ aiVerdict, aiTriagePromptInjectionSuspected: true }),
        ),
      ).toBe(SecurityCaseVerdict.TruePositive);
    }
  });

  // With AI off nothing of OneUptime AI is drawn, so nothing of it is picked.
  test("with the project's AI off, the read picks nothing", () => {
    for (const aiVerdict of Object.values(SecurityCaseAiVerdict)) {
      expect(getInitialCloseVerdict(caseWith({ aiVerdict }), false)).toBe(
        SecurityCaseVerdict.TruePositive,
      );
    }
    expect(
      getInitialCloseVerdict(
        caseWith({ verdict: SecurityCaseVerdict.BenignPositive }),
        false,
      ),
    ).toBe(SecurityCaseVerdict.BenignPositive);
  });
});

/*
 * What the dialog says over its verdicts: OneUptime AI's read, so a person
 * knows where the verdict it starts on came from and that the pick is theirs.
 */
describe("the AI read the Close Case dialog names", () => {
  function caseWith(values: Partial<SecurityCase>): SecurityCase {
    const securityCase: SecurityCase = new SecurityCase();
    Object.assign(securityCase, values);
    return securityCase;
  }

  test("every read is named while the case has no verdict of its own", () => {
    for (const aiVerdict of Object.values(SecurityCaseAiVerdict)) {
      expect(getCloseVerdictAiRead(caseWith({ aiVerdict }))).toBe(aiVerdict);
    }
  });

  test("nothing when the case was never read, has a verdict, or AI is off", () => {
    expect(getCloseVerdictAiRead(caseWith({}))).toBeUndefined();
    expect(
      getCloseVerdictAiRead(
        caseWith({
          verdict: SecurityCaseVerdict.TruePositive,
          aiVerdict: SecurityCaseAiVerdict.LikelyBenign,
        }),
      ),
    ).toBeUndefined();
    expect(
      getCloseVerdictAiRead(
        caseWith({ aiVerdict: SecurityCaseAiVerdict.LikelyMalicious }),
        false,
      ),
    ).toBeUndefined();
    expect(
      getCloseVerdictAiRead(
        caseWith({ aiVerdict: "Safe" as SecurityCaseAiVerdict }),
      ),
    ).toBeUndefined();
  });
});
