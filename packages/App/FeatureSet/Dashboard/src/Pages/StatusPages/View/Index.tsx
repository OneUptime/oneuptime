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
import UsedByCard from "../../../Components/UsedBy/UsedByCard";
import SetupHealthRecordFindings from "../../../Components/SetupHealth/SetupHealthRecordFindings";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import {
  SetupHealthCheck,
  SetupHealthRecordKind,
} from "Common/Types/SetupHealth/SetupHealth";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * What the status page's Overview says already, so Setup Health's line
 * leaves it out: its first step says it shows no monitors yet.
 */
export const STATUS_PAGE_OVERVIEW_SAYS: ReadonlyArray<SetupHealthCheck> = [
  SetupHealthCheck.StatusPageShowsNoMonitor,
];

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

      {/*
       * Setup Health's findings about this page (#7297): a custom domain
       * that does not open it, by its CNAME record or its certificate,
       * which only its Custom Domains page says otherwise.
       */}
      <SetupHealthRecordFindings
        recordKind={SetupHealthRecordKind.StatusPage}
        recordId={modelId}
        saidByThisPage={STATUS_PAGE_OVERVIEW_SAYS}
      />

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
              // Your team's, not what visitors read (#9130).
              title: "Internal Description",
            },
          ],
          modelId: modelId,
        }}
      />

      {/*
       * "Showing now" (#6813): the open incidents and the maintenance
       * coming up or in progress that visitors see on this page, each a
       * link to its own.
       */}
      <UsedByCard recordKind={UsedByRecordKind.StatusPage} recordId={modelId} />

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
