import ProfileMonitorResponse, {
  ProfileFunctionShareReading,
} from "../../../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
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

    if (input.criteriaFilter.checkOn === CheckOn.ProfileFunctionShare) {
      /*
       * No function named, or nothing profiled in the window: there is no
       * share to judge, so the criteria does not match. A service that
       * stops sending profiles is what Profile Count is for - a share of 0
       * read from no data would fire every "less than" rule.
       */
      const reading: ProfileFunctionShareReading | undefined = (
        input.dataToProcess as ProfileMonitorResponse
      ).functionShare;

      if (!reading || !(reading.windowSampleCount > 0)) {
        return null;
      }

      threshold = CompareCriteria.convertToNumber(threshold);

      return CompareCriteria.compareCriteriaNumbers({
        value: reading.sharePercent,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
