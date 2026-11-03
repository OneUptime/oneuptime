import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKind,
  AiAffectedResourceKindInfo,
  AiAffectedResourceRef,
  isAiAffectedResourceKind,
} from "../../../Types/AI/AiAffectedResources";
import {
  AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
  AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH,
  AffectedResourceKind,
  AffectedResourceSearchKindResult,
  AffectedResourceSearchMatch,
  AffectedResourceSearchResult,
} from "../../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import AlertService from "../../Services/AlertService";
import AffectedResourceSearch, {
  getAffectedResourceKindService,
} from "../AffectedResources/AffectedResourceSearch";
import LinkedAffectedResources, {
  LinkedAffectedResource as ListedAffectedResource,
} from "../AffectedResources/LinkedAffectedResources";
import AffectedResourceLinks, {
  LinkedAffectedResource,
} from "../AI/Toolbox/AffectedResourceLinks";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceRecordName } from "./WorkspaceActionAnswers";

/*
 * THE AFFECTED RESOURCES OF AN INCIDENT DECLARED FROM SLACK OR MICROSOFT
 * TEAMS.
 *
 * OneUptime AI investigates and fixes the resources an incident is linked
 * to (#5293, #5303): its investigation reaches them through their AI
 * agents, auto-remediation fixes them, and their owners, labels and pages
 * follow. The Declare Incident forms in Slack and Microsoft Teams asked for
 * a title, a severity, monitors and labels, and nothing else - so an
 * incident declared from a chat was linked to no host, cluster or database,
 * and OneUptime AI had nothing to act on.
 *
 * Both forms now offer Affected Resources: the hosts, network devices,
 * clusters, databases, cloud resources and services of the project - the
 * kinds the Dashboard's Declare Incident form lists under Other Affected
 * Resources, which are the kinds OneUptime AI links
 * (AI_AFFECTED_RESOURCE_KINDS). It is never a list sent with the form: the
 * chat asks OneUptime as the person types (Slack's options load, Microsoft
 * Teams' search invoke), and each answer is read here:
 *
 *   - as the member the chat account is connected to, in the project the
 *     form was drawn for, with their own props: a kind they may not read is
 *     never searched, labels and owned scope narrow the rest, and archived
 *     resources are not offered (AffectedResourceSearch);
 *   - and the picks a form submits are read again as the member who submits
 *     it before anything is linked (AffectedResourceLinks.resolve), so a
 *     pick they may no longer view, one of another project and an archived
 *     one are left out, and the confirmation says so.
 *
 * Monitors are not here. A monitor linked to an incident a person declares
 * stops its own checks until the incident is resolved
 * (IncidentService.disableActiveMonitoringIfManualIncident), so monitors
 * stay on the forms' own Monitors field, picked on purpose, which says so
 * (WORKSPACE_AFFECTED_RESOURCES_TEXT.monitorsHint).
 *
 * Shared by both chats, so the two say and do the same.
 */

// The field's id on both forms, and the key its picks are submitted under.
export const WORKSPACE_AFFECTED_RESOURCES_FIELD: string = "affectedResources";

/*
 * The most resources one declaration links. A form takes more picks than
 * an investigation reaches (MAX_AI_AFFECTED_RESOURCES) - an outage can take
 * out a whole rack - but not without end: as many as the alerts one
 * declaration links (MAX_ALERTS_PER_INCIDENT_LINK_ACTION).
 */
export const WORKSPACE_MAX_AFFECTED_RESOURCES: number = 50;

/*
 * How many of each kind one search reads: a page of suggestions per kind,
 * which each chat cuts to what it lists.
 */
export const WORKSPACE_AFFECTED_RESOURCE_SEARCH_LIMIT_PER_KIND: number = 15;

// The separator of a pick's value: "<kind>:<id>".
const VALUE_SEPARATOR: string = ":";

// How a kind is named, the way the Dashboard's Affected Resources picker names it.
export interface WorkspaceAffectedResourceKindLabel {
  label: string;
  pluralLabel: string;
}

export const WORKSPACE_AFFECTED_RESOURCE_KIND_LABELS: Readonly<
  Record<AiAffectedResourceKind, WorkspaceAffectedResourceKindLabel>
