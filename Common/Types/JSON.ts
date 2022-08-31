import ObjectID from './ObjectID';
import Version from './Version';
import Email from './Email';
import Phone from './Phone';
import Color from './Color';
import Route from './API/Route';
import URL from './API/URL';
import Name from './Name';
import Permission from './Permission';
import Search from './Database/Search';
import Typeof from './Typeof';
import Port from './Port';
import Hostname from './API/Hostname';
import HashedString from './HashedString';
import DatabaseProperty from './Database/DatabaseProperty';
import OneUptimeDate from './Date';
import BaseModel from '../Models/BaseModel';
import GreaterThan from './Database/GreaterThan';
import GreaterThanOrEqual from './Database/GreaterThanOrEqual';
import LessThan from './Database/LessThan';
import LessThanOrEqual from './Database/LessThanOrEqual';
import InBetween from './Database/InBetween';

enum ObjectType {
    ObjectID = 'ObjectID',
    Name = 'Name',
    Email = 'Email',
    Phone = 'Phone',
    Color = 'Color',
    Version = 'Version',
    Route = 'Route',
    URL = 'URL',
    Permission = 'Permission',
    Search = 'Search',
    GreaterThan = 'GreaterThan',
    GreaterThanOrEqual = 'GreaterThanOrEqual',
    LessThan = 'LessThan',
    LessThanOrEqual = 'LessThanOrEqual',
    Port = 'Port',
    Hostname = 'Hostname',
    HashedString = 'HashedString',
    DateTime = 'DateTime',
    InBetween = 'InBetween'
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
    | BaseModel
    | Array<BaseModel>
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
    | Permission
    | Array<Permission>
    | Search
    | Array<Search>
    | GreaterThan
    | Array<GreaterThan>
    | GreaterThanOrEqual
    | Array<GreaterThanOrEqual>
    | LessThan
    | Array<LessThan>
    | InBetween
    | Array<InBetween>
    | LessThanOrEqual
    | Array<LessThanOrEqual>
    | Port
    | Array<Port>
    | HashedString
    | Array<HashedString>
    | Hostname
    | Array<Hostname>
    | Array<JSONValue>
    | Array<Permission>
    | Array<JSONValue>
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
    public static serialize(val: JSONObject): JSONObject {
        const newVal: JSONValue = {};

        for (const key in val) {
            if (val[key] === null || val[key] === undefined) {
                continue;
            }

            if (Array.isArray(val[key])) {
                const arraySerialize: Array<JSONValue> = [];
                for (const arrVal of val[key] as Array<JSONValue>) {
                    arraySerialize.push(this.serializeValue(arrVal));
                }

                newVal[key] = arraySerialize;
            } else {
                newVal[key] = this.serializeValue(val[key] as JSONValue);
            }
        }

        return newVal;
    }

    public static serializeValue(val: JSONValue): JSONValue {
        if (val === null || val === undefined) {
            return val;
        } else if (val && val instanceof Name) {
            return {
                _type: ObjectType.Name,
                value: (val as Name).toString(),
            };
        } else if (val && val instanceof ObjectID) {
            return {
                _type: ObjectType.ObjectID,
                value: (val as ObjectID).toString(),
            };
        } else if (val && val instanceof Phone) {
            return {
                _type: ObjectType.Phone,
                value: (val as Phone).toString(),
            };
        } else if (val && val instanceof Email) {
            return {
                _type: ObjectType.Email,
                value: (val as Email).toString(),
            };
        } else if (val && val instanceof Port) {
            return {
                _type: ObjectType.Port,
                value: (val as Port).toString(),
            };
        } else if (val && val instanceof HashedString) {
            return {
                _type: ObjectType.HashedString,
                value: (val as HashedString).toString(),
            };
        } else if (val && val instanceof Hostname) {
            return {
                _type: ObjectType.Hostname,
                value: (val as Hostname).toString(),
            };
        } else if (val && val instanceof Version) {
            return {
                _type: ObjectType.Version,
                value: (val as Version).toString(),
            };
        } else if (val && val instanceof Route) {
            return {
                _type: ObjectType.Route,
                value: (val as Route).toString(),
            };
        } else if (val && val instanceof URL) {
            return {
                _type: ObjectType.URL,
                value: (val as URL).toString(),
            };
        } else if (val && val instanceof Color) {
            return {
                _type: ObjectType.Color,
                value: (val as Color).toString(),
            };
        } else if (val && val instanceof Search) {
            return {
                _type: ObjectType.Search,
                value: (val as Search).toString(),
            };
        } else if (val && val instanceof LessThan) {
            return {
                _type: ObjectType.LessThan,
                value: (val as LessThan).value,
            };
        } else if (val && val instanceof InBetween) {
            return {
                _type: ObjectType.InBetween,
                startValue: (val as InBetween).startValue,
                endValue: (val as InBetween).endValue,
            };
        } else if (val && val instanceof GreaterThan) {
            return {
                _type: ObjectType.GreaterThan,
                value: (val as GreaterThan).value,
            };
        } else if (val && val instanceof LessThanOrEqual) {
            return {
                _type: ObjectType.LessThanOrEqual,
                value: (val as LessThanOrEqual).value,
            };
        } else if (val && val instanceof GreaterThanOrEqual) {
            return {
                _type: ObjectType.GreaterThanOrEqual,
                value: (val as GreaterThanOrEqual).value,
            };
        } else if (val && val instanceof Date) {
            return {
                _type: ObjectType.DateTime,
                value: OneUptimeDate.toString(val as Date).toString(),
            };
        } else if (typeof val === Typeof.Object) {
            return this.serialize(val as JSONObject);
        }

        return val;
    }

