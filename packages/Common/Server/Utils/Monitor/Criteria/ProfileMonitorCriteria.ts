import ProfileMonitorResponse from "../../../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";

export default class ProfileMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    if (input.criteriaFilter.checkOn === CheckOn.ProfileCount) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentProfileCount: number =
        (input.dataToProcess as ProfileMonitorResponse).profileCount || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentProfileCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
