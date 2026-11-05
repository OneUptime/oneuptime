import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { getOpenStackShortHostName } from "../../../Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { OpenStackChange } from "../../../Utils/AiRemediation/Resource/OpenStackCommandPolicy";
import {
  OpenStackChangeReach,
  OpenStackReachInstance,
} from "../../../Utils/AiRemediation/Resource/OpenStackChangeReach";
import { OPENSTACK_CLOUD_LOG_ATTRIBUTE } from "../../../Utils/OpenStack/OpenStackLogs";
import {
  OPENSTACK_EVENT_HOST_ATTRIBUTE,
  OPENSTACK_EVENT_SERVICE_ATTRIBUTE,
  OpenStackEventAttribute,
} from "../../../Utils/OpenStack/OpenStackNotifications";
import { OpenStackLogAttribute } from "../../../Utils/OpenStack/OpenStackLogs";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
  CloudAiChangeStep,
} from "../../../Utils/Telemetry/ChangeEventFields";
import {
  MAX_CHANGE_EVENT_DESCRIPTION_LENGTH,
  MAX_CHANGE_EVENT_TITLE_LENGTH,
  ParsedChangeEventEntry,
} from "../Telemetry/ChangeEventRow";
import {
  OPENSTACK_CHART_HOST_ATTRIBUTE,
  OPENSTACK_CHART_ID_ATTRIBUTE,
  OPENSTACK_CLOUD_PROVIDER,
} from "./OpenStackEventEntries";

/*
 * THE CHANGE EVENTS OF A FIX ONEUPTIME AI MADE ON AN OPENSTACK CLOUD.
 *
 * One for each part it was about, so each part's Feed tab and its charts say it, in the
 * attributes those already read (getOpenStackPartChangeAttributes): an instance's its
 * ID, a compute service's or a Neutron agent's its binary and short host, and a host's
 * everything that happened on it. Each says who approved it, or that nobody did, because
 * "who decided this" is the first question a person asks of a change to production.
 *
 * Pure, so every rule is pinned by tests. OwnChangeRecorder reads the rows and writes.
 */

export enum OpenStackFixOutcome {
  // The API took every call, which is what "ran" can mean here.
  Accepted = "accepted",
  // It ran, and at least one call was refused or got no answer.
  Failed = "failed",
  // It never reached the API: refused by the agent, or no agent took it.
  DidNotRun = "did-not-run",
}

export interface OpenStackFixApproval {
  // Who pressed Approve, as OneUptime knows them.
  name: string | null;
  userId: ObjectID | null;
  // Where: the dashboard, Slack or Microsoft Teams.
  from: string | null;
}

