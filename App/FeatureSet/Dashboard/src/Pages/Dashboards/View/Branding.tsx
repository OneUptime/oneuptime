import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const DashboardBranding: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<Dashboard>
        name="Dashboard > Branding > Title and Description"
        cardProps={{
          title: "Title and Description",
          description: "This will also be used for SEO.",
        }}
        editButtonText={"Edit"}
        isEditable={true}
        formFields={[
          {
            field: {
              pageTitle: true,
            },
            title: "Page Title",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Please enter page title here.",
          },
          {
            field: {
              pageDescription: true,
            },
            title: "Page Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Please enter page description here.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Dashboard,
          id: "model-detail-dashboard-branding",
          fields: [
            {
              field: {
                pageTitle: true,
              },
              fieldType: FieldType.Text,
              title: "Page Title",
              placeholder: "No page title entered so far.",
            },
            {
              field: {
                pageDescription: true,
              },
              fieldType: FieldType.Text,
              title: "Page Description",
              placeholder: "No page description entered so far.",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<Dashboard>
        name="Dashboard > Branding > Logo"
        cardProps={{
          title: "Logo",
          description:
            "Logo will be displayed on the public dashboard header.",
        }}
        isEditable={true}
        editButtonText={"Edit Logo"}
        formFields={[
          {
            field: {
              logoFile: true,
            },
            title: "Logo",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload Logo.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Dashboard,
          id: "model-detail-dashboard-logo",
          fields: [
            {
              field: {
                logoFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Logo",
              placeholder: "No logo uploaded.",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<Dashboard>
        name="Dashboard > Branding > Favicon"
        cardProps={{
          title: "Favicon",
          description: "Favicon will be used for SEO.",
        }}
        isEditable={true}
        editButtonText={"Edit Favicon"}
        formFields={[
          {
            field: {
              faviconFile: true,
            },
            title: "Favicon",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload Favicon.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Dashboard,
          id: "model-detail-dashboard-favicon",
          fields: [
            {
              field: {
                faviconFile: {
                  file: true,
                  fileType: true,
                },
              },
              fieldType: FieldType.ImageFile,
              title: "Favicon",
              placeholder: "No favicon uploaded.",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default DashboardBranding;
