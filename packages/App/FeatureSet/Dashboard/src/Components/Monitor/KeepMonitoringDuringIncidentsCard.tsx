import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import KeepMonitoringDuringIncidentsCopy, {
  getKeepMonitoringOffDescription,
  isKeepMonitoringDuringIncidentsOffered,
  KEEP_MONITORING_DURING_INCIDENTS_COLUMN,
  KEEP_MONITORING_DURING_INCIDENTS_TEST_ID,
} from "./KeepMonitoringDuringIncidentsCopy";

/*
 * "During Incidents", on a monitor's Settings page: one switch, "Keep
 * monitoring during incidents", that saves the moment it is flipped
 * (Monitor.keepMonitoringDuringIncidents, issue #11141). Off, an incident
 * someone declares on the monitor pauses its checks until it is resolved;
 * on, they keep running. The server pauses or resumes the monitor as soon
 * as it is saved, and the banner across the monitor's pages follows it
 * (ModelSwitchEvents). Nothing for a manual monitor, which runs no checks.
 *
 * See KeepMonitoringDuringIncidentsCopy for what each line says.
 */

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
}

const KeepMonitoringDuringIncidentsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isKeepMonitoringDuringIncidentsOffered(props.monitorType)) {
    return <Fragment />;
  }

  return (
    <ModelSwitchCard<Monitor>
      modelType={Monitor}
      modelId={props.monitorId}
      column={KEEP_MONITORING_DURING_INCIDENTS_COLUMN}
      cardTitle={KeepMonitoringDuringIncidentsCopy.cardTitle}
      cardDescription={KeepMonitoringDuringIncidentsCopy.cardDescription}
      title={KeepMonitoringDuringIncidentsCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? KeepMonitoringDuringIncidentsCopy.onDescription
          : getKeepMonitoringOffDescription(props.monitorType);
      }}
      dataTestId={KEEP_MONITORING_DURING_INCIDENTS_TEST_ID}
    />
  );
};

export default KeepMonitoringDuringIncidentsCard;
