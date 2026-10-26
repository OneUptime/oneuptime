import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, it } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  CREATE_PROJECT_INITIAL_BILLING_PERIOD,
  PROJECT_NAME_MIN_LENGTH,
  getCreateProjectFormFields,
} from "../../../../UI/Components/Project/CreateProjectFormFields";
import {
  isProjectNameServerError,
  isPromoCodeServerError,
} from "../../../../UI/Components/Project/CreateProjectServerErrors";
import Field, {
  CustomElementProps,
} from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
} from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import SubscriptionPlan from "../../../../Types/Billing/SubscriptionPlan";
import { BillingPeriod } from "../../../../Types/Billing/SubscriptionPlanPricing";
import Project from "../../../../Models/DatabaseModels/Project";

/*
 * The fields of every form that creates a project (CreateProjectFormFields):
 * the Dashboard's Create New Project dialog and the Admin Dashboard's
 * Projects page. One page in every deployment - no stepId anywhere - with
 * the name first, the plan on OneUptime Cloud, and the promo code folded
 * under More fields.
 */

const FREE: SubscriptionPlan = new SubscriptionPlan(
  "price_free_month",
  "price_free_year",
  "Free",
  0,
  0,
  1,
  0,
);
const GROWTH: SubscriptionPlan = new SubscriptionPlan(
  "price_growth_month",
  "price_growth_year",
  "Growth",
  22,
  20,
  2,
  14,
);
const SCALE: SubscriptionPlan = new SubscriptionPlan(
  "price_scale_month",
  "price_scale_year",
  "Scale",
  99,
  84,
  3,
  14,
);

const CLOUD_PLANS: Array<SubscriptionPlan> = [FREE, GROWTH, SCALE];

function keyOf(field: Field<Project>): string {
  return Object.keys(field.field || {})[0] || "";
}

afterEach(() => {
  cleanup();
});

