import Field from "../Types/Field";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";
import { FormStep } from "../Types/FormStep";
import FormValues from "../Types/FormValues";
import Validation from "../Validation";
import Dictionary from "../../../../Types/Dictionary";
import GenericObject from "../../../../Types/GenericObject";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A stepped form can be finished as soon as every step left is optional.
 *
 * "Reduce decision / choice paralysis as much as possible: show people as
 * few options as possible ... and have sane defaults." - the maintainer,
 * closing the feedback document. Long forms walk steps (PR #4192), and a
 * create wizard used to make every one of them a click: Declare Incident
 * walked Resources Affected, Incident Roles, On-Call and More even when the
 * title and the severity were all the incident needed, and a status page
 * visitor clicked Next to a Preferences step whose answers ("all resources",
 * "every kind of event") were already ticked.
 *
 * So while every step after the one on screen already holds valid answers,
 * the form's main button is its action ("Declare Incident", "Subscribe"),
 * and a plain Next beside it walks on for anyone who wants the rest. The
 * action submits through BasicForm.submitAllSteps, which checks every step
 * and opens the first one with a problem. Steps not reached yet stay closed
 * in the step list, and there is still no Back button (b61a6b656d).
 *
 * A step holding a custom element counts as unfinished until it has been
 * shown, unless its field says customElementCanBeSkipped. A custom element
 * can write a value of its own when it first shows - the default criteria of
 * a monitor's type, a rule's conditions, a discovery scan's SNMP settings -
 * or be something to read before saving (the Free plan's pay-as-you-go
 * notice), and the form cannot tell which until it draws it. Skipping one of
 * those would save the record without that value, so the form walks to it.
 */

export type CanFinishFormFromStepFunction = <T extends GenericObject>(data: {
  // The steps the user walks, in order: the ones their showIf leaves out are not here.
  steps: ReadonlyArray<FormStep<T>>;
  currentStepId: string | null;
  // The form's fields, each with its name.
  fields: ReadonlyArray<Field<T>>;
  values: FormValues<T>;
  // The steps the form has shown so far.
  shownStepIds: ReadonlyArray<string>;
  onValidate?: ((values: FormValues<T>) => JSONObject) | undefined;
}) => boolean;

type IsFieldShownFunction = <T extends GenericObject>(
  field: Field<T>,
  values: FormValues<T>,
) => boolean;

const isFieldShown: IsFieldShownFunction = <T extends GenericObject>(
  field: Field<T>,
  values: FormValues<T>,
): boolean => {
  return !field.showIf || field.showIf(values);
};

type GetFieldNameFunction = <T extends GenericObject>(
  field: Field<T>,
) => string;

const getFieldName: GetFieldNameFunction = <T extends GenericObject>(
  field: Field<T>,
): string => {
  return (
    field.name ||
    field.overrideFieldKey ||
    (Object.keys(field.field || {})[0] as string) ||
    ""
  );
};

/*
 * A custom element the form has not drawn yet, that the form cannot finish
 * without drawing - see the note at the top.
 */
export const isCustomElementToShowBeforeFinishing: IsFieldShownFunction = <
  T extends GenericObject,
>(
  field: Field<T>,
  values: FormValues<T>,
): boolean => {
  return (
    field.fieldType === FormFieldSchemaType.CustomComponent &&
    !field.customElementCanBeSkipped &&
    isFieldShown(field, values)
  );
};

/*
 * Whether every step other than the one on screen is finished: each of its
 * fields that shows passes validation, and a step not shown yet holds no
 * custom element the form has to draw first. The step on screen is not
 * judged - its fields are in front of the user, and the action checks them
 * the moment it is pressed. Nothing is marked touched and no error is shown:
 * this only decides what the form's buttons say.
 */
export const canFinishFormFromStep: CanFinishFormFromStepFunction = <
  T extends GenericObject,
>(data: {
  steps: ReadonlyArray<FormStep<T>>;
  currentStepId: string | null;
  fields: ReadonlyArray<Field<T>>;
  values: FormValues<T>;
  shownStepIds: ReadonlyArray<string>;
  onValidate?: ((values: FormValues<T>) => JSONObject) | undefined;
}): boolean => {
  if (data.steps.length === 0 || !data.currentStepId) {
    return false;
  }

  const currentStepId: string = data.currentStepId;

  const isCurrentStepWalked: boolean = data.steps.some(
    (step: FormStep<T>): boolean => {
      return step.id === currentStepId;
    },
  );

  if (!isCurrentStepWalked) {
    return false;
  }

  const otherSteps: Array<FormStep<T>> = data.steps.filter(
    (step: FormStep<T>): boolean => {
      return step.id !== currentStepId;
    },
  );

  const otherStepIds: Set<string> = new Set<string>(
    otherSteps.map((step: FormStep<T>): string => {
      return step.id;
    }),
  );

  const fieldsOnOtherSteps: Array<Field<T>> = data.fields
    .filter((field: Field<T>): boolean => {
      return Boolean(field.stepId) && otherStepIds.has(field.stepId as string);
    })
    .map((field: Field<T>): Field<T> => {
      // Validation names each error after its field.
      return field.name ? field : { ...field, name: getFieldName(field) };
    });

  // A step not shown yet, holding an element that has to be drawn first.
  for (const step of otherSteps) {
    if (data.shownStepIds.includes(step.id)) {
      continue;
    }

    const holdsElementToShow: boolean = fieldsOnOtherSteps.some(
      (field: Field<T>): boolean => {
        return (
          field.stepId === step.id &&
          isCustomElementToShowBeforeFinishing(field, data.values)
        );
      },
    );

    if (holdsElementToShow) {
      return false;
    }
  }

  const fieldErrors: Dictionary<string> = Validation.validate<T>({
    values: data.values,
    formFields: fieldsOnOtherSteps,
    currentFormStepId: null,
    onValidate: undefined,
  });

  if (Object.keys(fieldErrors).length > 0) {
    return false;
  }

  if (!data.onValidate) {
    return true;
  }

  /*
   * The form's own check answers for the whole form. An error it pins on a
   * field of the step on screen is the user's to fix there; any other - on
   * another step, or on no field at all - is one the action would stop at.
   */
  const fieldNamesOnCurrentStep: Set<string> = new Set<string>(
    data.fields
      .filter((field: Field<T>): boolean => {
        return field.stepId === currentStepId;
      })
      .map((field: Field<T>): string => {
        return getFieldName(field);
      }),
  );

  const formErrors: JSONObject = data.onValidate(data.values) || {};

  return Object.keys(formErrors).every((key: string): boolean => {
    return fieldNamesOnCurrentStep.has(key);
  });
};

/*
 * What a stepped form's footer offers on the step on screen.
 */
export interface SteppedFormFooter {
  // What the main button says: the form's action, or "Next".
  primaryButtonText: string;
  /*
   * The main button finishes the form from here: BasicForm.submitAllSteps,
   * which checks every step and opens the first one with a problem. Otherwise
   * it is BasicForm.submitForm - check this step, then walk on, or submit on
   * the last step.
   */
  primaryButtonSubmitsAllSteps: boolean;
  // A plain Next beside the main button (BasicForm.submitForm).
  showNextButton: boolean;
}

export const NEXT_BUTTON_TEXT: string = "Next";

export type GetSteppedFormFooterFunction = (data: {
  hasSteps: boolean;
  isOnLastStep: boolean;
  // canFinishFormFromStep, for the step on screen.
  canFinishFromCurrentStep: boolean;
  /*
   * An edit form: every step is filled in already, so it saves from any
   * step whatever the steps hold (ModelFormModal's Update forms,
   * BasicFormModal's saveFromAnyStep).
   */
  savesFromAnyStep?: boolean | undefined;
  // The form's action: "Declare Incident", "Save Changes".
  actionText: string;
}) => SteppedFormFooter;

export const getSteppedFormFooter: GetSteppedFormFooterFunction = (data: {
  hasSteps: boolean;
  isOnLastStep: boolean;
  canFinishFromCurrentStep: boolean;
  savesFromAnyStep?: boolean | undefined;
  actionText: string;
}): SteppedFormFooter => {
  if (!data.hasSteps) {
    return {
      primaryButtonText: data.actionText,
      primaryButtonSubmitsAllSteps: false,
      showNextButton: false,
    };
  }

  if (data.savesFromAnyStep) {
    return {
      primaryButtonText: data.actionText,
      primaryButtonSubmitsAllSteps: true,
      showNextButton: !data.isOnLastStep,
    };
  }

  if (data.isOnLastStep) {
    return {
      primaryButtonText: data.actionText,
      primaryButtonSubmitsAllSteps: false,
      showNextButton: false,
    };
  }

  if (data.canFinishFromCurrentStep) {
    return {
      primaryButtonText: data.actionText,
      primaryButtonSubmitsAllSteps: true,
      showNextButton: true,
    };
  }

  return {
    primaryButtonText: NEXT_BUTTON_TEXT,
    primaryButtonSubmitsAllSteps: false,
    showNextButton: false,
  };
};
