import { JSONObject } from "../JSON";
import { translationKey } from "../Translator";
import SecuritySeverity from "../SecuritySeverity";
import {
  BREACH_CONDITION_WORDS,
  BREACH_DATA_ELEMENT_TYPES,
  BREACH_LAW_RULES,
  BREACH_PLACE_WORDS,
  BreachCondition,
  BreachDataElement,
  BreachDeadlineStart,
  BreachDeadlineUnit,
  BreachLawFamily,
  BreachLawId,
  BreachLawRule,
  BreachPeopleThreshold,
  BreachPlace,
  COVERED_PLACES,
  getBreachLawRule,
  getBreachPlaceOfCountry,
  isBreachLawId,
  isBreachPlace,
  isUsStatePlace,
  ONLINE_ACCOUNT_TYPES,
  PASSWORD_TYPES,
  PERSON_NAME_TYPE,
} from "./BreachLaws";
import {
  ComplianceFact,
  ComplianceFactKind,
  getFactKeys,
  getFactsHash,
  getUnfoundedNumbers,
  readComplianceFacts,
  withoutFactIds,
} from "./ComplianceFacts";
import DataCategory, { isPersonalDataCategory } from "./DataCategory";
import DataSensitivity from "./DataSensitivity";
import { getBuiltInDataType } from "./DataTypeCatalog";
import {
  cleanSectionMarkdown,
  ImpactAssessmentSectionSource,
} from "./ImpactAssessment";

/*
 * WAS IT A BREACH? A DATA EXPOSURE, ASSESSED (#10377).
 *
 * When a store of sensitive data was open to people who should not read
 * it - public on the internet, shared with an account outside the
 * company - closing it is the easy part. The questions that follow come
 * under a deadline: for how long was it open, did anyone read it, whose
 * data was in it, and which law says to tell whom, by when. Data Security
 * knows most of the answers, and this file works them out, in plain code,
 * from what it knows:
 *
 *   - the window (getExposureWindow): from the change in the cloud's log
 *     that exposed it - or, when there is none, the first scan that saw it
 *     exposed, said as "at least since" - to the change that closed it,
 *     Data Security's own response, or the scan that saw it closed;
 *   - who read it (getExposureReads): whether reads were logged at all,
 *     and who could read it - anyone on the internet, accounts outside the
 *     company. OneUptime does not read the logs themselves yet (#6107), so
 *     when reads were not logged it says so plainly: treat the data as
 *     read;
 *   - whose data (getWhoseData): its data types and categories, special
 *     category data among them, about how many records, the countries the
 *     data says its people are in, and where a person said they live;
 *   - the secrets to rotate: each secret type found in the store and
 *     where - never its value;
 *   - what the law may ask (applyBreachLaws): the table of BreachLaws.ts
 *     applied to those facts, each notice with why it may apply or does
 *     not, what a person must still check, and its deadline counted from
 *     when the exposure was found - and what the table does not cover
 *     (getUncoveredLaws), so silence is never read as "no obligation".
 *
 * OneUptime AI only explains and drafts from those facts: an explanation,
 * a notice to the regulator, a notice to the people affected and an
 * internal summary, each held to the facts it was given - a number none of
 * them holds, or a law none of them names, drops the draft
 * (holdExposureDraftsToFacts) - and each text a person edits and copies.
 * Nothing is sent anywhere. It is not legal advice.
 *
 * Pure, for the server and the Dashboard alike.
 */

/*
 * ---------------------------------------------------------------------------
 * Which exposures are assessed
 * ---------------------------------------------------------------------------
 */

// The checks that find a store open to people outside the company.
export const EXPOSURE_CHECK_IDS: ReadonlyArray<string> = [
  "public-read",
  "public-write",
  "snapshot-public",
  "snapshot-shared-externally",
  "shared-with-external-accounts",
];

// The checks that find a store open to anyone on the internet.
export const PUBLIC_EXPOSURE_CHECK_IDS: ReadonlyArray<string> = [
  "public-read",
  "public-write",
  "snapshot-public",
];

export function isExposureCheck(checkId: string | null | undefined): boolean {
  return Boolean(checkId) && EXPOSURE_CHECK_IDS.includes(checkId!);
}

/*
 * The stores a Critical exposure is assessed on its own for: those that
 * hold Restricted or Confidential data. Any other case about a store is
 * assessed when a person asks.
 */
export const ASSESSED_ON_ITS_OWN_SENSITIVITIES: ReadonlyArray<DataSensitivity> =
  [DataSensitivity.Restricted, DataSensitivity.Confidential];

export function isAssessedOnItsOwn(data: {
  severity: string | null | undefined;
  checkId: string | null | undefined;
  sensitivity: string | null | undefined;
}): boolean {
  return (
    data.severity === SecuritySeverity.Critical &&
    isExposureCheck(data.checkId) &&
    (ASSESSED_ON_ITS_OWN_SENSITIVITIES as ReadonlyArray<string>).includes(
      data.sensitivity || "",
    )
  );
}

/*
 * ---------------------------------------------------------------------------
 * The window
 * ---------------------------------------------------------------------------
 */

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

// How far before an exposure was found a change of the cloud's log is read as the one that made it.
export const EXPOSING_CHANGE_LOOKBACK_IN_DAYS: number = 30;

// Which way a change of a store's access moves it.
export enum ExposureChangeDirection {
  Opens = "Opens",
  Closes = "Closes",
  // A policy or an ACL written: the log does not say which way.
  Either = "Either",
}

const OPENING_OPERATIONS: ReadonlyArray<string> = [
  "s3:DeleteBucketPublicAccessBlock",
  "s3:DeleteAccountPublicAccessBlock",
  "rds:CopyDBSnapshot",
];

const CLOSING_OPERATIONS: ReadonlyArray<string> = [
  "s3:PutBucketPublicAccessBlock",
  "s3:PutAccountPublicAccessBlock",
  "s3:DeleteBucketPolicy",
];

const EITHER_WAY_OPERATIONS: ReadonlyArray<string> = [
  "s3:PutBucketPolicy",
  "s3:PutBucketAcl",
  "s3:PutObjectAcl",
  "rds:ModifyDBInstance",
  "rds:ModifyDBCluster",
  "redshift:ModifyCluster",
  "es:UpdateDomainConfig",
];

const SNAPSHOT_SHARING_OPERATIONS: ReadonlyArray<string> = [
  "rds:ModifyDBSnapshotAttribute",
  "rds:ModifyDBClusterSnapshotAttribute",
];

/*
 * Which way a change of the cloud's log moves who can reach a store, or
 * null for a change of something else. A change of who may restore a
 * snapshot opens it when it named accounts to add, and closes it when it
 * only took accounts off (oneuptime.cloud.grants_access).
 */
export function getExposureChangeDirection(data: {
  operation: string;
  grantsAccess?: boolean | undefined;
}): ExposureChangeDirection | null {
  if (OPENING_OPERATIONS.includes(data.operation)) {
    return ExposureChangeDirection.Opens;
  }

  if (CLOSING_OPERATIONS.includes(data.operation)) {
    return ExposureChangeDirection.Closes;
  }

  if (EITHER_WAY_OPERATIONS.includes(data.operation)) {
    return ExposureChangeDirection.Either;
  }

  if (SNAPSHOT_SHARING_OPERATIONS.includes(data.operation)) {
    if (data.grantsAccess === true) {
      return ExposureChangeDirection.Opens;
    }

    return data.grantsAccess === false
      ? ExposureChangeDirection.Closes
      : ExposureChangeDirection.Either;
  }

  return null;
}

// One change of a store's access, as the cloud's log recorded it.
export interface ExposureStoreChange {
  time: Date | string;
  operation: string;
  direction: ExposureChangeDirection;
  failed?: boolean | undefined;
  madeByOneUptime?: boolean | undefined;
}

// What happened to an exposure issue, as its timeline says, in order.
export enum ExposureIssueEvent {
  Opened = "Opened",
  Reopened = "Reopened",
  Resolved = "Resolved",
}

export interface ExposureIssueEntry {
  event: ExposureIssueEvent;
  at: Date | string;
}

// One of the case's exposure issues, with its timeline.
export interface ExposureIssueFacts {
  id: string;
  checkId: string;
  title?: string | undefined;
  severity?: string | undefined;
  status?: string | undefined;
  firstDetectedAt?: Date | string | null | undefined;
  resolvedAt?: Date | string | null | undefined;
  timeline: ReadonlyArray<ExposureIssueEntry>;
}

// A response Data Security took on the store that closed the exposure, from its timeline.
export interface ExposureResponseEntry {
  at: Date | string;
  // Block public access or revoke sharing: what closes an exposure.
  closesExposure: boolean;
}

// Where the window starts.
export enum ExposureWindowStartKind {
  // At the change of the cloud's log that exposed it.
  Change = "Change",
  // At least since the first scan that saw it exposed.
  FirstSeen = "FirstSeen",
}

// Where it ends.
export enum ExposureWindowEndKind {
  // At the change of the cloud's log that closed it.
  Change = "Change",
  // At the response Data Security took.
  ResponseAction = "ResponseAction",
  // By the scan that saw it closed, at the latest.
  Scan = "Scan",
  StillOpen = "StillOpen",
}

