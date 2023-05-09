import Dictionary from './Dictionary';
import Phone from './Phone';
import { ObjectType } from './JSON';
import ObjectID from './ObjectID';
import Name from './Name';
import EqualToOrNull from './Database/EqualToOrNull';
import MonitorSteps from './Monitor/MonitorSteps';
import MonitorStep from './Monitor/MonitorStep';
import MonitorCriteria from './Monitor/MonitorCriteria';
import MonitorCriteriaInstance from './Monitor/MonitorCriteriaInstance';
import NotEqual from './Database/NotEqual';
import Email from './Email';
import Color from './Color';
import Domain from './Domain';
import Version from './Version';
import Route from './API/Route';
import URL from './API/URL';
import Search from './Database/Search';
import GreaterThan from './Database/GreaterThan';
import GreaterThanOrEqual from './Database/GreaterThanOrEqual';
import LessThan from './Database/LessThan';
import LessThanOrEqual from './Database/LessThanOrEqual';
import Port from './Port';
import Hostname from './API/Hostname';
import HashedString from './HashedString';
import InBetween from './Database/InBetween';
import NotNull from './Database/NotNull';
import IsNull from './Database/IsNull';

const SerializableObjectDictionary: Dictionary<any> = {
    [ObjectType.Phone]: Phone,
    [ObjectType.ObjectID]: ObjectID,
    [ObjectType.Name]: Name,
    [ObjectType.EqualToOrNull]: EqualToOrNull,
    [ObjectType.MonitorSteps]: MonitorSteps,
    [ObjectType.MonitorStep]: MonitorStep,
    [ObjectType.MonitorCriteria]: MonitorCriteria,
    [ObjectType.MonitorCriteriaInstance]: MonitorCriteriaInstance,
    [ObjectType.NotEqual]: NotEqual,
    [ObjectType.Email]: Email,
    [ObjectType.Color]: Color,
    [ObjectType.Domain]: Domain,
    [ObjectType.Version]: Version,
    [ObjectType.Route]: Route,
    [ObjectType.URL]: URL,
    [ObjectType.Search]: Search,
    [ObjectType.GreaterThan]: GreaterThan,
    [ObjectType.GreaterThanOrEqual]: GreaterThanOrEqual,
    [ObjectType.LessThan]: LessThan,
    [ObjectType.LessThanOrEqual]: LessThanOrEqual,
    [ObjectType.Port]: Port,
    [ObjectType.Hostname]: Hostname,
    [ObjectType.HashedString]: HashedString,
    [ObjectType.InBetween]: InBetween,
    [ObjectType.NotNull]: NotNull,
    [ObjectType.IsNull]: IsNull,
};

export default SerializableObjectDictionary;
