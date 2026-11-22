/*
 * ONEUPTIME'S OWN ACTIVITY, AS SECURITY EVENTS MARK IT (#10426).
 *
 * What OneUptime itself does in a customer's systems reaches Security
 * Events like anything else does: Data Security reads a customer's AWS
 * accounts through the cloud connection's role, and that account's
 * CloudTrail records every call - the refused ones too. An event OneUptime
 * recognises as its own carries oneuptime.actor = oneuptime, and the cloud
 * connection whose session made the call, so a rule can leave OneUptime's
 * own work out (Burst of access-denied API calls does) while the event is
 * still kept and searchable.
 *
 * Only OneUptime writes these keys: whatever a record that arrives says
 * under them is dropped before OneUptime marks it
 * (Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions).
 */

// Who acted, when it was OneUptime itself.
export const ONEUPTIME_ACTOR_ATTRIBUTE: string = "oneuptime.actor";
export const ONEUPTIME_ACTOR_VALUE: string = "oneuptime";

// The cloud connection whose session made the call.
export const ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE: string =
  "oneuptime.actor.cloud_connection_id";

// Every key a record that arrives may not set itself.
export const ONEUPTIME_ACTOR_ATTRIBUTES: ReadonlyArray<string> = [
  ONEUPTIME_ACTOR_ATTRIBUTE,
  ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE,
];
