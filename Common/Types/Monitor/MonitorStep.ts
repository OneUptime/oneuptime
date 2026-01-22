import HTTPMethod from "../API/HTTPMethod";
import Hostname from "../API/Hostname";
import URL from "../API/URL";
import DatabaseProperty from "../Database/DatabaseProperty";
import Dictionary from "../Dictionary";
import BadDataException from "../Exception/BadDataException";
import IP from "../IP/IP";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import Port from "../Port";
import MonitorCriteria from "./MonitorCriteria";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "./MonitorStepLogMonitor";
import MonitorType from "./MonitorType";
import BrowserType from "./SyntheticMonitors//BrowserType";
import ScreenSizeType from "./SyntheticMonitors/ScreenSizeType";
import { FindOperator } from "typeorm";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "./MonitorStepTraceMonitor";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "./MonitorStepMetricMonitor";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "./MonitorStepExceptionMonitor";
import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

export interface MonitorStepType {
  id: string;
  monitorDestination?: URL | IP | Hostname | undefined;

  monitorCriteria: MonitorCriteria;

  // this is for API monitor.
  requestType: HTTPMethod;
  requestHeaders?: Dictionary<string> | undefined;
  requestBody?: string | undefined;

  // this is used for API and Website monitor
  doNotFollowRedirects?: boolean | undefined;

  // this is for port monitors.
  monitorDestinationPort?: Port | undefined;

  // this is for custom code monitors or synthetic monitors.
  customCode?: string | undefined;

  // this is for synthetic monitors.
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;

  // retry count for synthetic monitors - number of times to retry on error
  retryCountOnError?: number | undefined;

  // Log monitor type.
  logMonitor?: MonitorStepLogMonitor | undefined;

  // trace monitor type.
  traceMonitor?: MonitorStepTraceMonitor | undefined;

  // Metric Monitor
  metricMonitor: MonitorStepMetricMonitor | undefined;

  // Exception monitor
  exceptionMonitor?: MonitorStepExceptionMonitor | undefined;
}

export default class MonitorStep extends DatabaseProperty {
  public data: MonitorStepType | undefined = undefined;

  public constructor() {
    super();

    this.data = {
      id: ObjectID.generate().toString(),
      monitorDestination: undefined,
      doNotFollowRedirects: undefined,
      monitorDestinationPort: undefined,
      monitorCriteria: new MonitorCriteria(),
      requestType: HTTPMethod.GET,
      requestHeaders: undefined,
      requestBody: undefined,
      customCode: undefined,
      screenSizeTypes: undefined,
      browserTypes: undefined,
      retryCountOnError: undefined,
      logMonitor: undefined,
      traceMonitor: undefined,
      metricMonitor: undefined,
      exceptionMonitor: undefined,
    };
  }

  public static getDefaultMonitorStep(arg: {
    monitorName: string;
    monitorType: MonitorType;
    onlineMonitorStatusId: ObjectID;
    offlineMonitorStatusId: ObjectID;
    defaultIncidentSeverityId: ObjectID;
    defaultAlertSeverityId: ObjectID;
  }): MonitorStep {
    const monitorStep: MonitorStep = new MonitorStep();

    monitorStep.data = {
      id: ObjectID.generate().toString(),
      monitorDestination: undefined,
      doNotFollowRedirects: undefined,
      monitorDestinationPort: undefined,
      monitorCriteria: MonitorCriteria.getDefaultMonitorCriteria(arg),
      requestType: HTTPMethod.GET,
      requestHeaders: undefined,
      requestBody: undefined,
      customCode: undefined,
      screenSizeTypes: undefined,
      browserTypes: undefined,
      retryCountOnError: undefined,
      logMonitor: undefined,
      traceMonitor: undefined,
      metricMonitor: undefined,
      exceptionMonitor: undefined,
    };

    return monitorStep;
  }

  public get id(): ObjectID {
    return new ObjectID(this.data?.id as string);
  }

