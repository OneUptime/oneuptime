import type ObjectID from './ObjectID';
import type Version from './Version';
import type Email from './Email';
import type Phone from './Phone';
import type Color from './Color';
import type Route from './API/Route';
import type URL from './API/URL';
import type Name from './Name';
import type Permission from './Permission';
import type Search from './Database/Search';
import type Port from './Port';
import type Hostname from './API/Hostname';
import type HashedString from './HashedString';
import type GreaterThan from './Database/GreaterThan';
import type GreaterThanOrEqual from './Database/GreaterThanOrEqual';
import type LessThan from './Database/LessThan';
import type LessThanOrEqual from './Database/LessThanOrEqual';
import type InBetween from './Database/InBetween';
import type Domain from './Domain';
import type NotNull from './Database/NotNull';
import type { BaseEntity } from 'typeorm';

export enum ObjectType {
    ObjectID = 'ObjectID',
    Name = 'Name',
    Email = 'Email',
    Phone = 'Phone',
    Color = 'Color',
    Domain = 'Domain',
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
    Buffer = 'Buffer',
    InBetween = 'InBetween',
    NotNull = 'NotNull',
}

export type JSONValue =
    | Array<string>
    | string
    | Array<number>
    | number
    | Array<boolean>
    | boolean
    | JSONObject
    | Uint8Array
    | JSONArray
    | Date
    | Array<Date>
    | ObjectID
    | Array<ObjectID>
    | BaseEntity
    | Array<BaseEntity>
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
    | Domain
    | Array<Domain>
    | Array<Search>
    | GreaterThan
    | Array<GreaterThan>
    | GreaterThanOrEqual
    | Array<GreaterThanOrEqual>
    | LessThan
    | Array<LessThan>
    | InBetween
    | Array<InBetween>
    | NotNull
    | Array<NotNull>
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
    | undefined
    | null;

export interface JSONObject {
    [x: string]: JSONValue;
}

export type JSONArray = Array<JSONObject>;

export type JSONObjectOrArray = JSONObject | JSONArray;
