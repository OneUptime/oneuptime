import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Alert from "Common/Models/DatabaseModels/Alert";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";

const AlertDelete: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CardModelDetail
      name="Remediation Notes"
      cardProps={{
        title: "Remediation Notes",
        description:
          "What steps should be taken to resolve this alert? Here are the remediation notes.",
      }}
      editButtonText="Edit Remediation Notes"
      isEditable={true}
      formFields={[
        {
          field: {
            remediationNotes: true,
          },
          title: "Remediation Notes",

          fieldType: FormFieldSchemaType.Markdown,
          required: true,
          placeholder: "Remediation Notes",
          description: MarkdownUtil.getMarkdownCheatsheet(
            "Add remediation notes for this alert here",
          ),
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: Alert,
        id: "model-detail-alert-remediation-notes",
        fields: [
          {
            field: {
              remediationNotes: true,
            },
            title: "Remediation Notes",
            placeholder: "No remediation notes added for this alert.",
            fieldType: FieldType.Markdown,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default AlertDelete;
