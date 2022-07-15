import ObjectID from './ObjectID';
import Version from './Version';
import Email from './Email';
import Phone from './Phone';
import Color from './Color';
import Route from './API/Route';
import URL from './API/URL';
import Name from './Name';

enum ObjectType { 
    ObjectID = "ObjectID", 
    Name = "Name", 
    Email = "Email", 
    Phone = "Phone", 
    Color = "Color", 
    Version = "Version",
    Route = "Route",
    URL = "URL"
}

export type JSONValue =
    | Array<string>
    | string
    | Array<number>
    | number
    | Array<boolean>
    | boolean
    | JSONObject
    | JSONArray
    | Date
    | Array<Date>
    | ObjectID
    | Array<ObjectID>
    | Name
    | Array<Name>
    | Email
    | Array<Email>
    | Color
    | Array<Color>
    | Phone
    | Array<Phone>
    | Route
    | Array<Route>
    | URL
    | Array<URL>
    | Array<Version>
    | Version
    | Buffer
    | null;

export interface JSONObject {
    [x: string]: JSONValue;
}

export type JSONArray = Array<JSONObject>;

export class JSONFunctions {
    public static toCompressedString(val: JSONValue): string {
        return JSON.stringify(val, null, 2);
    }

    public static toString(val: JSONValue): string {
        return JSON.stringify(val);
    }

    // this funciton serializes JSON with Common Objects to JSON that can be stringified. 
    public static serialize(val: JSONObjectOrArray): JSONObjectOrArray {
        if (Array.isArray(val)) {

            const returnObj: JSONArray = [];
            
            for (const obj of val) {
                returnObj.push(this.serialize(obj) as JSONObject);
            }

            return returnObj;
        }

        for (const key in val) {
            if (!val[key]) {
                continue; 
            } else if (val[key] && Array.isArray(val[key])) {
                val[key] = this.serialize(val[key]  as JSONObject);
            }
            else if (val[key] && val[key] instanceof Name) {
                val[key] = {
                    _type: ObjectType.Name,
                    value: (val[key] as Name).toString()
                }
            }else if (val[key] && val[key] instanceof ObjectID) {
                val[key] = {
                    _type: ObjectType.ObjectID,
                    value: (val[key] as ObjectID).toString()
                }
            }else if (val[key] && val[key] instanceof Phone) {
                val[key] = {
                    _type: ObjectType.Phone,
                    value: (val[key] as Phone).toString()
                }
            }else if (val[key] && val[key] instanceof Email) {
                val[key] = {
                    _type: ObjectType.Email,
                    value: (val[key] as Email).toString()
                }
            }else if (val[key] && val[key] instanceof Version) {
                val[key] = {
                    _type: ObjectType.Version,
                    value: (val[key] as Version).toString()
                }
            }else if (val[key] && val[key] instanceof Route) {
                val[key] = {
                    _type: ObjectType.Route,
                    value: (val[key] as Route).toString()
                }
            }else if (val[key] && val[key] instanceof URL) {
                val[key] = {
                    _type: ObjectType.URL,
                    value: (val[key] as URL).toString()
                }
            }else if (val[key] && val[key] instanceof Color) {
                val[key] = {
                    _type: ObjectType.URL,
                    value: (val[key] as URL).toString()
                }
            }else if (typeof val[key] === "object") {
                val[key] = this.serialize(val[key]  as JSONObject);
            } else {
                continue; 
            }
        }

        return val; 
    }

    public static deserialize(val: JSONObjectOrArray): JSONObjectOrArray{

        if (Array.isArray(val)) {

            const returnObj: JSONArray = [];
            
            for (const obj of val) {
                returnObj.push(this.deserialize(obj) as JSONObject);
            }

            return returnObj;
        }

        for (const key in val) {
            if (!val[key]) {
                continue; 
            } else if (val[key] && Array.isArray(val[key])) {
                val[key] = this.deserialize(val[key] as JSONArray);
            }
            else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.Name) {
                val[key] = new Name((val[key] as JSONObject)["value"] as string);
            }else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.ObjectID) {
                val[key] = new ObjectID((val[key] as JSONObject)["value"] as string);
            }else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.Phone) {
                val[key] = new Phone((val[key] as JSONObject)["value"] as string);
            }else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.Email) {
                val[key] = new Email((val[key] as JSONObject)["value"] as string);
            }else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.Version) {
                val[key] = new Name((val[key] as JSONObject)["value"] as string);
            }else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.Route) {
                val[key] = new Route((val[key] as JSONObject)["value"] as string);
            }else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.URL) {
                val[key] = URL.fromString((val[key] as JSONObject)["value"] as string);
            }else if (val[key] && typeof val[key] === "object" && (val[key] as JSONObject)["_type"] && (val[key] as JSONObject)["value"] && typeof (val[key] as JSONObject)["value"] === "string" &&  ((val[key] as JSONObject)["_type"] as string) === ObjectType.Color) {
                val[key] = new Color((val[key] as JSONObject)["value"] as string);
            }else if (typeof val[key] === "object") {
                val[key] = this.deserialize(val[key]  as JSONObject);
            } else {
                continue; 
            }
        }

        return val; 
    }
}

export type JSONObjectOrArray = JSONObject | JSONArray;
