import { JSONObject, JSONValue } from "Common/Types/JSON";

export default class Query {
    private query: JSONObject = {};

    public equalTo(columnName: string, value: JSONValue): Query {
        this.query[columnName] = value; 
        return this;
    }
    
    public toJSON(): JSONObject {
        return this.query; 
    }
}