import { FindOperator } from "typeorm";
import DatabaseProperty from "../Database/DatabaseProperty";
import { JSONArray, JSONObject } from "../JSON";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";

export default class MonitorCriteria extends DatabaseProperty { 
    public monitorCriteria: Array<MonitorCriteriaInstance> = [];
    
    public constructor(){
        super();
    }

    public toJSON(): JSONArray {
        return this.monitorCriteria.map((criteria) => criteria.toJSON());
    }

    public fromJSON(jsonArray: JSONArray): MonitorCriteria {
        this.monitorCriteria = jsonArray.map((json: JSONObject) => new MonitorCriteriaInstance().fromJSON(json)));
        return this;
    }

    public isValid(): boolean {
        return true;
    }

    protected static override toDatabase(
        _value: MonitorCriteria | FindOperator<MonitorCriteria>
    ): JSONArray | null {
        if (_value) {
            return (_value as MonitorCriteria).toJSON();
        }

        return null;
    }

    protected static override fromDatabase(value: JSONArray): MonitorCriteria | null {
        if (value) {
            return new MonitorCriteria().fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}