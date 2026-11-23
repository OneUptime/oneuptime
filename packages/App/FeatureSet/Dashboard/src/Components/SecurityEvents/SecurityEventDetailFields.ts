import { CLAIMED_IP } from "./ClaimedClientAddressCopy";
import { HIDDEN_BY_A_SCRUB_RULE } from "./HiddenClientAddressCopy";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { JSONObject } from "Common/Types/JSON";
import { SECURITY_REQUEST_ATTRIBUTES } from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  ClaimedClientAddress,
  readClaimedClientAddress,
} from "Common/Utils/SecurityEvent/ClientAddressTrust";
import { SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX } from "Common/Utils/SecurityEvent/SecurityEventSearch";
import {
  CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE,
  HiddenClientAddress,
  SCRUBBED_ADDRESS_ATTRIBUTES,
  ScrubbedAddressRole,
  readHiddenClientAddress,
  readHiddenTargetAddress,
} from "Common/Utils/SecurityEvent/ScrubbedAddress";
import {
  SCRUBBED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  USER_HIDDEN_BY_SCRUB_RULE,
  readHiddenEventUser,
} from "Common/Utils/SecurityEvent/ScrubbedUser";

/*
 * What one security event says, as data.
 *
 * Kept out of the panel component so App/Tests can pin the field order, the
 * "the source did not say" rules and the JSON shape without rendering a
 * drawer — and so the same field list can be reused anywhere an event has to
 * be described.
 */

export interface SecurityEventDetailField {
  label: string;
  value: string;
  /*
   * The facet key a "filter the list by this" action would use — a
   * SecurityEvent column. Absent for fields that are free text (a message, a
   * process command line) or unique per row (an event uid), where filtering
   * on the exact value would return the one event already on screen.
   */
  facetKey?: string | undefined;
  // The value that filter is for, when it is not the value shown.
  facetValue?: string | undefined;
  /*
   * The value is a sentence of OneUptime's - an English key, looked up
   * where it is drawn - not something the event's source wrote.
   */
  isValueTranslated?: boolean | undefined;
  /*
   * The client address a scrub rule hid (#10397): what Principal IP says in
   * the address's place, with the rule that hid it - or the destination's,
   * on Target IP (#10419), as hiddenAddressRole says.
   */
  hiddenAddress?: HiddenClientAddress | undefined;
  hiddenAddressRole?: ScrubbedAddressRole | undefined;
  /*
   * An address the request only claimed (#10416): said as claimed by the
   * request, not verified, and never the event's address.
   */
  claimedAddress?: ClaimedClientAddress | undefined;
  /*
   * A user a scrub rule redacted or masked (#10435): what Principal User or
   * Target User says in the user's place, whose filter shows every event
   * whose user a rule hid.
   */
  isHiddenUser?: boolean | undefined;
}

/*
 * Principal User or Target User for an event whose user a scrub rule
 * redacted or masked (#10435): the sentence that says so, which filters
 * the list to every event whose user of that role a rule hid. Null for an
 * event that names its user - a Hash rule's token included, which names
 * one user without saying who - or says nothing of one.
 */
export function buildHiddenUserField(
  event: SecurityEventDetailSource,
  role: ScrubbedUserRole,
): SecurityEventDetailField | null {
  const user: string =
    role === ScrubbedUserRole.Principal
      ? text(event.principalUser)
      : text(event.targetUser);

  if (user || !readHiddenEventUser(event, role)) {
    return null;
  }

  return {
    label:
      role === ScrubbedUserRole.Principal ? "Principal User" : "Target User",
    value: HIDDEN_BY_A_SCRUB_RULE,
    isValueTranslated: true,
    isHiddenUser: true,
    facetKey: `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${SCRUBBED_USER_ATTRIBUTES[role].hidden}`,
    facetValue: USER_HIDDEN_BY_SCRUB_RULE,
  };
}

/*
 * Claimed IP, beside Principal IP: an address the event's request claimed
 * - X-Forwarded-For's, or client.address as instrumentation read it - that
 * Security Events could not verify, so it blames none of it (#10416). It
 * filters the list to every event that claimed the same address. Null for
 * an event whose request claimed nothing beside its address.
 */
export function buildClaimedIpField(
  event: SecurityEventDetailSource,
): SecurityEventDetailField | null {
  const claimedAddress: ClaimedClientAddress | null =
    readClaimedClientAddress(event);

  if (!claimedAddress) {
    return null;
  }

  return {
    label: CLAIMED_IP,
    value: claimedAddress.address || HIDDEN_BY_A_SCRUB_RULE,
    isValueTranslated: !claimedAddress.address,
    claimedAddress,
    ...(claimedAddress.address
      ? {
          facetKey: `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress}`,
          facetValue: claimedAddress.address,
        }
      : {}),
  };
}

