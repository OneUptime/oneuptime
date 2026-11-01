import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import {
  getCloudProviderLabel,
  getManagedCloudPlatformDescriptor,
  ManagedCloudPlatformDescriptor,
} from "../../../../Types/Cloud/CloudPlatform";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventType,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { getShortCloudAppRevision } from "../../../../Utils/Telemetry/CloudAppRevisionName";
import type { ParsedChangeEventEntry } from "../ChangeEventRow";
import { isTrackableVersion } from "./TelemetryChangeSignals";

/*
 * What an App Platforms app's new revision says, as a change event and as a
 * line in its environment's feed. Pure: CloudAppRevisionService decides that
 * a revision is new (or that the app went back to an older one), and
 * CloudAppChangeRecorder writes what these build.
 *
 * Two kinds:
 *
 *   - Deployed: an instance reported a revision the app had not run before
 *     (a new ECS task definition revision, a new Cloud Run revision...).
 *   - Rolled back: the revision the app ran last stopped reporting while one
 *     it ran before kept running - the ECS deployment circuit breaker, a
 *     Cloud Run traffic split moved back, a redeploy of an old version. A
 *     known revision that is newer than the one it replaces (a roll forward
 *     to it again) is a deploy.
 *
 * The change event names the environment the app runs in
 * (oneuptime.resource.type / .id = CloudResource / the environment's id), so
 * an incident linked to the environment sees it as a linked change when
 * OneUptime AI investigates, and the app (oneuptime.app_platform.*), so the
 * app's pages can read its own.
 */

export enum CloudAppRevisionChangeKind {
  Deployed = "deployed",
  RolledBack = "rolled-back",
}

export interface CloudAppRevisionChange {
  kind: CloudAppRevisionChangeKind;
  // The revision the app runs now.
  revision: string;
  // The revision it ran before.
  previousRevision: string;
  // When the change happened, as near as telemetry says.
  time: Date;
}

export interface CloudAppChangeSubject {
  appId: ObjectID;
  appName: string;
  // The ECS cluster or the slot the app is kept apart by, when it has one.
  groupName?: string | null | undefined;
  environmentId: ObjectID;
  cloudPlatform?: string | null | undefined;
  cloudProvider?: string | null | undefined;
  cloudAccountId?: string | null | undefined;
  cloudRegion?: string | null | undefined;
  // The service.version the new revision reports, when it reports one.
  serviceVersion?: string | null | undefined;
}

/*
 * "production/checkout": the app as a line of text names it, with the
 * cluster or slot it is kept apart by first.
 */
export function getCloudAppDisplayName(data: {
  appName: string;
  groupName?: string | null | undefined;
}): string {
  const name: string = data.appName.trim() || "app";
  const group: string = (data.groupName || "").trim();

  return group ? `${group}/${name}` : name;
}

// "AWS ECS / Fargate in us-east-1, account 123456789012".
function describeWhere(subject: CloudAppChangeSubject): string {
  const descriptor: ManagedCloudPlatformDescriptor | null =
    getManagedCloudPlatformDescriptor(subject.cloudPlatform);
  const platform: string =
    descriptor?.productName ||
    getCloudProviderLabel(subject.cloudProvider) ||
    (subject.cloudPlatform || "").trim();

  const places: Array<string> = [];
  const region: string = (subject.cloudRegion || "").trim();
  const account: string = (subject.cloudAccountId || "").trim();

  if (region) {
    places.push(region);
  }

  if (account) {
    places.push(`account ${account}`);
  }

  if (!platform) {
    return places.join(", ");
  }

  return places.length > 0 ? `${platform} (${places.join(", ")})` : platform;
}

/*
 * The revisions a line says, as the app's page shows them: a Cloud Run or
 * Container Apps revision without its service's name, which the line names
 * already ("Deployed api revision 00042-xyz"). The attributes keep them
 * whole.
 */
function getShortRevisions(data: {
  subject: CloudAppChangeSubject;
  change: CloudAppRevisionChange;
}): { revision: string; previousRevision: string } {
  return {
    revision: getShortCloudAppRevision({
      revision: data.change.revision,
      appName: data.subject.appName,
    }),
    previousRevision: getShortCloudAppRevision({
      revision: data.change.previousRevision,
      appName: data.subject.appName,
    }),
  };
}

// The change event a revision change is recorded as.
export function buildCloudAppChangeEntry(data: {
  subject: CloudAppChangeSubject;
  change: CloudAppRevisionChange;
}): ParsedChangeEventEntry {
  const { subject, change } = data;
  const app: string = getCloudAppDisplayName(subject);
  const where: string = describeWhere(subject);
  const on: string = where ? ` on ${where}` : "";
  const said: { revision: string; previousRevision: string } =
    getShortRevisions(data);

  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]: ChangeEventSource.AppPlatform,
    [ChangeEventAttribute.AppPlatformApp]: app,
    [ChangeEventAttribute.AppPlatformAppId]: subject.appId.toString(),
    [ChangeEventAttribute.AppPlatformRevision]: change.revision,
    [ChangeEventAttribute.PreviousRevision]: change.previousRevision,
    [ChangeEventAttribute.ResourceType]: "CloudResource",
    [ChangeEventAttribute.ResourceId]: subject.environmentId.toString(),
  };

  const optional: Array<[string, string | null | undefined]> = [
    [ChangeEventAttribute.CloudPlatform, subject.cloudPlatform],
    [ChangeEventAttribute.CloudProvider, subject.cloudProvider],
    [ChangeEventAttribute.CloudAccountId, subject.cloudAccountId],
    [ChangeEventAttribute.CloudRegion, subject.cloudRegion],
  ];

  for (const [key, value] of optional) {
    const text: string = (value || "").trim();

    if (text) {
      attributes[key] = text;
    }
  }

  if (subject.serviceVersion && isTrackableVersion(subject.serviceVersion)) {
    attributes[ChangeEventAttribute.ServiceVersion] =
      subject.serviceVersion.trim();
  }

  if (change.kind === CloudAppRevisionChangeKind.RolledBack) {
    return {
      time: change.time,
      eventType: ChangeEventType.Rollback,
      title: `Rolled back ${app} to revision ${said.revision}`,
      description: `${app}${on} went back to revision ${said.revision}: revision ${said.previousRevision} stopped reporting while ${said.revision} kept running. OneUptime recorded this from the app's telemetry.`,
      attributes,
    };
  }

  return {
    time: change.time,
    eventType: ChangeEventType.Deployment,
    title: `Deployed ${app} revision ${said.revision}`,
    description: `${app}${on} started running revision ${said.revision}; it ran ${said.previousRevision} before. OneUptime recorded this from the app's telemetry.`,
    attributes,
  };
}

/*
 * The environment's feed line: "🚀 Deployed [checkout](…): revision **43**
 * replaced **42**." The app's name links to its page.
 */
export function buildCloudAppChangeFeedMarkdown(data: {
  subject: CloudAppChangeSubject;
  change: CloudAppRevisionChange;
  appLink: string;
}): MarkdownText {
  const app: string = getCloudAppDisplayName(data.subject);
  const said: { revision: string; previousRevision: string } =
    getShortRevisions(data);

  if (data.change.kind === CloudAppRevisionChangeKind.RolledBack) {
    return mdText`↩️ Rolled back [${app}](${data.appLink}) to revision **${said.revision}**: revision **${said.previousRevision}** stopped reporting.`;
  }

  return mdText`🚀 Deployed [${app}](${data.appLink}): revision **${said.revision}** replaced **${said.previousRevision}**.`;
}
