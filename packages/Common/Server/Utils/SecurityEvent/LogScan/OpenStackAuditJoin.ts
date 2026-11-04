import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  OpenStackAuditAttribute,
  describeOpenStackPart,
  describeOpenStackProject,
  describeOpenStackUser,
} from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import OpenStackCloudService from "../../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../../Services/OpenStackResourceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";

/*
 * An OpenStack audit event says what it is about by ID: Keystone's notifications name nothing
 * else, and an API call's path holds nothing else. This puts the names beside the IDs before
 * the event is stored, so a case reads "project payments" and "instance web-1", a detection can
 * name the projects it protects (DetectionRuleLibrary), and the message says something a person
 * knows. An ID nobody has a name for keeps its ID: that is still exact.
 *
 *   Projects and parts  from the cloud's inventory, by ID. A part's own project is the one its
 *                       row says, whoever's token touched it: an admin acting from their own
 *                       project affects the project the instance is in.
 *   Users               from what the cloud's own events have said. Keystone's users are not in
 *                       the inventory, because the access the agent asks for leaves them out on
 *                       purpose, and every event of a user acting gives their ID and their name
 *                       together. So a name is remembered once seen, for the grant that names
 *                       that user only by ID.
 *   One request         a security group's or an image's notification says who, and not from
 *                       where. The audit filter's event of the same request does.
 *
 * Never throws: a name is worth having and not worth losing an event over.
 */

// The most IDs one read names, for one cloud.
const MAX_IDS_PER_READ: number = 500;

// The most user names one scan's page reads and remembers.
const MAX_USERS_PER_BATCH: number = 200;

const USER_NAMES_CACHE_NAMESPACE: string = "openstack-audit-user-name";
const USER_NAME_REMEMBERED_FOR_IN_SECONDS: number = 30 * 24 * 60 * 60;

function readText(attributes: JSONObject, key: string): string {
  const value: unknown = attributes[key];

  return typeof value === "string" ? value : "";
}

function replaced(text: string | undefined, from: string, to: string): string {
  return (text || "").split(from).join(to);
}

// One name in place of another, wherever the event says it. As text: a name holds anything.
function rewrite(
  event: NormalizedSecurityEvent,
  from: string,
  to: string,
): void {
  event.message = replaced(event.message, from, to);
  event.targetResource = replaced(event.targetResource, from, to);
  event.observables = (event.observables || []).map(
    (value: string): string => {
      return value === from ? to : value;
    },
  );
}

function isAuditEvent(event: NormalizedSecurityEvent): boolean {
  return (
    event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] ===
    SecurityLogFormat.OpenStackAudit
  );
}

function userKey(data: {
  projectId: ObjectID;
  cloud: string;
  id: string;
}): string {
  return `${data.projectId.toString()}:${data.cloud}:${data.id}`;
}