    public static deserializeValue(val: JSONValue): JSONValue {
        if (val === null || val === undefined) {
            return val;
        } else if (val instanceof DatabaseProperty) {
            return val;
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Name
        ) {
            return new Name((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.ObjectID
        ) {
            return new ObjectID((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Phone
        ) {
            return new Phone((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Email
        ) {
            return new Email((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Version
        ) {
            return new Name((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Route
        ) {
            return new Route((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.URL
        ) {
            return URL.fromString((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Port
        ) {
            return new Port((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Hostname
        ) {
            return new Hostname((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.HashedString
        ) {
            return new HashedString((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.DateTime
        ) {
            return OneUptimeDate.fromString(
                (val as JSONObject)['value'] as string
            );
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Color
        ) {
            return new Color((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            typeof (val as JSONObject)['value'] === Typeof.String &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Search
        ) {
            return new Search((val as JSONObject)['value'] as string);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            (typeof (val as JSONObject)['value'] === Typeof.Number || (val as JSONObject)['value'] instanceof Date) &&
            ((val as JSONObject)['_type'] as string) === ObjectType.LessThan
        ) {
            return new LessThan((val as JSONObject)['value'] as number | Date);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            (typeof (val as JSONObject)['value'] === Typeof.Number || (val as JSONObject)['value'] instanceof Date || typeof (val as JSONObject)['value'] === Typeof.String) && 
            ((val as JSONObject)['_type'] as string) === ObjectType.GreaterThan
        ) {
            return new GreaterThan((val as JSONObject)['value'] as number | Date);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            (typeof (val as JSONObject)['value'] === Typeof.Number || (val as JSONObject)['value'] instanceof Date || typeof (val as JSONObject)['value'] === Typeof.String) && 
            ((val as JSONObject)['_type'] as string) === ObjectType.LessThanOrEqual
        ) {
            return new LessThanOrEqual((val as JSONObject)['value'] as number | Date);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            (typeof (val as JSONObject)['value'] === Typeof.Number || (val as JSONObject)['value'] instanceof Date || typeof (val as JSONObject)['value'] === Typeof.String) && 
            ((val as JSONObject)['_type'] as string) === ObjectType.LessThanOrEqual
        ) {
            return new LessThanOrEqual((val as JSONObject)['value'] as number | Date);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            (typeof (val as JSONObject)['value'] === Typeof.Number || (val as JSONObject)['value'] instanceof Date || typeof (val as JSONObject)['value'] === Typeof.String) && 
            ((val as JSONObject)['_type'] as string) === ObjectType.GreaterThanOrEqual
        ) {
            return new GreaterThanOrEqual((val as JSONObject)['value'] as number | Date);
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['startValue'] &&
            (typeof (val as JSONObject)['startValue'] === Typeof.Number || typeof (val as JSONObject)['endValue'] === Typeof.String || (val as JSONObject)['startValue'] instanceof Date) && 
            (val as JSONObject)['endValue'] &&
            (typeof (val as JSONObject)['endValue'] === Typeof.Number || typeof (val as JSONObject)['endValue'] === Typeof.String ||  (val as JSONObject)['endValue'] instanceof Date) && 
            ((val as JSONObject)['_type'] as string) === ObjectType.InBetween
        ) {
            return new InBetween((val as JSONObject)['startValue'] as number | Date, (val as JSONObject)['endValue'] as number | Date,);
        } else if (val instanceof Date) {
            return val;
        } else if (typeof val === Typeof.Object) {
            return this.deserialize(val as JSONObject);
        }

        return val;
    }

    public static deserializeArray(array: JSONArray): JSONArray {
        const returnArr: JSONArray = [];

        for (const obj of array) {
            returnArr.push(this.deserialize(obj));
        }

        return returnArr;
    }

    public static serializeArray(array: JSONArray): JSONArray {
        const returnArr: JSONArray = [];

        for (const obj of array) {
            returnArr.push(this.serialize(obj));
        }

        return returnArr;
    }

    public static deserialize(val: JSONObject): JSONObject {
        const newVal: JSONObject = {};
        for (const key in val) {
            if (val[key] === null || val[key] === undefined) {
                continue;
            }

            if (Array.isArray(val[key])) {
                const arraySerialize: Array<JSONValue> = [];
                for (const arrVal of val[key] as Array<JSONValue>) {
                    arraySerialize.push(this.deserializeValue(arrVal));
                }

                newVal[key] = arraySerialize;
            } else {
                newVal[key] = this.deserializeValue(val[key] as JSONValue);
            }
        }

        return newVal;
    }
}

export type JSONObjectOrArray = JSONObject | JSONArray;