/*
 * The columns the overview reads. A stored event has them, and so does an
 * event a log line is about to become (NormalizedSecurityEvent), which "Check
 * a log line" on Your logs describes with the same fields.
 */
export type SecurityEventDetailSource = Partial<
  Pick<
    SecurityEvent,
    | "className"
    | "categoryName"
    | "activityName"
    | "statusName"
    | "message"
    | "vendorName"
    | "productName"
    | "ruleName"
    | "ruleId"
    | "mitreTactics"
    | "mitreTechniques"
    | "principalUser"
    | "principalHost"
    | "principalIp"
    | "principalProcess"
    | "processName"
    | "processPath"
    | "processCommandLine"
    | "parentProcessName"
    | "parentProcessPath"
    | "parentProcessCommandLine"
    | "targetUser"
    | "targetHost"
    | "targetIp"
    | "targetPort"
    | "targetResource"
    | "requestOutcome"
    | "traceId"
    | "sessionId"
    | "eventUid"
    // What it says of its request: a client address a scrub rule hid.
    | "attributes"
  >
>;

/*
 * Principal IP for an event whose address a scrub rule hid (#10397): the
 * sentence that says so, which filters the list to every event whose
 * address a scrub rule hid. Null for an event that names its address, or
 * says nothing of one.
 */
export function buildHiddenPrincipalIpField(
  event: SecurityEventDetailSource,
): SecurityEventDetailField | null {
  const hiddenAddress: HiddenClientAddress | null =
    readHiddenClientAddress(event);

  if (!hiddenAddress) {
    return null;
  }

  return {
    label: "Principal IP",
    value: HIDDEN_BY_A_SCRUB_RULE,
    isValueTranslated: true,
    hiddenAddress,
    hiddenAddressRole: ScrubbedAddressRole.Principal,
    facetKey: `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden}`,
    facetValue: CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE,
  };
}

/*
 * Target IP for an event whose destination a scrub rule hid (#10419): a
 * firewall's connection, an outbound transfer. The same sentence, with the
 * rule that hid it, filtering the list to every event whose destination a
 * scrub rule hid. Null for an event that names its destination, or says
 * nothing of one.
 */
export function buildHiddenTargetIpField(
  event: SecurityEventDetailSource,
): SecurityEventDetailField | null {
  const hiddenAddress: HiddenClientAddress | null =
    readHiddenTargetAddress(event);

  if (!hiddenAddress) {
    return null;
  }

  return {
    label: "Target IP",
    value: HIDDEN_BY_A_SCRUB_RULE,
    isValueTranslated: true,
    hiddenAddress,
    hiddenAddressRole: ScrubbedAddressRole.Target,
    facetKey: `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${SCRUBBED_ADDRESS_ATTRIBUTES[ScrubbedAddressRole.Target].hidden}`,
    facetValue: CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE,
  };
}

function text(value: string | undefined): string {
  return (value || "").trim();
}

function joinArray(values: Array<string> | undefined): string {
  return (values || [])
    .filter((value: string): boolean => {
      return Boolean(value);
    })
    .join(", ");
}

/*
 * The typed OCSF fields, in the order a responder reads them: what happened,
 * how bad, who did it, to what, and who reported it.
 *
 * Fields the source did not fill are dropped rather than rendered as a dash.
 * Every one of these columns is non-nullable with a '' (or 0) default, so an
 * event that carries six facts would otherwise be shown as six facts buried
 * in fifteen blanks.
 */
