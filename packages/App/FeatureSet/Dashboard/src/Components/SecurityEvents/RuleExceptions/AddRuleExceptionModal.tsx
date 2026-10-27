import { ADD_EXCEPTION_TITLE } from "./RuleExceptionsCopy";
import {
  RULE_EXCEPTION_FORM_STEPS,
  getRuleExceptionFormFields,
  getRuleExceptionWindowDefaults,
} from "./RuleExceptionFormFields";
import { getRuleExceptionInitialValues } from "./RuleExceptionsModel";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import OneUptimeDate from "Common/Types/Date";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  // The rule that skips it: the rule's row, or the detection's rule.
  detectionRuleId?: string | undefined;
  // From a case's detection: the entity it is about, to start with.
  entity?: SecurityEntity | null | undefined;
  // A line under the title, saying where it was opened from.
  description?: string | undefined;
  onClose: () => void;
  onSuccess: (exception: DetectionRuleException) => void;
}

/*
 * ADD EXCEPTION, opened from a rule's row or a case's detection: the same
 * form as Security Events > Rule Exceptions (RuleExceptionFormFields),
 * starting with the rule - and, from a detection, the entity it is about -
 * so tuning a rule that fired on something expected takes a reason and a
 * click.
 */
const AddRuleExceptionModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Read once: the form keeps what it starts with while it is open.
  const initialValues: FormValues<DetectionRuleException> = useMemo(() => {
    return {
      ...getRuleExceptionInitialValues({
        detectionRuleId: props.detectionRuleId,
        entity: props.entity,
      }),
      ...getRuleExceptionWindowDefaults(OneUptimeDate.getCurrentDate()),
    } as FormValues<DetectionRuleException>;
  }, []);

  return (
    <ModelFormModal<DetectionRuleException>
      title={ADD_EXCEPTION_TITLE}
      description={props.description}
      modelType={DetectionRuleException}
      name="Add Rule Exception"
      submitButtonText={ADD_EXCEPTION_TITLE}
      initialValues={initialValues}
      onClose={props.onClose}
      onSuccess={(exception: DetectionRuleException) => {
        props.onSuccess(exception);
      }}
      formProps={{
        name: "rule-exception-add",
        modelType: DetectionRuleException,
        id: "rule-exception-add",
        formType: FormType.Create,
        steps: RULE_EXCEPTION_FORM_STEPS,
        fields: getRuleExceptionFormFields({ translator }),
      }}
    />
  );
};

export default AddRuleExceptionModal;