describe("getCreateProjectFormFields", () => {
  describe("self-hosted (billing off)", () => {
    const fields: Array<Field<Project>> = getCreateProjectFormFields({
      isBillingEnabled: false,
      plans: CLOUD_PLANS,
    });

    it("is the project name alone, whatever plans are configured", () => {
      expect(fields.map(keyOf)).toEqual(["name"]);
    });

    /*
     * Two characters, as every other name in the product: a minimum of
     * four refused "IBM", "Ops" and "QA".
     */
    it("asks for a name of at least two characters, with a hint and an example", () => {
      const name: Field<Project> = fields[0]!;

      expect(PROJECT_NAME_MIN_LENGTH).toBe(2);
      expect(name).toMatchObject({
        title: "Project Name",
        description:
          "Such as your company or team name. You can change it later.",
        placeholder: "My Project",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        validation: { minLength: 2 },
      });
      expect(name.stepId).toBeUndefined();
    });

    it("owns the server's answer that another project has the name", () => {
      const name: Field<Project> = fields[0]!;

      expect(name.ownsServerError).toBe(isProjectNameServerError);
      expect(
        name.ownsServerError!("Project with the same name already exists"),
      ).toBe(true);
      expect(name.ownsServerError!("Promo code is invalid.")).toBe(false);
    });
  });

  describe("OneUptime Cloud (billing on)", () => {
    const fields: Array<Field<Project>> = getCreateProjectFormFields({
      isBillingEnabled: true,
      plans: CLOUD_PLANS,
    });

    it("is the name, the plan and the promo code, in that order", () => {
      expect(fields.map(keyOf)).toEqual([
        "name",
        "paymentProviderPlanId",
        "paymentProviderPromoCode",
      ]);
    });

    it("is one page: no field is on a step", () => {
      for (const field of fields) {
        expect({ key: keyOf(field), stepId: field.stepId }).toEqual({
          key: keyOf(field),
          stepId: undefined,
        });
      }
    });

    it("shows three rows: the name, the plan and the folded More fields", () => {
      const rows: number = fields.filter((field: Field<Project>): boolean => {
        return !field.collapsibleSection;
      }).length;
      const foldedSections: Set<string> = new Set(
        fields
          .filter((field: Field<Project>): boolean => {
            return Boolean(field.collapsibleSection);
          })
          .map((field: Field<Project>): string => {
            return field.collapsibleSection!.id;
          }),
      );

      expect(rows + foldedSections.size).toBe(3);
    });

    it("asks for the plan with the plan picker, which draws its own label", () => {
      const plan: Field<Project> = fields[1]!;

      expect(plan).toMatchObject({
        title: "Plan",
        fieldType: FormFieldSchemaType.CustomComponent,
        customElementDrawsOwnLabel: true,
        required: true,
      });
      expect(typeof plan.getCustomElement).toBe("function");
    });

    it("starts on Free, billed yearly - never on a paid plan or its trial", () => {
      expect(CREATE_PROJECT_INITIAL_BILLING_PERIOD).toBe(BillingPeriod.Yearly);
      expect(fields[1]!.defaultValue).toBe("price_free_year");
    });

    it("starts on nothing where every plan costs money", () => {
      const paidOnly: Array<Field<Project>> = getCreateProjectFormFields({
        isBillingEnabled: true,
        plans: [GROWTH, SCALE],
      });

      expect("defaultValue" in paidOnly[1]!).toBe(false);
    });

    it("folds the promo code under More fields, optional and editable", () => {
      const promoCode: Field<Project> = fields[2]!;

      expect(promoCode).toMatchObject({
        title: "Promo Code",
        description: "If you have one, from an offer or a reseller.",
        fieldType: FormFieldSchemaType.Text,
        required: false,
      });
      expect(promoCode.disabled).toBeFalsy();
      expect(promoCode.collapsibleSection).toMatchObject({
        id: ADVANCED_FORM_SECTION_ID,
        title: MORE_FIELDS_SECTION_TITLE,
        openWhenConfigured: false,
        listFieldsWhileFolded: true,
      });
    });

    it("owns every answer the server refuses a promo code with, and nothing else", () => {
      const promoCode: Field<Project> = fields[2]!;

      expect(promoCode.ownsServerError).toBe(isPromoCodeServerError);
      expect(fields[1]!.ownsServerError).toBeUndefined();
      expect(
        promoCode.ownsServerError!(
          "Promocode is not valid for this plan. Please select the Growth plan.",
        ),
      ).toBe(true);
      expect(
        promoCode.ownsServerError!("Project with the same name already exists"),
      ).toBe(false);
    });

    it("draws the plan picker with the form's value and error, and hands picks to the form", () => {
      const onChange: MockFunction = getJestMockFunction();
      const props: CustomElementProps = {
        initialValue: "price_growth_month",
        error: "Plan is required.",
        onChange: (value: unknown) => {
          onChange(value);
        },
      };

      const element: ReactElement | undefined = fields[1]!.getCustomElement!(
        {} as FormValues<Project>,
        props,
      );

      render(<>{element}</>);

      expect(screen.getByTestId("plan-picker")).toBeVisible();
      expect(screen.getByRole("radio", { name: "Growth" })).toBeChecked();
      expect(screen.getByTestId("plan-picker-period-monthly")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Plan is required.");

      act(() => {
        fireEvent.click(screen.getByRole("radio", { name: "Scale" }));
      });

      expect(onChange).toHaveBeenLastCalledWith("price_scale_month");
    });

    it("draws the plan picker on Yearly before anything is picked", () => {
      const element: ReactElement | undefined = fields[1]!.getCustomElement!(
        {} as FormValues<Project>,
        { initialValue: "" },
      );

      render(<>{element}</>);

      expect(screen.getByTestId("plan-picker-period-yearly")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.queryByRole("radio", { checked: true })).toBeNull();
    });
  });
});
