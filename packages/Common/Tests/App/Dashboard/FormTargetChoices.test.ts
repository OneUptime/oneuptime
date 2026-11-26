import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Alert from "../../../Models/DatabaseModels/Alert";
import FormTargetType, {
  FORM_TARGET_TYPES,
} from "../../../Types/Form/FormTargetType";
import IconProp from "../../../Types/Icon/IconProp";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import {
  FORM_TARGET_ICONS,
  getChangeTargetDescription,
  getFormTargetSetUpGate,
  getFormTargetsToOffer,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormTargetChoices";

/*
 * What a form can create, as the Dashboard offers the choice (#10760): the
 * Forms list's Create Form and the On Submit page's "What Each Submission
 * Creates".
 *
 *   - an alert form is set up only by someone who may create alerts, as the
 *     server asks (FormService.assertMaySetUpTarget): the Dashboard asks
 *     PermissionGate about creating an Alert, and offers the choice unless
 *     it knows the answer is no - a snapshot not loaded yet leaves it to the
 *     server; incident and maintenance forms take the Form permissions
 *     alone;
 *   - the choices read as one choice of three, each with its product's own
 *     icon;
 *   - changing what a form creates says, before it is done, which questions
 *     stay linked: an alert has its own severities and one monitor.
 */

const REFUSED: PermissionGateResult = {
  isAllowed: false,
  disabledReason: "You need Create Alert to do this.",
};

function gateFor(alertGate: PermissionGateResult): jest.SpyInstance {
  return getJestSpyOn(PermissionGate, "check").mockImplementation(((
    model: unknown,
  ): PermissionGateResult => {
    return model instanceof Alert ? alertGate : { isAllowed: true };
  }) as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FORM_TARGET_ICONS", () => {
  test("each target has its product's own icon, and no two share one", () => {
    expect(FORM_TARGET_ICONS).toEqual({
      [FormTargetType.Incident]: IconProp.Alert,
      [FormTargetType.Alert]: IconProp.ExclaimationCircle,
      [FormTargetType.ScheduledMaintenance]: IconProp.Clock,
    });
    expect(new Set(Object.values(FORM_TARGET_ICONS)).size).toBe(
      FORM_TARGET_TYPES.length,
    );
  });
});

describe("getFormTargetSetUpGate", () => {
  test("an alert form asks whether the reader may create alerts", () => {
    const check: jest.SpyInstance = gateFor(REFUSED);

    expect(getFormTargetSetUpGate(FormTargetType.Alert)).toEqual(REFUSED);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check.mock.calls[0]![0]).toBeInstanceOf(Alert);
    expect(check.mock.calls[0]![1]).toBe(ModelAction.Create);
  });

  test("incident and maintenance forms take the Form permissions alone: nothing more is asked", () => {
    const check: jest.SpyInstance = gateFor(REFUSED);

    expect(getFormTargetSetUpGate(FormTargetType.Incident)).toEqual({
      isAllowed: true,
    });
    expect(getFormTargetSetUpGate(FormTargetType.ScheduledMaintenance)).toEqual(
      { isAllowed: true },
    );
    expect(check).not.toHaveBeenCalled();
  });
});

describe("getFormTargetsToOffer", () => {
  test("offers all three, an alert beside an incident, to someone who may create alerts", () => {
    gateFor({ isAllowed: true });

    expect(getFormTargetsToOffer()).toEqual([
      FormTargetType.Incident,
      FormTargetType.Alert,
      FormTargetType.ScheduledMaintenance,
    ]);
  });

  test("leaves Alert out for someone known to be refused", () => {
    gateFor(REFUSED);

    expect(getFormTargetsToOffer()).toEqual([
      FormTargetType.Incident,
      FormTargetType.ScheduledMaintenance,
    ]);
  });

  test("offers Alert while the answer is not known yet, and leaves it to the server", () => {
    // Not loaded yet: neither allowed nor refused with a reason.
    gateFor({ isAllowed: false });

    expect(getFormTargetsToOffer()).toContain(FormTargetType.Alert);
  });
});

describe("getChangeTargetDescription: what changing what a form creates keeps", () => {
  test.each([
    [
      FormTargetType.Incident,
      FormTargetType.ScheduledMaintenance,
      FormsCopy.changeTargetToScheduledMaintenance,
    ],
    [
      FormTargetType.ScheduledMaintenance,
      FormTargetType.Incident,
      FormsCopy.changeTargetToIncident,
    ],
    [
      FormTargetType.Incident,
      FormTargetType.Alert,
      FormsCopy.changeTargetToAlert,
    ],
    [
      FormTargetType.ScheduledMaintenance,
      FormTargetType.Alert,
      FormsCopy.changeTargetToAlert,
    ],
    [
      FormTargetType.Alert,
      FormTargetType.Incident,
      FormsCopy.changeTargetFromAlertToIncident,
    ],
    [
      FormTargetType.Alert,
      FormTargetType.ScheduledMaintenance,
      FormsCopy.changeTargetFromAlertToScheduledMaintenance,
    ],
  ])(
    "from %s to %s",
    (from: FormTargetType, to: FormTargetType, words: string) => {
      expect(getChangeTargetDescription({ from, to })).toBe(words);
    },
  );

  test("monitors stay linked only between an incident and a maintenance event", () => {
    expect(FormsCopy.changeTargetToIncident).toContain("monitors");
    expect(FormsCopy.changeTargetToScheduledMaintenance).toContain("monitors");

    for (const words of [
      FormsCopy.changeTargetToAlert,
      FormsCopy.changeTargetFromAlertToIncident,
      FormsCopy.changeTargetFromAlertToScheduledMaintenance,
    ]) {
      expect(words).toContain("Title, description and labels stay linked");
      expect(words).not.toContain("monitors");
    }
  });

  test("says what each submission will create", () => {
    expect(FormsCopy.changeTargetToAlert).toBe(
      "Each submission will create an alert. Title, description and labels stay linked; On Submit settings start over.",
    );
    expect(FormsCopy.changeTargetFromAlertToIncident).toBe(
      "Each submission will declare an incident. Title, description and labels stay linked; On Submit settings start over.",
    );
    expect(FormsCopy.changeTargetFromAlertToScheduledMaintenance).toBe(
      "Each submission will schedule a maintenance event. Title, description and labels stay linked; On Submit settings start over.",
    );
  });
});
