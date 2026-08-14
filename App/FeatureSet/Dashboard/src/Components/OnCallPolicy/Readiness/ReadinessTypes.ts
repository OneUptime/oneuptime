import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import type {
  ReadinessCoverageCell,
  ReadinessMethod,
  ReadinessStatus,
  ReadinessSummary,
  ResponderSource,
  UserReadiness,
} from "Common/Server/Services/OnCallReadinessService";

/*
 * The browser-side view of the readiness contract.
 *
 * These are type-only imports from the server service on purpose. The previous
 * surface of this kind (Components/Team/TeamComplianceStatusTable.tsx:25-45)
 * hand-copied its response interface and typed the fetch `any` end to end, so
 * the client shape had no compile-time link to the server shape and could drift
 * silently for as long as nobody happened to look at both files. Deriving the
 * wire types from the real ones means a field added, removed or retyped on
 * OnCallReadinessService breaks this build instead of quietly rendering blanks.
 *
 * `import type` (never a value import) matters just as much: the enums live in a
 * server module that transitively pulls in TypeORM, the database models and the
 * whole service layer. A value import would drag all of that into the dashboard
 * bundle. Type-only imports are erased at compile time, so the three literal
 * unions below are reconstructed from the enums with template-literal types and
 * the runtime constants are declared against those unions — renaming an enum
 * member server-side still fails this file to compile.
 */

export type ReadinessStatusValue = `${ReadinessStatus}`;
export type ResponderSourceValue = `${ResponderSource}`;

/*
 * `methodId` is re-declared as an optional STRING for two independent reasons.
 *
 * The first is the same one ReadinessCoverageCellWire has for severityId:
 * ObjectID is a class and does not survive JSON, so an id reaches us either as
 * "uuid" or as ObjectID.toJSON()'s `{ _type: "ObjectID", value: "uuid" }`, and
 * readIdString below flattens both.
 *
 * The second is that it can legitimately be ABSENT. It is the newest field on
 * this contract, and during a rollout a browser holding this bundle can be
 * talking to a server that predates it. A required `string` would then be the
 * empty string, which is an id-shaped value that addresses nothing — it would
 * populate a dropdown with options that submit a foreign key of "" and are
 * refused on create. Optional makes the absence visible to every caller, and the
 * one caller that builds a picker out of these drops the entries it cannot
 * point a rule at rather than offering them.
 */
export type ReadinessMethodWire = Omit<ReadinessMethod, "methodId"> & {
  methodId?: string | undefined;
};

/*
 * ObjectID is a class, and it does not survive JSON. Depending on whether the
 * API stringifies its ids (as Common/Server/API/TeamComplianceAPI.ts:82 does) or
 * hands the instances to Response.sendJsonObjectResponse untouched, an id
 * reaches us either as "uuid" or as ObjectID.toJSON()'s
 * `{ _type: "ObjectID", value: "uuid" }`. The wire types say `string` and
 * readIdString() below flattens both shapes, so the UI never has to care.
 */
export type ReadinessCoverageCellWire = Omit<
  ReadinessCoverageCell,
  "severityId"
> & {
  severityId?: string | undefined;
};

/*
 * `methods` is in the Omit list for the same reason `coverage` is: both are
 * arrays of a type this file re-declares, and inheriting the server's element
 * type would leave a field typed ObjectID on a value that is a string by the
 * time it gets here. Every nested type restated below has to be restated on the
 * container too, or the container quietly keeps the server's version.
 */
export type UserReadinessWire = Omit<
  UserReadiness,
  | "userId"
  | "userProfilePictureId"
  | "status"
  | "methods"
  | "coverage"
  | "reachedVia"
> & {
  userId: string;
  userProfilePictureId?: string | undefined;
  status: ReadinessStatusValue;
  methods: Array<ReadinessMethodWire>;
  coverage: Array<ReadinessCoverageCellWire>;
  reachedVia: Array<ResponderSourceValue>;
};

