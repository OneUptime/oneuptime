import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import CriteriaFilterValues from "../../Types/Monitor/CriteriaFilterValues";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorStepRollingTime from "../../Types/Monitor/MonitorStepRollingTime";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";

/*
 * A monitor's (or template's) steps written with a value its checks cannot
 * read are refused, whoever writes them: the API, a workflow, or an AI
 * through the MCP server (the Terraform provider takes only the values
 * OneUptime writes for a criteria, but not for a rolling time).
 *
 * A Metrics monitor an AI created through the MCP server was stored with
 * its rolling time as "15 minutes" and its conditions as "GreaterThan" and
 * "LessThanOrEqual". Every check read a window of no length, found no
 * data, and its no-data rule opened an alert on every run - and its
 * conditions, matching nothing, could never have fired on a value.
 *
 * A value written another way that means one ("15 minutes", "PT15M",
 * "GreaterThan", ">") is not refused: reading the steps
 * (MonitorStep.fromJSON, MonitorCriteriaInstance.fromJSON) stores it as
 * the one it means. One that means none is refused, with the values it
 * can take (MonitorStepRollingTime, CriteriaFilterValues).
 */
export default class MonitorStepsValuesUtil {
  /*
   * Why these steps cannot be read - the first value, step by step, that
   * means none of the values its field takes - or null when every one can.
   * A rolling time is read only under the monitor's own type: it is the
   * one its checks use. Steps that cannot be read at all say nothing here:
   * their shape is refused where they are parsed.
   */
  public static getUnreadableValueError(data: {
    monitorType: MonitorType | undefined | null;
    monitorSteps: MonitorSteps | JSONObject | null | undefined;
  }): string | null {
    if (!data.monitorSteps) {
      return null;
    }

    let steps: Array<MonitorStep> = [];

    try {
      steps =
        MonitorSteps.fromJSON(data.monitorSteps as MonitorSteps | JSONObject)
          .data?.monitorStepsInstanceArray || [];
    } catch {
      return null;
    }

    for (const step of steps) {
      const rollingTimeError: string | null =
        MonitorStepRollingTime.getUnreadableError({
          monitorType: data.monitorType,
          stepData: step?.data,
        });

      if (rollingTimeError) {
        return rollingTimeError;
      }

      const criteriaInstances: Array<MonitorCriteriaInstance> =
        step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

      for (const criteriaInstance of criteriaInstances) {
        const errors: Array<string> = CriteriaFilterValues.getUnreadableErrors({
          criteriaName: criteriaInstance?.data?.name || "",
          filterCondition: criteriaInstance?.data?.filterCondition,
          filters: criteriaInstance?.data?.filters,
        });

        if (errors.length > 0) {
          return errors[0]!;
        }
      }
    }

    return null;
  }

  // Refuses steps written with a value their checks cannot read (above).
  public static assertValuesReadable(data: {
    monitorType: MonitorType | undefined | null;
    monitorSteps: MonitorSteps | JSONObject | null | undefined;
  }): void {
    const error: string | null =
      MonitorStepsValuesUtil.getUnreadableValueError(data);

    if (error) {
      throw new BadDataException(error);
    }
  }
}