export default class OpenStackAuditJoin {
  public static async enrichEvents(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<void> {
    const events: Array<NormalizedSecurityEvent> =
      data.events.filter(isAuditEvent);

    if (events.length === 0) {
      return;
    }

    this.fillFromSameRequest(events);

    try {
      await this.nameFromInventory({ projectId: data.projectId, events });
    } catch (error) {
      logger.warn(
        `OpenStack audit events of project ${data.projectId.toString()} keep their project and part IDs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      await this.nameUsers({ projectId: data.projectId, events });
    } catch (error) {
      logger.warn(
        `OpenStack audit events of project ${data.projectId.toString()} keep their user IDs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // One event with its project named, wherever the event said its ID.
  public static nameProject(data: {
    event: NormalizedSecurityEvent;
    id: string;
    name: string;
  }): void {
    data.event.attributes[OpenStackAuditAttribute.ProjectName] = data.name;
    rewrite(
      data.event,
      describeOpenStackProject(data.id),
      describeOpenStackProject(data.name),
    );
  }

  // One event with the part it touched named, wherever the event said its ID.
  public static namePart(data: {
    event: NormalizedSecurityEvent;
    kind: OpenStackResourceKind | string;
    id: string;
    name: string;
  }): void {
    data.event.attributes[OpenStackAuditAttribute.PartName] = data.name;
    rewrite(
      data.event,
      describeOpenStackPart(data.kind, data.id),
      describeOpenStackPart(data.kind, data.name),
    );
  }

  /*
   * One event's user named: who did it, who it was done to, or both, by the ID it said. A
   * user's ID is 32 hex digits, so it stands for nothing else in a message.
   */
  public static nameUser(data: {
    event: NormalizedSecurityEvent;
    id: string;
    name: string;
  }): void {
    const { event, id, name } = data;

    if (event.principalUser === id) {
      event.principalUser = name;
    }

    if (event.targetUser === id) {
      event.targetUser = name;
    }

    if (readText(event.attributes, OpenStackAuditAttribute.InitiatorId) === id) {
      event.attributes[OpenStackAuditAttribute.InitiatorName] = name;
    }

    if (readText(event.attributes, OpenStackAuditAttribute.UserId) === id) {
      event.attributes[OpenStackAuditAttribute.UserName] = name;
    }

    event.observables = (event.observables || []).map(
      (value: string): string => {
        return value === describeOpenStackUser(id) ? name : value;
      },
    );
    event.message = replaced(event.message, id, name);
    event.targetResource = replaced(event.targetResource, id, name);
  }

  /*
   * Who and from where, for the events of a request that did not say: the notification a
   * request causes is written while its audit filter's event is, so they meet in one page.
   */
  private static fillFromSameRequest(
    events: Array<NormalizedSecurityEvent>,
  ): void {
    const addresses: Map<string, NormalizedSecurityEvent> = new Map();

    for (const event of events) {
      const request: string = readText(
        event.attributes,
        OpenStackAuditAttribute.RequestId,
      );

      if (
        request &&
        readText(event.attributes, OpenStackAuditAttribute.InitiatorAddress)
      ) {
        addresses.set(request, event);
      }
    }

    if (addresses.size === 0) {
      return;
    }

    for (const event of events) {
      const source: NormalizedSecurityEvent | undefined = addresses.get(
        readText(event.attributes, OpenStackAuditAttribute.RequestId),
      );

      if (
        !source ||
        readText(event.attributes, OpenStackAuditAttribute.InitiatorAddress)
      ) {
        continue;
      }

      event.attributes[OpenStackAuditAttribute.InitiatorAddress] = readText(
        source.attributes,
        OpenStackAuditAttribute.InitiatorAddress,
      );

      for (const key of [
        OpenStackAuditAttribute.InitiatorId,
        OpenStackAuditAttribute.InitiatorName,
      ]) {
        if (!readText(event.attributes, key) && readText(source.attributes, key)) {
          event.attributes[key] = readText(source.attributes, key);
        }
      }

      if (!event.principalIp && source.principalIp) {
        event.principalIp = source.principalIp;
        event.observables = [...(event.observables || []), source.principalIp];
      }
    }
  }

  private static async nameFromInventory(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<void> {
    const idsByCloud: Map<string, Set<string>> = new Map();

    for (const event of data.events) {
      const cloud: string = readText(
        event.attributes,
        OpenStackAuditAttribute.Cloud,
      );

      if (!cloud) {
        continue;
      }

      const ids: Set<string> = idsByCloud.get(cloud) || new Set();

      for (const key of [
        OpenStackAuditAttribute.ProjectId,
        OpenStackAuditAttribute.PartId,
      ]) {
        const id: string = readText(event.attributes, key);

        if (id) {
          ids.add(id);
        }
      }

      if (ids.size > 0) {
        idsByCloud.set(cloud, ids);
      }
    }

    if (idsByCloud.size === 0) {
      return;
    }

    const clouds: Array<OpenStackCloud> = await OpenStackCloudService.findBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.any(Array.from(idsByCloud.keys())),
      } as never,
      select: { _id: true, name: true },
      limit: idsByCloud.size,
      skip: 0,
      props: { isRoot: true },
    });

    for (const cloud of clouds) {
      const cloudName: string = cloud.name || "";
      const ids: Array<string> = Array.from(idsByCloud.get(cloudName) || []);

      if (!cloud.id || ids.length === 0) {
        continue;
      }

      const rows: Map<string, OpenStackResource> = await this.readRows({
        projectId: data.projectId,
        cloudId: cloud.id,
        ids,
      });

      /*
       * The projects the parts turned out to be in: a part's own project is read once
       * more when no event of this page named it.
       */
      const moreIds: Set<string> = new Set();

      for (const row of rows.values()) {
        if (row.openStackProjectId && !ids.includes(row.openStackProjectId)) {
          moreIds.add(row.openStackProjectId);
        }
      }

      if (moreIds.size > 0) {
        const more: Map<string, OpenStackResource> = await this.readRows({
          projectId: data.projectId,
          cloudId: cloud.id,
          ids: Array.from(moreIds),
        });

        for (const [key, row] of more) {
          rows.set(key, row);
        }
      }

      for (const event of data.events) {
        if (
          readText(event.attributes, OpenStackAuditAttribute.Cloud) ===
          cloudName
        ) {
          this.applyRows({ event, rows });
        }
      }
    }
  }

  private static async readRows(data: {
    projectId: ObjectID;
    cloudId: ObjectID;
    ids: Array<string>;
  }): Promise<Map<string, OpenStackResource>> {
    const ids: Array<string> = data.ids.slice(0, MAX_IDS_PER_READ);

    const rows: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.cloudId,
          externalId: QueryHelper.any(ids),
        } as never,
        select: {
          externalId: true,
          kind: true,
          name: true,
          openStackProjectId: true,
        },
        limit: ids.length,
        skip: 0,
        props: { isRoot: true },
      });

