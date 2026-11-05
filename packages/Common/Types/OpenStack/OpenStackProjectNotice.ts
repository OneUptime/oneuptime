import {
  OPENSTACK_BLAST_RADIUS_COUNTS,
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  OpenStackBlastRadiusProject,
} from "./OpenStackBlastRadius";
import { getOpenStackShortHostName } from "./OpenStackHealthRules";
import { OpenStackResourceKind } from "./OpenStackResourceKind";

/*
 * WHO IS TOLD WHEN A PART OF A CLOUD FAILS, AND WHY THE REST ARE NOT.
 *
 * Telling the wrong person about someone else's outage is worse than telling nobody, so this is one
 * pure answer, read by the preview an operator sees before turning a notice on, by the page that says
 * who a part would tell, and by what really sends. They can't disagree, and a table of the awkward rows
 * can hold it to account (OpenStackProjectNotice.test.ts).
 *
 * What it holds to:
 *
 *   - A notice is off until an operator has seen who it tells and turned it on, for that recipient.
 *     Change the address and it is off again: what they saw is no longer what would be told.
 *   - A project is told about what it holds. An instance that names no project tells nobody, and it
 *     counts in the total so an operator can see that it does.
 *   - A project the inventory doesn't hold any more is told nothing. Keystone's IDs are not reused, so
 *     what's left of a deleted project is a leftover, and its old contact is the wrong person.
 *   - IDs match exactly: a project whose ID begins another's is not that project.
 *   - One address is told once per project, however many times it is configured.
 */

export enum OpenStackProjectNoticeChannel {
  Email = "Email",
  Webhook = "Webhook",
  // A private status page an operator made for the project, which tells whoever may read it.
  StatusPage = "Status Page",
}

export enum OpenStackProjectNoticeEvent {
  IncidentOpened = "Incident Opened",
  IncidentResolved = "Incident Resolved",
  MaintenancePlanned = "Maintenance Planned",
  MaintenanceEnded = "Maintenance Ended",
}

export enum OpenStackProjectNoticeDeliveryStatus {
  Pending = "Pending",
  Sending = "Sending",
  Sent = "Sent",
  Failed = "Failed",
  // Never sent, on purpose: statusMessage says why.
  Skipped = "Skipped",
}

export enum OpenStackProjectNotToldReason {
  // No recipient is configured for this project at all, which is how most projects are.
  NoRecipient = "No Recipient",
  // Recipients exist and none is turned on.
  NoticesOff = "Notices Off",
  // Turned on, and the address has changed since an operator saw who it tells.
  NotPreviewed = "Not Previewed",
  // The inventory has no such project now.
  ProjectGone = "Project Gone",
}

// What the decision reads of a notice, so a test and the server can both hand it one.
export interface OpenStackProjectNoticeRecipient {
  id: string;
  openStackProjectId: string;
  email?: string | null | undefined;
  webhookUrl?: string | null | undefined;
  statusPageId?: string | null | undefined;
  isEnabled?: boolean | null | undefined;
  previewedRecipient?: string | null | undefined;
  previewSeenAt?: Date | string | null | undefined;
}

type OpenStackNoticeAddress = Pick<
  OpenStackProjectNoticeRecipient,
  "email" | "webhookUrl" | "statusPageId"
>;

// Whichever one it holds, and none when it holds anything else: a notice tells exactly one.
export function getOpenStackNoticeChannel(
  notice: OpenStackNoticeAddress,
): OpenStackProjectNoticeChannel | null {
  const held: Array<OpenStackProjectNoticeChannel> = [
    ...(notice.email ? [OpenStackProjectNoticeChannel.Email] : []),
    ...(notice.webhookUrl ? [OpenStackProjectNoticeChannel.Webhook] : []),
    ...(notice.statusPageId ? [OpenStackProjectNoticeChannel.StatusPage] : []),
  ];

  return held.length === 1 ? held[0]! : null;
}

/*
 * The one string that says who a notice tells: what a preview is of, and what two notices are the same
 * recipient by. An email's case means nothing to anyone's mail server, and a URL's does.
 */
