import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  MonitorEvaluationDetailsLimits,
  MonitorEvaluationFieldValue,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
} from "../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SqlMonitorResponse from "../../../Types/Monitor/SqlMonitor/SqlMonitorResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import Typeof from "../../../Types/Typeof";
import {
  TemplatePlaceholder,
  findTemplatePlaceholders,
} from "../../../Utils/TemplatePlaceholders";
import logger from "../Logger";
import VMUtil from "../VM/VMAPI";
import DataToProcess from "./DataToProcess";
import MonitorEvidenceRedaction from "./MonitorEvidenceRedaction";

/*
 * WHAT A MONITOR'S JAVASCRIPT EXPRESSION CAN READ, AND WHAT IT READ.
 *
 * A JavaScript Expression filter names the values it compares with
 * placeholders - {{responseBody.data.status}} == 'down' - filled from one
 * map per monitor type before the expression runs. The evaluator and the
 * evaluation details read the same map from here, so the values an incident
 * shows are the values the expression saw.
 */

// A value of one reference, written into a sentence: at most this long.
const SENTENCE_VALUE_CHARS: number = 80;

// References a root cause's sentence lists, at most.
const SENTENCE_REFERENCES: number = 5;

export default class JavaScriptExpressionValues {
  /*
   * The values a JavaScript expression can name, for a monitor type. Empty
   * for a type whose expressions name nothing.
   */
  public static getStorageMap(input: {
    monitorType: MonitorType | undefined;
    dataToProcess: DataToProcess;
    projectId?: string | undefined;
    /*
     * Read again for the evaluation details: a body that is no JSON was
     * already logged when the expression ran.
     */
    isQuiet?: boolean | undefined;
  }): JSONObject {
    let storageMap: JSONObject = {};

    if (
      input.monitorType === MonitorType.API ||
      input.monitorType === MonitorType.Website
    ) {
      let responseBody: JSONObject | null = null;
      try {
        responseBody = JSON.parse(
          ((input.dataToProcess as ProbeMonitorResponse)
            .responseBody as string) || "{}",
        );
      } catch (err) {
        if (!input.isQuiet) {
          logger.error(err, {
            projectId: input.projectId,
          });
        }
        responseBody = (input.dataToProcess as ProbeMonitorResponse)
          .responseBody as JSONObject;
      }

      if (
        typeof responseBody === Typeof.String &&
        responseBody?.toString() === ""
      ) {
        responseBody = {};
      }

      storageMap = {
        responseBody: responseBody,
        responseHeaders: (input.dataToProcess as ProbeMonitorResponse)
          .responseHeaders,
        responseStatusCode: (input.dataToProcess as ProbeMonitorResponse)
          .responseCode,
        responseTimeInMs: (input.dataToProcess as ProbeMonitorResponse)
          .responseTimeInMs,
        isOnline: (input.dataToProcess as ProbeMonitorResponse).isOnline,
      };
    }

    if (input.monitorType === MonitorType.IncomingRequest) {
      storageMap = {
        requestBody: (input.dataToProcess as IncomingMonitorRequest)
          .requestBody,
        requestHeaders: (input.dataToProcess as IncomingMonitorRequest)
          .requestHeaders,
      };
    }

    if (input.monitorType === MonitorType.SQLQuery) {
      const sqlResponse: SqlMonitorResponse | undefined = (
        input.dataToProcess as ProbeMonitorResponse
      ).sqlQueryMonitorResponse;

      storageMap = {
        rowCount: sqlResponse?.rowCount,
        scalarValue: sqlResponse?.scalarValue,
        firstRow: sqlResponse?.firstRow,
        executionTimeInMs: sqlResponse?.responseTimeInMs,
        queryError: sqlResponse?.queryError,
        isOnline: (input.dataToProcess as ProbeMonitorResponse).isOnline,
      };
    }

    if (input.monitorType === MonitorType.Database) {
      const databaseResponse: DatabaseMonitorResponse | undefined = (
        input.dataToProcess as ProbeMonitorResponse
      ).databaseMonitorResponse;

      /*
       * metrics is exposed raw, keyed by series name, so an expression can
       * read any of the catalog's series without a variable per metric:
       * {{metrics['oneuptime.monitor.database.connections.used.percent']}} > 90
       *
       * Connection details are deliberately absent - host, username and
       * password never travel into an expression sandbox.
       */
      storageMap = {
        isOnline: (input.dataToProcess as ProbeMonitorResponse).isOnline,
        engineVersion: databaseResponse?.engineVersion,
        connectionError: databaseResponse?.connectionError,
        collectedGroups: databaseResponse?.collectedGroups,
        unavailableGroups: (databaseResponse?.unavailableGroups || []).map(
          (status: DatabaseMetricGroupStatus): JSONObject => {
            return {
              group: status.group,
              reason: status.reason,
              message: status.message,
              remediation: status.remediation,
            };
          },
        ),
        metrics: databaseResponse?.metrics,
      };
    }

    return storageMap;
  }