  public set id(v: ObjectID) {
    this.data!.id = v.toString();
  }

  public setRequestType(requestType: HTTPMethod): MonitorStep {
    this.data!.requestType = requestType;
    return this;
  }

  public setRequestHeaders(requestHeaders: Dictionary<string>): MonitorStep {
    this.data!.requestHeaders = requestHeaders;
    return this;
  }

  public static clone(monitorStep: MonitorStep): MonitorStep {
    return MonitorStep.fromJSON(monitorStep.toJSON());
  }

  public setRequestBody(requestBody: string): MonitorStep {
    this.data!.requestBody = requestBody;
    return this;
  }

  public setMonitorDestination(
    monitorDestination: URL | IP | Hostname,
  ): MonitorStep {
    this.data!.monitorDestination = monitorDestination;
    return this;
  }

  public setDoNotFollowRedirects(doNotFollowRedirects: boolean): MonitorStep {
    this.data!.doNotFollowRedirects = doNotFollowRedirects;
    return this;
  }

  public setPort(monitorDestinationPort: Port): MonitorStep {
    this.data!.monitorDestinationPort = monitorDestinationPort;
    return this;
  }

  public setScreenSizeTypes(
    screenSizeTypes: Array<ScreenSizeType>,
  ): MonitorStep {
    this.data!.screenSizeTypes = screenSizeTypes;
    return this;
  }

  public setBrowserTypes(browserTypes: Array<BrowserType>): MonitorStep {
    this.data!.browserTypes = browserTypes;
    return this;
  }

  public setRetryCountOnError(retryCountOnError: number): MonitorStep {
    this.data!.retryCountOnError = retryCountOnError;
    return this;
  }

  public setLogMonitor(logMonitor: MonitorStepLogMonitor): MonitorStep {
    this.data!.logMonitor = logMonitor;
    return this;
  }

  public setMetricMonitor(
    metricMonitor: MonitorStepMetricMonitor,
  ): MonitorStep {
    this.data!.metricMonitor = metricMonitor;
    return this;
  }

  public setTraceMonitor(traceMonitor: MonitorStepTraceMonitor): MonitorStep {
    this.data!.traceMonitor = traceMonitor;
    return this;
  }

  public setExceptionMonitor(
    exceptionMonitor: MonitorStepExceptionMonitor,
  ): MonitorStep {
    this.data!.exceptionMonitor = exceptionMonitor;
    return this;
  }

  public setCustomCode(customCode: string): MonitorStep {
    this.data!.customCode = customCode;
    return this;
  }

  public setMonitorCriteria(monitorCriteria: MonitorCriteria): MonitorStep {
    this.data!.monitorCriteria = monitorCriteria;
    return this;
  }

  public static getNewMonitorStepAsJSON(): JSONObject {
    return {
      _type: ObjectType.MonitorStep,
      value: {
        id: ObjectID.generate().toString(),
        monitorDestination: undefined,
        doNotFollowRedirects: undefined,
        monitorDestinationPort: undefined,
        monitorCriteria: MonitorCriteria.getNewMonitorCriteriaAsJSON(),
        requestType: HTTPMethod.GET,
        requestHeaders: undefined,
        requestBody: undefined,
        customCode: undefined,
        screenSizeTypes: undefined,
        browserTypes: undefined,
        retryCountOnError: undefined,
        lgoMonitor: undefined,
        exceptionMonitor: undefined,
      },
    };
  }

