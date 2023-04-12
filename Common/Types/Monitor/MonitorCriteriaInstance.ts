import { FindOperator } from "typeorm";
import DatabaseProperty from "../Database/DatabaseProperty";
import { JSONObject } from "../JSON";

export default class MonitorCriteriaInstance extends DatabaseProperty {
    
    public monitorCriteriaInstance: JSONObject = {};
    
    public constructor(){
        super();
    }

    public toJSON(): JSONObject {
        return this.monitorCriteriaInstance;
    }

    public fromJSON(json: JSONObject): MonitorCriteriaInstance {
        this.monitorCriteriaInstance = json;
        return this;
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    protected static override toDatabase(
        _value: MonitorCriteriaInstance | FindOperator<MonitorCriteriaInstance>
    ): JSONObject | null {
        if (_value) {
            return (_value as MonitorCriteriaInstance).toJSON();
        }

        return null;
    }

    protected static override fromDatabase(value: JSONObject): MonitorCriteriaInstance | null {
        if (value) {
            return new MonitorCriteriaInstance().fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}

