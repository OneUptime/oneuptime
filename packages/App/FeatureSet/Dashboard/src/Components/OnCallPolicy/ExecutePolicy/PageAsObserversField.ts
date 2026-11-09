import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { translationKey } from "Common/Types/Translator";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * EXECUTE ON-CALL POLICY, AS OBSERVERS (OnCallObserverPage).
 *
 * The Execute On-Call Policy form on an incident's, an alert's or an
 * episode's feed pages the policy's people as responders, as it always has.
 * Switched on, they are paged as observers instead: kept informed while the
 * people responding stay on it, and their answer only says they have seen
 * it - the record is not acknowledged, and nobody else's page stops. One
 * switch, off until turned on, shared by the four forms so they say it in
 * the same words.
 */

export const PAGE_AS_OBSERVERS_TITLE: string = translationKey(
  "Page them as observers",
);

export const PAGE_AS_OBSERVERS_DESCRIPTION: string = translationKey(
  "Kept informed while others respond: their answer only says they've seen it, and nothing is acknowledged.",
);

export const getPageAsObserversField: () => ModelField<OnCallDutyPolicyExecutionLog> =
  (): ModelField<OnCallDutyPolicyExecutionLog> => {
    return {
      field: {
        isObserverPage: true,
      },
      title: PAGE_AS_OBSERVERS_TITLE,
      description: PAGE_AS_OBSERVERS_DESCRIPTION,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: false,
    };
  };