  /*
   * The names an expression reads, without their braces, each once and in
   * the order they are written. A {{#each}} or {{/each}} tag names nothing.
   */
  public static getReferences(expression: string): Array<string> {
    if (typeof expression !== "string" || !expression) {
      return [];
    }

    const references: Array<string> = [];

    for (const placeholder of findTemplatePlaceholders(expression)) {
      const inner: string = (placeholder as TemplatePlaceholder).inner.trim();

      if (
        !inner ||
        inner.startsWith("#") ||
        inner.startsWith("/") ||
        inner.startsWith("@") ||
        references.includes(inner)
      ) {
        continue;
      }

      references.push(inner);
    }

    return references;
  }

  /*
   * What each reference of an expression held, redacted and bounded: a
   * reference whose path names a secret ({{responseHeaders.set-cookie}},
   * {{responseBody.auth.token}}) is masked whole; any other value is written
   * as JSON with its sensitive fields masked and its text swept.
   */
  public static readReferences(input: {
    expression: string;
    storageMap: JSONObject;
    maxReferences?: number | undefined;
    maxValueChars?: number | undefined;
  }): {
    values: Array<MonitorEvaluationFieldValue>;
    isTruncated: boolean;
  } {
    const maxReferences: number =
      input.maxReferences ??
      MonitorEvaluationDetailsLimits.fieldValuesPerFilter;
    const maxValueChars: number =
      input.maxValueChars ?? MonitorEvaluationDetailsLimits.valueChars;

    const references: Array<string> = JavaScriptExpressionValues.getReferences(
      input.expression,
    );

    const values: Array<MonitorEvaluationFieldValue> = references
      .slice(0, maxReferences)
      .map((path: string): MonitorEvaluationFieldValue => {
        return JavaScriptExpressionValues.readReference({
          path: path,
          storageMap: input.storageMap,
          maxValueChars: maxValueChars,
        });
      });

    return {
      values: values,
      isTruncated: references.length > maxReferences,
    };
  }

  /*
   * The sentence a met expression puts into the root cause and the
   * evaluation log: the expression as it was written - never with the
   * response's values written into it, which put whole bodies into email and
   * chat - and what its references held, short and redacted.
   */
  public static describeMetExpression(input: {
    expression: string;
    storageMap: JSONObject;
    // False for a monitor that keeps no response content: no values.
    includeValues?: boolean | undefined;
  }): string {
    const sentence: string = `JavaScript Expression - ${input.expression} - evaluated to true.`;

    if (input.includeValues === false) {
      return sentence;
    }

    const { values, isTruncated } = JavaScriptExpressionValues.readReferences({
      expression: input.expression,
      storageMap: input.storageMap,
      maxReferences: SENTENCE_REFERENCES,
      maxValueChars: SENTENCE_VALUE_CHARS,
    });

    if (values.length === 0) {
      return sentence;
    }

    const listed: Array<string> = values.map(
      (value: MonitorEvaluationFieldValue): string => {
        if (value.isMissing) {
          return `${value.path} was not found`;
        }

        return `${value.path} = ${value.value}${value.isTruncated ? "…" : ""}`;
      },
    );

    return `${sentence} Values: ${listed.join(", ")}${isTruncated ? ", …" : ""}.`;
  }

  private static readReference(input: {
    path: string;
    storageMap: JSONObject;
    maxValueChars: number;
  }): MonitorEvaluationFieldValue {
    let value: JSONValue | undefined = undefined;

    try {
      value = VMUtil.deepFind(input.storageMap, input.path);
    } catch {
      value = undefined;
    }

    if (value === undefined) {
      return { path: input.path, isMissing: true };
    }

    const isSecretPath: boolean = JavaScriptExpressionValues.getPathNames(
      input.path,
    ).some((name: string) => {
      return MonitorEvidenceRedaction.isSensitiveName(name);
    });

    if (isSecretPath) {
      return {
        path: input.path,
        value: MonitorEvidenceRedaction.REDACTED,
        isRedacted: true,
      };
    }

    let text: string;

    try {
      text =
        JSON.stringify(MonitorEvidenceRedaction.redactJson(value)) ?? "null";
    } catch {
      text = "[object]";
    }

    if (text.length > input.maxValueChars) {
      return {
        path: input.path,
        value: text.slice(0, input.maxValueChars),
        isTruncated: true,
      };
    }

    return { path: input.path, value: text };
  }

  /*
   * The names a path walks through: responseBody.data.items[0].token is
   * responseBody, data, items and token.
   */
  private static getPathNames(path: string): Array<string> {
    return path
      .split(".")
      .map((piece: string): string => {
        const bracket: number = piece.indexOf("[");

        return bracket === -1 ? piece : piece.slice(0, bracket);
      })
      .filter((name: string) => {
        return Boolean(name);
      });
  }
}