    const byId: Map<string, OpenStackResource> = new Map();

    for (const row of rows) {
      if (row.externalId) {
        byId.set(`${row.kind}:${row.externalId}`, row);
      }
    }

    return byId;
  }

  private static applyRows(data: {
    event: NormalizedSecurityEvent;
    rows: Map<string, OpenStackResource>;
  }): void {
    const { event, rows } = data;
    const partId: string = readText(
      event.attributes,
      OpenStackAuditAttribute.PartId,
    );
    const partKind: string = readText(
      event.attributes,
      OpenStackAuditAttribute.PartKind,
    );
    const part: OpenStackResource | undefined =
      partId && partKind && partKind !== OpenStackResourceKind.Project
        ? rows.get(`${partKind}:${partId}`)
        : undefined;

    if (part?.name) {
      this.namePart({ event, kind: partKind, id: partId, name: part.name });
    }

    // Whoever's token touched it, this is the project it affects.
    const said: string = readText(
      event.attributes,
      OpenStackAuditAttribute.ProjectId,
    );
    const project: string = part?.openStackProjectId || said;

    if (project && project !== said) {
      event.attributes[OpenStackAuditAttribute.ProjectId] = project;

      if (said) {
        rewrite(
          event,
          describeOpenStackProject(said),
          describeOpenStackProject(project),
        );
      }
    }

    const projectRow: OpenStackResource | undefined = project
      ? rows.get(`${OpenStackResourceKind.Project}:${project}`)
      : undefined;

    if (projectRow?.name) {
      this.nameProject({ event, id: project, name: projectRow.name });

      if (partKind === OpenStackResourceKind.Project && partId === project) {
        event.attributes[OpenStackAuditAttribute.PartName] = projectRow.name;
      }
    }
  }

  private static async nameUsers(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<void> {
    const names: Map<string, string> = new Map();
    const wanted: Map<string, string> = new Map();

    for (const event of data.events) {
      const cloud: string = readText(
        event.attributes,
        OpenStackAuditAttribute.Cloud,
      );
      const initiatorId: string = readText(
        event.attributes,
        OpenStackAuditAttribute.InitiatorId,
      );
      const initiatorName: string = readText(
        event.attributes,
        OpenStackAuditAttribute.InitiatorName,
      );
      const userId: string = readText(
        event.attributes,
        OpenStackAuditAttribute.UserId,
      );

      if (initiatorId && initiatorName) {
        names.set(
          userKey({ projectId: data.projectId, cloud, id: initiatorId }),
          initiatorName,
        );
      } else if (initiatorId) {
        wanted.set(
          userKey({ projectId: data.projectId, cloud, id: initiatorId }),
          initiatorId,
        );
      }

      if (userId) {
        wanted.set(
          userKey({ projectId: data.projectId, cloud, id: userId }),
          userId,
        );
      }
    }

    const toRead: Array<string> = Array.from(wanted.keys())
      .filter((key: string): boolean => {
        return !names.has(key);
      })
      .slice(0, MAX_USERS_PER_BATCH);

    const seen: Array<[string, string]> = Array.from(names.entries()).slice(
      0,
      MAX_USERS_PER_BATCH,
    );

    if (toRead.length > 0) {
      const read: Array<string | null> = await GlobalCache.getStrings(
        USER_NAMES_CACHE_NAMESPACE,
        toRead,
      );

      toRead.forEach((key: string, index: number): void => {
        const name: string | null | undefined = read[index];

        if (name) {
          names.set(key, name);
        }
      });
    }

    for (const event of data.events) {
      const cloud: string = readText(
        event.attributes,
        OpenStackAuditAttribute.Cloud,
      );

      for (const attribute of [
        OpenStackAuditAttribute.InitiatorId,
        OpenStackAuditAttribute.UserId,
      ]) {
        const id: string = readText(event.attributes, attribute);
        const name: string | undefined = id
          ? names.get(userKey({ projectId: data.projectId, cloud, id }))
          : undefined;

        if (id && name) {
          this.nameUser({ event, id, name });
        }
      }
    }

    await Promise.all(
      seen.map(async ([key, name]: [string, string]): Promise<void> => {
        await GlobalCache.setString(USER_NAMES_CACHE_NAMESPACE, key, name, {
          expiresInSeconds: USER_NAME_REMEMBERED_FOR_IN_SECONDS,
        });
      }),
    );
  }
}
