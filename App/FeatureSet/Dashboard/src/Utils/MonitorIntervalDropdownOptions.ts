/*
 * Monitoring-interval options for the dashboard pickers.
 *
 * The options themselves, and the rules about which of them a given monitor
 * may use, live in Common/Utils/Monitor/MonitoringIntervalUtil so that the
 * server validates against exactly the same list the dashboard renders - a
 * value the picker offers can never be one the API rejects. This file is the
 * thin adapter that turns them into dropdown options and applies the
 * self-hosted gate.
 */

import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { BILLING_ENABLED } from "Common/UI/Config";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitoringIntervalUtil, {
  MonitoringIntervalOption,
} from "Common/Utils/Monitor/MonitoringIntervalUtil";

/*
 * Sub-minute intervals are self-hosted only. BILLING_ENABLED is how the rest
 * of the dashboard tells self-hosted and SaaS apart - see AIPlanGate and
 * EnterpriseFeatureUpgrade.
 */
export type IsSubMinuteMonitoringAllowedFunction = () => boolean;

export const isSubMinuteMonitoringAllowed: IsSubMinuteMonitoringAllowedFunction =
  (): boolean => {
    return !BILLING_ENABLED;
  };

/**
 * The intervals to offer for a monitor of this type.
 *
 * Pass the monitor type whenever it is known. Without it the picker
 * conservatively hides sub-minute intervals, because whether they are
 * available at all depends on the type.
 */
export type GetMonitoringIntervalOptionsFunction = (
  monitorType?: MonitorType | undefined,
) => Array<DropdownOption>;

export const getMonitoringIntervalOptions: GetMonitoringIntervalOptionsFunction =
  (monitorType?: MonitorType | undefined): Array<DropdownOption> => {
    return MonitoringIntervalUtil.getOptions({
      monitorType: monitorType,
      isSubMinuteAllowed: isSubMinuteMonitoringAllowed(),
    }).map((option: MonitoringIntervalOption) => {
      return {
        value: option.value,
        label: option.label,
      };
    });
  };