export interface ExposurePeriod {
  start: string;
  end?: string | undefined;
}

export interface ExposureWindow {
  // When Data Security found it: the first detection of this period.
  foundAt: string;
  start: string;
  startKind: ExposureWindowStartKind;
  // The change that exposed it, as the log names it.
  startOperation?: string | undefined;
  end?: string | undefined;
  endKind: ExposureWindowEndKind;
  endOperation?: string | undefined;
  isStillOpen: boolean;
  // How long it was open, in whole hours and whole days.
  hours: number;
  days: number;
  // Earlier times the same exposure was open, oldest first.
  earlierPeriods: Array<ExposurePeriod>;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

function toIso(time: number): string {
  return new Date(time).toISOString();
}

interface Interval {
  start: number;
  end: number | null;
}

// The times one issue was open, from its timeline (or its first and last detection).
export function getIssueOpenIntervals(
  issue: ExposureIssueFacts,
  now: Date,
): Array<Interval> {
  const first: number | null = toTime(issue.firstDetectedAt);
  const entries: Array<{ event: ExposureIssueEvent; at: number }> = [
    ...issue.timeline,
  ]
    .map((entry: ExposureIssueEntry) => {
      return { event: entry.event, at: toTime(entry.at) };
    })
    .filter(
      (entry: {
        event: ExposureIssueEvent;
        at: number | null;
      }): entry is { event: ExposureIssueEvent; at: number } => {
        return entry.at !== null && entry.at <= now.getTime();
      },
    )
    .sort((a: { at: number }, b: { at: number }): number => {
      return a.at - b.at;
    });
  const intervals: Array<Interval> = [];
  let openSince: number | null = first;

  for (const entry of entries) {
    if (
      entry.event === ExposureIssueEvent.Opened ||
      entry.event === ExposureIssueEvent.Reopened
    ) {
      if (openSince === null) {
        openSince = entry.at;
      } else if (entry.event === ExposureIssueEvent.Opened) {
        // The first detection, written again: the earlier of the two.
        openSince = Math.min(openSince, entry.at);
      }

      continue;
    }

    if (openSince !== null && entry.at >= openSince) {
      intervals.push({ start: openSince, end: entry.at });
      openSince = null;
    }
  }

  if (openSince !== null) {
    const resolved: number | null = toTime(issue.resolvedAt);

    intervals.push({
      start: openSince,
      end:
        resolved !== null && resolved >= openSince && issue.status !== "Open"
          ? resolved
          : null,
    });
  }

  return intervals;
}

// The union of the case's issues' open times, oldest first.
function mergeIntervals(intervals: Array<Interval>): Array<Interval> {
  const sorted: Array<Interval> = [...intervals].sort(
    (a: Interval, b: Interval): number => {
      return a.start - b.start;
    },
  );
  const merged: Array<Interval> = [];

  for (const interval of sorted) {
    const last: Interval | undefined = merged[merged.length - 1];

    if (last && (last.end === null || interval.start <= last.end)) {
      last.end =
        last.end === null || interval.end === null
          ? null
          : Math.max(last.end, interval.end);
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

/*
 * The window of the case's exposure: the latest time its issues were open,
 * merged, from the change that exposed it to the one that closed it.
 *
 * A change of the log starts the window only when it is proven to be the
 * one that exposed the store: it came before the scan that found it, no
 * more than EXPOSING_CHANGE_LOOKBACK_IN_DAYS before, after any earlier
 * exposure ended, and after Data Security first saw the store - so a scan
 * before it saw the store closed. Otherwise the store may have been open
 * before anyone looked, and the window says "at least since" the first
 * scan that saw it exposed.
 */
export function getExposureWindow(data: {
  issues: ReadonlyArray<ExposureIssueFacts>;
  changes: ReadonlyArray<ExposureStoreChange>;
  responses: ReadonlyArray<ExposureResponseEntry>;
  storeFirstSeenAt?: Date | string | null | undefined;
  now: Date;
}): ExposureWindow | null {
  const periods: Array<Interval> = mergeIntervals(
    data.issues.flatMap((issue: ExposureIssueFacts): Array<Interval> => {
      return getIssueOpenIntervals(issue, data.now);
    }),
  );
  const current: Interval | undefined = periods[periods.length - 1];

  if (!current) {
    return null;
  }

  const earlier: Array<Interval> = periods.slice(0, -1);
  const previousEnd: number | null =
    earlier.length > 0 ? earlier[earlier.length - 1]!.end : null;
  const foundAt: number = current.start;
  const firstSeenAt: number | null = toTime(data.storeFirstSeenAt);
  const changes: Array<{
    time: number;
    operation: string;
    direction: ExposureChangeDirection;
  }> = data.changes
    .filter((change: ExposureStoreChange): boolean => {
      return change.failed !== true;
    })
    .map((change: ExposureStoreChange) => {
      return {
        time: toTime(change.time) ?? NaN,
        operation: change.operation,
        direction: change.direction,
      };
    })
    .filter((change: { time: number }): boolean => {
      return Number.isFinite(change.time);
    })
    .sort((a: { time: number }, b: { time: number }): number => {
      return a.time - b.time;
    });

  const exposing:
    | { time: number; operation: string; direction: ExposureChangeDirection }
    | undefined = changes
    .filter(
      (change: {
        time: number;
        direction: ExposureChangeDirection;
      }): boolean => {
        return (
          change.direction !== ExposureChangeDirection.Closes &&
          change.time <= foundAt &&
          change.time >= foundAt - EXPOSING_CHANGE_LOOKBACK_IN_DAYS * DAY_IN_MS &&
          (previousEnd === null || change.time > previousEnd) &&
          firstSeenAt !== null &&
          firstSeenAt < change.time
        );
      },
    )
    .pop();

  const start: number = exposing ? exposing.time : foundAt;
  let end: number | null = current.end;
  let endKind: ExposureWindowEndKind = ExposureWindowEndKind.StillOpen;
  let endOperation: string | undefined = undefined;

  if (end !== null) {
    const resolvedAt: number = end;
    const response: number | undefined = data.responses
      .filter((entry: ExposureResponseEntry): boolean => {
        return entry.closesExposure;
      })
      .map((entry: ExposureResponseEntry): number | null => {
        return toTime(entry.at);
      })
      .filter((time: number | null): time is number => {
        return time !== null && time >= start && time <= resolvedAt;
      })
      .sort((a: number, b: number): number => {
        return a - b;
      })
      .pop();
    const closing:
      | { time: number; operation: string; direction: ExposureChangeDirection }
      | undefined = changes
      .filter(
        (change: {
          time: number;
          direction: ExposureChangeDirection;
        }): boolean => {
          return (
            change.direction !== ExposureChangeDirection.Opens &&
            change.time >= start &&
            change.time <= resolvedAt
          );
        },
      )
      .pop();

    if (response !== undefined) {
      end = response;
      endKind = ExposureWindowEndKind.ResponseAction;
    } else if (closing) {
      end = closing.time;
      endKind = ExposureWindowEndKind.Change;
      endOperation = closing.operation;
    } else {
      endKind = ExposureWindowEndKind.Scan;
    }
  }

  const until: number = end === null ? data.now.getTime() : end;
  const hours: number = Math.max(0, Math.floor((until - start) / HOUR_IN_MS));

  return {
    foundAt: toIso(foundAt),
    start: toIso(start),
    startKind: exposing
      ? ExposureWindowStartKind.Change
      : ExposureWindowStartKind.FirstSeen,
    startOperation: exposing ? exposing.operation : undefined,
    end: end === null ? undefined : toIso(end),
    endKind,
    endOperation,
    isStillOpen: end === null,
    hours,
    days: Math.floor(hours / 24),
    earlierPeriods: earlier.map((interval: Interval): ExposurePeriod => {
      return {
        start: toIso(interval.start),
        end: interval.end === null ? undefined : toIso(interval.end),
      };
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Who read it
 * ---------------------------------------------------------------------------
 */

export enum ExposureReadsLogged {
  // Access logs or data events were on.
  Logged = "Logged",
  NotLogged = "NotLogged",
  // Data Security could not read whether they were.
  Unknown = "Unknown",
}

// A grant of access to the store, as Data Security read it: who, never what they read.
export interface ExposureGrant {
  principal: string;
  isExternal?: boolean | undefined;
  isPublic?: boolean | undefined;
  lastUsedAt?: Date | string | null | undefined;
}

export interface ExposureReads {
  logged: ExposureReadsLogged;
  // Anyone on the internet could read it.
  isPublic: boolean;
  // Accounts outside the company that could, counted.
  outsideAccounts: number;
  // Of those, how many used their access inside the window.
  outsideAccountsUsedInWindow: number;
  // With reads not logged, or not known to be: treat the data as read.
  isTreatedAsRead: boolean;
}

export function getExposureReads(data: {
  accessLogging: boolean | null | undefined;
  exposureCheckIds: ReadonlyArray<string>;
  isStorePublic: boolean;
  grants: ReadonlyArray<ExposureGrant>;
  window: ExposureWindow | null;
  now: Date;
}): ExposureReads {
  const logged: ExposureReadsLogged =
    data.accessLogging === true
      ? ExposureReadsLogged.Logged
      : data.accessLogging === false
        ? ExposureReadsLogged.NotLogged
        : ExposureReadsLogged.Unknown;
  const outside: Map<string, ExposureGrant> = new Map();

  for (const grant of data.grants) {
    if (grant.isExternal === true && grant.isPublic !== true) {
      outside.set(grant.principal, grant);
    }
  }

  const start: number | null = data.window ? toTime(data.window.start) : null;
  const end: number =
    (data.window ? toTime(data.window.end) : null) ?? data.now.getTime();

  return {
    logged,
    isPublic:
      data.isStorePublic ||
      data.grants.some((grant: ExposureGrant): boolean => {
        return grant.isPublic === true;
      }) ||
      data.exposureCheckIds.some((checkId: string): boolean => {
        return PUBLIC_EXPOSURE_CHECK_IDS.includes(checkId);
      }),
    outsideAccounts: outside.size,
    outsideAccountsUsedInWindow:
      start === null
        ? 0
        : [...outside.values()].filter((grant: ExposureGrant): boolean => {
            const used: number | null = toTime(grant.lastUsedAt);

            return used !== null && used >= start && used <= end;
          }).length,
    isTreatedAsRead: logged !== ExposureReadsLogged.Logged,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Whose data
 * ---------------------------------------------------------------------------
 */

// A data type the store holds, by the project's name for it.
export interface ExposureDataType {
  id: string;
  name: string;
  category: string;
}

export interface ExposureWhoseData {
  dataTypes: Array<ExposureDataType>;
  categories: Array<string>;
  hasPersonalData: boolean;
  // Health, or what GDPR Article 9 protects most.
  specialCategories: Array<string>;
  // About how many records, rounded.
  records?: number | undefined;
  // The countries the store's data types say its people are in (ISO 3166-1 alpha-2).
  countriesFromData: Array<string>;
  // Where a person said the people live, when one did.
  placesNamed?: Array<BreachPlace> | undefined;
  // Every place known to hold some of the people: from the data, and as said.
  places: Array<BreachPlace>;
  // Where the data is kept: its region, and that region's country.
  region?: string | undefined;
  regionCountry?: string | undefined;
  regionIsInEea?: boolean | undefined;
  // Who the record of processing says the data is about, as written or confirmed.
  people: Array<string>;
  includesChildren: boolean;
  // What the breach laws are triggered by, of what it holds.
  elements: Array<BreachDataElement>;
  hasNames: boolean;
}

/*
 * The breach laws' data elements a store's data types make: each type's
 * element by the catalog, any personal category as personal data, any
 * other government ID as one, and a login made of an email address or a
 * username held with a password.
 */
export function getBreachDataElements(data: {
  dataTypeIds: ReadonlyArray<string>;
  // A custom data type's category, by its id.
  categoryOf?: ReadonlyMap<string, string> | undefined;
}): Array<BreachDataElement> {
  const elements: Set<BreachDataElement> = new Set();
  const ids: Set<string> = new Set(data.dataTypeIds);

  for (const id of ids) {
    const category: string | undefined =
      getBuiltInDataType(id)?.category || data.categoryOf?.get(id);

    if (category && isPersonalDataCategory(category as DataCategory)) {
      elements.add(BreachDataElement.PersonalData);
    }

    let isNamedId: boolean = false;

    for (const [element, types] of Object.entries(BREACH_DATA_ELEMENT_TYPES)) {
      if (types.includes(id)) {
        elements.add(element as BreachDataElement);
        isNamedId = true;
      }
    }

    if (
      !isNamedId &&
      category === DataCategory.GovernmentId &&
      getBuiltInDataType(id)
    ) {
      elements.add(BreachDataElement.OtherGovernmentId);
    }
  }

  if (
    ONLINE_ACCOUNT_TYPES.some((id: string): boolean => {
      return ids.has(id);
    }) &&
    PASSWORD_TYPES.some((id: string): boolean => {
      return ids.has(id);
    })
  ) {
    elements.add(BreachDataElement.OnlineCredentials);
  }

  return [...elements].sort();
}

// The places of a set of countries, each once, in the table's order.
export function getPlacesOfCountries(
  countries: ReadonlyArray<string>,
): Array<BreachPlace> {
  const places: Set<BreachPlace> = new Set(
    countries.map((country: string): BreachPlace => {
      return getBreachPlaceOfCountry(country);
    }),
  );

  return Object.values(BreachPlace).filter((place: BreachPlace): boolean => {
    return places.has(place);
  });
}

export const CHILDREN_PEOPLE: string = "Children";

export function getWhoseData(data: {
  dataTypes: ReadonlyArray<ExposureDataType>;
  categoryOf?: ReadonlyMap<string, string> | undefined;
  estimatedRecords?: number | null | undefined;
  subjectCountries: ReadonlyArray<string>;
  placesNamed?: ReadonlyArray<BreachPlace> | undefined;
  region?: string | null | undefined;
  regionCountry?: string | null | undefined;
  regionIsInEea?: boolean | null | undefined;
  people?: ReadonlyArray<string> | undefined;
}): ExposureWhoseData {
  const categories: Array<string> = [
    ...new Set(
      data.dataTypes
        .map((type: ExposureDataType): string => {
          return type.category;
        })
        .filter(Boolean),
    ),
  ].sort();
  const countries: Array<string> = [
    ...new Set(
      data.subjectCountries
        .filter((country: string): boolean => {
          return /^[A-Za-z]{2}$/.test(country);
        })
        .map((country: string): string => {
          return country.toUpperCase();
        }),
    ),
  ].sort();
  const named: Array<BreachPlace> | undefined = data.placesNamed
    ? [...new Set(data.placesNamed.filter(isBreachPlace))]
    : undefined;
  const places: Set<BreachPlace> = new Set([
    ...getPlacesOfCountries(countries),
    ...(named || []),
  ]);
  const people: Array<string> = [...(data.people || [])];
  const ids: Array<string> = data.dataTypes.map(
    (type: ExposureDataType): string => {
      return type.id;
    },
  );

  return {
    dataTypes: [...data.dataTypes],
    categories,
    hasPersonalData: categories.some((category: string): boolean => {
      return isPersonalDataCategory(category as DataCategory);
    }),
    specialCategories: categories.filter((category: string): boolean => {
      return (
        category === DataCategory.Health ||
        category === DataCategory.SpecialCategory
      );
    }),
    records:
      typeof data.estimatedRecords === "number" &&
      Number.isFinite(data.estimatedRecords) &&
      data.estimatedRecords >= 0
        ? roundRecords(data.estimatedRecords)
        : undefined,
    countriesFromData: countries,
    placesNamed: named,
    places: Object.values(BreachPlace).filter((place: BreachPlace): boolean => {
      return places.has(place);
    }),
    region: data.region || undefined,
    regionCountry: data.regionCountry || undefined,
    regionIsInEea:
      typeof data.regionIsInEea === "boolean" ? data.regionIsInEea : undefined,
    people,
    includesChildren: people.includes(CHILDREN_PEOPLE),
    elements: getBreachDataElements({
      dataTypeIds: ids,
      categoryOf: data.categoryOf,
    }),
    hasNames: ids.includes(PERSON_NAME_TYPE),
  };
}

// About how many records, to two significant figures: no fact changes by a record.
export function roundRecords(value: number): number {
  if (value < 100) {
    return Math.round(value);
  }

  const scale: number = Math.pow(10, Math.floor(Math.log10(value)) - 1);

  return Math.round(value / scale) * scale;
}

/*
 * ---------------------------------------------------------------------------
 * The secrets to rotate
 * ---------------------------------------------------------------------------
 */

// A secret found in the store, by its type and where: never its value.
export interface ExposureSecret {
  dataTypeId: string;
  dataTypeName: string;
  location: string;
  locationKind?: string | undefined;
  // Whether the last scan still found it there.
  isStillThere: boolean;
}

// The most secrets an assessment lists.
export const MAX_EXPOSURE_SECRETS: number = 50;

/*
 * ---------------------------------------------------------------------------
 * What the law may ask
 * ---------------------------------------------------------------------------
 */

export enum BreachObligationStatus {
  // The facts meet what plain code can check; a person checks the rest.
  MayApply = "MayApply",
  // A fact rules it out.
  NotTriggered = "NotTriggered",
  // It takes effect later.
  NotYetInForce = "NotYetInForce",
}

// Why it may apply, or does not: each with the facts it names.
export enum BreachReasonKind {
  PeopleIn = "PeopleIn",
  PeopleNamedElsewhere = "PeopleNamedElsewhere",
  Holds = "Holds",
  HoldsNoneOf = "HoldsNoneOf",
  NoPersonalData = "NoPersonalData",
  Records = "Records",
  ReadsNotLogged = "ReadsNotLogged",
  ReadsUnknown = "ReadsUnknown",
  NotInForce = "NotInForce",
}

export interface BreachReason {
  kind: BreachReasonKind;
  places?: Array<BreachPlace> | undefined;
  elements?: Array<BreachDataElement> | undefined;
  records?: number | undefined;
  // YYYY-MM-DD.
  date?: string | undefined;
}

// What a person still checks: a condition of the law, or a fact plain code cannot know.
export enum BreachCheckKind {
  Condition = "Condition",
  PeopleLiveIn = "PeopleLiveIn",
  PeopleCount = "PeopleCount",
  FewerPeopleThan = "FewerPeopleThan",
  HeldWithNames = "HeldWithNames",
  ReadFromOutside = "ReadFromOutside",
}

export interface BreachCheck {
  kind: BreachCheckKind;
  condition?: BreachCondition | undefined;
  places?: Array<BreachPlace> | undefined;
  threshold?: BreachPeopleThreshold | undefined;
  count?: number | undefined;
}

export interface BreachObligation {
  ruleId: BreachLawId;
  status: BreachObligationStatus;
  reasons: Array<BreachReason>;
  checks: Array<BreachCheck>;
  // Whether the facts place some of the people where it applies, or it applies wherever they live.
  isPlaceKnown: boolean;
  // When the exposure was found, which its deadline counts from.
  foundAt: string;
  // Its deadline, when it has a length of time.
  dueAt?: string | undefined;
  // A deadline counted from another notice: the latest it can be, if that notice is given on its last day.
  isDueAtTheLatest?: boolean | undefined;
}

// Monday to Friday, in UTC: public holidays are not taken off.
export function addBusinessDays(from: Date, days: number): Date {
  let at: number = from.getTime();
  let left: number = Math.max(0, Math.floor(days));

  while (left > 0) {
    at += DAY_IN_MS;

    const weekday: number = new Date(at).getUTCDay();

    if (weekday !== 0 && weekday !== 6) {
      left--;
    }
  }

  return new Date(at);
}

/*
 * A deadline's moment, counted from when the exposure was found: hours as
 * hours, calendar days as days of twenty-four hours, business days as
 * weekdays, and "60 days after the end of the calendar year" as the 60th
 * day of the next year. Nothing for no length of time.
 */
export function getBreachDueAt(data: {
  rule: BreachLawRule;
  foundAt: Date;
  // The other notices' moments, for one counted from them.
  dueAtOf?: ReadonlyMap<BreachLawId, Date> | undefined;
}): Date | undefined {
  const deadline: BreachLawRule["deadline"] = data.rule.deadline;
  const amount: number | undefined = deadline.amount;

  if (
    amount === undefined ||
    deadline.unit === BreachDeadlineUnit.WithoutUndueDelay ||
    deadline.unit === BreachDeadlineUnit.NoFixedTime
  ) {
    return undefined;
  }

  let from: Date = data.foundAt;

  if (deadline.start === BreachDeadlineStart.PeopleNotified) {
    const after: Date | undefined = deadline.afterRule
      ? data.dueAtOf?.get(deadline.afterRule)
      : undefined;

    if (!after) {
      return undefined;
    }

    from = after;
  }

  if (deadline.start === BreachDeadlineStart.EndOfCalendarYear) {
    // The end of the year it was found in, in UTC: midnight that starts the next.
    from = new Date(Date.UTC(data.foundAt.getUTCFullYear() + 1, 0, 1));

    return new Date(from.getTime() + amount * DAY_IN_MS - 60 * 1000);
  }

  switch (deadline.unit) {
    case BreachDeadlineUnit.Hours:
      return new Date(from.getTime() + amount * HOUR_IN_MS);
    case BreachDeadlineUnit.CalendarDays:
      return new Date(from.getTime() + amount * DAY_IN_MS);
    case BreachDeadlineUnit.BusinessDays:
      return addBusinessDays(from, amount);
    default:
      return undefined;
  }
}

// Whether a row is in force on a day.
export function isBreachLawInForce(rule: BreachLawRule, now: Date): boolean {
  if (!rule.inForceFrom) {
    return true;
  }

  const from: number | null = toTime(`${rule.inForceFrom}T00:00:00.000Z`);

  return from === null || now.getTime() >= from;
}

export interface BreachLawFacts {
  whose: ExposureWhoseData;
  reads: ExposureReads;
  foundAt: Date;
  now: Date;
}

// Whether a set of places meets a row's: one of the people is known to live where it applies.
function placesMeet(
  rule: BreachLawRule,
  places: ReadonlyArray<BreachPlace>,
): Array<BreachPlace> {
  if (!rule.places) {
    return [];
  }

  return rule.places.filter((place: BreachPlace): boolean => {
    return places.includes(place);
  });
}

/*
 * Whether a person's answer of where the people live rules a row's places
 * out: a person who named only other places. "The United States" without
 * its states rules out no state.
 */
function isPlaceRuledOut(
  rule: BreachLawRule,
  named: ReadonlyArray<BreachPlace> | undefined,
): boolean {
  if (!rule.places || !named || named.length === 0) {
    return false;
  }

  return rule.places.every((place: BreachPlace): boolean => {
    if (named.includes(place)) {
      return false;
    }

    return !(isUsStatePlace(place) && named.includes(BreachPlace.UnitedStates));
  });
}

/*
 * One row, applied to the facts: whether it may apply, why, what a person
 * still checks, and its deadline.
 */
export function applyBreachLaw(
  rule: BreachLawRule,
  facts: BreachLawFacts,
  dueAtOf?: ReadonlyMap<BreachLawId, Date> | undefined,
): BreachObligation {
  const reasons: Array<BreachReason> = [];
  const checks: Array<BreachCheck> = [];
  const foundAt: string = facts.foundAt.toISOString();
  const base: Omit<BreachObligation, "status" | "isPlaceKnown"> = {
    ruleId: rule.id,
    reasons,
    checks,
    foundAt,
  };

  if (!isBreachLawInForce(rule, facts.now)) {
    reasons.push({ kind: BreachReasonKind.NotInForce, date: rule.inForceFrom });

    return {
      ...base,
      status: BreachObligationStatus.NotYetInForce,
      isPlaceKnown: false,
    };
  }

  // What it covers, of what the store holds.
  const held: Array<BreachDataElement> = rule.dataElements.filter(
    (element: BreachDataElement): boolean => {
      return facts.whose.elements.includes(element);
    },
  );

  if (held.length === 0) {
    reasons.push(
      rule.dataElements.includes(BreachDataElement.PersonalData)
        ? { kind: BreachReasonKind.NoPersonalData }
        : {
            kind: BreachReasonKind.HoldsNoneOf,
            elements: [...rule.dataElements],
          },
    );

    return {
      ...base,
      status: BreachObligationStatus.NotTriggered,
      isPlaceKnown: false,
    };
  }

  // Where the people live.
  const met: Array<BreachPlace> = placesMeet(rule, facts.whose.places);

  if (isPlaceRuledOut(rule, facts.whose.placesNamed) && met.length === 0) {
    reasons.push({
      kind: BreachReasonKind.PeopleNamedElsewhere,
      places: [...(facts.whose.placesNamed || [])],
    });

    return {
      ...base,
      status: BreachObligationStatus.NotTriggered,
      isPlaceKnown: false,
    };
  }

  const isPlaceKnown: boolean = rule.places === null || met.length > 0;

  if (met.length > 0) {
    reasons.push({ kind: BreachReasonKind.PeopleIn, places: met });
  } else if (rule.places) {
    checks.push({
      kind: BreachCheckKind.PeopleLiveIn,
      places: [...rule.places],
    });
  }

  reasons.push({ kind: BreachReasonKind.Holds, elements: held });

  // A number the law covers only held with a name, where no name was found.
  if (
    rule.needsName &&
    !facts.whose.hasNames &&
    !held.some((element: BreachDataElement): boolean => {
      return rule.nameFreeElements.includes(element);
    })
  ) {
    checks.push({ kind: BreachCheckKind.HeldWithNames });
  }

  // How many people: a count of records is not a count of people.
  if (rule.minimumPeople) {
    checks.push({
      kind: BreachCheckKind.PeopleCount,
      threshold: rule.minimumPeople,
    });
  }

  if (rule.fewerPeopleThan !== undefined) {
    checks.push({
      kind: BreachCheckKind.FewerPeopleThan,
      count: rule.fewerPeopleThan,
    });
  }

  if (
    (rule.minimumPeople || rule.fewerPeopleThan !== undefined) &&
    facts.whose.records !== undefined
  ) {
    reasons.push({
      kind: BreachReasonKind.Records,
      records: facts.whose.records,
    });
  }

  // Whether anyone read it.
  if (facts.reads.logged === ExposureReadsLogged.NotLogged) {
    reasons.push({ kind: BreachReasonKind.ReadsNotLogged });
  } else if (facts.reads.logged === ExposureReadsLogged.Unknown) {
    reasons.push({ kind: BreachReasonKind.ReadsUnknown });
  } else {
    checks.push({ kind: BreachCheckKind.ReadFromOutside });
  }

  for (const condition of rule.conditions) {
    checks.push({ kind: BreachCheckKind.Condition, condition });
  }

  const dueAt: Date | undefined = getBreachDueAt({
    rule,
    foundAt: facts.foundAt,
    dueAtOf,
  });

  return {
    ...base,
    status: BreachObligationStatus.MayApply,
    isPlaceKnown,
    dueAt: dueAt ? dueAt.toISOString() : undefined,
    isDueAtTheLatest:
      rule.deadline.start === BreachDeadlineStart.PeopleNotified && dueAt
        ? true
        : undefined,
  };
}

const STATUS_ORDER: Readonly<Record<BreachObligationStatus, number>> = {
  [BreachObligationStatus.MayApply]: 0,
  [BreachObligationStatus.NotYetInForce]: 1,
  [BreachObligationStatus.NotTriggered]: 2,
};

/*
 * Every row of the table applied to the facts: what may apply first, the
 * soonest deadline first - those whose place is known before those that
 * depend on where the people live - then what has no length of time, what
 * is not in force yet, and what the facts rule out, each in the table's
 * order.
 */
export function applyBreachLaws(
  facts: BreachLawFacts,
  rules: ReadonlyArray<BreachLawRule> = BREACH_LAW_RULES,
): Array<BreachObligation> {
  const dueAtOf: Map<BreachLawId, Date> = new Map();
  const obligations: Array<BreachObligation> = [];

  // A notice counted from another comes after it: two passes over the table.
  for (const rule of rules) {
    if (rule.deadline.start === BreachDeadlineStart.PeopleNotified) {
      continue;
    }

    const obligation: BreachObligation = applyBreachLaw(rule, facts);

    if (obligation.dueAt) {
      dueAtOf.set(rule.id, new Date(obligation.dueAt));
    }

    obligations.push(obligation);
  }

  for (const rule of rules) {
    if (rule.deadline.start === BreachDeadlineStart.PeopleNotified) {
      obligations.push(applyBreachLaw(rule, facts, dueAtOf));
    }
  }

  const order: Map<BreachLawId, number> = new Map(
    rules.map((rule: BreachLawRule, index: number): [BreachLawId, number] => {
      return [rule.id, index];
    }),
  );

  return obligations.sort(
    (a: BreachObligation, b: BreachObligation): number => {
      if (a.status !== b.status) {
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      }

      if (a.status === BreachObligationStatus.MayApply) {
        if (a.isPlaceKnown !== b.isPlaceKnown) {
          return a.isPlaceKnown ? -1 : 1;
        }

        const aDue: number = a.dueAt
          ? new Date(a.dueAt).getTime()
          : Number.POSITIVE_INFINITY;
        const bDue: number = b.dueAt
          ? new Date(b.dueAt).getTime()
          : Number.POSITIVE_INFINITY;

        if (aDue !== bDue) {
          return aDue - bDue;
        }
      }

      return (order.get(a.ruleId) || 0) - (order.get(b.ruleId) || 0);
    },
  );
}

/*
 * The obligation to read first: of those that may apply where the people
 * are known to live, or wherever they live, the one due soonest. Null when
 * none with a deadline is known to apply - the people's places decide it.
 */
export function getMostUrgentObligation(
  obligations: ReadonlyArray<BreachObligation>,
): BreachObligation | null {
  return (
    obligations
      .filter((obligation: BreachObligation): boolean => {
        return (
          obligation.status === BreachObligationStatus.MayApply &&
          obligation.isPlaceKnown &&
          Boolean(obligation.dueAt)
        );
      })
      .sort((a: BreachObligation, b: BreachObligation): number => {
        return new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime();
      })[0] || null
  );
}

// What the table does not cover, said so nobody reads silence as "no obligation".
export enum UncoveredLawKind {
  // People in countries the table has no rows for, by the data.
  OtherCountries = "OtherCountries",
  // A person said some of the people live elsewhere.
  PeopleElsewhere = "PeopleElsewhere",
  // US states other than the six the table covers.
  OtherUsStates = "OtherUsStates",
  // Where the organization is established can bring in a law whatever the people's countries.
  Establishment = "Establishment",
  // Contracts, sector rules and other obligations.
  ContractsAndSectors = "ContractsAndSectors",
}

export interface UncoveredLaw {
  kind: UncoveredLawKind;
  countries?: Array<string> | undefined;
}

export function getUncoveredLaws(
  whose: ExposureWhoseData,
): Array<UncoveredLaw> {
  const uncovered: Array<UncoveredLaw> = [];
  const elsewhere: Array<string> = whose.countriesFromData.filter(
    (country: string): boolean => {
      return getBreachPlaceOfCountry(country) === BreachPlace.Elsewhere;
    },
  );

  if (elsewhere.length > 0) {
    uncovered.push({
      kind: UncoveredLawKind.OtherCountries,
      countries: elsewhere,
    });
  }

  if (whose.placesNamed?.includes(BreachPlace.Elsewhere)) {
    uncovered.push({ kind: UncoveredLawKind.PeopleElsewhere });
  }

  if (
    !whose.placesNamed ||
    whose.placesNamed.some((place: BreachPlace): boolean => {
      return (
        place === BreachPlace.UnitedStates || place === BreachPlace.OtherUsState
      );
    }) ||
    whose.countriesFromData.includes("US")
  ) {
    uncovered.push({ kind: UncoveredLawKind.OtherUsStates });
  }

  uncovered.push({ kind: UncoveredLawKind.Establishment });
  uncovered.push({ kind: UncoveredLawKind.ContractsAndSectors });

  return uncovered;
}

export const UNCOVERED_LAW_WORDS: Readonly<Record<UncoveredLawKind, string>> = {
  [UncoveredLawKind.OtherCountries]: translationKey(
    "Its data is about people in {{countries}}, whose breach laws this assessment does not cover.",
  ),
  [UncoveredLawKind.PeopleElsewhere]: translationKey(
    "You said some of the people live somewhere this assessment does not cover: check that place's breach law.",
  ),
  [UncoveredLawKind.OtherUsStates]: translationKey(
    "Of the US states, it covers California, Colorado, Florida, New York, Texas and Washington. Every other state has a breach law of its own.",
  ),
  [UncoveredLawKind.Establishment]: translationKey(
    "Where your organization is established can bring in GDPR, UK GDPR or another law, whatever the people's countries.",
  ),
  [UncoveredLawKind.ContractsAndSectors]: translationKey(
    "Contracts with customers and partners, and sector rules such as banking, insurance and telecoms regulators', can set deadlines of their own.",
  ),
};

// Whether the facts tell where any of the people live.
export function isPlaceUnknown(whose: ExposureWhoseData): boolean {
  return whose.places.length === 0;
}

// The places the table covers that the people may live in, for the question "Where do the people live?".
export function getCoveredPlaces(): Array<BreachPlace> {
  return [...COVERED_PLACES];
}

/*
 * ---------------------------------------------------------------------------
 * The playbook's checklist
 * ---------------------------------------------------------------------------
 */

/*
 * The Close a Data Exposure template's checklist (SecurityPlaybookTemplates),
 * each line answered by a part of the assessment. A case's task is matched
 * to its line by its title, as the template wrote it, or by its key.
 */
export enum ExposureChecklistItem {
  WhoReadIt = "who-read-it",
  MustReport = "must-report",
  RotateSecrets = "rotate-secrets",
  CloseTheCase = "close-the-case",
}

export const EXPOSURE_CHECKLIST_ITEMS: ReadonlyArray<ExposureChecklistItem> = [
  ExposureChecklistItem.WhoReadIt,
  ExposureChecklistItem.MustReport,
  ExposureChecklistItem.RotateSecrets,
  ExposureChecklistItem.CloseTheCase,
];

// The template's lines, as it adds them: the English a task's title holds.
export const DATA_EXPOSURE_CHECKLIST_TASKS: Readonly<
  Record<ExposureChecklistItem, string>
> = {
  [ExposureChecklistItem.WhoReadIt]:
    "Find who read the data while it was exposed, from the store's access logs and its Who Can Reach It page",
  [ExposureChecklistItem.MustReport]:
    "Decide whether this is a breach you must report, to whom and by when",
  [ExposureChecklistItem.RotateSecrets]:
    "Rotate every secret and key the store held",
  [ExposureChecklistItem.CloseTheCase]:
    "Close the case with what was exposed, for how long, and to whom",
};

// A task made from the checklist keeps its line's key here (SecurityCaseTask.responseStepKey).
export const EXPOSURE_CHECKLIST_STEP_KEY_PREFIX: string = "exposure-checklist:";

export function getExposureChecklistStepKey(
  item: ExposureChecklistItem,
): string {
  return `${EXPOSURE_CHECKLIST_STEP_KEY_PREFIX}${item}`;
}

// The checklist line a case's task is, or null.
export function getExposureChecklistItemOfTask(task: {
  title?: string | null | undefined;
  responseStepKey?: string | null | undefined;
}): ExposureChecklistItem | null {
  const key: string = (task.responseStepKey || "").trim();

  for (const item of EXPOSURE_CHECKLIST_ITEMS) {
    if (key === getExposureChecklistStepKey(item)) {
      return item;
    }
  }

  const title: string = (task.title || "").trim().toLowerCase();

  for (const item of EXPOSURE_CHECKLIST_ITEMS) {
    if (title === DATA_EXPOSURE_CHECKLIST_TASKS[item].toLowerCase()) {
      return item;
    }
  }

  return null;
}

// A checklist line, and the case's task it matched.
export interface ExposureChecklistAnswer {
  item: ExposureChecklistItem;
  taskId?: string | undefined;
  taskTitle?: string | undefined;
  isDone?: boolean | undefined;
}

export function getExposureChecklistAnswers(
  tasks: ReadonlyArray<{
    id: string;
    title?: string | null | undefined;
    responseStepKey?: string | null | undefined;
    isDone?: boolean | null | undefined;
  }>,
): Array<ExposureChecklistAnswer> {
  return EXPOSURE_CHECKLIST_ITEMS.map(
    (item: ExposureChecklistItem): ExposureChecklistAnswer => {
      const task:
        | {
            id: string;
            title?: string | null | undefined;
            isDone?: boolean | null | undefined;
          }
        | undefined = tasks.find(
        (candidate: {
          title?: string | null | undefined;
          responseStepKey?: string | null | undefined;
        }): boolean => {
          return getExposureChecklistItemOfTask(candidate) === item;
        },
      );

      return task
        ? {
            item,
            taskId: task.id,
            taskTitle: task.title || undefined,
            isDone: task.isDone === true,
          }
        : { item };
    },
  );
}

/*
 * ---------------------------------------------------------------------------
 * OneUptime AI's write-up and drafts
 * ---------------------------------------------------------------------------
 */

/*
 * What OneUptime AI writes from the facts. Stored as the keys of an
 * assessment's sections: never rename one.
 */
export enum ExposureDraftPart {
  // What happened, what it means and what to do first.
  Explanation = "explanation",
  RegulatorNotice = "regulatorNotice",
  PeopleNotice = "peopleNotice",
  InternalSummary = "internalSummary",
}

export const EXPOSURE_DRAFT_PARTS: ReadonlyArray<ExposureDraftPart> = [
  ExposureDraftPart.Explanation,
  ExposureDraftPart.RegulatorNotice,
  ExposureDraftPart.PeopleNotice,
  ExposureDraftPart.InternalSummary,
];

// The three drafts a person edits and copies, in the order the page folds them.
export const EXPOSURE_NOTICE_PARTS: ReadonlyArray<ExposureDraftPart> = [
  ExposureDraftPart.RegulatorNotice,
  ExposureDraftPart.PeopleNotice,
  ExposureDraftPart.InternalSummary,
];

export function isExposureDraftPart(
  value: unknown,
): value is ExposureDraftPart {
  return (
    typeof value === "string" &&
    (EXPOSURE_DRAFT_PARTS as ReadonlyArray<string>).includes(value)
  );
}

export const EXPOSURE_DRAFT_PART_TITLES: Readonly<
  Record<ExposureDraftPart, string>
> = {
  [ExposureDraftPart.Explanation]: translationKey("What This Means"),
  [ExposureDraftPart.RegulatorNotice]: translationKey(
    "Notice to the Regulator",
  ),
  [ExposureDraftPart.PeopleNotice]: translationKey(
    "Notice to the People Affected",
  ),
  [ExposureDraftPart.InternalSummary]: translationKey("Internal Summary"),
};

// What OneUptime AI is asked to write in each part.
export const EXPOSURE_DRAFT_PART_ASKS: Readonly<
  Record<ExposureDraftPart, string>
> = {
  [ExposureDraftPart.Explanation]:
    "two to four short sentences for the person working the case: what happened, what it means for the people the data is about, and what to do first - name the obligation that is due first, with its deadline as the facts give it",
  [ExposureDraftPart.RegulatorNotice]:
    "a notice to the regulator of the obligation that is due first (or, when none is, the first that may apply): the nature of the breach, the categories and approximate numbers of people and records the facts give, when it started and ended, its likely consequences, and the measures taken - with a placeholder in square brackets for each thing only the team knows, such as [contact details of your data protection officer]",
  [ExposureDraftPart.PeopleNotice]:
    "a notice to the people the data is about, in plain words: what happened and when, which kinds of their data, what was done, what they can do to protect themselves (rotate passwords, watch for phishing), and who to contact - a placeholder in square brackets for what only the team knows",
  [ExposureDraftPart.InternalSummary]:
    "an internal summary for the case's closing note and leadership: what was exposed, for how long and to whom, whether reads were logged, whose data it was, the secrets to rotate, each obligation that may apply with its deadline, and what is still open",
};

export interface ExposureDraftSection {
  part: ExposureDraftPart;
  // Its words, as Markdown: paragraphs and lists, no headings.
  markdown: string;
  source: ImpactAssessmentSectionSource;
  // The keys of the facts a drafted part rests on.
  factKeys: Array<string>;
  /*
   * What its facts said when it was written: a drafted part's, the facts it
   * cites; an edited part's, every fact the person had in front of them.
   */
  factsHash?: string | undefined;
  draftedAt?: string | undefined;
  editedAt?: string | undefined;
  editedByUserId?: string | undefined;
}

// Who started the assessment.
export enum ExposureAssessmentStarter {
  // Data Security, on its own, as a Critical exposure opened the case.
  DataSecurity = "DataSecurity",
  // A person asked for it.
  Person = "Person",
}

// Where a person said the people live, and who said it.
export interface ExposurePeoplePlaces {
  places: Array<BreachPlace>;
  saidAt: string;
  saidByUserId?: string | undefined;
}

// What a case keeps (SecurityCase.exposureAssessment).
export interface StoredExposureAssessment {
  version: number;
  dataStoreId: string;
  assessedAt: string;
  startedBy: ExposureAssessmentStarter;
  startedByUserId?: string | undefined;
  peopleLiveIn?: ExposurePeoplePlaces | undefined;
  // The language its drafted parts are written in.
  language: string;
  sections: Partial<Record<ExposureDraftPart, ExposureDraftSection>>;
  // The facts its drafted parts were written from.
  facts: Array<ComplianceFact>;
  draftedAt?: string | undefined;
}

export const EXPOSURE_ASSESSMENT_VERSION: number = 1;

// The longest part a draft keeps, and the shortest that says anything.
export const MAX_EXPOSURE_DRAFT_LENGTH: number = 6000;
export const MAX_EXPOSURE_EXPLANATION_LENGTH: number = 1200;
export const MIN_EXPOSURE_DRAFT_LENGTH: number = 40;
// The longest part a person may write.
export const MAX_EDITED_EXPOSURE_DRAFT_LENGTH: number = 20000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function readSection(
  part: ExposureDraftPart,
  value: unknown,
): ExposureDraftSection | null {
  if (!isRecord(value)) {
    return null;
  }

  const markdown: string = readText(
    value["markdown"],
    MAX_EDITED_EXPOSURE_DRAFT_LENGTH,
  );

  if (!markdown.trim()) {
    return null;
  }

  return {
    part,
    markdown,
    source:
      value["source"] === ImpactAssessmentSectionSource.Edited
        ? ImpactAssessmentSectionSource.Edited
        : ImpactAssessmentSectionSource.Drafted,
    factKeys: Array.isArray(value["factKeys"])
      ? value["factKeys"]
          .filter((key: unknown): key is string => {
            return typeof key === "string";
          })
          .slice(0, 120)
      : [],
    factsHash: readText(value["factsHash"], 64) || undefined,
    draftedAt: readText(value["draftedAt"], 40) || undefined,
    editedAt: readText(value["editedAt"], 40) || undefined,
    editedByUserId: readText(value["editedByUserId"], 40) || undefined,
  };
}

function readPeoplePlaces(value: unknown): ExposurePeoplePlaces | undefined {
  if (!isRecord(value) || !Array.isArray(value["places"])) {
    return undefined;
  }

  const places: Array<BreachPlace> = [
    ...new Set(value["places"].filter(isBreachPlace)),
  ];

  if (places.length === 0) {
    return undefined;
  }

  return {
    places,
    saidAt: readText(value["saidAt"], 40),
    saidByUserId: readText(value["saidByUserId"], 40) || undefined,
  };
}

// An assessment as a case keeps it, or null: none, or one this build cannot read.
export function readStoredExposureAssessment(
  value: unknown,
): StoredExposureAssessment | null {
  if (!isRecord(value)) {
    return null;
  }

  const dataStoreId: string = readText(value["dataStoreId"], 40);

  if (!dataStoreId) {
    return null;
  }

  const sections: Partial<Record<ExposureDraftPart, ExposureDraftSection>> =
    {};
  const keptSections: Record<string, unknown> = isRecord(value["sections"])
    ? value["sections"]
    : {};

  for (const part of EXPOSURE_DRAFT_PARTS) {
    const section: ExposureDraftSection | null = readSection(
      part,
      keptSections[part],
    );

    if (section) {
      sections[part] = section;
    }
  }

  return {
    version: EXPOSURE_ASSESSMENT_VERSION,
    dataStoreId,
    assessedAt: readText(value["assessedAt"], 40),
    startedBy:
      value["startedBy"] === ExposureAssessmentStarter.Person
        ? ExposureAssessmentStarter.Person
        : ExposureAssessmentStarter.DataSecurity,
    startedByUserId: readText(value["startedByUserId"], 40) || undefined,
    peopleLiveIn: readPeoplePlaces(value["peopleLiveIn"]),
    language: readText(value["language"], 20) || "en",
    sections,
    facts: readComplianceFacts(value["facts"]),
    draftedAt: readText(value["draftedAt"], 40) || undefined,
  };
}

export function toStoredExposureAssessmentJson(
  assessment: StoredExposureAssessment,
): JSONObject {
  return JSON.parse(JSON.stringify(assessment)) as JSONObject;
}

// A new assessment of a store, with nothing drafted yet.
export function startExposureAssessment(data: {
  dataStoreId: string;
  startedBy: ExposureAssessmentStarter;
  startedByUserId?: string | undefined;
  language: string;
  now: Date;
}): StoredExposureAssessment {
  return {
    version: EXPOSURE_ASSESSMENT_VERSION,
    dataStoreId: data.dataStoreId,
    assessedAt: data.now.toISOString(),
    startedBy: data.startedBy,
    startedByUserId: data.startedByUserId,
    language: data.language,
    sections: {},
    facts: [],
  };
}

/*
 * The laws a draft may name, by how a text names them. A text that names a
 * law none of its facts names - or one the table does not cover at all - is
 * dropped: a notice that cites the wrong law is worse than none.
 */
const LAW_NAMES_IN_TEXT: ReadonlyArray<{
  pattern: RegExp;
  family: BreachLawFamily | null;
}> = [
  { pattern: /\bUK[ -]GDPR\b/gi, family: BreachLawFamily.UkGdpr },
  {
    pattern: /\bGDPR\b|General Data Protection Regulation/gi,
    family: BreachLawFamily.Gdpr,
  },
  { pattern: /\bHIPAA\b|\bHITECH\b/gi, family: BreachLawFamily.Hipaa },
  {
    pattern: /\bCalifornia\b|\b1798\.82\b/gi,
    family: BreachLawFamily.California,
  },
  { pattern: /\bColorado\b|\b6-1-716\b/gi, family: BreachLawFamily.Colorado },
  { pattern: /\bFlorida\b|\b501\.171\b/gi, family: BreachLawFamily.Florida },
  { pattern: /\bNew York\b|\b899-aa\b/gi, family: BreachLawFamily.NewYork },
  { pattern: /\bTexas\b|\b521\.053\b/gi, family: BreachLawFamily.Texas },
  {
    pattern: /\bWashington\b|\b19\.255\b/gi,
    family: BreachLawFamily.Washington,
  },
  { pattern: /\bLGPD\b|\bANPD\b/gi, family: BreachLawFamily.Lgpd },
  {
    pattern: /\bDPDP\b|Digital Personal Data Protection/gi,
    family: BreachLawFamily.Dpdp,
  },
  { pattern: /\bCERT-In\b/gi, family: BreachLawFamily.CertIn },
  { pattern: /\bPCI(?:[ -]?DSS)?\b/gi, family: BreachLawFamily.PciDss },
  // Laws the table does not cover: never named by a draft.
  {
    pattern:
      /\bCCPA\b|\bCPRA\b|\bPIPEDA\b|\bPIPL\b|\bAPPI\b|\bPDPA\b|\bPOPIA\b|\bNIS ?2\b|\bDORA\b|\bGLBA\b|Gramm-Leach|\bFERPA\b|\bCOPPA\b|\bSOX\b/gi,
    family: null,
  },
];

// The families of the laws a set of facts names: every obligation fact's.
export function getFactLawFamilies(
  facts: ReadonlyArray<ComplianceFact>,
): Set<string> {
  const families: Set<string> = new Set();

  for (const fact of facts) {
    if (fact.kind === ComplianceFactKind.BreachObligation) {
      families.add(fact.family);
    }
  }

  return families;
}

/*
 * The laws a text names that none of the facts names, as the text names
 * them. "UK GDPR" is read before "GDPR", so it is not read as both.
 */
export function getUnfoundedLaws(data: {
  text: string;
  facts: ReadonlyArray<ComplianceFact>;
}): Array<string> {
  const families: Set<string> = getFactLawFamilies(data.facts);
  const unfounded: Array<string> = [];
  let text: string = data.text;

  for (const entry of LAW_NAMES_IN_TEXT) {
    const found: Array<string> = text.match(entry.pattern) || [];

    for (const name of found) {
      if (entry.family === null || !families.has(entry.family)) {
        if (!unfounded.includes(name)) {
          unfounded.push(name);
        }
      }
    }

    text = text.replace(entry.pattern, " ");
  }

  return unfounded;
}

/*
 * OneUptime AI's answer, as read (StrictAnswer): each part's Markdown and
 * the ids it says it rests on - not yet held to the facts.
 */
export type ExposureDraftAnswer = Partial<
  Record<ExposureDraftPart, { markdown: string; facts: Array<string> }>
>;

// Why a part of OneUptime AI's answer was not kept.
export enum ExposureDraftDropReason {
  NoFactCited = "NoFactCited",
  TooShort = "TooShort",
  UnfoundedNumber = "UnfoundedNumber",
  UnfoundedLaw = "UnfoundedLaw",
}

export interface HeldExposureDrafts {
  sections: Partial<Record<ExposureDraftPart, ExposureDraftSection>>;
  dropped: Partial<Record<ExposureDraftPart, ExposureDraftDropReason>>;
}

/*
 * The answer held to its facts. Each part keeps only the ids of facts it
 * was given, with the ids taken out of its words; and is dropped when it
 * cites none, says too little, says a number none of the facts holds - a
 * date, a count, a deadline it made up, once the law's own references are
 * set aside - or names a law none of them names.
 */
export function holdExposureDraftsToFacts(data: {
  answer: ExposureDraftAnswer;
  facts: ReadonlyArray<ComplianceFact>;
  now: Date;
}): HeldExposureDrafts {
  const sections: Partial<Record<ExposureDraftPart, ExposureDraftSection>> =
    {};
  const dropped: Partial<Record<ExposureDraftPart, ExposureDraftDropReason>> =
    {};

  for (const part of EXPOSURE_DRAFT_PARTS) {
    const raw: { markdown: string; facts: Array<string> } | undefined =
      data.answer[part];

    if (!raw || typeof raw.markdown !== "string") {
      continue;
    }

    const factKeys: Array<string> = getFactKeys({
      facts: data.facts,
      ids: raw.facts || [],
    });

    if (factKeys.length === 0) {
      dropped[part] = ExposureDraftDropReason.NoFactCited;
      continue;
    }

    const maxLength: number =
      part === ExposureDraftPart.Explanation
        ? MAX_EXPOSURE_EXPLANATION_LENGTH
        : MAX_EXPOSURE_DRAFT_LENGTH;
    const cleaned: string = withoutFactIds(cleanSectionMarkdown(raw.markdown));
    const characters: Array<string> = Array.from(cleaned);
    const markdown: string =
      characters.length > maxLength
        ? `${characters
            .slice(0, maxLength - 1)
            .join("")
            .trim()}…`
        : cleaned;

    if (Array.from(markdown).length < MIN_EXPOSURE_DRAFT_LENGTH) {
      dropped[part] = ExposureDraftDropReason.TooShort;
      continue;
    }

    // Every number the facts hold: a draft cites the assessment, which they all describe.
    if (getUnfoundedNumbers({ text: markdown, facts: data.facts }).length > 0) {
      dropped[part] = ExposureDraftDropReason.UnfoundedNumber;
      continue;
    }

    if (getUnfoundedLaws({ text: markdown, facts: data.facts }).length > 0) {
      dropped[part] = ExposureDraftDropReason.UnfoundedLaw;
      continue;
    }

    sections[part] = {
      part,
      markdown,
      source: ImpactAssessmentSectionSource.Drafted,
      factKeys,
      factsHash: getFactsHash({ facts: data.facts, keys: factKeys }),
      draftedAt: data.now.toISOString(),
    };
  }

  return { sections, dropped };
}

/*
 * A new draft, merged into the assessment a case keeps: every part a
 * person edited stays as they wrote it, whatever the draft says; a part
 * still OneUptime AI's is the new draft's, where it wrote one. The facts
 * and the language are the new draft's.
 */
export function mergeExposureDrafts(data: {
  previous: StoredExposureAssessment;
  drafted: Partial<Record<ExposureDraftPart, ExposureDraftSection>>;
  facts: ReadonlyArray<ComplianceFact>;
  language: string;
  now: Date;
}): StoredExposureAssessment {
  const sections: Partial<Record<ExposureDraftPart, ExposureDraftSection>> =
    {};

  for (const part of EXPOSURE_DRAFT_PARTS) {
    const previous: ExposureDraftSection | undefined =
      data.previous.sections[part];

    if (previous?.source === ImpactAssessmentSectionSource.Edited) {
      sections[part] = previous;
      continue;
    }

    const drafted: ExposureDraftSection | undefined = data.drafted[part];

    if (drafted) {
      sections[part] = drafted;
    } else if (previous) {
      sections[part] = previous;
    }
  }

  return {
    ...data.previous,
    language: data.language,
    sections,
    facts: [...data.facts],
    draftedAt: data.now.toISOString(),
  };
}

// The parts OneUptime AI may draft: those no person edited.
export function getDraftableExposureParts(
  assessment: StoredExposureAssessment | null,
): Array<ExposureDraftPart> {
  return EXPOSURE_DRAFT_PARTS.filter((part: ExposureDraftPart): boolean => {
    return (
      assessment?.sections[part]?.source !==
      ImpactAssessmentSectionSource.Edited
    );
  });
}

export const EXPOSURE_DRAFT_TOO_LONG_MESSAGE: string = translationKey(
  "This draft is longer than an assessment keeps. Shorten it, then save it again.",
);

function allKeys(facts: ReadonlyArray<ComplianceFact>): Array<string> {
  return facts.map((fact: ComplianceFact): string => {
    return fact.key;
  });
}

/*
 * A person's words for one part, as the assessment keeps them: cleaned as a
 * draft is, and from then on theirs - never drafted again. An empty part is
 * taken out, for OneUptime AI to draft again.
 */
export function editExposureDraft(data: {
  assessment: StoredExposureAssessment;
  part: ExposureDraftPart;
  markdown: string;
  // The facts as the person read them, so a change after is said.
  facts: ReadonlyArray<ComplianceFact>;
  userId?: string | undefined;
  now: Date;
}):
  | { isDone: true; assessment: StoredExposureAssessment }
  | { isDone: false; refusal: string } {
  if (Array.from(data.markdown).length > MAX_EDITED_EXPOSURE_DRAFT_LENGTH) {
    return { isDone: false, refusal: EXPOSURE_DRAFT_TOO_LONG_MESSAGE };
  }

  const markdown: string = cleanSectionMarkdown(data.markdown);
  const sections: Partial<Record<ExposureDraftPart, ExposureDraftSection>> = {
    ...data.assessment.sections,
  };

  if (markdown) {
    sections[data.part] = {
      part: data.part,
      markdown,
      source: ImpactAssessmentSectionSource.Edited,
      factKeys: [],
      factsHash: getFactsHash({ facts: data.facts, keys: allKeys(data.facts) }),
      editedAt: data.now.toISOString(),
      editedByUserId: data.userId,
    };
  } else {
    delete sections[data.part];
  }

  return { isDone: true, assessment: { ...data.assessment, sections } };
}

/*
 * The parts written over facts that say something else now - the exposure
 * closed, a secret found, a deadline that now applies - for the page to
 * say, and a person to look at.
 */
export function getStaleExposureDraftParts(data: {
  assessment: StoredExposureAssessment | null;
  facts: ReadonlyArray<ComplianceFact>;
}): Array<ExposureDraftPart> {
  if (!data.assessment) {
    return [];
  }

  return EXPOSURE_DRAFT_PARTS.filter((part: ExposureDraftPart): boolean => {
    const section: ExposureDraftSection | undefined =
      data.assessment!.sections[part];

    if (!section?.factsHash) {
      return false;
    }

    const keys: Array<string> =
      section.source === ImpactAssessmentSectionSource.Edited
        ? allKeys(data.facts)
        : section.factKeys;

    return getFactsHash({ facts: data.facts, keys }) !== section.factsHash;
  });
}

// Where a person says the people live: the places, each once; none takes the answer back.
export function setExposurePeoplePlaces(data: {
  assessment: StoredExposureAssessment;
  places: ReadonlyArray<unknown>;
  userId?: string | undefined;
  now: Date;
}): StoredExposureAssessment {
  const places: Array<BreachPlace> = [
    ...new Set(data.places.filter(isBreachPlace)),
  ];

  return {
    ...data.assessment,
    peopleLiveIn:
      places.length > 0
        ? {
            places,
            saidAt: data.now.toISOString(),
            saidByUserId: data.userId,
          }
        : undefined,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The assessment as plain code worked it out
 * ---------------------------------------------------------------------------
 */

// The store, as the assessment names it.
export interface ExposureStoreView {
  id: string;
  name: string;
  kind: string;
  provider?: string | undefined;
  region?: string | undefined;
  environment?: string | undefined;
  sensitivity: string;
  exposure: string;
}

// One of the case's exposure issues, as the assessment lists it.
export interface ExposureIssueView {
  id: string;
  checkId: string;
  title: string;
  severity: string;
  status: string;
  firstDetectedAt?: string | undefined;
  resolvedAt?: string | undefined;
}

export interface ExposureAssessmentView {
  store: ExposureStoreView;
  exposureIssues: Array<ExposureIssueView>;
  window: ExposureWindow | null;
  reads: ExposureReads;
  whose: ExposureWhoseData;
  secretsToRotate: Array<ExposureSecret>;
  // More secrets were found than an assessment lists.
  hasMoreSecrets: boolean;
  obligations: Array<BreachObligation>;
  mostUrgent: BreachObligation | null;
  uncovered: Array<UncoveredLaw>;
  isPlaceUnknown: boolean;
  // When this was worked out.
  now: string;
}

export function buildExposureAssessmentView(data: {
  store: ExposureStoreView;
  exposureIssues: ReadonlyArray<ExposureIssueView>;
  window: ExposureWindow | null;
  reads: ExposureReads;
  whose: ExposureWhoseData;
  secretsToRotate: ReadonlyArray<ExposureSecret>;
  hasMoreSecrets: boolean;
  now: Date;
}): ExposureAssessmentView {
  const foundAt: Date = data.window
    ? new Date(data.window.foundAt)
    : data.now;
  const obligations: Array<BreachObligation> = applyBreachLaws({
    whose: data.whose,
    reads: data.reads,
    foundAt,
    now: data.now,
  });

  return {
    store: data.store,
    exposureIssues: [...data.exposureIssues],
    window: data.window,
    reads: data.reads,
    whose: data.whose,
    secretsToRotate: [...data.secretsToRotate],
    hasMoreSecrets: data.hasMoreSecrets,
    obligations,
    mostUrgent: getMostUrgentObligation(obligations),
    uncovered: getUncoveredLaws(data.whose),
    isPlaceUnknown: isPlaceUnknown(data.whose),
    now: data.now.toISOString(),
  };
}

// The obligations that may apply, as a count: what the checklist's answer and the timeline say.
export function countObligationsThatMayApply(
  obligations: ReadonlyArray<BreachObligation>,
): number {
  return obligations.filter((obligation: BreachObligation): boolean => {
    return obligation.status === BreachObligationStatus.MayApply;
  }).length;
}

// Whether an obligation's row is one this build knows.
export function isKnownObligation(obligation: BreachObligation): boolean {
  return isBreachLawId(obligation.ruleId);
}

// A row's name as written: "GDPR Article 33".
export function getBreachLawName(id: BreachLawId): string {
  const rule: BreachLawRule = getBreachLawRule(id);

  return `${rule.law} ${rule.provision}`;
}

/*
 * ---------------------------------------------------------------------------
 * The same, in English: for OneUptime AI's facts and an export
 * ---------------------------------------------------------------------------
 */

function plural(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`;
}

// A deadline's length in English: "72 hours", "3 business days", "without undue delay".
export function describeBreachDeadlineInEnglish(rule: BreachLawRule): string {
  const amount: number = rule.deadline.amount || 0;
  let length: string;

  switch (rule.deadline.unit) {
    case BreachDeadlineUnit.Hours:
      length = plural(amount, "hour", "hours");
      break;
    case BreachDeadlineUnit.CalendarDays:
      length = plural(amount, "calendar day", "calendar days");
      break;
    case BreachDeadlineUnit.BusinessDays:
      length = plural(amount, "business day", "business days");
      break;
    case BreachDeadlineUnit.WithoutUndueDelay:
      return "without undue delay";
    default:
      return "no fixed time";
  }

  switch (rule.deadline.start) {
    case BreachDeadlineStart.PeopleNotified:
      return amount === 0
        ? "when the people are notified"
        : `${length} after the people are notified`;
    case BreachDeadlineStart.EndOfCalendarYear:
      return `${length} after the end of the calendar year it was found in`;
    default:
      return `${length} from when it was found`;
  }
}

// A place in English: the table's own words (translationKey keeps the English).
export function describeBreachPlaceInEnglish(place: BreachPlace): string {
  return BREACH_PLACE_WORDS[place];
}

// What a person still checks, in English.
export function describeBreachCheckInEnglish(check: BreachCheck): string {
  switch (check.kind) {
    case BreachCheckKind.Condition:
      return check.condition ? BREACH_CONDITION_WORDS[check.condition] : "";
    case BreachCheckKind.PeopleLiveIn:
      return `If any of the people live in ${(check.places || [])
        .map(describeBreachPlaceInEnglish)
        .join(" or ")}.`;
    case BreachCheckKind.PeopleCount:
      return check.threshold
        ? check.threshold.isMoreThan
          ? `If it affects more than ${check.threshold.count} people.`
          : `If it affects ${check.threshold.count} or more people.`
        : "";
    case BreachCheckKind.FewerPeopleThan:
      return `If it affects fewer than ${check.count || 0} people.`;
    case BreachCheckKind.HeldWithNames:
      return "If the numbers were held with people's names: no names were found, but scans can miss them.";
    case BreachCheckKind.ReadFromOutside:
      return "If the store's access logs show the data was read from outside your accounts.";
    default:
      return "";
  }
}

// The table's rows in English: what to do and who must be told.
export function describeBreachRuleInEnglish(rule: BreachLawRule): {
  action: string;
  recipient: string;
} {
  return { action: rule.action, recipient: rule.recipient };
}
