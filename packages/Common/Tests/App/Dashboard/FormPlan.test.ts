import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getJestSpyOn } from "../../Spy";
import {
  getFormIpAllowlistPlan,
  isFormIpAllowlistEditableOnCurrentPlan,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormPlan";
import Form from "../../../Models/DatabaseModels/Form";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * Whether a project's plan lets it change a form's IP allowlist, for the
 * note on the form's Share page. The plan comes from
 * the column's own billing rule, so the note says what the server enforces;
 * and like the dashboard's other plan notes it fails open - with billing off,
 * or a plan it cannot tell, it says nothing.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

function onPlan(plan: PlanType | null): void {
  jest
    .spyOn(ProjectUtil, "getCurrentPlan")
    .mockImplementation((): PlanType | null => {
      return plan;
    });
}

function accessibleWhen(answer: boolean | Error): SpyInstance {
  return getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((): boolean => {
    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the plan an IP allowlist needs", () => {
  test("is the one Form.ipWhitelist's billing rule names for updates: Scale", () => {
    expect(getFormIpAllowlistPlan()).toBe(PlanType.Scale);
    expect(new Form().getColumnBillingAccessControl("ipWhitelist").update).toBe(
      getFormIpAllowlistPlan(),
    );
  });
});

describe("whether this project may change it", () => {
  test("yes with billing off (no plan at all), without asking about plans", () => {
    onPlan(null);
    const accessible: SpyInstance = accessibleWhen(false);

    expect(isFormIpAllowlistEditableOnCurrentPlan()).toBe(true);
    expect(accessible).not.toHaveBeenCalled();
  });

  test("asks whether Scale is within the project's plan", () => {
    onPlan(PlanType.Growth);
    const accessible: SpyInstance = accessibleWhen(false);

    expect(isFormIpAllowlistEditableOnCurrentPlan()).toBe(false);
    expect(accessible).toHaveBeenCalledTimes(1);
    expect(accessible.mock.calls[0]![0]).toBe(PlanType.Scale);
    expect(accessible.mock.calls[0]![1]).toBe(PlanType.Growth);
  });

  test("yes when the plan includes it", () => {
    onPlan(PlanType.Scale);
    accessibleWhen(true);

    expect(isFormIpAllowlistEditableOnCurrentPlan()).toBe(true);
  });

  test("yes when the environment does not describe the plan: the server decides", () => {
    onPlan(PlanType.Growth);
    accessibleWhen(new Error("Invalid Plan"));

    expect(isFormIpAllowlistEditableOnCurrentPlan()).toBe(true);
  });
});
