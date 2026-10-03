import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import StatusPagePreviewLink from "./StatusPagePreviewLink";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <StatusPagePreviewLink modelId={modelId} />

      {/* StatusPage View  */}
      <CardModelDetail<StatusPage>
        name="Status Page > Status Page Details"
        cardProps={{
          title: "Status Page Details",
          description: "Here are more details for this status page.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Status Page Name",
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
            placeholder: "Description",
          },
          getLabelsFormField<StatusPage>(),
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Status Page ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Status Page Name",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: StatusPage): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />

      <OverviewCustomFields
        modelId={modelId}
        modelType={StatusPage}
        customFieldType={StatusPageCustomField}
        resourceName="Status Page"
      />
    </Fragment>
  );
};

export default StatusPageView;