/*
 * `isFallbackEnabled` is re-declared rather than inherited on purpose. It is the
 * project's `disableOnCallNotificationFallback` switch, inverted, and it is the
 * single fact that decides whether a coverage gap is a degraded page or a lost
 * one. Every sentence this file writes about a PartiallyReady responder is
 * conditional on it, so the wire type states it as a required boolean and the
 * parse below supplies it — the copy must never be able to compile without
 * having been told which world it is describing.
 */
export type ReadinessSummaryWire = Omit<
  ReadinessSummary,
  | "projectId"
  | "onCallDutyPolicyId"
  | "users"
  | "isFallbackEnabled"
  | "isTruncated"
> & {
  projectId: string;
  onCallDutyPolicyId?: string | undefined;
  users: Array<UserReadinessWire>;
  isFallbackEnabled: boolean;
  /*
   * The server's own "this answer is incomplete" flag: one of the reads behind
   * the summary hit its ceiling, so responders, methods or rules may be missing.
   * A surface that renders a count must say so out loud when this is set —
   * "we truncated" and "everyone is fine" look identical otherwise, and the
   * second is the more comforting of the two.
   */
  isTruncated: boolean;
};

export const READINESS_STATUS_READY: ReadinessStatusValue = "Ready";
export const READINESS_STATUS_PARTIALLY_READY: ReadinessStatusValue =
  "PartiallyReady";
export const READINESS_STATUS_NOT_REACHABLE: ReadinessStatusValue =
  "NotReachable";

const READINESS_STATUS_VALUES: Array<ReadinessStatusValue> = [
  READINESS_STATUS_READY,
  READINESS_STATUS_PARTIALLY_READY,
  READINESS_STATUS_NOT_REACHABLE,
];

const RESPONDER_SOURCE_DIRECT: ResponderSourceValue = "Direct";
const RESPONDER_SOURCE_TEAM: ResponderSourceValue = "Team";
const RESPONDER_SOURCE_SCHEDULE: ResponderSourceValue = "Schedule";
const RESPONDER_SOURCE_OVERRIDE: ResponderSourceValue = "Override";

const RESPONDER_SOURCE_VALUES: Array<ResponderSourceValue> = [
  RESPONDER_SOURCE_DIRECT,
  RESPONDER_SOURCE_TEAM,
  RESPONDER_SOURCE_SCHEDULE,
  RESPONDER_SOURCE_OVERRIDE,
];

/*
 * Why an unknown status degrades to PartiallyReady rather than Ready: this whole
 * feature exists because a responder can be silently unreachable, and a surface
 * that renders green when it does not understand the payload would reproduce
 * exactly that failure. Amber is visible without crying wolf.
 */
const isReadinessStatusValue: (
  value: JSONValue,
) => value is ReadinessStatusValue = (
  value: JSONValue,
): value is ReadinessStatusValue => {
  return (
    typeof value === "string" &&
    READINESS_STATUS_VALUES.includes(value as ReadinessStatusValue)
  );
};

const isResponderSourceValue: (
  value: JSONValue,
) => value is ResponderSourceValue = (
  value: JSONValue,
): value is ResponderSourceValue => {
  return (
    typeof value === "string" &&
    RESPONDER_SOURCE_VALUES.includes(value as ResponderSourceValue)
  );
};

// Flattens the three shapes an ObjectID can arrive in to its plain uuid string.
const readIdString: (value: JSONValue | undefined) => string = (
  value: JSONValue | undefined,
): string => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const asObject: JSONObject = value as JSONObject;
    const inner: JSONValue | undefined =
      asObject["value"] ?? asObject["_id"] ?? asObject["id"];

    return inner ? String(inner) : "";
  }

  return String(value);
};

