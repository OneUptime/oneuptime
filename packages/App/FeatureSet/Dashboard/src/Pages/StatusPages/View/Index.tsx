import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import StatusPagePreviewLink from "./StatusPagePreviewLink";
import StatusPageFirstStep from "../../../Components/StatusPage/StatusPageFirstStep";
import { getStatusPageDetailsFormFields } from "../../../Components/StatusPage/StatusPageCreateForm";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
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
      {/*
       * While the page shows no monitors, the one next step comes first:
       * visitors see no status until monitors are added on Resources.
       */}
      <StatusPageFirstStep statusPageId={modelId} />

      <StatusPagePreviewLink modelId={modelId} />

      <CardModelDetail<StatusPage>
        name="Status Page > Status Page Details"
        cardProps={{
          title: "Status Page Details",
        }}
        isEditable={true}
        formFields={getStatusPageDetailsFormFields()}
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
              /*
               * The card is the status page's details: "Name" says it,
               * as on every other details card.
               */
              title: "Name",
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
