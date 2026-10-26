import Project from "../../../Models/DatabaseModels/Project";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import {
  BillingPeriod,
  getDefaultPlanIdForNewProject,
} from "../../../Types/Billing/SubscriptionPlanPricing";
import PlanPicker from "../Billing/PlanPicker/PlanPicker";
import Field, { CustomElementProps } from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import { getAdvancedFormSection } from "../Forms/Utils/AdvancedFormSection";
import {
  isProjectNameServerError,
  isPromoCodeServerError,
} from "./CreateProjectServerErrors";
import React, { ReactElement } from "react";

/*
 * The fields of every form that creates a project: the Dashboard's Create
 * New Project dialog (project picker, and the welcome page after sign-up)
 * and the Admin Dashboard's Projects page.
 *
 * One page, whatever the deployment. The maintainer asked for this dialog
 * to be easier to understand, with the promo code hidden away. It used to
 * walk two steps - Basic, then Select Plan - for three fields, with a stack
 * of plan cards, a "Yearly Plan (Save 20%)" switch under them and a promo
 * code box nearly everyone leaves empty. Now:
 *
 *   - Project Name;
 *   - on OneUptime Cloud (billing on), the plan, as one calm comparison
 *     with the billing period above it and what the picked plan costs, and
 *     when, under it (PlanPicker). Free is picked to start with: nobody is
 *     put on a paid plan, or its trial, without choosing it;
 *   - the promo code, folded under More fields (getAdvancedFormSection),
 *     where its name still shows on the folded header, and a code that came
 *     with the sign-up link shows as set.
 *
 * A promo code the server refuses, or a name another of the reader's
 * projects has, is said under its field (Field.ownsServerError): More
 * fields opens on the refused code, which can be changed or cleared there.
 *
 * A name needs two characters, like every other name in the product: a
 * minimum of four (client-side only) refused real teams and companies -
 * "IBM", "Ops", "QA".
 *
 * Self-hosted (billing off), the form is the name alone.
 */

export interface CreateProjectFormFieldsOptions {
  isBillingEnabled: boolean;
  // The plans this deployment sells (SUBSCRIPTION_PLAN_*), in their order.
  plans: Array<SubscriptionPlan>;
}

/*
 * The fewest characters a project's name takes: two, as every other name in
 * the product (a state, a policy, a rule) - "IBM", "QA" and "Ops" are names.
 */
export const PROJECT_NAME_MIN_LENGTH: number = 2;

// The period the plan picker opens on: yearly, as on the pricing page.
export const CREATE_PROJECT_INITIAL_BILLING_PERIOD: BillingPeriod =
  BillingPeriod.Yearly;

export const getCreateProjectFormFields: (
  options: CreateProjectFormFieldsOptions,
) => Array<Field<Project>> = (
  options: CreateProjectFormFieldsOptions,
): Array<Field<Project>> => {
  const nameField: Field<Project> = {
    field: {
      name: true,
    },
    title: "Project Name",
    description: "Such as your company or team name. You can change it later.",
    placeholder: "My Project",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    validation: {
      minLength: PROJECT_NAME_MIN_LENGTH,
    },
    ownsServerError: isProjectNameServerError,
  };

  if (!options.isBillingEnabled) {
    return [nameField];
  }

  const defaultPlanId: string | null = getDefaultPlanIdForNewProject(
    options.plans,
    CREATE_PROJECT_INITIAL_BILLING_PERIOD,
  );

  const planField: Field<Project> = {
    field: {
      paymentProviderPlanId: true,
    },
    title: "Plan",
    fieldType: FormFieldSchemaType.CustomComponent,
    // The picker draws "Plan" itself, with the Monthly | Yearly switch beside it.
    customElementDrawsOwnLabel: true,
    required: true,
    getCustomElement: (
      _values: FormValues<Project>,
      props: CustomElementProps,
    ): ReactElement => {
      return (
        <PlanPicker
          plans={options.plans}
          value={(props.initialValue as string) || ""}
          initialPeriod={CREATE_PROJECT_INITIAL_BILLING_PERIOD}
          error={props.error}
          onChange={(planId: string) => {
            props.onChange?.(planId);
          }}
        />
      );
    },
  };

  if (defaultPlanId) {
    planField.defaultValue = defaultPlanId;
  }

  const promoCodeField: Field<Project> = {
    field: {
      paymentProviderPromoCode: true,
    },
    title: "Promo Code",
    description: "If you have one, from an offer or a reseller.",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    collapsibleSection: getAdvancedFormSection<Project>(),
    ownsServerError: isPromoCodeServerError,
  };

  return [nameField, planField, promoCodeField];
};
