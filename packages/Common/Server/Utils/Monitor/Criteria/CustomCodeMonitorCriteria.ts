import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import CustomCodeMonitorResponse, {
  CustomCodeMonitorResult,
  CustomCodeMonitorResultObject,
} from "../../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class CustomCodeMonitoringCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    monitorResponse: CustomCodeMonitorResponse;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    // Server Monitoring Checks

    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const syntheticMonitorResponse: CustomCodeMonitorResponse =
      input.monitorResponse;

    if (input.criteriaFilter.checkOn === CheckOn.ExecutionTime) {
      threshold = CompareCriteria.convertToNumber(threshold);

      const currentExecutionTime: number =
        syntheticMonitorResponse.executionTimeInMS || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: currentExecutionTime,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    if (input.criteriaFilter.checkOn === CheckOn.Error) {
      const emptyNotEmptyResult: string | null =
        CompareCriteria.compareEmptyAndNotEmpty({
          value: syntheticMonitorResponse.scriptError,
          criteriaFilter: input.criteriaFilter,
        });

      if (emptyNotEmptyResult) {
        return emptyNotEmptyResult;
      }

      if (
        threshold &&
        typeof syntheticMonitorResponse.scriptError === "string"
      ) {
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: syntheticMonitorResponse.scriptError!,
          threshold: threshold.toString(),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return result;
        }
      }
    }

    if (input.criteriaFilter.checkOn === CheckOn.ResultValue) {
      const resultValuePath: string | undefined =
        input.criteriaFilter.customCodeMonitorOptions?.resultValuePath?.trim() ||
        undefined;

      /*
       * When a path is set, reach into the object/array result and compare
       * the resolved field. With no path the whole result is used, so a
       * primitive result keeps behaving exactly as before.
       */
      const resolvedValue: CustomCodeMonitorResult | undefined =
        CustomCodeMonitoringCriteria.resolveValueAtPath(
          syntheticMonitorResponse.result,
          resultValuePath,
        );

      const emptyNotEmptyResult: string | null =
        CompareCriteria.compareEmptyAndNotEmpty({
          value: resolvedValue,
          criteriaFilter: input.criteriaFilter,
        });

      if (emptyNotEmptyResult) {
        return CustomCodeMonitoringCriteria.withPathContext(
          emptyNotEmptyResult,
          resultValuePath,
        );
      }

      let thresholdAsNumber: number | null = null;

      try {
        if (threshold) {
          thresholdAsNumber = parseFloat(threshold.toString());
        }
      } catch (err) {
        logger.error(err);
        thresholdAsNumber = null;
      }

      if (thresholdAsNumber !== null && typeof resolvedValue === "number") {
        const result: string | null = CompareCriteria.compareCriteriaNumbers({
          value: resolvedValue,
          threshold: thresholdAsNumber as number,
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return CustomCodeMonitoringCriteria.withPathContext(
            result,
            resultValuePath,
          );
        }
      }

      if (threshold && typeof resolvedValue === "string") {
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: resolvedValue,
          threshold: threshold.toString(),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return CustomCodeMonitoringCriteria.withPathContext(
            result,
            resultValuePath,
          );
        }
      }

      if (typeof resolvedValue === "boolean") {
        const result: string | null = CompareCriteria.compareCriteriaBoolean({
          value: resolvedValue,
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return CustomCodeMonitoringCriteria.withPathContext(
            result,
            resultValuePath,
          );
        }
      }
    }

    return null;
  }

  /*
   * Prepend the field path to a match message when one was used, so the
   * reader can see which field inside the result fired the criterion. With
   * no path the message is returned unchanged (no regression for primitives).
   */
  private static withPathContext(
    message: string,
    resultValuePath: string | undefined,
  ): string {
    if (resultValuePath) {
      return `Result value at "${resultValuePath}": ${message}`;
    }

    return message;
  }

  /*
   * Resolve the value at a dotted / bracketed path inside a custom-code
   * monitor result. Supports dot notation and [index] array brackets, e.g.
   * "status", "cpu_busy_percent", "data.items[0].value", "results[2].status".
   * An empty/undefined path returns the whole result unchanged.
   * If any segment is missing, or traverses a primitive/null/undefined, the
   * resolved value is undefined. Object keys with a literal dot are not
   * addressable - only "[index]" reaches into arrays.
   */
  private static resolveValueAtPath(
    result: CustomCodeMonitorResult | undefined,
    path: string | undefined,
  ): CustomCodeMonitorResult | undefined {
    if (!path) {
      return result;
    }

    let current: CustomCodeMonitorResult | undefined = result;

    const pieces: Array<string> = path.split(".");

    for (const piece of pieces) {
      // Pull a leading key plus zero or more [index] groups, e.g. items[0][1].
      const match: RegExpMatchArray | null = piece.match(
        /^([^[\]]*)((?:\[\d+\])*)$/,
      );

      if (!match) {
        return undefined;
      }

      const key: string | undefined = match[1];
      const bracketGroups: string | undefined = match[2];

      // Resolve the object key first (skip when the piece is pure brackets).
      if (key && key.length > 0) {
        /*
         * Only the result's own fields. Without the own-property check a
         * key like "constructor" or "toString" resolves to something every
         * object inherits, and Is Not Empty fires on a field the script
         * never returned.
         */
        if (
          current === null ||
          current === undefined ||
          typeof current !== "object" ||
          Array.isArray(current) ||
          !Object.prototype.hasOwnProperty.call(current, key)
        ) {
          return undefined;
        }

        current = (current as CustomCodeMonitorResultObject)[key];
      }

      // Then resolve each [index] against an array in turn.
      if (bracketGroups && bracketGroups.length > 0) {
        const indexMatches: RegExpMatchArray | null =
          bracketGroups.match(/\[\d+\]/g);

        if (!indexMatches) {
          return undefined;
        }

        for (const indexToken of indexMatches) {
          const index: number = parseInt(indexToken.slice(1, -1), 10);

          if (!Array.isArray(current)) {
            return undefined;
          }

          if (index < 0 || index >= current.length) {
            return undefined;
          }

          current = current[index];
        }
      }
    }

    return current;
  }
}
