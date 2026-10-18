import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE INCOMING CALL POLICIES LIST, AND CREATING ONE.
 *
 * The list said "Configure incoming call routing policies for your on-call
 * teams. Purchase phone numbers and set up escalation rules." and, empty,
 * "No incoming call policy found" - the words of a search that missed - and
 * the create form asked for a name ("Any friendly name of this policy") and
 * a description ("Friendly description that will help you remember") before
 * folding the labels away. A new policy then stayed in the list, with
 * "Setup Needed" in its row, for somebody to open.
 *
 * Now the list says what a policy is for, an empty list says "No incoming
 * call policies yet" with the Create button, as every list does, and its ⋯
 * menu (and its empty state) links to the docs page that explains the whole
 * set-up - the policy's own Documentation page that repeated it is gone. The
 * form asks for the name, as Create On-Call Policy does, with the
 * description and the labels under More fields; and a new policy opens on
 * its Overview, where its Setup card walks through what it still needs.
 *
 * React-free, so tests can read the fields without rendering the page.
 */

export const INCOMING_CALL_POLICIES_CARD_DESCRIPTION: string = translationKey(
  "Phone numbers people can call to reach whoever is on call.",
);

export const INCOMING_CALL_POLICY_DOCS_PATH: string =
  "/docs/on-call/incoming-call-policy";

export const getIncomingCallPolicyCreateFormFields: () => Array<
  Field<IncomingCallPolicy>
> = (): Array<Field<IncomingCallPolicy>> => {
  const moreFields: FormFieldCollapsibleSection<IncomingCallPolicy> =
    getAdvancedFormSection<IncomingCallPolicy>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "e.g., Production Support Hotline",
      // The title says it; the column's "Any friendly name" says nothing more.
      hideColumnDescription: true,
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Description of this incoming call policy",
      hideColumnDescription: true,
      collapsibleSection: moreFields,
    },
    getLabelsFormField<IncomingCallPolicy>({
      collapsibleSection: moreFields,
    }),
  ];
};