const readString: (value: JSONValue | undefined) => string = (
  value: JSONValue | undefined,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

/*
 * Boolean with an explicit "the key was not there at all" answer, which is a
 * different question from "the key was false".
 *
 * Plain Boolean(json["isFallbackEnabled"]) would read a server that predates the
 * signal as fallback-disabled and print "your pages are being dropped" at every
 * project on earth. On such a server the fallback is on unless an admin turned it
 * off (disableOnCallNotificationFallback defaults to false), so absent means the
 * default configuration. A false alarm on every project is not the safe side of
 * this call: it is the same alarm-fatigue failure the whole feature exists to
 * avoid, just pointed the other way.
 */
const readBoolean: (
  value: JSONValue | undefined,
  whenAbsent: boolean,
) => boolean = (value: JSONValue | undefined, whenAbsent: boolean): boolean => {
  if (value === null || value === undefined) {
    return whenAbsent;
  }

  return Boolean(value);
};

/*
 * Array<JSONValue>, not JSONArray: JSONArray is Array<JSONObject> (JSON.ts:189)
 * and this payload carries arrays of plain strings (`reasons`, `reachedVia`) as
 * well as arrays of objects.
 */
const readArray: (value: JSONValue | undefined) => Array<JSONValue> = (
  value: JSONValue | undefined,
): Array<JSONValue> => {
  if (!value || !Array.isArray(value)) {
    return [];
  }

  return value as Array<JSONValue>;
};

/*
 * A count, or the caller's fallback when the payload does not carry one.
 * Number("") is 0 and Number(undefined) is NaN, and either one would silently
 * become "the scope holds no responders" if it were allowed through as a total.
 */
const readNumber: (
  value: JSONValue | undefined,
  whenAbsent: number,
) => number = (value: JSONValue | undefined, whenAbsent: number): number => {
  if (value === null || value === undefined || value === "") {
    return whenAbsent;
  }

  const parsed: number = Number(value);

  if (!Number.isFinite(parsed)) {
    return whenAbsent;
  }

  return parsed;
};

const parseCoverageCell: (json: JSONObject) => ReadinessCoverageCellWire = (
  json: JSONObject,
): ReadinessCoverageCellWire => {
  const severityId: string = readIdString(json["severityId"]);
  const severityName: string = readString(json["severityName"]);

  return {
    /*
     * Deliberately not validated against NotificationRuleType: a rule type added
     * server-side should render as its own copy (getRuleTypeLabel falls through
     * to the raw string) rather than being silently relabelled as some other
     * type we do happen to know about.
     */
    ruleType: readString(json["ruleType"]) as NotificationRuleType,
    severityId: severityId || undefined,
    severityName: severityName || undefined,
    hasRule: Boolean(json["hasRule"]),
    isOptOut: Boolean(json["isOptOut"]),
  };
};

const parseMethod: (json: JSONObject) => ReadinessMethodWire = (
  json: JSONObject,
): ReadinessMethodWire => {
  const methodId: string = readIdString(json["methodId"]);

  return {
    /*
     * The id of the method ROW, and the only field here that is not for
     * display. It is what lets an administrator POINT A RULE AT one of somebody
     * else's notification methods without reading that method's row — the
     * dropdown renders the mask and submits this. Empty collapses to undefined
     * so "the server did not send one" and "the server sent nothing useful" are
     * the same answer to the surfaces downstream.
     */
    methodId: methodId || undefined,
    methodType: readString(json["methodType"]),
    maskedIdentifier: readString(json["maskedIdentifier"]),
    isVerified: Boolean(json["isVerified"]),
  };
};

const parseUserReadiness: (json: JSONObject) => UserReadinessWire = (
  json: JSONObject,
): UserReadinessWire => {
  const profilePictureId: string = readIdString(json["userProfilePictureId"]);

  return {
    userId: readIdString(json["userId"]),
    userName: readString(json["userName"]),
    userEmail: readString(json["userEmail"]),
    userProfilePictureId: profilePictureId || undefined,
    status: isReadinessStatusValue(json["status"])
      ? json["status"]
      : READINESS_STATUS_PARTIALLY_READY,
    methods: readArray(json["methods"]).map(
      (method: JSONValue): ReadinessMethodWire => {
        return parseMethod(method as JSONObject);
      },
    ),
    coverage: readArray(json["coverage"]).map(
      (cell: JSONValue): ReadinessCoverageCellWire => {
        return parseCoverageCell(cell as JSONObject);
      },
    ),
    reasons: readArray(json["reasons"])
      .map((reason: JSONValue): string => {
        return readString(reason);
      })
      .filter((reason: string): boolean => {
        return reason.length > 0;
      }),
    reachedVia: readArray(json["reachedVia"]).filter(isResponderSourceValue),
  };
};

export const countByStatus: (
  users: Array<UserReadinessWire>,
  status: ReadinessStatusValue,
) => number = (
  users: Array<UserReadinessWire>,
  status: ReadinessStatusValue,
): number => {
  return users.filter((user: UserReadinessWire): boolean => {
    return user.status === status;
  }).length;
};

export const parseReadinessSummary: (
  json: JSONObject,
) => ReadinessSummaryWire = (json: JSONObject): ReadinessSummaryWire => {
  const policyId: string = readIdString(json["onCallDutyPolicyId"]);

  const users: Array<UserReadinessWire> = readArray(json["users"]).map(
    (user: JSONValue): UserReadinessWire => {
      return parseUserReadiness(user as JSONObject);
    },
  );

  /*
   * The counts are recomputed from the rows rather than trusted from the
   * payload. The tiles and the list are read together, and a tile that
   * disagrees with the list under it is worse than no tile at all.
   */
  return {
    projectId: readIdString(json["projectId"]),
    onCallDutyPolicyId: policyId || undefined,
    isFallbackEnabled: readBoolean(json["isFallbackEnabled"], true),
    /*
     * Absent defaults to false, the opposite of the fallback flag's default,
     * because the two absences mean opposite things: a server that does not
     * report truncation is one that does not truncate, whereas a server that
     * does not report the fallback switch still has a fallback.
     */
    isTruncated: readBoolean(json["isTruncated"], false),
    readyCount: countByStatus(users, READINESS_STATUS_READY),
    partiallyReadyCount: countByStatus(users, READINESS_STATUS_PARTIALLY_READY),
    notReachableCount: countByStatus(users, READINESS_STATUS_NOT_REACHABLE),
    users: users,
  };
};

/*
 * One page of a summary, as ReadinessSummaryPageWire sends it.
 *
 * The endpoint is paged (`?limit=&skip=`, default 100, max 500) and the chips
 * surface asks about SPECIFIC responders: a chip whose user did not fit in the
 * page the client happens to hold has no readiness row, renders no dot, and is
 * therefore indistinguishable from a healthy one. That is the feature's central
 * failure mode reproduced at chip scale, so `hasMore` is parsed rather than
 * ignored and the hook reads pages until it is false.
 *
 * `totalCount` is whole-scope, never the page's, so it is what a surface has to
 * quote if it ever admits to holding part of a list.
 */
export interface ReadinessPageWire {
  summary: ReadinessSummaryWire;
  hasMore: boolean;
  totalCount: number;
}

export const parseReadinessPage: (json: JSONObject) => ReadinessPageWire = (
  json: JSONObject,
): ReadinessPageWire => {
  const summary: ReadinessSummaryWire = parseReadinessSummary(json);

  return {
    summary: summary,
    /*
     * Absent defaults to false — "this is everything" — because the alternative
     * default makes a client loop against a server that never said it had more.
     * A server that pages always says so.
     */
    hasMore: readBoolean(json["hasMore"], false),
    totalCount: readNumber(json["totalCount"], summary.users.length),
  };
};

/*
 * Merges the pages a surface has read into the one summary it renders.
 *
 * The counts are recomputed across every row held, which is right exactly while
 * the client holds the whole scope — and `isTruncated` on the hook is how a
 * surface finds out that it does not, so it can say so rather than print a
 * reassuring "0 unreachable" computed from the healthy tail of a list it only
 * partly read.
 */
export const mergeReadinessPages: (
  pages: Array<ReadinessPageWire>,
) => ReadinessSummaryWire | null = (
  pages: Array<ReadinessPageWire>,
): ReadinessSummaryWire | null => {
  const first: ReadinessPageWire | undefined = pages[0];

  if (!first) {
    return null;
  }

  const users: Array<UserReadinessWire> = [];

  for (const page of pages) {
    users.push(...page.summary.users);
  }

  return {
    ...first.summary,
    /*
     * Incompleteness is sticky: one truncated page makes the merged answer
     * incomplete, however many complete pages surround it.
     */
    isTruncated: pages.some((page: ReadinessPageWire): boolean => {
      return page.summary.isTruncated;
    }),
    readyCount: countByStatus(users, READINESS_STATUS_READY),
    partiallyReadyCount: countByStatus(users, READINESS_STATUS_PARTIALLY_READY),
    notReachableCount: countByStatus(users, READINESS_STATUS_NOT_REACHABLE),
    users: users,
  };
};

/*
 * Lets a surface that only knows a responder by chip label — the escalation
 * summary renders `user.name || user.email` and nothing else — find that
 * responder's readiness row.
 *
 * userId is the reliable key and is used whenever the caller has one. The label
 * index is the fallback, and it deliberately stores null for any label that more
 * than one distinct user answers to: two responders genuinely named "Alex Chen"
 * must produce no dot at all rather than a confident dot pointing at the wrong
 * person. A missing warning is recoverable; a warning attached to the wrong name
 * sends an admin to fix an account that was never broken.
 */
export interface ReadinessIndex {
  byUserId: Record<string, UserReadinessWire>;
  byLabel: Record<string, UserReadinessWire | null>;
}

export const buildReadinessIndex: (
  summary: ReadinessSummaryWire | null,
) => ReadinessIndex = (
  summary: ReadinessSummaryWire | null,
): ReadinessIndex => {
  const index: ReadinessIndex = {
    byUserId: {},
    byLabel: {},
  };

  if (!summary) {
    return index;
  }

  const addLabel: (label: string, user: UserReadinessWire) => void = (
    label: string,
    user: UserReadinessWire,
  ): void => {
    const key: string = label.trim().toLowerCase();

    if (!key) {
      return;
    }

    const existing: UserReadinessWire | null | undefined = index.byLabel[key];

    if (existing === undefined) {
      index.byLabel[key] = user;
      return;
    }

    if (existing && existing.userId === user.userId) {
      return;
    }

    index.byLabel[key] = null;
  };

  for (const user of summary.users) {
    if (user.userId) {
      index.byUserId[user.userId] = user;
    }

    addLabel(user.userName, user);
    addLabel(user.userEmail, user);
  }

  return index;
};

export const findReadinessForResponder: (
  index: ReadinessIndex,
  params: { userId?: string | undefined; label: string },
) => UserReadinessWire | null = (
  index: ReadinessIndex,
  params: { userId?: string | undefined; label: string },
): UserReadinessWire | null => {
  if (params.userId && index.byUserId[params.userId]) {
    return index.byUserId[params.userId] || null;
  }

  return index.byLabel[params.label.trim().toLowerCase()] || null;
};

/*
 * A "gap" is a (ruleType, severity) cell with no rule and no explicit opt-out.
 * An opt-out is a deliberate choice — the responder said "never notify me for
 * this" — so counting it as a gap would nag people for configuring the product
 * correctly.
 */
export const getCoverageGaps: (
  user: UserReadinessWire,
) => Array<ReadinessCoverageCellWire> = (
  user: UserReadinessWire,
): Array<ReadinessCoverageCellWire> => {
  return user.coverage.filter((cell: ReadinessCoverageCellWire): boolean => {
    return !cell.hasRule && !cell.isOptOut;
  });
};

export const getVerifiedMethods: (
  user: UserReadinessWire,
) => Array<ReadinessMethodWire> = (
  user: UserReadinessWire,
): Array<ReadinessMethodWire> => {
  return user.methods.filter((method: ReadinessMethodWire): boolean => {
    return method.isVerified;
  });
};

// Compact label for a rule type: the enum's own value is a whole sentence.
export const getRuleTypeLabel: (ruleType: NotificationRuleType) => string = (
  ruleType: NotificationRuleType,
): string => {
  switch (ruleType) {
    case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT:
      return "Incident";
    case NotificationRuleType.ON_CALL_EXECUTED_ALERT:
      return "Alert";
    case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE:
      return "Incident episode";
    case NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE:
      return "Alert episode";
    case NotificationRuleType.WHEN_USER_GOES_ON_CALL:
      return "Goes on call";
    case NotificationRuleType.WHEN_USER_GOES_OFF_CALL:
      return "Goes off call";
    default:
      return String(ruleType);
  }
};

// "Incident · Sev1", or just "Goes on call" for the two severity-less types.
export const getCoverageCellLabel: (
  cell: ReadinessCoverageCellWire,
) => string = (cell: ReadinessCoverageCellWire): string => {
  const ruleLabel: string = getRuleTypeLabel(cell.ruleType);

  if (!cell.severityName) {
    return ruleLabel;
  }

  return `${ruleLabel} · ${cell.severityName}`;
};

export const getResponderSourceLabel: (
  source: ResponderSourceValue,
) => string = (source: ResponderSourceValue): string => {
  const labels: Record<ResponderSourceValue, string> = {
    Direct: "added directly",
    Team: "a team",
    Schedule: "an on-call schedule",
    Override: "an override",
  };

  return labels[source];
};

/*
 * Chip-sized summary of a responder's state. Ready responders have no chip at
 * all on the escalation summary, so this is only ever amber or red copy.
 */
export const getStatusShortLabel: (user: UserReadinessWire) => string = (
  user: UserReadinessWire,
): string => {
  if (user.status === READINESS_STATUS_NOT_REACHABLE) {
    return "Unreachable";
  }

  if (user.status === READINESS_STATUS_PARTIALLY_READY) {
    const gapCount: number = getCoverageGaps(user).length;

    if (gapCount === 1) {
      return "1 gap";
    }

    return `${gapCount} gaps`;
  }

  return "Ready";
};

/*
 * The project-level facts the consequence copy cannot be written without.
 *
 * It is a required argument, not an option with a default, and that is the whole
 * point of the type. The previous version of these functions took only the user
 * and hardcoded "so nothing is dropped" for every PartiallyReady responder — true
 * only while the fallback is on. A project with
 * `disableOnCallNotificationFallback` set drops exactly those pages, and the copy
 * told the admin their gap was harmless at the precise moment it was not. Making
 * the caller state which world it is in means that sentence cannot be written
 * again by accident.
 */
export interface ReadinessDeliveryContext {
  /*
   * The project's on-call notification fallback, as the summary reports it. When
   * false, a rule gap has nothing behind it: no rule means no notification, full
   * stop.
   */
  isFallbackEnabled: boolean;
}

/*
 * Whether the fallback has anything at all to deliver on for this responder.
 *
 * Two independent ways to answer no, and both are silent in the payload unless
 * you look for them. The obvious one is the project switch. The other is a
 * responder the server marked NotReachable while they still have verified
 * methods on file — the only way that happens is that every channel those methods
 * live on is switched off project-wide, which is a different problem with a
 * different fix from "they never verified anything", and telling the two apart is
 * the difference between an admin flipping a project setting and an admin sending
 * a pointless email.
 */
const hasChannelsSwitchedOff: (user: UserReadinessWire) => boolean = (
  user: UserReadinessWire,
): boolean => {
  return (
    user.status === READINESS_STATUS_NOT_REACHABLE &&
    getVerifiedMethods(user).length > 0
  );
};

const canFallbackDeliver: (
  user: UserReadinessWire,
  delivery: ReadinessDeliveryContext,
) => boolean = (
  user: UserReadinessWire,
  delivery: ReadinessDeliveryContext,
): boolean => {
  if (!delivery.isFallbackEnabled) {
    return false;
  }

  return getVerifiedMethods(user).length > 0;
};

const getMethodNames: (user: UserReadinessWire) => string = (
  user: UserReadinessWire,
): string => {
  return getVerifiedMethods(user)
    .map((method: ReadinessMethodWire): string => {
      return method.methodType;
    })
    .join(", ");
};

/*
 * The sentence that has to carry the whole three-state semantic: red is the
 * state that actually loses pages, amber is degraded-but-delivered *when the
 * fallback is on*, because the fallback pages the responder on whatever verified
 * method they do have (OnCallNotificationAlertingService documents that
 * contract). Saying "gaps still page you, just not the way you asked" is the
 * difference between a warning people act on and a warning people learn to
 * ignore — and saying it in a project where the fallback is off is a lie that
 * costs somebody a page.
 */
export const getStatusConsequence: (
  user: UserReadinessWire,
  delivery: ReadinessDeliveryContext,
  displayName?: string | undefined,
) => string = (
  user: UserReadinessWire,
  delivery: ReadinessDeliveryContext,
  displayName?: string | undefined,
): string => {
  /*
   * Every branch below is a complete sentence that names the responder, because
   * this copy is read in three different places (a card row under the name, a
   * chip tooltip, an email draft) and a sentence that leans on whatever happened
   * to precede it — "Those pages…" — is only correct in one of them.
   */
  const name: string =
    displayName || user.userName || user.userEmail || "This responder";

  if (user.status === READINESS_STATUS_NOT_REACHABLE) {
    if (hasChannelsSwitchedOff(user)) {
      return `${name} can only be reached on ${getMethodNames(
        user,
      )}, and this project has those channels switched off, so every page routed to them is dropped.`;
    }

    return `${name} has no verified notification method, so every page routed to them is dropped.`;
  }

  if (user.status === READINESS_STATUS_PARTIALLY_READY) {
    const gapCount: number = getCoverageGaps(user).length;
    const gapWord: string = gapCount === 1 ? "rule gap" : "rule gaps";
    const pageWord: string =
      gapCount === 1 ? "That page is" : "Those pages are";

    if (!delivery.isFallbackEnabled) {
      return `${name} has ${gapCount} ${gapWord}, and this project has on-call notification fallback switched off. ${pageWord} dropped — nothing catches them.`;
    }

    if (!canFallbackDeliver(user, delivery)) {
      return `${name} has ${gapCount} ${gapWord} and no verified method for the fallback to use, so ${pageWord.toLowerCase()} dropped.`;
    }

    return `${name} has ${gapCount} ${gapWord}. Those pages still reach them on ${getMethodNames(
      user,
    )} through the fallback, so nothing is dropped — but with default timing rather than the rules they would have chosen.`;
  }

  return `${name} has a verified method and a rule for every severity and rule type.`;
};

/*
 * Second person, for a draft addressed to the responder themselves. The
 * third-person copy above cannot be reused here: "Alex has no verified method"
 * inside an email to Alex reads like it was written about somebody else.
 *
 * Each branch is a clause that completes "…you are a responder on an on-call
 * policy, but ", so it opens lower-case and carries no leading subject.
 */
export const getSelfAddressedConsequence: (
  user: UserReadinessWire,
  delivery: ReadinessDeliveryContext,
) => string = (
  user: UserReadinessWire,
  delivery: ReadinessDeliveryContext,
): string => {
  if (user.status === READINESS_STATUS_NOT_REACHABLE) {
    if (hasChannelsSwitchedOff(user)) {
      return `every notification method on your account is on a channel this project has switched off (${getMethodNames(
        user,
      )}), so pages routed to you are being dropped.`;
    }

    return "your account has no verified notification method, so pages routed to you are being dropped.";
  }

  const gapCount: number = getCoverageGaps(user).length;
  const subject: string = `${gapCount} ${
    gapCount === 1
      ? "severity or rule type has"
      : "severities and rule types have"
  } no notification rule on your account`;
  const pageWord: string = gapCount === 1 ? "That page is" : "Those pages are";

  if (!delivery.isFallbackEnabled) {
    return `${subject}, and this project has on-call notification fallback switched off. ${pageWord} dropped rather than arriving on another channel.`;
  }

  if (!canFallbackDeliver(user, delivery)) {
    return `${subject}, and you have no verified notification method for the fallback to use, so ${pageWord.toLowerCase()} dropped.`;
  }

  return `${subject}. Those pages still reach you through the fallback, but with default timing rather than the rules you would have chosen.`;
};
