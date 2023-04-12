import { FindOperator } from "typeorm";
import DatabaseProperty from "../Database/DatabaseProperty";
import { JSONArray, JSONObject } from "../JSON";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import BadDataException from "../Exception/BadDataException";


export interface MonitorCriteriaType {
    monitorCriteriaInstanceArray: Array<MonitorCriteriaInstance>;
}

export default class MonitorCriteria extends DatabaseProperty { 
    public monitorCriteria: MonitorCriteriaType | undefined = undefined;
    
    public constructor(){
        super();
    }

    public toJSON(): JSONObject {

        if(!this.monitorCriteria){
            return {
                _type: "MonitorCriteria",
                value: {}
            };
        }

        return {
            _type: "MonitorCriteria",
            value: {
                monitorCriteriaInstanceArray: this.monitorCriteria.monitorCriteriaInstanceArray.map((criteria) => criteria.toJSON())
            }
        }
    }

    public fromJSON(json: JSONObject): MonitorCriteria {

        if(!json){
            throw new BadDataException("Invalid monitor criteria");
        }

        if(!json['value']){
            throw new BadDataException("Invalid monitor criteria");
        }
        
        if(!(json['value'] as JSONObject)['monitorCriteriaInstanceArray']){
            throw new BadDataException("Invalid monitor criteria");
        }

        let monitorCriteriaInstanceArray: JSONArray = (json['value'] as JSONObject)['monitorCriteriaInstanceArray'] as JSONArray;


        this.monitorCriteria = {
            monitorCriteriaInstanceArray:  monitorCriteriaInstanceArray.map((json: JSONObject) => new MonitorCriteriaInstance().fromJSON(json))
        }

        return this;
    }

    public static isValid(_json: JSONObject): boolean {
        return true;
    }

    protected static override toDatabase(
        _value: MonitorCriteria | FindOperator<MonitorCriteria>
    ): JSONObject | null {
        if (_value) {
            return (_value as MonitorCriteria).toJSON();
        }

        return null;
    }

    protected static override fromDatabase(value: JSONObject): MonitorCriteria | null {
        if (value) {
            return new MonitorCriteria().fromJSON(value);
        }

        return null;
    }

    public override toString(): string {
        return JSON.stringify(this.toJSON());
    }
}