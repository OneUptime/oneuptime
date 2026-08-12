import DependencySuppressionWarning from "../../../Components/Monitor/DependencySuppressionWarning";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import MonitorsElement from "../../../Components/Monitor/Monitors";
import MonitorStatusesElement from "../../../Components/MonitorStatus/MonitorStatusesElement";
import PageComponentProps from "../../PageComponentProps";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const MonitorDependencies: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} refreshToggle={refreshToggle} />
      <DependencySuppressionWarning
        monitorId={modelId}
        refreshToggle={refreshToggle}
      />
      <CardModelDetail<Monitor>
        name="Monitor Dependencies"
        editButtonText="Edit Dependencies"
        cardProps={{
          title: "Monitor Dependencies",
          description:
            "Suppress this monitor's alerts and incidents while a parent monitor it depends on is down. The monitor keeps evaluating and its status timeline still updates.",
        }}
        onSaveSuccess={() => {
          setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              dependsOnMonitors: true,
            },
            title: "Depends On Monitors",
            description:
              "Parent monitors this monitor depends on. This monitor's alerts and incidents are suppressed while any of these parent monitors is offline.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitors",
          },
          {
            field: {
              suppressAlertsWhenParentMonitorStatuses: true,
            },
            title: "Suppress When Parent Status Is",
            description:
              "Parent monitor statuses that suppress this monitor's alerts and incidents. Leave empty to suppress when a parent is in any status flagged offline (the default).",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: MonitorStatus,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Any offline status (default)",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Monitor,
          id: "model-detail-monitor-dependencies",
          fields: [
            {
              field: {
                dependsOnMonitors: {
                  name: true,
                  _id: true,
                },
              },
              title: "Depends On Monitors",
              description:
                "This monitor's alerts and incidents are suppressed while any of these parent monitors is offline.",
              fieldType: FieldType.Element,
              getElement: (item: Monitor): ReactElement => {
                return (
                  <MonitorsElement monitors={item.dependsOnMonitors || []} />
                );
              },
            },
            {
              field: {
                suppressAlertsWhenParentMonitorStatuses: {
                  name: true,
                  color: true,
                  _id: true,
                },
              },
              title: "Suppress When Parent Status Is",
              description:
                "Leave empty to suppress when a parent is in any status flagged offline (the default).",
              fieldType: FieldType.Element,
              getElement: (item: Monitor): ReactElement => {
                const statuses: Array<MonitorStatus> =
                  item.suppressAlertsWhenParentMonitorStatuses || [];

                if (statuses.length === 0) {
                  return <p>Any status flagged offline (default).</p>;
                }

                return (
                  <MonitorStatusesElement
                    monitorStatuses={statuses}
                    shouldAnimate={false}
                  />
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

export default MonitorDependencies;
