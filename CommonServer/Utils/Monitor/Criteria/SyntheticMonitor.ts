import CompareCriteria from "./CompareCriteria";
import CustomCodeMonitoringCriteria from "./CustomCodeMonitorCriteria";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import SyntheticMonitor from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitor";

export default class SyntheticMonitoringCriteria {
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    Monitor: Array<SyntheticMonitor>;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    for (const syntheticMonitor of input.Monitor) {
      const threshold: number | string | undefined | null =
        input.criteriaFilter.value;

      // check custom code monitoring criteria first
      const result: string | null =
        await CustomCodeMonitoringCriteria.isMonitorInstanceCriteriaFilterMet({
          Monitor: syntheticMonitor,
          criteriaFilter: input.criteriaFilter,
        });

      if (result) {
        return result;
      }

      // check browser type and screen type.

      if (CheckOn.ScreenSizeType === input.criteriaFilter.checkOn) {
        return CompareCriteria.checkEqualToOrNotEqualTo({
          value: syntheticMonitor.screenSizeType,
          threshold: threshold as number,
          criteriaFilter: input.criteriaFilter,
        });
      }

      if (CheckOn.BrowserType === input.criteriaFilter.checkOn) {
        return CompareCriteria.checkEqualToOrNotEqualTo({
          value: syntheticMonitor.browserType,
          threshold: threshold as number,
          criteriaFilter: input.criteriaFilter,
        });
      }
    }

    return null;
  }
}
