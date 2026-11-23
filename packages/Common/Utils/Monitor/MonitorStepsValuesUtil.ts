import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { CriteriaFilter } from "../../Types/Monitor/CriteriaFilter";
import CriteriaFilterValues from "../../Types/Monitor/CriteriaFilterValues";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorStepRollingTime from "../../Types/Monitor/MonitorStepRollingTime";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorRequestBody from "./MonitorRequestBody";

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
 *
 * An API monitor's request body is refused the same way when it is not
 * JSON, whatever its {{...}} placeholders hold: the probe could not send it,
 * and every check would fail (MonitorRequestBody, #9737). Any JSON value is
 * one - an object, an array or a single value - as the monitor form says.
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

      const requestBodyError: string | null =
        MonitorRequestBody.getUnreadableError({
          monitorType: data.monitorType,
          requestBody: step?.data?.requestBody,
          requestBodyFormat: step?.data?.requestBodyFormat,
        });

      if (requestBodyError) {
        return requestBodyError;
      }

      const criteriaInstances: Array<MonitorCriteriaInstance> =
        step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

      for (const criteriaInstance of criteriaInstances) {
        const criteriaName: string = criteriaInstance?.data?.name || "";

        const errors: Array<string> = [
          ...CriteriaFilterValues.getUnreadableErrors({
            criteriaName: criteriaName,
            filterCondition: criteriaInstance?.data?.filterCondition,
            filters: criteriaInstance?.data?.filters,
          }),
          // Its recovery condition, when it has one (#10355).
          ...(MonitorCriteriaInstance.hasRecoveryCondition(
            criteriaInstance?.data,
          )
            ? CriteriaFilterValues.getUnreadableErrors({
                criteriaName: criteriaName,
                filterCondition: criteriaInstance?.data?.recoveryFilterCondition,
                filters: criteriaInstance?.data?.recoveryFilters,
                filtersPath: "recoveryFilters",
                filterConditionPath: "recoveryFilterCondition",
              })
            : []),
        ];

        if (errors.length > 0) {
          return errors[0]!;
        }

        /*
         * A window no check can read: a count with a number that is not one,
         * a share above 100%, a percentile outside 0 to 100, a count over
         * more than a week of checks (#10355).
         */
        const windowError: string | null =
          MonitorStepsValuesUtil.getWindowError({
            criteriaInstance: criteriaInstance,
            monitorType: data.monitorType,
          });

        if (windowError) {
          return windowError;
        }

        /*
         * Active hours that never open, or in a time zone nobody knows, would
         * leave the criteria judged on no check at all.
         */
        const activeHoursError: string | null =
          MonitorCriteriaInstance.getActiveHoursError(criteriaInstance?.data);

        if (activeHoursError) {
          return activeHoursError;
        }
      }
    }

    return null;
  }

  // The first window of a criteria's filters, or its recovery's, no check reads.
  private static getWindowError(data: {
    criteriaInstance: MonitorCriteriaInstance | undefined;
    monitorType: MonitorType | undefined | null;
  }): string | null {
    const criteriaName: string = data.criteriaInstance?.data?.name || "";

    const lists: Array<{ filters: Array<CriteriaFilter>; where: string }> = [
      {
        filters: data.criteriaInstance?.data?.filters || [],
        where: `criteria "${criteriaName}"`,
      },
      {
        filters: data.criteriaInstance?.data?.recoveryFilters || [],
        where: `the recovery condition of criteria "${criteriaName}"`,
      },
    ];

    for (const list of lists) {
      for (const filter of list.filters) {
        if (!filter || typeof filter !== "object") {
          continue;
        }

        const error: string | null =
          MonitorCriteriaInstance.getWindowValidationError({
            filter: filter,
            where: list.where,
            monitorType: data.monitorType || undefined,
          });

        if (error) {
          return error;
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
