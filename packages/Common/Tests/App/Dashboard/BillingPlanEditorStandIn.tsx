import React, { ReactElement, useState } from "react";
import { CustomElementProps } from "../../../UI/Components/Forms/Types/Field";

/*
 * The Billing page's Current Plan card (CardModelDetail), drawn as its
 * Change Plan dialog's one field: the real plan field the page hands it -
 * the shared plan picker, through its getCustomElement - holding the plan
 * the project is on, as the dialog's form does, and the field's footer
 * under it. The suites that read what the dialog offers mock CardModelDetail
 * with this (jest.mock(..., () => require("./BillingPlanEditorStandIn"))).
 *
 * The plan the project is on is the one the suite last gave
 * setPlanEditorProjectPlan, as the dialog would load it from the project.
 */

let projectPlanId: string = "";

export const setPlanEditorProjectPlan: (planId: string | null) => void = (
  planId: string | null,
): void => {
  projectPlanId = planId || "";
};

interface PlanField {
  getCustomElement?:
    | ((values: unknown, props: CustomElementProps) => ReactElement)
    | undefined;
  footerElement?: ReactElement | undefined;
}

interface StandInProps {
  cardProps: { title: string };
  editModalTitle?: string | undefined;
  formFields?: Array<PlanField> | undefined;
}

const PlanEditor: (props: { field: PlanField }) => ReactElement = (props: {
  field: PlanField;
}): ReactElement => {
  const [value, setValue] = useState<string>(projectPlanId);

  return (
    <section aria-label="Plan options">
      {props.field.getCustomElement ? (
        props.field.getCustomElement({}, {
          initialValue: value,
          onChange: (next: unknown) => {
            setValue(String(next));
          },
        } as CustomElementProps)
      ) : (
        <></>
      )}
      <div data-testid="plan-footer">{props.field.footerElement}</div>
      <p data-testid="plan-editor-value">{value}</p>
    </section>
  );
};

const BillingPlanEditorStandIn: (props: StandInProps) => ReactElement = (
  props: StandInProps,
): ReactElement => {
  if (props.cardProps.title !== "Current Plan") {
    return <></>;
  }

  const field: PlanField | undefined = props.formFields?.[0];

  return (
    <div data-testid="plan-editor" data-title={props.editModalTitle || ""}>
      {field ? <PlanEditor field={field} /> : <></>}
    </div>
  );
};

export default BillingPlanEditorStandIn;
