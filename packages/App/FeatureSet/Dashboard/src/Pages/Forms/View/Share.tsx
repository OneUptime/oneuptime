import FormsCopy from "../../../Components/FormBuilder/FormsCopy";
import FormShareLinkCard from "../../../Components/FormBuilder/FormShareLinkCard";
import FormStatusCard from "../../../Components/FormBuilder/FormStatusCard";
import IpAllowlistSettings from "../../../Components/IpAllowlist/IpAllowlistSettings";
import PageComponentProps from "../../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useParams } from "react-router-dom";

// The test id of the form's IP allowlist entries.
export const FORM_IP_ALLOWLIST_ENTRIES_TEST_ID: string = "form-ip-allowlist";

/*
 * A form's Share page, top to bottom in the order someone shares a form:
 * whether it takes submissions, its link (copy, open, reset), what it says
 * after a submission, and which networks can reach it.
 *
 * The IP allowlist is an Enterprise feature: IpAllowlistSettings renders the
 * Enterprise card - which names the plan the allowlist needs on OneUptime
 * Cloud beside its title - or the upsell with the allowlist the form still
 * has.
 */
const FormShare: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  // Turning the form on or off changes what the Share Link card says.
  const [shareLinkRefresher, setShareLinkRefresher] = useState<boolean>(false);

  return (
    <Fragment>
      <FormStatusCard
        formId={modelId}
        onChange={() => {
          setShareLinkRefresher((previous: boolean): boolean => {
            return !previous;
          });
        }}
      />

      <FormShareLinkCard modelId={modelId} refresher={shareLinkRefresher} />

      <CardModelDetail<Form>
        name="Form > After Submitting"
        cardProps={{
          title: FormsCopy.afterSubmittingTitle,
          description: FormsCopy.afterSubmittingDescription,
        }}
        isEditable={true}
        editButtonText={FormsCopy.editSuccessMessage}
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: {
              successMessage: true,
            },
            title: FormsCopy.successMessageTitle,
            description: FormsCopy.successMessageDescription,
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            // Shown on the public page, where a private image cannot load.
            allowImageUpload: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Form,
          id: "model-detail-form-after-submitting",
          fields: [
            {
              field: {
                successMessage: true,
              },
              title: FormsCopy.successMessageTitle,
              fieldType: FieldType.Markdown,
              placeholder: FormsCopy.successMessageEmpty,
            },
          ],
          modelId: modelId,
        }}
      />

      <IpAllowlistSettings
        modelType={Form}
        modelId={modelId}
        cardName="Form > Access"
        modelDetailId="model-detail-form-access"
        title={FormsCopy.ipAllowlistTitle}
        cardTitle="Access"
        description={FormsCopy.accessDescription}
        editButtonText={FormsCopy.editIpAllowlist}
        fieldDescription={FormsCopy.ipAllowlistDescription}
        emptyText={FormsCopy.ipAllowlistEmpty}
        noAddressText={FormsCopy.ipAllowlistNoAddress}
        entriesTestId={FORM_IP_ALLOWLIST_ENTRIES_TEST_ID}
      />
    </Fragment>
  );
};

export default FormShare;
