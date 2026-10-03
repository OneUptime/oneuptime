import MonitorStatuesElement from "../../../Components/MonitorStatus/MonitorStatusesElement";
import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ExportModelCard from "Common/UI/Components/ImportExport/ExportModelCard";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import StatusPageDisplaySettingsCard from "../../../Components/StatusPage/StatusPageDisplaySettingsCard";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import { STATUS_PAGE_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * Advanced -> Advanced Settings: what the status page shows, then the things
 * done to the page as a whole - export and archive - as on a monitor's, a
 * workflow's, a dashboard's or an on-call policy's Settings page.
 *
 * What the page shows was six cards here, each behind its own Edit button
 * (and the incidents one a two-step dialog); it is one card now, whose
 * switches and numbers save as they are changed. Whether the page shows a
 * Subscribe link, and which channels visitors can use there, are switched in
 * one place: the Channels card on Subscribers -> Subscriber Settings.
 */
const StatusPageSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <StatusPageDisplaySettingsCard statusPageId={modelId} />

      {/*
       * The overall uptime % and the statuses that count as downtime were on
       * Branding's Overview Page screen, which is gone (its branding is on
       * the one Branding page). They are about what the page shows, so they
       * are here, as they were, until they become rows of the card above.
       */}
      <CardModelDetail<StatusPage>
        name="Status Page > Settings"
        cardProps={{
          title: "Overall Uptime Percent",
          description: "Settings for overall uptime percent on status page",
        }}
        editButtonText="Edit Settings"
        isEditable={true}
        formFields={[
          {
            field: {
              showOverallUptimePercentOnStatusPage: true,
            },
            title: "Show Overall Uptime Percent",
            description:
              "Show or hide the overall uptime percent on the status page",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder: "No",
          },
          {
            field: {
              overallUptimePercentPrecision: true,
            },
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(UptimePrecision),
            showIf: (item: FormValues<StatusPage>): boolean => {
              return Boolean(item.showOverallUptimePercentOnStatusPage);
            },
            title: "Select Uptime Precision",
            defaultValue: UptimePrecision.TWO_DECIMAL,
            required: true,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                showOverallUptimePercentOnStatusPage: true,
              },
              fieldType: FieldType.Boolean,
              title: "Show Overall Uptime Percent",
            },

            {
              field: {
                overallUptimePercentPrecision: true,
              },
              title: "Overall Uptime Precision",
              fieldType: FieldType.Text,
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<StatusPage>
        name="Status Page > Branding > Downtime Monitor Statuses"
        cardProps={{
          title: "Downtime Monitor Statuses",
          description:
            "These monitor statuses are be considered as down when we calculate uptime %.",
        }}
        isEditable={true}
        editButtonText={"Edit Statuses"}
        formFields={[
          {
            field: {
              downtimeMonitorStatuses: true,
            },
            title: "These monitor statuses are considered as down",
            description:
              "These monitor statuses are be considered as down when we calculate uptime %.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: MonitorStatus,
              labelField: "name",
              valueField: "_id",
              sort: {
                priority: SortOrder.Ascending,
              },
            },
            required: true,
            placeholder: "Select monitor statuses",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "downtime-monitor-statuses",
          fields: [
            {
              field: {
                downtimeMonitorStatuses: {
                  _id: true,
                  name: true,
                  color: true,
                },
              },
              title: "Downtime Monitor Statuses",
              description:
                "These monitor statuses are be considered as down when we calculate uptime %",
              fieldType: FieldType.EntityArray,
              getElement: (item: StatusPage): ReactElement => {
                if (item["downtimeMonitorStatuses"]) {
                  return (
                    <MonitorStatuesElement
                      shouldAnimate={false}
                      monitorStatuses={
                        (item[
                          "downtimeMonitorStatuses"
                        ] as Array<MonitorStatus>) || []
                      }
                    />
                  );
                }

                return <></>;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/*
       * The page's JSON export lived on a page no menu linked to. The status
       * page list can export several at once; this is the one-page export
       * every other resource keeps on its Settings page.
       */}
      <ExportModelCard modelId={modelId} modelType={StatusPage} />

      {/*
       * Last on the page: taking the page offline is a decision about the
       * page as a whole, not one more thing it shows.
       */}
      <ArchiveResourceCard<StatusPage>
        modelType={StatusPage}
        modelId={modelId}
        singularName={STATUS_PAGE_ARCHIVE_COPY.singularName}
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STATUS_PAGES] as Route,
        )}
        archiveCardDescription={STATUS_PAGE_ARCHIVE_COPY.archiveCardDescription}
        unarchiveCardDescription={
          STATUS_PAGE_ARCHIVE_COPY.unarchiveCardDescription
        }
        archiveConfirmMessage={STATUS_PAGE_ARCHIVE_COPY.archiveConfirmMessage}
        unarchiveConfirmMessage={
          STATUS_PAGE_ARCHIVE_COPY.unarchiveConfirmMessage
        }
      />
    </Fragment>
  );
};

export default StatusPageSettings;
