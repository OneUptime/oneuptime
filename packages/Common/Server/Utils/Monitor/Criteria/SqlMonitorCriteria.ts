import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import SqlMonitorResponse from "../../../../Types/Monitor/SqlMonitor/SqlMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class SqlMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
  }): Promise<string | null> {
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const sqlResponse: SqlMonitorResponse | undefined =
      dataToProcess.sqlQueryMonitorResponse;

    // Is the database reachable / did the check succeed?
    if (input.criteriaFilter.checkOn === CheckOn.SqlIsOnline) {
      return CompareCriteria.compareCriteriaBoolean({
        value: dataToProcess.isOnline as boolean,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Number of rows the query returned.
    if (input.criteriaFilter.checkOn === CheckOn.SqlQueryRowCount) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      if (
        sqlResponse?.rowCount === null ||
        sqlResponse?.rowCount === undefined
      ) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: sqlResponse.rowCount,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Query execution time (in ms).
    if (input.criteriaFilter.checkOn === CheckOn.SqlQueryExecutionTime) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      const executionTime: number | undefined =
        sqlResponse?.responseTimeInMs ?? dataToProcess.responseTimeInMs;

      if (executionTime === null || executionTime === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: executionTime,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    /*
     * The first column of the first row — the natural target for a
     * COUNT(*)-style query. Compared numerically when both sides look
     * numeric, otherwise as strings.
     */
    if (input.criteriaFilter.checkOn === CheckOn.SqlQueryScalarValue) {
      const scalarValue: string | number | boolean | null | undefined =
        sqlResponse?.scalarValue;

      if (scalarValue === null || scalarValue === undefined) {
        return null;
      }

      const numericThreshold: number | null =
        CompareCriteria.convertToNumber(threshold);
      const scalarAsNumber: number = Number(scalarValue);

      if (
        numericThreshold !== null &&
        typeof scalarValue !== "boolean" &&
        !isNaN(scalarAsNumber)
      ) {
        const numericResult: string | null =
          CompareCriteria.compareCriteriaNumbers({
            value: scalarAsNumber,
            threshold: numericThreshold,
            criteriaFilter: input.criteriaFilter,
          });

        if (numericResult) {
          return numericResult;
        }
      }

      if (threshold !== null && threshold !== undefined) {
        return CompareCriteria.compareCriteriaStrings({
          value: String(scalarValue),
          threshold: String(threshold),
          criteriaFilter: input.criteriaFilter,
        });
      }

      return null;
    }

    // The query error message (present when the query failed).
    if (input.criteriaFilter.checkOn === CheckOn.SqlQueryError) {
      const emptyNotEmptyResult: string | null =
        CompareCriteria.compareEmptyAndNotEmpty({
          value: sqlResponse?.queryError,
          criteriaFilter: input.criteriaFilter,
        });

      if (emptyNotEmptyResult) {
        return emptyNotEmptyResult;
      }

      if (
        threshold !== null &&
        threshold !== undefined &&
        typeof sqlResponse?.queryError === "string"
      ) {
        return CompareCriteria.compareCriteriaStrings({
          value: sqlResponse.queryError,
          threshold: threshold.toString(),
          criteriaFilter: input.criteriaFilter,
        });
      }

      return null;
    }

    return null;
  }
}
