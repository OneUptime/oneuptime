import DatabaseProperty from "../Database/DatabaseProperty";
import BadDataException from "../Exception/BadDataException";
import { JSONArray, JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorType from "./MonitorType";
import { FindOperator } from "typeorm";
import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

export interface MonitorStepsType {
  monitorStepsInstanceArray: Array<MonitorStep>;
  defaultMonitorStatusId?: ObjectID | undefined;
}

export default class MonitorSteps extends DatabaseProperty {
  public data: MonitorStepsType | undefined = undefined;

  public constructor() {
    super();
    this.data = {
      monitorStepsInstanceArray: [new MonitorStep()],
      defaultMonitorStatusId: undefined,
    };
  }

  public static getNewMonitorStepsAsJSON(): JSONObject {
    return {
      _type: ObjectType.MonitorSteps,
      value: {
        monitorStepsInstanceArray: [new MonitorStep().toJSON()],
        defaultMonitorStatusId: undefined,
      },
    };
  }

  public static getDefaultMonitorSteps(arg: {
    defaultMonitorStatusId: ObjectID;
    monitorType: MonitorType;
    monitorName: string;
    onlineMonitorStatusId: ObjectID;
    offlineMonitorStatusId: ObjectID;
    defaultIncidentSeverityId: ObjectID;
    defaultAlertSeverityId: ObjectID;
  }): MonitorSteps {
    const monitorSteps: MonitorSteps = new MonitorSteps();

    monitorSteps.data = {
      monitorStepsInstanceArray: [MonitorStep.getDefaultMonitorStep(arg)],
      defaultMonitorStatusId: arg.defaultMonitorStatusId,
    };

    return monitorSteps;
  }

  public setMonitorStepsInstanceArray(monitorSteps: Array<MonitorStep>): void {
    if (this.data) {
      this.data.monitorStepsInstanceArray = monitorSteps;
    }
  }

  public static clone(monitorSteps: MonitorSteps): MonitorSteps {
    return MonitorSteps.fromJSON(monitorSteps.toJSON());
  }

  public setDefaultMonitorStatusId(
    monitorStatusId: ObjectID | undefined,
  ): MonitorSteps {
    if (this.data) {
      this.data.defaultMonitorStatusId = monitorStatusId;
    }

    return this;
  }

  public override toJSON(): JSONObject {
    if (!this.data) {
      return MonitorSteps.getNewMonitorStepsAsJSON();
    }

    return JSONFunctions.serialize({
      _type: ObjectType.MonitorSteps,
      value: {
        monitorStepsInstanceArray: this.data.monitorStepsInstanceArray.map(
          (step: MonitorStep) => {
            return step.toJSON();
          },
        ),
        defaultMonitorStatusId:
          this.data.defaultMonitorStatusId?.toString() || undefined,
      },
    });
  }

  public static override fromJSON(
    json: JSONObject | MonitorSteps | undefined,
  ): MonitorSteps {
    if (!json) {
      return new MonitorSteps();
    }

    if (json instanceof MonitorSteps) {
      return json;
    }

    if (!json) {
      throw new BadDataException("Invalid monitor steps");
    }

    if (json["_type"] !== "MonitorSteps") {
      throw new BadDataException("Invalid monitor steps");
    }

    if (!json["value"]) {
      throw new BadDataException("Invalid monitor steps");
    }

    if (!(json["value"] as JSONObject)["monitorStepsInstanceArray"]) {
      throw new BadDataException("Invalid monitor steps");
    }

    const monitorStepsInstanceArray: JSONArray = (json["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as JSONArray;

    const monitorSteps: MonitorSteps = new MonitorSteps();

    monitorSteps.data = {
      monitorStepsInstanceArray: monitorStepsInstanceArray.map(
        (json: JSONObject) => {
          return MonitorStep.fromJSON(json);
        },
      ),
      defaultMonitorStatusId: (json["value"] as JSONObject)[
        "defaultMonitorStatusId"
      ]
        ? new ObjectID(
            (json["value"] as JSONObject)["defaultMonitorStatusId"] as string,
          )
        : undefined,
    };

    return monitorSteps;
  }

  public static getValidationError(
    value: MonitorSteps,
    monitorType: MonitorType,
  ): string | null {
    if (!value.data) {
      return "Monitor Steps is required";
    }

    if (value.data.monitorStepsInstanceArray.length === 0) {
      return "Monitor Steps is required";
    }

    if (!value.data.defaultMonitorStatusId) {
      return "Default Monitor Status is required";
    }

    for (const step of value.data.monitorStepsInstanceArray) {
      if (MonitorStep.getValidationError(step, monitorType)) {
        return MonitorStep.getValidationError(step, monitorType);
      }
    }

    return null;
  }

  protected static override toDatabase(
    value: MonitorSteps | FindOperator<MonitorSteps>,
  ): JSONObject | null {
    if (value && value instanceof MonitorSteps) {
      return (value as MonitorSteps).toJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject,
  ): MonitorSteps | null {
    if (!value) {
      return null;
    }

    /*
     * Be lenient when reading from the database. Some rows can be created
     * with malformed monitorSteps (e.g. via Terraform or older migrations),
     * and throwing here makes those rows un-deletable and un-readable —
     * `_deleteBy` selects every column for the audit-log snapshot, so a
     * single bad row blocks DELETE entirely. Strict validation still runs
     * via fromJSON / getValidationError on writes from the API layer, which
     * is the right place to reject bad input.
     */
    try {
      return MonitorSteps.fromJSON(value);
    } catch {
      return new MonitorSteps();
    }
  }

  public override toString(): string {
    return JSON.stringify(this.toJSON());
  }

  public static override getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.MonitorSteps),
      value: Zod.object({
        monitorStepsInstanceArray: Zod.array(MonitorStep.getSchema()),
        defaultMonitorStatusId: Zod.string().optional(),
      }).openapi({
        type: "object",
        example: {
          monitorStepsInstanceArray: [],
          defaultMonitorStatusId: undefined,
        },
      }),
    }).openapi({
      type: "object",
      description: "MonitorSteps object",
      example: {
        _type: ObjectType.MonitorSteps,
        value: {
          monitorStepsInstanceArray: [],
          defaultMonitorStatusId: undefined,
        },
      },
    });
  }
}