export function getOpenStackNoticeRecipient(
  notice: OpenStackNoticeAddress,
): string | null {
  switch (getOpenStackNoticeChannel(notice)) {
    case OpenStackProjectNoticeChannel.Email:
      return `email:${String(notice.email).trim().toLowerCase()}`;
    case OpenStackProjectNoticeChannel.Webhook:
      return `webhook:${String(notice.webhookUrl).trim()}`;
    case OpenStackProjectNoticeChannel.StatusPage:
      return `statusPage:${String(notice.statusPageId).trim().toLowerCase()}`;
    default:
      return null;
  }
}

// On, and for the recipient an operator saw.
export function isOpenStackProjectNoticeArmed(
  notice: OpenStackProjectNoticeRecipient,
): boolean {
  const recipient: string | null = getOpenStackNoticeRecipient(notice);

  return Boolean(
    notice.isEnabled === true &&
      notice.previewSeenAt &&
      recipient &&
      notice.previewedRecipient === recipient,
  );
}

export interface OpenStackProjectTold {
  notice: OpenStackProjectNoticeRecipient;
  project: OpenStackBlastRadiusProject;
}

export interface OpenStackProjectNotTold {
  projectId: string;
  name: string | null;
  reason: OpenStackProjectNotToldReason;
  // How many recipients this leaves untold, none for a project with none.
  recipientCount: number;
}

export interface OpenStackProjectNoticeDecision {
  told: Array<OpenStackProjectTold>;
  notTold: Array<OpenStackProjectNotTold>;
  /*
   * What the part holds of no project: an instance with no project, or a project row that names none.
   * Nobody can be told of these, and an operator should be able to see that nobody was.
   */
  ofNoProject: Partial<Pick<OpenStackBlastRadius, OpenStackBlastRadiusCount>>;
  // False when what was collected can't say who is on the part, so nobody is told on a guess.
  isReachKnown: boolean;
}

function emptyHoldings(projectId: string): OpenStackBlastRadiusProject {
  const project: OpenStackBlastRadiusProject = {
    projectId,
    name: null,
  } as OpenStackBlastRadiusProject;

  for (const entry of OPENSTACK_BLAST_RADIUS_COUNTS) {
    project[entry.count] = 0;
  }

  return project;
}

/*
 * Every project a part reaches: each it holds something of, past what a description names, and the one
 * the part itself belongs to, which holds it even where the radius can't say any more than that.
 */
export function getOpenStackProjectsToDecideFor(data: {
  radius: OpenStackBlastRadius | null;
  ownerProjectId?: string | null | undefined;
}): Array<OpenStackBlastRadiusProject> {
  const projects: Map<string, OpenStackBlastRadiusProject> = new Map();

  for (const project of data.radius?.everyProject ||
    data.radius?.projects ||
    []) {
    projects.set(project.projectId, project);
  }

  if (data.ownerProjectId && !projects.has(data.ownerProjectId)) {
    projects.set(data.ownerProjectId, emptyHoldings(data.ownerProjectId));
  }

  return Array.from(projects.values());
}

function getHoldingsOfNoProject(
  radius: OpenStackBlastRadius | null,
  projects: ReadonlyArray<OpenStackBlastRadiusProject>,
): Partial<Pick<OpenStackBlastRadius, OpenStackBlastRadiusCount>> {
  const left: Partial<Pick<OpenStackBlastRadius, OpenStackBlastRadiusCount>> =
    {};

  if (!radius) {
    return left;
  }

  for (const entry of OPENSTACK_BLAST_RADIUS_COUNTS) {
    const named: number = projects.reduce(
      (total: number, project: OpenStackBlastRadiusProject): number => {
        return total + project[entry.count];
      },
      0,
    );

    if (radius[entry.count] > named) {
      left[entry.count] = radius[entry.count] - named;
    }
  }

  return left;
}

