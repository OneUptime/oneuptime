import Hostname from "./API/Hostname";
import Route from "./API/Route";
import URL from "./API/URL";
import EqualTo from "./BaseDatabase/EqualTo";
import EqualToOrNull from "./BaseDatabase/EqualToOrNull";
import GreaterThan from "./BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "./BaseDatabase/GreaterThanOrEqual";
import InBetween from "./BaseDatabase/InBetween";
import Includes from "./BaseDatabase/Includes";
import IncludesAll from "./BaseDatabase/IncludesAll";
import IncludesNone from "./BaseDatabase/IncludesNone";
import StartsWith from "./BaseDatabase/StartsWith";
import EndsWith from "./BaseDatabase/EndsWith";
import NotContains from "./BaseDatabase/NotContains";
import Wildcard from "./BaseDatabase/Wildcard";
import NotWildcard from "./BaseDatabase/NotWildcard";
import IsNull from "./BaseDatabase/IsNull";
import LessThan from "./BaseDatabase/LessThan";
import LessThanOrEqual from "./BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "./BaseDatabase/LessThanOrNull";
import GreaterThanOrNull from "./BaseDatabase/GreaterThanOrNull";
import NotEqual from "./BaseDatabase/NotEqual";
import NotNull from "./BaseDatabase/NotNull";
import Search from "./BaseDatabase/Search";
import MultiSearch from "./BaseDatabase/MultiSearch";
import Color from "./Color";
import OneUptimeDate from "./Date";
import Dictionary from "./Dictionary";
import Domain from "./Domain";
import Email from "./Email";
import Recurring from "./Events/Recurring";
import HashedString from "./HashedString";
import IP from "./IP/IP";
import { ObjectType } from "./JSON";
import MonitorCriteria from "./Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "./Monitor/MonitorCriteriaInstance";
import MonitorStep from "./Monitor/MonitorStep";
import MonitorSteps from "./Monitor/MonitorSteps";
import Name from "./Name";
import ObjectID from "./ObjectID";
import Phone from "./Phone";
import Port from "./Port";
import Version from "./Version";

/*
 * Every entry is a getter, not a direct reference.
 *
 * Three of these classes — Includes, IncludesAll and IncludesNone — import
 * JSONFunctions so their fromJSON can deserialize the values inside them, and
 * JSONFunctions imports this dictionary. That is a cycle, and with a plain
 * object literal the entry a cycle passes through is captured as `undefined`:
 * whichever of the two modules loads second sees the first only half
 * initialized. Which of them loads first depends on the whole app's import
 * graph, so `{"_type":"Includes","value":[...]}` deserialized into a real
 * Includes in some entry points and stayed a plain object in others — and a
 * plain object reaching TypeORM is a silently wrong query, not an error.
 *
 * A getter defers the lookup to the first property access, by which time every
 * module has finished initializing.
 */
const SerializableObjectDictionary: Dictionary<any> = {
  get [ObjectType.Phone](): any {
    return Phone;
  },
  get [ObjectType.DateTime](): any {
    return OneUptimeDate;
  },
  get [ObjectType.ObjectID](): any {
    return ObjectID;
  },
  get [ObjectType.Name](): any {
    return Name;
  },
  get [ObjectType.EqualTo](): any {
    return EqualTo;
  },
  get [ObjectType.EqualToOrNull](): any {
    return EqualToOrNull;
  },
  get [ObjectType.MonitorSteps](): any {
    return MonitorSteps;
  },
  get [ObjectType.MonitorStep](): any {
    return MonitorStep;
  },
  get [ObjectType.MonitorCriteria](): any {
    return MonitorCriteria;
  },
  get [ObjectType.MonitorCriteriaInstance](): any {
    return MonitorCriteriaInstance;
  },
  get [ObjectType.NotEqual](): any {
    return NotEqual;
  },
  get [ObjectType.Email](): any {
    return Email;
  },
  get [ObjectType.Color](): any {
    return Color;
  },
  get [ObjectType.Domain](): any {
    return Domain;
  },
  get [ObjectType.Version](): any {
    return Version;
  },
  get [ObjectType.Route](): any {
    return Route;
  },
  get [ObjectType.URL](): any {
    return URL;
  },
  get [ObjectType.IP](): any {
    return IP;
  },
  get [ObjectType.Search](): any {
    return Search;
  },
  get [ObjectType.MultiSearch](): any {
    return MultiSearch;
  },
  get [ObjectType.GreaterThan](): any {
    return GreaterThan;
  },
  get [ObjectType.GreaterThanOrEqual](): any {
    return GreaterThanOrEqual;
  },
  get [ObjectType.LessThan](): any {
    return LessThan;
  },
  get [ObjectType.LessThanOrEqual](): any {
    return LessThanOrEqual;
  },
  get [ObjectType.LessThanOrNull](): any {
    return LessThanOrNull;
  },
  get [ObjectType.GreaterThanOrNull](): any {
    return GreaterThanOrNull;
  },
  get [ObjectType.Port](): any {
    return Port;
  },
  get [ObjectType.Hostname](): any {
    return Hostname;
  },
  get [ObjectType.HashedString](): any {
    return HashedString;
  },
  get [ObjectType.InBetween](): any {
    return InBetween;
  },
  get [ObjectType.Includes](): any {
    return Includes;
  },
  get [ObjectType.IncludesAll](): any {
    return IncludesAll;
  },
  get [ObjectType.IncludesNone](): any {
    return IncludesNone;
  },
  get [ObjectType.StartsWith](): any {
    return StartsWith;
  },
  get [ObjectType.EndsWith](): any {
    return EndsWith;
  },
  get [ObjectType.NotContains](): any {
    return NotContains;
  },
  get [ObjectType.Wildcard](): any {
    return Wildcard;
  },
  get [ObjectType.NotWildcard](): any {
    return NotWildcard;
  },
  get [ObjectType.NotNull](): any {
    return NotNull;
  },
  get [ObjectType.IsNull](): any {
    return IsNull;
  },
  get [ObjectType.Recurring](): any {
    return Recurring;
  },
};

export default SerializableObjectDictionary;
