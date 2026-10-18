import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import { StatusPageOverviewCopy } from "./StatusPageOverviewCopy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * The fields of Create Status Page (the Status Pages list) and of the
 * details card's Edit dialog (a status page's Overview).
 *
 * Create asks for the name; the description and the labels have no bearing
 * on what visitors see, so they wait under More fields - as Create On-Call
 * Policy and Create Incoming Call Policy ask. The model's column help
 * ("Any friendly name of this object", "Friendly description that will help
 * you remember") is left out: the titles say it, and the placeholders show
 * an example. See StatusPageOverviewCopy for the words.
 *
 * Each form's fields are written out whole, as the form scanners of the
 * guard tests (Common/Tests/Helpers/FormStepsScan) read them.
 *
 * React-free, so tests can read the fields without rendering the page.
 */

// Create Status Page: the name, then More fields (description, labels).
export const getStatusPageCreateFormFields: () => Array<
  Field<StatusPage>
> = (): Array<Field<StatusPage>> => {
  const moreFields: FormFieldCollapsibleSection<StatusPage> =
    getAdvancedFormSection<StatusPage>();

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: StatusPageOverviewCopy.namePlaceholder,
      // The title says it; "Any friendly name of this object" says nothing more.
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
      placeholder: StatusPageOverviewCopy.descriptionPlaceholder,
      hideColumnDescription: true,
      collapsibleSection: moreFields,
    },
    getLabelsFormField<StatusPage>({
      collapsibleSection: moreFields,
    }),
  ];
};

/*
 * The details card's Edit dialog: the name and the description open - the
 * description is on the card, so it is edited where it is read - and the
 * labels folded (getLabelsFormField folds them under a section of its own).
 */
export const getStatusPageDetailsFormFields: () => Array<
  Field<StatusPage>
> = (): Array<Field<StatusPage>> => {
  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: StatusPageOverviewCopy.namePlaceholder,
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
      placeholder: StatusPageOverviewCopy.descriptionPlaceholder,
      hideColumnDescription: true,
    },
    getLabelsFormField<StatusPage>(),
  ];
};

export default getStatusPageCreateFormFields;