> = {
  [AiAffectedResourceKind.Host]: { label: "Host", pluralLabel: "Hosts" },
  [AiAffectedResourceKind.NetworkDevice]: {
    label: "Network Device",
    pluralLabel: "Network Devices",
  },
  [AiAffectedResourceKind.KubernetesCluster]: {
    label: "Kubernetes Cluster",
    pluralLabel: "Kubernetes Clusters",
  },
  [AiAffectedResourceKind.DockerHost]: {
    label: "Docker Host",
    pluralLabel: "Docker Hosts",
  },
  [AiAffectedResourceKind.PodmanHost]: {
    label: "Podman Host",
    pluralLabel: "Podman Hosts",
  },
  [AiAffectedResourceKind.ProxmoxCluster]: {
    label: "Proxmox Cluster",
    pluralLabel: "Proxmox Clusters",
  },
  [AiAffectedResourceKind.VMwareVCenter]: {
    label: "vCenter",
    pluralLabel: "vCenters",
  },
  [AiAffectedResourceKind.CephCluster]: {
    label: "Ceph Cluster",
    pluralLabel: "Ceph Clusters",
  },
  [AiAffectedResourceKind.StorageArray]: {
    label: "Storage Array",
    pluralLabel: "Storage Arrays",
  },
  [AiAffectedResourceKind.DockerSwarmCluster]: {
    label: "Docker Swarm Cluster",
    pluralLabel: "Docker Swarm Clusters",
  },
  [AiAffectedResourceKind.IoTFleet]: {
    label: "IoT Fleet",
    pluralLabel: "IoT Fleets",
  },
  [AiAffectedResourceKind.DatabaseServer]: {
    label: "Database",
    pluralLabel: "Databases",
  },
  [AiAffectedResourceKind.CloudResource]: {
    label: "Cloud Resource",
    pluralLabel: "Cloud Resources",
  },
  [AiAffectedResourceKind.Service]: {
    label: "Service",
    pluralLabel: "Services",
  },
};

// The form's words, the same in both chats.
export const WORKSPACE_AFFECTED_RESOURCES_TEXT: {
  label: string;
  placeholder: string;
  monitorsHint: string;
} = {
  label: "Affected Resources",
  placeholder: "Search hosts, clusters, databases…",
  /*
   * Under the forms' own Monitors field: what picking one does, which the
   * person decides (IncidentService.disableActiveMonitoringIfManualIncident).
   */
  monitorsHint:
    "A monitor you pick here pauses its checks until the incident is resolved.",
};

// One resource a search found, as the forms list it.
export interface WorkspaceAffectedResourceMatch {
  kind: AiAffectedResourceKind;
  // Its OneUptime ID, lower-cased.
  id: string;
  name: string;
  // What tells two of one name apart: a network device's address.
  detail?: string | undefined;
}

// What a search found of one kind.
export interface WorkspaceAffectedResourceKindMatches {
  kind: AiAffectedResourceKind;
  // How many of the kind match, all of them - not only the ones listed.
  count: number;
  matches: Array<WorkspaceAffectedResourceMatch>;
}

// The picks a form submitted, before anything is read.
export interface WorkspaceAffectedResourcePicks {
  refs: Array<AiAffectedResourceRef>;
  /*
   * How many submitted values are left out: one that names no resource, and
   * every one past WORKSPACE_MAX_AFFECTED_RESOURCES.
   */
  leftOutCount: number;
}

// What a declaration links, as the member who submits it reads it.
export interface WorkspaceAffectedResourcesToLink {
  linked: Array<LinkedAffectedResource>;
  /*
   * How many of the picks are not linked: deleted, archived, no longer one
   * the member may view - or a value that names no resource at all.
   */
  notLinkedCount: number;
}

/*
 * The member's props, for a read of their own: the permission layer writes
 * what it works out onto the props it is given (the global permissions
 * everybody holds), and a form's reads must not change what the caller
 * goes on to create the incident with.
 */
function readerProps(
  props: DatabaseCommonInteractionProps,
): DatabaseCommonInteractionProps {
  return { ...props };
}

// "A", "A and B", "A, B and C".
function joinWithAnd(items: Array<MarkdownText>): MarkdownText {
  if (items.length <= 1) {
    return items[0] || FeedMarkdown.empty();
  }

  return mdText`${FeedMarkdown.join(items.slice(0, -1))} and ${items[items.length - 1]!}`;
}

export default class WorkspaceAffectedResources {
  // Every kind the forms offer, in the order they list them.
  public static getKinds(): Array<AiAffectedResourceKind> {
    return AI_AFFECTED_RESOURCE_KINDS.map(
      (info: AiAffectedResourceKindInfo): AiAffectedResourceKind => {
        return info.kind;
      },
    );
  }

