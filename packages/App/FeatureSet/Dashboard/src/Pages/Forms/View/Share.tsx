import FormsCopy from "../../../Components/FormBuilder/FormsCopy";
import { isFormIpAllowlistEditableOnCurrentPlan } from "../../../Components/FormBuilder/FormPlan";
import FormShareLinkCard from "../../../Components/FormBuilder/FormShareLinkCard";
import FormStatusCard from "../../../Components/FormBuilder/FormStatusCard";
import PageComponentProps from "../../PageComponentProps";
import Form from "Common/Models/DatabaseModels/Form";
import ObjectID from "Common/Types/ObjectID";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useParams } from "react-router-dom";

/*
 * A form's Share page, top to bottom in the order someone shares a form:
 * whether it takes submissions, its link (copy, open, reset), what it says
 * after a submission, and which networks can reach it.
 */
const FormShare: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const { translateString } = useTranslateValue();

  // Turning the form on or off changes what the Share Link card says.
  const [shareLinkRefresher, setShareLinkRefresher] = useState<boolean>(false);

  /*
   * Changing the IP allowlist needs a higher plan than the form itself (as a
   * public dashboard's does). Said up front, before a save the server would
   * refuse; nothing is said when the plan allows it or is unknown.
   */
  const isIpAllowlistEditable: boolean =
    isFormIpAllowlistEditableOnCurrentPlan();

  const withPlanNote: (text: string) => string | ReactElement = (
    text: string,
  ): string | ReactElement => {
    if (isIpAllowlistEditable) {
      return text;
    }

    return (
      <>
        {translateString(text) || text}{" "}
        <span data-testid="form-ip-allowlist-plan-note">
          {translateString(FormsCopy.accessPlanNote) || FormsCopy.accessPlanNote}
        </span>
      </>
    );
  };

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

      <CardModelDetail<Form>
        name="Form > Access"
        cardProps={{
          title: "Access",
          description: withPlanNote(FormsCopy.accessDescription),
        }}
        isEditable={true}
        editButtonText={FormsCopy.editIpAllowlist}
        formFields={[
          {
            field: {
              ipWhitelist: true,
            },
            title: FormsCopy.ipAllowlistTitle,
            description: withPlanNote(FormsCopy.ipAllowlistDescription),
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Form,
          id: "model-detail-form-access",
          fields: [
            {
              field: {
                ipWhitelist: true,
              },
              title: FormsCopy.ipAllowlistTitle,
              fieldType: FieldType.Element,
              // One address or range per line, as it was written.
              getElement: (item: Form): ReactElement => {
                const allowlist: string = (item.ipWhitelist || "").trim();

                if (!allowlist) {
                  return <PlaceholderText text={FormsCopy.ipAllowlistEmpty} />;
                }

                return (
                  <div
                    className="whitespace-pre-line break-all font-mono text-sm text-gray-900"
                    data-testid="form-ip-allowlist"
                  >
                    {allowlist}
                  </div>
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default FormShare;
