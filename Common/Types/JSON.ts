import Hostname from './API/Hostname';
import Route from './API/Route';
import URL from './API/URL';
import EqualToOrNull from './BaseDatabase/EqualToOrNull';
import GreaterThan from './BaseDatabase/GreaterThan';
import GreaterThanOrEqual from './BaseDatabase/GreaterThanOrEqual';
import InBetween from './BaseDatabase/InBetween';
import Includes from './BaseDatabase/Includes';
import LessThan from './BaseDatabase/LessThan';
import LessThanOrEqual from './BaseDatabase/LessThanOrEqual';
import NotEqual from './BaseDatabase/NotEqual';
import NotNull from './BaseDatabase/NotNull';
import Search from './BaseDatabase/Search';
import CallRequest from './Call/CallRequest';
import Color from './Color';
import Domain from './Domain';
import Email from './Email';
import HashedString from './HashedString';
import { CheckOn, FilterType } from './Monitor/CriteriaFilter';
import Name from './Name';
import ObjectID from './ObjectID';
import Permission from './Permission';
import Phone from './Phone';
import Port from './Port';
import PositiveNumber from './PositiveNumber';
import StartAndEndTime from './Time/StartAndEndTime';
import Version from './Version';
import { BaseEntity } from 'typeorm';

export enum ObjectType {
    ObjectID = 'ObjectID',
    Decimal = 'Decimal',
    Name = 'Name',
    EqualToOrNull = 'EqualToOrNull',
    MonitorSteps = 'MonitorSteps',
    MonitorStep = 'MonitorStep',
    Recurring = 'Recurring',
    RestrictionTimes = 'RestrictionTimes',
    MonitorCriteria = 'MonitorCriteria',
    PositiveNumber = 'PositiveNumber',
    MonitorCriteriaInstance = 'MonitorCriteriaInstance',
    NotEqual = 'NotEqual',
    Email = 'Email',
    Phone = 'Phone',
    Color = 'Color',
    Domain = 'Domain',
    Version = 'Version',
    IP = 'IP',
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
    IsNull = 'IsNull',
    Includes = 'Includes',
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
    | CheckOn
    | Array<CheckOn>
    | FilterType
    | Array<FilterType>
    | Search
    | Domain
    | Array<Domain>
    | Array<Search>
    | EqualToOrNull
    | Array<EqualToOrNull>
    | NotEqual
    | Array<NotEqual>
    | GreaterThan
    | Array<GreaterThan>
    | GreaterThanOrEqual
    | Array<GreaterThanOrEqual>
    | PositiveNumber
    | Array<PositiveNumber>
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
    | Array<ObjectID>
    | CallRequest
    | undefined
    | null
    | StartAndEndTime
    | Array<StartAndEndTime>
    | Includes
    | Array<Includes>;

export interface JSONObject {
    [x: string]: JSONValue;
}

export type JSONArray = Array<JSONObject>;

export type JSONObjectOrArray = JSONObject | JSONArray;