  // "Host", "Kubernetes Cluster": a kind as a form names it.
  public static getKindLabel(kind: AiAffectedResourceKind): string {
    return WORKSPACE_AFFECTED_RESOURCE_KIND_LABELS[kind].label;
  }

  // "Hosts", "Kubernetes Clusters": a kind's heading in a list.
  public static getKindPluralLabel(kind: AiAffectedResourceKind): string {
    return WORKSPACE_AFFECTED_RESOURCE_KIND_LABELS[kind].pluralLabel;
  }

  /*
   * Under the Affected Resources field: why it is there. OneUptime AI
   * looks into what an incident is linked to, and fixes it where fixes are
   * on - which is not every project's, so it says "can".
   */
  public static getHint(): string {
    return `${ProductBrandingText.getProductName()} AI investigates what an incident is linked to, and can fix it.`;
  }

  /*
   * The kinds the member may read, of those the forms offer - read from
   * their permissions alone, with no database read. A member who may read
   * none gets no Affected Resources field.
   */
  public static getReadableKinds(
    props: DatabaseCommonInteractionProps,
  ): Array<AiAffectedResourceKind> {
    const reader: DatabaseCommonInteractionProps = readerProps(props);

    return this.getKinds().filter((kind: AiAffectedResourceKind): boolean => {
      return (
        AffectedResourceSearch.getReadableSearchFields({
          kind: kind as unknown as AffectedResourceKind,
          props: reader,
        }).length > 0
      );
    });
  }

  /*
   * Whether a form offers the field to the member: they may read some kind
   * of resource, and the project has one of those to pick. A project with
   * no infrastructure in OneUptime - monitors and nothing else - keeps its
   * form as it was. Asked kind by kind, and the first found ends it, so a
   * project with hosts reads one row. A kind the plan or a block leaves
   * out, or whose read fails, counts as none of it.
   */
  @CaptureSpan()
  public static async isOffered(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    const reader: DatabaseCommonInteractionProps = readerProps(data.props);

    for (const kind of this.getReadableKinds(reader)) {
      const searchKind: AffectedResourceKind =
        kind as unknown as AffectedResourceKind;

      try {
        const rows: Array<BaseModel> = await getAffectedResourceKindService(
          searchKind,
        ).findBy({
          query: AffectedResourceSearch.buildKindQuery({
            kind: searchKind,
            projectId: data.projectId,
            search: "",
            searchFields: [],
          }),
          select: { _id: true },
          skip: 0,
          limit: 1,
          props: reader,
        });

        if (rows.length > 0) {
          return true;
        }
      } catch (error) {
        logger.debug(
          `Could not tell whether the project has ${this.getKindPluralLabel(kind)} to offer on a chat's incident form: ${error}`,
        );
      }
    }

    return false;
  }

