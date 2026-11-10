import { Amber500, Gray500, Green500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import {
  DataCheckHealth,
  getDataCheckHealth,
} from "Common/Types/DataObservability/DataObservabilityAttention";
import DataCheck from "Common/Models/DatabaseModels/DataCheck";
import { DataCheckType } from "Common/Types/DataObservability/DataCheckType";

/*
 * A check's Status, in a word and a colour. "Ran" in green said only that
 * the query worked - a check whose values broke its alert read as well as
 * one that passed. Passing and Failing come from the check's alert: open,
 * it is failing; not, it passes. Until the alerts are read, and for a
 * check with no alert, a check that ran says only that, in grey.
 */

export interface CheckHealthCopy {
  label: string;
  color: Color;
}

export const CHECK_HEALTH_COPY: Readonly<
  Record<DataCheckHealth, CheckHealthCopy>
> = {
  [DataCheckHealth.Failing]: { label: "Failing", color: Red500 },
  [DataCheckHealth.CouldNotRun]: { label: "Could Not Run", color: Amber500 },
  [DataCheckHealth.Passing]: { label: "Passing", color: Green500 },
  [DataCheckHealth.NoAlert]: { label: "Ran", color: Gray500 },
  [DataCheckHealth.Waiting]: {
    label: "Waiting for first run",
    color: Gray500,
  },
  [DataCheckHealth.Off]: { label: "Off", color: Gray500 },
};

/*
 * What a check's last run alone says, before its alert is read: read as a
 * check with no alert, so never Passing for a check of OneUptime's own, as
 * only its alert says that. A dbt test's own result is dbt's verdict, and
 * stands.
 */
export function getCheckHealthBeforeAlerts(check: DataCheck): DataCheckHealth {
  return getDataCheckHealth({
    isEnabled: check.isEnabled,
    lastRunAt: check.lastRunAt,
    lastRunStatus: check.lastRunStatus,
    isDbtTest: check.checkType === DataCheckType.DbtTest,
    hasAlert: false,
    hasOpenAlert: false,
  });
}
