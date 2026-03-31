import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import MonitorMetricsElement from "../../../Components/Monitor/MonitorMetrics";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement, useState } from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";
import Includes from "Common/Types/BaseDatabase/Includes";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { Black } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

const MonitorMetrics: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [_currentTab, setCurrentTab] = useState<Tab | null>(null);

  const incidentQuery: Query<Incident> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    monitors: new Includes([modelId]),
  };

  const alertQuery: Query<Alert> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    monitor: modelId,
  };

  const tabs: Array<Tab> = [
    {
      name: "Monitor Metrics",
      children: <MonitorMetricsElement monitorId={modelId} />,
    },
    {
      name: "Incidents",
      children: (
        <IncidentsTable
          query={incidentQuery}
          noItemsMessage="No incidents found for this monitor."
          title="Monitor Incidents"
          description="Incidents associated with this monitor."
        />
      ),
    },
    {
      name: "Alerts",
      children: (
        <AlertsTable
          query={alertQuery}
          noItemsMessage="No alerts found for this monitor."
          title="Monitor Alerts"
          description="Alerts associated with this monitor."
          createInitialValues={{
            monitor: modelId,
          }}
        />
      ),
    },
    {
      name: "Status Timeline",
      children: (
        <ModelTable<MonitorStatusTimeline>
          modelType={MonitorStatusTimeline}
          id="table-monitor-status-timeline"
          name="Monitor > Status Timeline"
          userPreferencesKey="monitor-status-timeline-table"
          isDeleteable={true}
          showViewIdButton={true}
          isCreateable={true}
          isViewable={false}
          query={{
            monitorId: modelId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          sortBy="startsAt"
          sortOrder={SortOrder.Descending}
          onBeforeCreate={(
            item: MonitorStatusTimeline,
          ): Promise<MonitorStatusTimeline> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }
            item.monitorId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);
            return Promise.resolve(item);
          }}
          cardProps={{
            title: "Status Timeline",
            description: "Here is the status timeline for this monitor",
          }}
          noItemsMessage={
            "No status timeline created for this monitor so far."
          }
          formFields={[
            {
              field: {
                monitorStatus: true,
              },
              title: "Monitor Status",
              fieldType: FormFieldSchemaType.Dropdown,
              required: true,
              placeholder: "Monitor Status",
              dropdownModal: {
                type: MonitorStatus,
                labelField: "name",
                valueField: "_id",
              },
            },
            {
              field: {
                startsAt: true,
              },
              title: "Starts At",
              fieldType: FormFieldSchemaType.DateTime,
              required: true,
              placeholder: "Starts At",
              getDefaultValue: () => {
                return OneUptimeDate.getCurrentDate();
              },
            },
          ]}
          showRefreshButton={true}
          viewPageRoute={Navigation.getCurrentRoute()}
          filters={[
            {
              field: {
                monitorStatus: {
                  name: true,
                },
              },
              title: "Monitor Status",
              type: FieldType.Entity,
              filterEntityType: MonitorStatus,
              filterQuery: {
                projectId: ProjectUtil.getCurrentProjectId()!,
              },
              filterDropdownField: {
                label: "name",
                value: "_id",
              },
            },
            {
              field: {
                startsAt: true,
              },
              title: "Starts At",
              type: FieldType.Date,
            },
            {
              field: {
                endsAt: true,
              },
              title: "Ends At",
              type: FieldType.Date,
            },
          ]}
          columns={[
            {
              field: {
                monitorStatus: {
                  name: true,
                  color: true,
                },
              },
              title: "Monitor Status",
              type: FieldType.Text,
              getElement: (item: MonitorStatusTimeline): ReactElement => {
                if (!item["monitorStatus"]) {
                  throw new BadDataException("Monitor Status not found");
                }

                return (
                  <Statusbubble
                    color={item.monitorStatus.color || Black}
                    shouldAnimate={false}
                    text={item.monitorStatus.name || "Unknown"}
                  />
                );
              },
            },
            {
              field: {
                startsAt: true,
              },
              title: "Starts At",
              type: FieldType.DateTime,
            },
            {
              field: {
                endsAt: true,
              },
              title: "Ends At",
              type: FieldType.DateTime,
              noValueMessage: "Currently Active",
            },
            {
              field: {
                endsAt: true,
              },
              title: "Duration",
              type: FieldType.Text,
              getElement: (item: MonitorStatusTimeline): ReactElement => {
                return (
                  <p>
                    {OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
                      item["startsAt"] as Date,
                      (item["endsAt"] as Date) || OneUptimeDate.getCurrentDate(),
                    )}
                  </p>
                );
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <Tabs
        tabs={tabs}
        onTabChange={(tab: Tab) => {
          setCurrentTab(tab);
        }}
      />
    </Fragment>
  );
};

export default MonitorMetrics;