  /*
   * What `text` finds, read as the member in the project: each kind they
   * may read with how many match and the first of them by name (a name
   * that is the text, then names that start with it, first), kinds with no
   * match left out. Empty text asks for suggestions: the first by name.
   */
  @CaptureSpan()
  public static async search(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    text: string;
    limitPerKind?: number | undefined;
  }): Promise<Array<WorkspaceAffectedResourceKindMatches>> {
    const result: AffectedResourceSearchResult =
      await AffectedResourceSearch.search({
        projectId: data.projectId,
        props: readerProps(data.props),
        request: {
          search: this.readSearchText(data.text),
          kinds: this.getKinds().map(
            (kind: AiAffectedResourceKind): AffectedResourceKind => {
              return kind as unknown as AffectedResourceKind;
            },
          ),
          limitPerKind: Math.min(
            AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
            Math.max(
              1,
              Math.floor(
                data.limitPerKind ||
                  WORKSPACE_AFFECTED_RESOURCE_SEARCH_LIMIT_PER_KIND,
              ),
            ),
          ),
          countKinds: [],
        },
      });

    const groups: Array<WorkspaceAffectedResourceKindMatches> = [];

    for (const kindResult of result.kinds) {
      const kind: unknown = kindResult.kind;

      if (!isAiAffectedResourceKind(kind)) {
        continue;
      }

      const matches: Array<WorkspaceAffectedResourceMatch> = this.toMatches(
        kind,
        kindResult,
      );

      if (matches.length === 0) {
        continue;
      }

      groups.push({
        kind: kind,
        count: Math.max(kindResult.count, matches.length),
        matches: matches,
      });
    }

    return groups;
  }

  /*
   * What a person typed, as it is searched: trimmed, and cut to the
   * longest text the search takes, so a pasted line still finds what it
   * starts with.
   */
  public static readSearchText(text: unknown): string {
    return (typeof text === "string" ? text : "")
      .trim()
      .substring(0, AFFECTED_RESOURCE_SEARCH_MAX_TEXT_LENGTH)
      .trim();
  }

  /*
   * The matches of every kind in one list of at most `limit`, for a chat
   * that lists them all together (Microsoft Teams): names that are the text
   * first, then names that start with it, then the rest - and within each,
   * the kinds taken in turn, so one kind with many matches cannot push every
   * other kind off the list.
   */
  public static rankAcrossKinds(data: {
    groups: Array<WorkspaceAffectedResourceKindMatches>;
    text: string;
    limit: number;
  }): Array<WorkspaceAffectedResourceMatch> {
    const needle: string = this.readSearchText(data.text).toLowerCase();

    const rankOf: (name: string) => number = (name: string): number => {
      const lowered: string = name.trim().toLowerCase();

      if (!needle) {
        return 2;
      }

      if (lowered === needle) {
        return 0;
      }

      return lowered.startsWith(needle) ? 1 : 2;
    };

    interface RankedMatch {
      match: WorkspaceAffectedResourceMatch;
      rank: number;
      place: number;
      kindPlace: number;
    }

    const ranked: Array<RankedMatch> = [];

    data.groups.forEach(
      (group: WorkspaceAffectedResourceKindMatches, kindPlace: number) => {
        group.matches.forEach(
          (match: WorkspaceAffectedResourceMatch, place: number) => {
            ranked.push({
              match: match,
              rank: rankOf(match.name),
              place: place,
              kindPlace: kindPlace,
            });
          },
        );
      },
    );

    return ranked
      .sort((a: RankedMatch, b: RankedMatch): number => {
        return (
          a.rank - b.rank || a.place - b.place || a.kindPlace - b.kindPlace
        );
      })
      .slice(0, Math.max(0, data.limit))
      .map((item: RankedMatch): WorkspaceAffectedResourceMatch => {
        return item.match;
      });
  }

  // A pick's value on a form: "<kind>:<id>" - "Host:3f2b...".
  public static toValue(ref: AiAffectedResourceRef): string {
    return `${ref.kind}${VALUE_SEPARATOR}${ref.id.toLowerCase()}`;
  }

  // A pick's value, read: null for one that names no resource.
  public static readValue(value: unknown): AiAffectedResourceRef | null {
    if (typeof value !== "string") {
      return null;
    }

    const text: string = value.trim();
    const separator: number = text.indexOf(VALUE_SEPARATOR);

    if (separator <= 0) {
      return null;
    }

    const kind: string = text.substring(0, separator);
    const id: string = text.substring(separator + 1).trim();

    if (!isAiAffectedResourceKind(kind) || !ObjectID.isValidUUID(id)) {
      return null;
    }

    return { kind: kind, id: id.toLowerCase() };
  }

  /*
   * The picks a form submitted: Slack's list of values, or Microsoft Teams'
   * one string of them, comma-separated. Each resource once, in the order
   * picked, at most WORKSPACE_MAX_AFFECTED_RESOURCES; a value that names no
   * resource, and every one past the cap, is counted as left out.
   */
  public static readPicks(value: unknown): WorkspaceAffectedResourcePicks {
    const values: Array<unknown> = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];

    const refs: Array<AiAffectedResourceRef> = [];
    const seen: Set<string> = new Set<string>();
    let leftOutCount: number = 0;

    for (const item of values) {
      if (typeof item === "string" && !item.trim()) {
        continue;
      }

      const ref: AiAffectedResourceRef | null = this.readValue(item);

      if (!ref) {
        leftOutCount++;
        continue;
      }

      const key: string = this.toValue(ref);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (refs.length >= WORKSPACE_MAX_AFFECTED_RESOURCES) {
        leftOutCount++;
        continue;
      }

      refs.push(ref);
    }

    return { refs: refs, leftOutCount: leftOutCount };
  }

  /*
   * What a declaration links: the picks, each read again as the member who
   * submits the form, in the form's project (AffectedResourceLinks.resolve)
   * - so only what they may view now, of that project, and not archived.
   * Never throws for the picks it is given.
   */
  @CaptureSpan()
  public static async readPicked(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    picks: WorkspaceAffectedResourcePicks;
  }): Promise<WorkspaceAffectedResourcesToLink> {
    if (data.picks.refs.length === 0) {
      return { linked: [], notLinkedCount: data.picks.leftOutCount };
    }

    const resolved: {
      linked: Array<LinkedAffectedResource>;
      notLinked: Array<string>;
    } = await AffectedResourceLinks.resolve({
      refs: data.picks.refs,
      ctx: { projectId: data.projectId, props: readerProps(data.props) },
    });

    return {
      linked: resolved.linked,
      notLinkedCount:
        data.picks.leftOutCount +
        Math.max(0, data.picks.refs.length - resolved.linked.length),
    };
  }

  // The new incident's lists: each resource in its kind's list.
  public static setOnIncident(
    incident: Incident,
    linked: Array<LinkedAffectedResource>,
  ): void {
    if (linked.length > 0) {
      AffectedResourceLinks.setOnRecord(incident, linked);
    }
  }

  /*
   * The resources an alert is linked to, as the member reads them - what a
   * form declared from the alert's own channel starts with. Which ones the
   * alert lists is read as OneUptime, held to its project
   * (LinkedAffectedResources); each is then read again as the member
   * (readPicked), so a resource they may not view is never shown to them.
   * Its monitor is not among them: a monitor is picked on purpose. Empty
   * when none can be read.
   */
  @CaptureSpan()
  public static async readAlertResources(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<LinkedAffectedResource>> {
    try {
      const listed: Array<ListedAffectedResource> =
        await LinkedAffectedResources.readForAlert({
          service: AlertService,
          projectId: data.projectId,
          alertId: data.alertId,
        });

      const refs: Array<AiAffectedResourceRef> = [];

      for (const info of AI_AFFECTED_RESOURCE_KINDS) {
        for (const resource of listed) {
          if (
            (resource.type as string) === (info.kind as string) &&
            ObjectID.isValidUUID(resource.id)
          ) {
            refs.push({ kind: info.kind, id: resource.id.toLowerCase() });
          }
        }
      }

      const toLink: WorkspaceAffectedResourcesToLink = await this.readPicked({
        projectId: data.projectId,
        props: data.props,
        picks: {
          refs: refs.slice(0, WORKSPACE_MAX_AFFECTED_RESOURCES),
          leftOutCount: 0,
        },
      });

      return toLink.linked;
    } catch (error) {
      logger.debug(
        `Could not read the resources of an alert for a chat's incident form: ${error}`,
      );
      return [];
    }
  }

  // A resource in a chat's sentence: "**api-1** (Host)".
  public static describe(resource: {
    kind: AiAffectedResourceKind;
    name: string;
  }): MarkdownText {
    return mdText`**${resource.name}** (${this.getKindLabel(resource.kind)})`;
  }

  /*
   * The confirmation's line: what the new incident is linked to - "Linked
   * to **api-1** (Host), **prod** (Kubernetes Cluster) and **[Alert
   * ALT-3](link)**." - or null when it is linked to nothing.
   */
  public static getLinkedLine(data: {
    linked: Array<LinkedAffectedResource>;
    alert?: WorkspaceRecordName | null | undefined;
  }): MarkdownText | null {
    const items: Array<MarkdownText> = data.linked.map(
      (resource: LinkedAffectedResource): MarkdownText => {
        return this.describe(resource);
      },
    );

    if (data.alert) {
      items.push(
        data.alert.link
          ? mdText`**[${data.alert.label}](${data.alert.link})**`
          : mdText`**${data.alert.label}**`,
      );
    }

    if (items.length === 0) {
      return null;
    }

    return mdText`Linked to ${joinWithAnd(items)}.`;
  }

  /*
   * The confirmation's line for picks that were not linked, or null when
   * every pick was. Text: nothing is known of a pick that cannot be read.
   */
  public static getNotLinkedLine(count: number): string | null {
    if (count <= 0) {
      return null;
    }

    return count === 1
      ? "1 resource you picked was not linked: it was deleted or archived, or you may no longer view it."
      : `${count} resources you picked were not linked: they were deleted or archived, or you may no longer view them.`;
  }

  private static toMatches(
    kind: AiAffectedResourceKind,
    kindResult: AffectedResourceSearchKindResult,
  ): Array<WorkspaceAffectedResourceMatch> {
    const matches: Array<WorkspaceAffectedResourceMatch> = [];

    for (const match of kindResult.matches as Array<AffectedResourceSearchMatch>) {
      const name: string = (match.name || "").trim();

      if (!name || !ObjectID.isValidUUID(match._id)) {
        continue;
      }

      const read: WorkspaceAffectedResourceMatch = {
        kind: kind,
        id: match._id.toLowerCase(),
        name: name,
      };

      if (match.detail) {
        read.detail = match.detail;
      }

      matches.push(read);
    }

    return matches;
  }
}
