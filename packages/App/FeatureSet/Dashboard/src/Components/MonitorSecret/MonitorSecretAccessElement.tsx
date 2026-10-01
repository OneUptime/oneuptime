import MonitorsElement from "../Monitor/Monitors";
import { MONITOR_SECRET_ACCESS_TITLES } from "../../Pages/Monitor/Settings/MonitorSecretAccessFormFields";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorSecretAccess, {
  MonitorSecretAccessUtil,
} from "Common/Types/Monitor/MonitorSecretAccess";
import LabelsElement from "Common/UI/Components/Label/Labels";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  secret: MonitorSecret;
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
    : MonitorSecretAccessUtil.DEFAULT_ACCESS;

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
