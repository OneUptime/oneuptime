import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Title and Description"
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
          modelType: StatusPage,
          id: "model-detail-status-page",
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

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Search Engine Indexing"
        cardProps={{
          title: "Search Engine Indexing",
          description:
            "Control whether search engines like Google and Bing are allowed to list this status page in their results.",
        }}
        editButtonText={"Edit"}
        isEditable={true}
        formFields={[
          {
            field: {
              enableSearchEngineIndexing: true,
            },
            title: "Allow Search Engines to Index this Status Page",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "On by default. Turn this off to keep the page reachable by anyone with the link while keeping it out of search results - OneUptime then serves the page with a noindex, nofollow robots directive. Search engines can take a few weeks to drop a page they have already indexed.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page-search-engine-indexing",
          fields: [
            {
              field: {
                enableSearchEngineIndexing: true,
              },
              fieldType: FieldType.Boolean,
              title: "Allow Search Engines to Index this Status Page",
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Favicon"
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
          modelType: StatusPage,
          id: "model-detail-status-page",
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

export default StatusPageDelete;