export interface OpenStackFix {
  jobId: ObjectID;
  cloudId: ObjectID;
  // The name its telemetry and its parts' feeds go by.
  cloudName: string;
  command: string;
  change: OpenStackChange;
  // What the agent read of what it touched, when its output said.
  reach: OpenStackChangeReach | null;
  outcome: OpenStackFixOutcome;
  // Why it failed or did not run, in the agent's words.
  failure?: string | null | undefined;
  time: Date;
  // Null: nobody was asked, because the cloud's mode ran it unattended.
  approval: OpenStackFixApproval | null;
  // A rollback a verification that failed ran. The plan's approval covers it.
  isRollback: boolean;
  regionName?: string | null | undefined;
  suggestionId?: ObjectID | undefined;
  aiRunId?: ObjectID | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

function clamp(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function describeApproval(fix: OpenStackFix): string {
  if (!fix.approval) {
    return "on its own: nobody was asked, because this cloud's fixes run it unattended";
  }

  const who: string = fix.approval.name || "a person";

  return `approved by ${who}${fix.approval.from ? ` from ${fix.approval.from}` : ""}`;
}

function describeWhatHappened(fix: OpenStackFix, what: string): string {
  const doing: string = fix.isRollback ? `rolled back with ${what}` : `ran ${what}`;

  switch (fix.outcome) {
    case OpenStackFixOutcome.Accepted:
      return `OneUptime AI ${doing}`;
    case OpenStackFixOutcome.Failed:
      return `OneUptime AI's ${what} failed, and may have changed something`;
    default:
      return `OneUptime AI's ${what} did not run, and changed nothing`;
  }
}

function statusOf(outcome: OpenStackFixOutcome): ChangeEventStatus {
  switch (outcome) {
    case OpenStackFixOutcome.Accepted:
      return ChangeEventStatus.Succeeded;
    case OpenStackFixOutcome.Failed:
      return ChangeEventStatus.Failed;
    default:
      return ChangeEventStatus.Cancelled;
  }
}

// What every one of a fix's change events says.
function commonAttributes(fix: OpenStackFix): Dictionary<string> {
  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]: ChangeEventSource.OneUptimeAi,
    [ChangeEventAttribute.MadeBy]: ChangeEventSource.OneUptimeAi,
    [ChangeEventAttribute.Status]: statusOf(fix.outcome),
    [ChangeEventAttribute.Command]: clamp(fix.command, 500),
    [ChangeEventAttribute.ResourceType]: AiResourceType.OpenStackCloud,
    [ChangeEventAttribute.ResourceId]: fix.cloudId.toString(),
    [ChangeEventAttribute.CloudProvider]: OPENSTACK_CLOUD_PROVIDER,
    [ChangeEventAttribute.CloudOperation]: fix.change.route,
    [ChangeEventAttribute.RunnerJobId]: fix.jobId.toString(),
    [ChangeEventAttribute.AiStep]: fix.isRollback
      ? CloudAiChangeStep.Rollback
      : CloudAiChangeStep.Fix,
    // As a chart of the cloud is filtered, whichever spelling it uses.
    "openstack.cloud.name": fix.cloudName,
    [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: fix.cloudName,
    [OpenStackEventAttribute.Outcome]:
      fix.outcome === OpenStackFixOutcome.Accepted ? "succeeded" : "failed",
    /*
     * Who, for the feed's own column: the person who said yes, or OneUptime AI when
     * nobody did.
     */
    [ChangeEventAttribute.CloudActor]:
      fix.approval?.name || "OneUptime AI",
  };

  if (fix.approval?.name) {
    attributes[ChangeEventAttribute.ApprovedBy] = fix.approval.name;
  }

  if (fix.approval?.userId) {
    attributes[ChangeEventAttribute.ApprovedByUserId] =
      fix.approval.userId.toString();
  }

  if (fix.approval?.from) {
    attributes[ChangeEventAttribute.ApprovedFrom] = fix.approval.from;
  }

  if (fix.regionName) {
    attributes[ChangeEventAttribute.CloudRegion] = fix.regionName;
  }

  if (fix.suggestionId) {
    attributes[ChangeEventAttribute.AutoRemediationSuggestionId] =
      fix.suggestionId.toString();
  }

  if (fix.aiRunId) {
    attributes[ChangeEventAttribute.AiRunId] = fix.aiRunId.toString();
  }

  if (fix.incidentId) {
    attributes[ChangeEventAttribute.IncidentId] = fix.incidentId.toString();
  }

  if (fix.alertId) {
    attributes[ChangeEventAttribute.AlertId] = fix.alertId.toString();
  }

  return attributes;
}

function buildEntry(data: {
  fix: OpenStackFix;
  what: string;
  attributes: Dictionary<string>;
}): ParsedChangeEventEntry {
  const { fix } = data;
  const approval: string = describeApproval(fix);

  return {
    time: fix.time,
    eventType: fix.isRollback
      ? ChangeEventType.Rollback
      : ChangeEventType.Remediation,
    title: clamp(
      `${describeWhatHappened(fix, data.what)}, ${approval}`,
      MAX_CHANGE_EVENT_TITLE_LENGTH,
    ),
    description: clamp(
      [
        `${clamp(fix.command, 500)}`,
        `It was ${approval}.`,
        fix.failure ? clamp(fix.failure, 1000) : "",
      ]
        .filter((line: string): boolean => {
          return line.length > 0;
        })
        .join("\n"),
      MAX_CHANGE_EVENT_DESCRIPTION_LENGTH,
    ),
    attributes: { ...commonAttributes(fix), ...data.attributes },
  };
}

function instanceEntry(
  fix: OpenStackFix,
  id: string,
  read: OpenStackReachInstance | undefined,
): ParsedChangeEventEntry {
  const name: string = read?.name || id;
  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.CloudResourceId]: id,
    [ChangeEventAttribute.CloudResourceName]: name,
    [OpenStackEventAttribute.PartKind]: OpenStackResourceKind.Instance,
    [OpenStackEventAttribute.PartId]: id,
    [OpenStackEventAttribute.PartName]: name,
    [OPENSTACK_CHART_ID_ATTRIBUTE]: id,
    [OpenStackLogAttribute.InstanceId]: id,
  };

  if (read?.projectId) {
    attributes[OpenStackLogAttribute.ProjectId] = read.projectId;
  }

  // The hypervisor it was on says this too.
  if (read?.host) {
    attributes[OPENSTACK_EVENT_HOST_ATTRIBUTE] = getOpenStackShortHostName(
      read.host,
    );
    attributes[OPENSTACK_CHART_HOST_ATTRIBUTE] = read.host;
  }

  return buildEntry({
    fix,
    what: `${fix.change.route} on ${name}`,
    attributes,
  });
}

