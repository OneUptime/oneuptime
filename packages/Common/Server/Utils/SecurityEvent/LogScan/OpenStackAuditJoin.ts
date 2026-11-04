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
  describeOpenStackProject,
} from "../../../../Utils/SecurityEvent/LogParsers/OpenStackAuditLogParser";
import OpenStackCloudService from "../../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../../Services/OpenStackResourceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";

/*
 * An OpenStack audit event says which project it is about by ID: Keystone's notifications
 * name nothing else. This puts the project's name beside it, from the cloud's inventory,
 * before the event is stored: so a case reads "project payments", a detection can name the
 * projects it protects (DetectionRuleLibrary), and the message says something a person
 * knows. An ID the inventory has not seen keeps its ID: that is still exact.
 *
 * Keystone's users are not in the inventory: the access the agent asks for leaves them out
 * on purpose. A user is named when the event itself names them, as a failed login's does,
 * and by ID otherwise.
 *
 * Never throws: a name is worth having and not worth losing an event over.
 */

// The most projects one read names, for one cloud.
const MAX_PROJECTS_PER_READ: number = 500;

function readText(attributes: JSONObject, key: string): string {
  const value: unknown = attributes[key];

  return typeof value === "string" ? value : "";
}

export default class OpenStackAuditJoin {
  public static async enrichEvents(data: {
    projectId: ObjectID;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<void> {
    try {
      const idsByCloud: Map<string, Set<string>> = new Map();

      for (const event of data.events) {
        if (
          event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] !==
          SecurityLogFormat.OpenStackAudit
        ) {
          continue;
        }

        const cloud: string = readText(
          event.attributes,
          OpenStackAuditAttribute.Cloud,
        );
        const project: string = readText(
          event.attributes,
          OpenStackAuditAttribute.ProjectId,
        );

        if (!cloud || !project) {
          continue;
        }

        const ids: Set<string> = idsByCloud.get(cloud) || new Set();
        ids.add(project);
        idsByCloud.set(cloud, ids);
      }

      if (idsByCloud.size === 0) {
        return;
      }

      const names: Map<string, Map<string, string>> = await this.readNames({
        projectId: data.projectId,
        idsByCloud,
      });

      for (const event of data.events) {
        const project: string = readText(
          event.attributes,
          OpenStackAuditAttribute.ProjectId,
        );
        const cloud: string = readText(
          event.attributes,
          OpenStackAuditAttribute.Cloud,
        );
        const name: string | undefined = names.get(cloud)?.get(project);

        if (name) {
          this.nameProject({ event, id: project, name });
        }
      }
    } catch (error) {
      logger.warn(
        `OpenStack audit events of project ${data.projectId.toString()} keep their project IDs: ${
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
    const before: string = describeOpenStackProject(data.id);
    const after: string = describeOpenStackProject(data.name);

    data.event.attributes[OpenStackAuditAttribute.ProjectName] = data.name;
    data.event.message = (data.event.message || "").split(before).join(after);
    data.event.targetResource = (data.event.targetResource || "")
      .split(before)
      .join(after);
  }

  private static async readNames(data: {
    projectId: ObjectID;
    idsByCloud: Map<string, Set<string>>;
  }): Promise<Map<string, Map<string, string>>> {
    const names: Map<string, Map<string, string>> = new Map();

    const clouds: Array<OpenStackCloud> = await OpenStackCloudService.findBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.any(Array.from(data.idsByCloud.keys())),
      } as never,
      select: { _id: true, name: true },
      limit: data.idsByCloud.size,
      skip: 0,
      props: { isRoot: true },
    });

    for (const cloud of clouds) {
      const cloudName: string = cloud.name || "";
      const ids: Array<string> = Array.from(
        data.idsByCloud.get(cloudName) || [],
      ).slice(0, MAX_PROJECTS_PER_READ);

      if (!cloud.id || ids.length === 0) {
        continue;
      }

      const rows: Array<OpenStackResource> =
        await OpenStackResourceService.findBy({
          query: {
            projectId: data.projectId,
            openStackCloudId: cloud.id,
            kind: OpenStackResourceKind.Project,
            externalId: QueryHelper.any(ids),
          } as never,
          select: { externalId: true, name: true },
          limit: ids.length,
          skip: 0,
          props: { isRoot: true },
        });

      const byId: Map<string, string> = new Map();

      for (const row of rows) {
        if (row.externalId && row.name) {
          byId.set(row.externalId, row.name);
        }
      }

      names.set(cloudName, byId);
    }

    return names;
  }
}
