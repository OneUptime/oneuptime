import MonitorsElement from "../Monitor/Monitors";
import { MONITOR_SECRET_ACCESS_TITLES } from "../../Pages/Monitor/Settings/MonitorSecretAccessFormFields";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecretAccess, {
  MonitorSecretAccessUtil,
} from "Common/Types/Monitor/MonitorSecretAccess";
import LabelsElement from "Common/UI/Components/Label/Labels";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A secret limited to some monitors, by the rule MonitorSecretAccess keeps:
 * a monitor secret, or an incoming request secret (issue #8501).
 */
export interface MonitorSecretAccessHolder {
  monitorAccess?: MonitorSecretAccess | undefined;
  monitors?: Array<Monitor> | undefined;
  labels?: Array<Label> | undefined;
}

export interface ComponentProps {
  secret: MonitorSecretAccessHolder;
  /*
   * The mode a row without a known one reads as: what its column defaults
   * to. A monitor secret's is Specific Monitors, an incoming request
   * secret's All Monitors.
   */
  defaultAccess?: MonitorSecretAccess | undefined;
}

/*
 * The Access cell of the monitor secrets table: the secret's mode, then what
 * that mode reads - its monitors, or its labels. Only the mode's own list is
 * shown. A row can still hold the other list (an API client may write a list
 * without changing the mode), and showing it would claim access the secret
 * does not grant.
 */
const MonitorSecretAccessElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const access: MonitorSecretAccess = MonitorSecretAccessUtil.isValid(
    props.secret.monitorAccess,
  )
    ? props.secret.monitorAccess
    : props.defaultAccess || MonitorSecretAccessUtil.DEFAULT_ACCESS;

  const title: string =
    translateString(MONITOR_SECRET_ACCESS_TITLES[access]) ||
    MONITOR_SECRET_ACCESS_TITLES[access];

  if (access === MonitorSecretAccess.AllMonitors) {
    return (
      <div
        data-testid="monitor-secret-access"
        data-access={access}
        className="text-sm font-medium text-gray-900"
      >
        {title}
      </div>
    );
  }

  return (
    <div data-testid="monitor-secret-access" data-access={access}>
      <div className="mb-1 text-xs font-medium text-gray-500">{title}</div>
      {access === MonitorSecretAccess.MonitorsWithLabels ? (
        <LabelsElement labels={props.secret.labels || []} />
      ) : (
        <MonitorsElement monitors={props.secret.monitors || []} />
      )}
    </div>
  );
};

export default MonitorSecretAccessElement;