  public static getValidationError(
    value: MonitorStep,
    monitorType: MonitorType,
  ): string | null {
    if (!value.data) {
      return "Monitor Step is required.";
    }

    // If the monitor type is incoming request, then the monitor destination is not required
    if (
      !value.data.monitorDestination &&
      (monitorType === MonitorType.Port ||
        monitorType === MonitorType.API ||
        monitorType === MonitorType.Ping ||
        monitorType === MonitorType.Website ||
        monitorType === MonitorType.IP ||
        monitorType === MonitorType.SSLCertificate)
    ) {
      return "Monitor Destination is required.";
    }

    if (
      !value.data.customCode &&
      (monitorType === MonitorType.CustomJavaScriptCode ||
        monitorType === MonitorType.SyntheticMonitor)
    ) {
      if (monitorType === MonitorType.CustomJavaScriptCode) {
        return "Custom Code is required";
      }
      return "Playwright code is required.";
    }

    if (!value.data.monitorCriteria) {
      return "Monitor Criteria is required";
    }

    if (
      MonitorCriteria.getValidationError(
        value.data.monitorCriteria,
        monitorType,
      )
    ) {
      return MonitorCriteria.getValidationError(
        value.data.monitorCriteria,
        monitorType,
      );
    }

    if (!value.data.requestType && monitorType === MonitorType.API) {
      return "Request Type is required";
    }

    if (
      monitorType === MonitorType.Port &&
      !value.data.monitorDestinationPort
    ) {
      return "Port is required";
    }

    return null;
  }

  public override toJSON(): JSONObject {
    if (this.data) {
      return JSONFunctions.serialize({
        _type: ObjectType.MonitorStep,
        value: {
          id: this.data.id,
          monitorDestination:
            this.data?.monitorDestination?.toJSON() || undefined,
          doNotFollowRedirects: this.data.doNotFollowRedirects || undefined,
          monitorDestinationPort:
            this.data?.monitorDestinationPort?.toJSON() || undefined,
          monitorCriteria: this.data.monitorCriteria.toJSON(),
          requestType: this.data.requestType,
          requestHeaders: this.data.requestHeaders || undefined,
          requestBody: this.data.requestBody || undefined,
          customCode: this.data.customCode || undefined,
          screenSizeTypes: this.data.screenSizeTypes || undefined,
          browserTypes: this.data.browserTypes || undefined,
          retryCountOnError: this.data.retryCountOnError || undefined,
          logMonitor: this.data.logMonitor
            ? MonitorStepLogMonitorUtil.toJSON(
                this.data.logMonitor || MonitorStepLogMonitorUtil.getDefault(),
              )
            : undefined,
          metricMonitor: this.data.metricMonitor
            ? MonitorStepMetricMonitorUtil.toJSON(this.data.metricMonitor)
            : undefined,
          traceMonitor: this.data.traceMonitor
            ? MonitorStepTraceMonitorUtil.toJSON(
                this.data.traceMonitor ||
                  MonitorStepTraceMonitorUtil.getDefault(),
              )
            : undefined,
          exceptionMonitor: this.data.exceptionMonitor
            ? MonitorStepExceptionMonitorUtil.toJSON(
                this.data.exceptionMonitor ||
                  MonitorStepExceptionMonitorUtil.getDefault(),
              )
            : undefined,
        },
      });
    }

    return MonitorStep.getNewMonitorStepAsJSON();
  }