export function decideOpenStackProjectNotices(data: {
  radius: OpenStackBlastRadius | null;
  // The project the part itself belongs to, when it belongs to one.
  ownerProjectId?: string | null | undefined;
  // Every notice of this cloud, on or off. Another cloud's never reach this.
  notices: ReadonlyArray<OpenStackProjectNoticeRecipient>;
  // The projects the inventory holds now, by Keystone's ID.
  existingProjectIds: ReadonlySet<string>;
}): OpenStackProjectNoticeDecision {
  const projects: Array<OpenStackBlastRadiusProject> =
    getOpenStackProjectsToDecideFor({
      radius: data.radius,
      ownerProjectId: data.ownerProjectId,
    });

  const decision: OpenStackProjectNoticeDecision = {
    told: [],
    notTold: [],
    ofNoProject: getHoldingsOfNoProject(data.radius, projects),
    isReachKnown: Boolean(data.radius?.isKnown) || Boolean(data.ownerProjectId),
  };

  for (const project of projects) {
    const recipients: Array<OpenStackProjectNoticeRecipient> =
      data.notices.filter(
        (notice: OpenStackProjectNoticeRecipient): boolean => {
          return notice.openStackProjectId === project.projectId;
        },
      );

    if (recipients.length === 0) {
      decision.notTold.push({
        projectId: project.projectId,
        name: project.name,
        reason: OpenStackProjectNotToldReason.NoRecipient,
        recipientCount: 0,
      });
      continue;
    }

    if (!data.existingProjectIds.has(project.projectId)) {
      decision.notTold.push({
        projectId: project.projectId,
        name: project.name,
        reason: OpenStackProjectNotToldReason.ProjectGone,
        recipientCount: recipients.length,
      });
      continue;
    }

    const armed: Array<OpenStackProjectNoticeRecipient> = recipients.filter(
      isOpenStackProjectNoticeArmed,
    );

    if (armed.length === 0) {
      decision.notTold.push({
        projectId: project.projectId,
        name: project.name,
        reason: recipients.some(
          (notice: OpenStackProjectNoticeRecipient): boolean => {
            return notice.isEnabled === true;
          },
        )
          ? OpenStackProjectNotToldReason.NotPreviewed
          : OpenStackProjectNotToldReason.NoticesOff,
        recipientCount: recipients.length,
      });
      continue;
    }

    const seen: Set<string> = new Set();

    for (const notice of armed) {
      const recipient: string = getOpenStackNoticeRecipient(notice)!;

      if (!seen.has(recipient)) {
        seen.add(recipient);
        decision.told.push({ notice, project });
      }
    }
  }

  return decision;
}

// How many of each reason, for a line that has to stay short with 500 projects on a host.
export function countOpenStackProjectsNotTold(
  notTold: ReadonlyArray<OpenStackProjectNotTold>,
): Array<{ reason: OpenStackProjectNotToldReason; count: number }> {
  const counts: Map<OpenStackProjectNotToldReason, number> = new Map();

  for (const project of notTold) {
    counts.set(project.reason, (counts.get(project.reason) || 0) + 1);
  }

  return Array.from(counts.entries()).map(
    ([reason, count]: [OpenStackProjectNotToldReason, number]) => {
      return { reason, count };
    },
  );
}

/*
 * What makes two incidents the same failure to whoever is told: a nova-compute and its hypervisor are
 * one machine, under two names (isSameOpenStackHost), so the second to fire tells nobody anything new.
 */
export function getOpenStackNoticePartKey(part: {
  kind: string;
  externalId?: string | null | undefined;
  name?: string | null | undefined;
  regionName?: string | null | undefined;
}): string {
  const region: string = part.regionName || "";

  if (part.kind === OpenStackResourceKind.Hypervisor) {
    return `host:${region}/${getOpenStackShortHostName(part.name || part.externalId)}`;
  }

  if (
    part.kind === OpenStackResourceKind.Service &&
    part.name === "nova-compute"
  ) {
    return `host:${region}/${getOpenStackShortHostName((part.externalId || "").split("/")[2])}`;
  }

  return `${part.kind}:${part.externalId || part.name || ""}`;
}