/*
 * The change events of one fix: one for each instance it names, or the one for the
 * service or agent it changes.
 */
export function buildOpenStackFixChangeEntries(
  fix: OpenStackFix,
): Array<ParsedChangeEventEntry> {
  const { change, reach } = fix;

  if (change.instanceIds.length > 0) {
    return change.instanceIds.map((id: string): ParsedChangeEventEntry => {
      return instanceEntry(
        fix,
        id,
        reach?.instances.find((row: OpenStackReachInstance): boolean => {
          return row.id === id;
        }),
      );
    });
  }

  if (change.serviceHost) {
    return [
      buildEntry({
        fix,
        what: `${change.route} on ${change.serviceHost}`,
        attributes: {
          [OpenStackEventAttribute.PartKind]: OpenStackResourceKind.Service,
          [OpenStackEventAttribute.PartName]: "nova-compute",
          [OPENSTACK_EVENT_SERVICE_ATTRIBUTE]: "nova-compute",
          [OPENSTACK_EVENT_HOST_ATTRIBUTE]: getOpenStackShortHostName(
            change.serviceHost,
          ),
          [OPENSTACK_CHART_HOST_ATTRIBUTE]: change.serviceHost,
        },
      }),
    ];
  }

  if (change.agentId) {
    const binary: string | null = reach?.agent?.binary || null;
    const host: string | null = reach?.agent?.host || null;
    const attributes: Dictionary<string> = {
      [OpenStackEventAttribute.PartKind]: OpenStackResourceKind.Service,
      [OpenStackEventAttribute.PartId]: change.agentId,
      [ChangeEventAttribute.CloudResourceId]: change.agentId,
    };

    if (binary) {
      attributes[OpenStackEventAttribute.PartName] = binary;
      attributes[OPENSTACK_EVENT_SERVICE_ATTRIBUTE] = binary;
    }

    if (host) {
      attributes[OPENSTACK_EVENT_HOST_ATTRIBUTE] =
        getOpenStackShortHostName(host);
      attributes[OPENSTACK_CHART_HOST_ATTRIBUTE] = host;
    }

    return [
      buildEntry({
        fix,
        what: `${change.route} on ${binary || change.agentId}${
          host ? ` on ${host}` : ""
        }`,
        attributes,
      }),
    ];
  }

  return [];
}

// The one line on the cloud's own feed, as plain words: the caller makes it Markdown.
export function describeOpenStackFixForFeed(fix: OpenStackFix): string {
  const instances: number = fix.change.instanceIds.length;
  const what: string =
    instances > 1
      ? `${fix.change.route} on ${instances} instances`
      : fix.change.serviceHost
        ? `${fix.change.route} on ${fix.change.serviceHost}`
        : fix.change.route;

  return `${describeWhatHappened(fix, what)}, ${describeApproval(fix)}.`;
}

// When it happened: when the agent started it, or as near as the row says.
export function getOpenStackFixTime(data: {
  startedAt?: Date | null | undefined;
  claimedAt?: Date | null | undefined;
  completedAt?: Date | null | undefined;
}): Date {
  return (
    data.startedAt ||
    data.claimedAt ||
    data.completedAt ||
    OneUptimeDate.getCurrentDate()
  );
}