  public static override fromJSON(json: JSONObject): MonitorStep {
    if (json instanceof MonitorStep) {
      return json;
    }

    if (!json || json["_type"] !== "MonitorStep") {
      throw new BadDataException("Invalid monitor step");
    }

    if (!json["value"]) {
      throw new BadDataException("Invalid monitor step");
    }

    json = json["value"] as JSONObject;

    let monitorDestination: URL | IP | Hostname | undefined = undefined;

    if (
      json &&
      json["monitorDestination"] &&
      (json["monitorDestination"] as JSONObject)["_type"] === ObjectType.URL
    ) {
      monitorDestination = URL.fromJSON(
        json["monitorDestination"] as JSONObject,
      );
    }

    if (
      json &&
      json["monitorDestination"] &&
      (json["monitorDestination"] as JSONObject)["_type"] ===
        ObjectType.Hostname
    ) {
      monitorDestination = Hostname.fromJSON(
        json["monitorDestination"] as JSONObject,
      );
    }

    if (
      json &&
      json["monitorDestination"] &&
      (json["monitorDestination"] as JSONObject)["_type"] === ObjectType.IP
    ) {
      monitorDestination = IP.fromJSON(
        json["monitorDestination"] as JSONObject,
      );
    }

    const monitorDestinationPort: Port | undefined = json[
      "monitorDestinationPort"
    ]
      ? Port.fromJSON(json["monitorDestinationPort"] as JSONObject)
      : undefined;

    if (!json["monitorCriteria"]) {
      throw new BadDataException("Invalid monitor criteria");
    }

    if (
      MonitorCriteria.isValid(json["monitorCriteria"] as JSONObject) === false
    ) {
      throw new BadDataException("Invalid monitor criteria");
    }

    const monitorStep: MonitorStep = new MonitorStep();

    monitorStep.data = JSONFunctions.deserialize({
      id: json["id"] as string,
      monitorDestination: monitorDestination || undefined,
      doNotFollowRedirects: json["doNotFollowRedirects"] || undefined,
      monitorDestinationPort: monitorDestinationPort || undefined,
      monitorCriteria: MonitorCriteria.fromJSON(
        json["monitorCriteria"] as JSONObject,
      ),
      requestType: (json["requestType"] as HTTPMethod) || HTTPMethod.GET,
      requestHeaders:
        (json["requestHeaders"] as Dictionary<string>) || undefined,
      requestBody: (json["requestBody"] as string) || undefined,
      customCode: (json["customCode"] as string) || undefined,
      screenSizeTypes:
        (json["screenSizeTypes"] as Array<ScreenSizeType>) || undefined,
      browserTypes: (json["browserTypes"] as Array<BrowserType>) || undefined,
      retryCountOnError: (json["retryCountOnError"] as number) || undefined,
      logMonitor: json["logMonitor"]
        ? (json["logMonitor"] as JSONObject)
        : undefined,
      metricMonitor: json["metricMonitor"]
        ? (json["metricMonitor"] as JSONObject)
        : undefined,
      traceMonitor: json["traceMonitor"]
        ? (json["traceMonitor"] as JSONObject)
        : undefined,
      exceptionMonitor: json["exceptionMonitor"]
        ? (json["exceptionMonitor"] as JSONObject)
        : undefined,
    }) as any;

    return monitorStep;
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.MonitorStep),
      value: Zod.object({
        id: Zod.string(),
        monitorDestination: Zod.any().optional(),
        monitorCriteria: Zod.any(),
        requestType: Zod.any(),
        requestHeaders: Zod.any().optional(),
        requestBody: Zod.string().optional(),
        doNotFollowRedirects: Zod.boolean().optional(),
        monitorDestinationPort: Zod.any().optional(),
        customCode: Zod.string().optional(),
        screenSizeTypes: Zod.any().optional(),
        browserTypes: Zod.any().optional(),
        retryCountOnError: Zod.number().optional(),
        logMonitor: Zod.any().optional(),
        traceMonitor: Zod.any().optional(),
        metricMonitor: Zod.any().optional(),
      }).openapi({
        type: "object",
        example: {
          id: "stepId",
          monitorDestination: undefined,
          monitorCriteria: {},
          requestType: "GET",
        },
      }),
    }).openapi({
      type: "object",
      description: "MonitorStep object",
      example: {
        _type: ObjectType.MonitorStep,
        value: {
          id: "stepId",
          monitorDestination: undefined,
          monitorCriteria: {},
          requestType: "GET",
        },
      },
    });
  }

  public isValid(): boolean {
    return true;
  }

  protected static override toDatabase(
    value: MonitorStep | FindOperator<MonitorStep>,
  ): JSONObject | null {
    if (value && value instanceof MonitorStep) {
      return (value as MonitorStep).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject,
  ): MonitorStep | null {
    if (value) {
      return MonitorStep.fromJSON(value);
    }

    return null;
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }
}