export function buildSecurityEventOverviewFields(
  event: SecurityEventDetailSource,
): Array<SecurityEventDetailField> {
  const candidates: Array<SecurityEventDetailField> = [
    {
      label: "Event Class",
      value: text(event.className),
      facetKey: "className",
    },
    {
      label: "Category",
      value: text(event.categoryName),
      facetKey: "categoryName",
    },
    {
      label: "Activity",
      value: text(event.activityName),
      facetKey: "activityName",
    },
    { label: "Status", value: text(event.statusName), facetKey: "statusName" },
    { label: "Message", value: text(event.message) },
    { label: "Vendor", value: text(event.vendorName), facetKey: "vendorName" },
    {
      label: "Product",
      value: text(event.productName),
      facetKey: "productName",
    },
    {
      /*
       * "Detection Rule", not "Rule Name" — the same words the facet sidebar
       * uses for this column, so a chip added from here reads as the section
       * it came from.
       */
      label: "Detection Rule",
      value: text(event.ruleName),
      facetKey: "ruleName",
    },
    { label: "Rule ID", value: text(event.ruleId) },
    { label: "MITRE Tactics", value: joinArray(event.mitreTactics) },
    { label: "MITRE Techniques", value: joinArray(event.mitreTechniques) },
    // A scrub rule hid it: said where the user would be (#10435).
    buildHiddenUserField(event, ScrubbedUserRole.Principal) || {
      label: "Principal User",
      value: text(event.principalUser),
      facetKey: "principalUser",
    },
    {
      label: "Principal Host",
      value: text(event.principalHost),
      facetKey: "principalHost",
    },
    // A scrub rule hid it: said where the address would be, never left out.
    buildHiddenPrincipalIpField(event) || {
      label: "Principal IP",
      value: text(event.principalIp),
      facetKey: "principalIp",
    },
    // An address the request only claimed: said as claimed, never blamed.
    buildClaimedIpField(event) || { label: CLAIMED_IP, value: "" },
    { label: "Principal Process", value: text(event.principalProcess) },
    /*
     * The process the event is about - the one started, in a process
     * launch - and the one that started it. Names filter the list; paths
     * and command lines are as good as unique.
     */
    {
      label: "Process",
      value: text(event.processName),
      facetKey: "processName",
    },
    { label: "Process Path", value: text(event.processPath) },
    { label: "Command Line", value: text(event.processCommandLine) },
    {
      label: "Parent Process",
      value: text(event.parentProcessName),
      facetKey: "parentProcessName",
    },
    { label: "Parent Process Path", value: text(event.parentProcessPath) },
    {
      label: "Parent Command Line",
      value: text(event.parentProcessCommandLine),
    },
    buildHiddenUserField(event, ScrubbedUserRole.Target) || {
      label: "Target User",
      value: text(event.targetUser),
      facetKey: "targetUser",
    },
    {
      label: "Target Host",
      value: text(event.targetHost),
      facetKey: "targetHost",
    },
    // A scrub rule hid it: said where the destination would be (#10419).
    buildHiddenTargetIpField(event) || {
      label: "Target IP",
      value: text(event.targetIp),
      facetKey: "targetIp",
    },
    {
      /*
       * The column is non-nullable with a 0 default, so 0 means "the source
       * did not say" far more often than it means port zero.
       */
      label: "Target Port",
      value: event.targetPort ? event.targetPort.toString() : "",
    },
    { label: "Target Resource", value: text(event.targetResource) },
    /*
     * The request the event happened in: how far it got, and the ids that
     * find every other event of the same request or session.
     */
    {
      label: "Request Outcome",
      value: text(event.requestOutcome),
      facetKey: "requestOutcome",
    },
    { label: "Trace ID", value: text(event.traceId), facetKey: "traceId" },
    {
      label: "Session ID",
      value: text(event.sessionId),
      facetKey: "sessionId",
    },
    { label: "Event UID", value: text(event.eventUid) },
  ];

  return candidates.filter((field: SecurityEventDetailField): boolean => {
    return field.value.length > 0;
  });
}

/*
 * The event as JSON — what the "JSON" tab shows and what a copy-paste into a
 * ticket carries.
 *
 * Built field by field rather than off the model instance: an analytics model
 * carries its whole table definition (columns, access control, projections)
 * on the object, and serializing that would bury the twenty facts about the
 * event under a few hundred about the table. Empty values are kept here,
 * unlike the overview: the JSON is the record, and a reader diffing two
 * events needs to see that one of them has no target host.
 */
export function buildSecurityEventJson(event: SecurityEvent): JSONObject {
  return {
    time: event.time ? new Date(event.time).toISOString() : null,
    eventUid: event.eventUid || "",
    severityName: event.severityName || "",
    severityId: event.severityId ?? null,
    categoryName: event.categoryName || "",
    categoryUid: event.categoryUid ?? null,
    className: event.className || "",
    classUid: event.classUid ?? null,
    activityName: event.activityName || "",
    statusName: event.statusName || "",
    message: event.message || "",
    vendorName: event.vendorName || "",
    productName: event.productName || "",
    ruleId: event.ruleId || "",
    ruleName: event.ruleName || "",
    mitreTactics: event.mitreTactics || [],
    mitreTechniques: event.mitreTechniques || [],
    principalUser: event.principalUser || "",
    principalHost: event.principalHost || "",
    principalIp: event.principalIp || "",
    principalProcess: event.principalProcess || "",
    processName: event.processName || "",
    processPath: event.processPath || "",
    processCommandLine: event.processCommandLine || "",
    parentProcessName: event.parentProcessName || "",
    parentProcessPath: event.parentProcessPath || "",
    parentProcessCommandLine: event.parentProcessCommandLine || "",
    targetUser: event.targetUser || "",
    targetHost: event.targetHost || "",
    targetIp: event.targetIp || "",
    targetPort: event.targetPort ?? null,
    targetResource: event.targetResource || "",
    observables: event.observables || [],
    traceId: event.traceId || "",
    spanId: event.spanId || "",
    sessionId: event.sessionId || "",
    requestOutcome: event.requestOutcome || "",
    attributes: (event.attributes || {}) as JSONObject,
  };
}
