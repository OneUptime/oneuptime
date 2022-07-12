import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";

export default class Select {
    private select: Dictionary<boolean> = {};

    public selectColumn(columnName: string): Select {
        this.select[columnName] = true; 
        return this;
    }
    
    public toJSON(): JSONObject {
        return this.select; 
    }
}