import FormSignInCopy, {
  FORM_REQUIRE_SIGN_IN_SWITCH_TEST_ID,
} from "./FormSignInCopy";
import Form from "Common/Models/DatabaseModels/Form";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Who Can Open This Form", on the form's Share page (#10249): one switch,
 * Only people who sign in, that saves the moment it is flipped. Turning it
 * on asks first: from then on visitors who are not the form's private users,
 * and whom its single sign-on does not let in, can no longer open or submit
 * it. Turning it off saves at once: it opens the form to anyone with the
 * link again, as it was.
 */

export interface ComponentProps {
  formId: ObjectID;
}

export const getFormSignInConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: FormSignInCopy.confirmTitle,
    description: FormSignInCopy.confirmDescription,
    submitButtonText: FormSignInCopy.confirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const FormSignInCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Form>
      modelType={Form}
      modelId={props.formId}
      column="requireSignIn"
      cardTitle={FormSignInCopy.cardTitle}
      title={FormSignInCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? FormSignInCopy.onDescription
          : FormSignInCopy.offDescription;
      }}
      note={FormSignInCopy.note}
      getConfirmation={getFormSignInConfirmation}
      dataTestId={FORM_REQUIRE_SIGN_IN_SWITCH_TEST_ID}
    />
  );
};

export default FormSignInCard;
