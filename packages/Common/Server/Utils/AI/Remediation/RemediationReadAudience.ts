import ResourceAiAccessService from "../../../Services/ResourceAiAccessService";
import ReadAudiencePermission from "../../../Types/Database/Permissions/ReadAudiencePermission";
import ReadAudienceReader from "../../ReadAudience/ReadAudienceReader";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import Runner from "../../../../Models/DatabaseModels/Runner";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType, {
  isAiResourceType,
} from "../../../../Types/ResourceAiAgent/AiResourceType";

/*
 * WHO READS WHAT A FIX POSTS (#9612).
 *
 * A fix OneUptime AI works out for an incident or an alert - a runbook it
 * picks, the commands it runs or proposes on a cluster, a resource or a
 * Runner, the changes it makes through the project's MCP servers - posts
 * its plan, its reasoning and its outcome to the incident's or alert's
 * feed, its OneUptime AI card and its Slack and Microsoft Teams channels:
 * everyone who may see the incident or alert reads them. So a fix reads
 * as an investigation does (Types/BaseDatabase/ReadAudience): only what
 * every one of them may read, its tools and its starting context alike.
 *
 * Beside what the incident or alert names itself, a fix reads what it acts
 * on, whoever owns it and whatever labels it carries:
 *
 *   - a cluster's or a resource's round, its cluster or resource. It is the
 *     subject's own - an affected resource, or what one of its monitors
 *     watches - and the round's announcement on the subject's feed named it
 *     before the fix started;
 *   - a rule's fix, the Runners its AI rule runs commands on, the
 *     subject's clusters an older rule reaches, and the runbooks the rule
 *     names: the rule's author chose them to fix what the rule matches.
 *
 * Refusing a target some reader may not read would stop the fixes the
 * people who set them up asked for, and would name the target anyway in
 * saying why. Everything else - another host, service or cluster, an
 * incident in a track record, a runbook the project's own pick may choose
 * - is read as nobody in particular may read it, and what is left out is
 * never named or counted.
 */

// What a fix acts on, as the round names it.
export interface RemediationTargets {
  kubernetesClusterIds?: Array<string | ObjectID> | undefined;
  resource?:
    | {
        resourceType: AiResourceType | string | undefined;
        resourceId: string | ObjectID | undefined;
      }
    | undefined;
  runnerIds?: Array<string | ObjectID> | undefined;
  runbookIds?: Array<string | ObjectID> | undefined;
}

export default class RemediationReadAudience {
  /*
   * The readers of a fix of an incident or an alert, with what it acts on
   * named (RemediationTargets). Throws when they cannot be read: a round
   * that cannot tell who reads it is retried, never run as OneUptime.
   */
  public static async forFix(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    targets?: RemediationTargets | undefined;
  }): Promise<ReadAudience> {
    return await ReadAudienceReader.forSubject({
      projectId: data.projectId,
      incidentId: data.incidentId,
      alertId: data.alertId,
      targets: RemediationReadAudience.getNamedTargets(data.targets || {}),
    });
  }

  /*
   * What a fix acts on, by model name, as ReadAudience.named keys it: a
   * resource round's resource under its own model (a Docker host's
   * "DockerHost", an AWS account's "CloudAccount"). A resource of a type
   * OneUptime does not know names nothing.
   */
  public static getNamedTargets(
    targets: RemediationTargets,
  ): Dictionary<Array<string>> {
    const named: Dictionary<Array<string>> = {};

    const add: (
      modelType: { new (): BaseModel },
      ids: Array<unknown>,
    ) => void = (
      modelType: { new (): BaseModel },
      ids: Array<unknown>,
    ): void => {
      const kind: string = ReadAudiencePermission.getKindName(modelType);
      const values: Array<string> = ids
        .map((id: unknown): string => {
          return id ? String(id).trim().toLowerCase() : "";
        })
        .filter(Boolean);

      if (values.length === 0) {
        return;
      }

      named[kind] = Array.from(
        new Set<string>([...(named[kind] || []), ...values]),
      ).sort();
    };

    add(KubernetesCluster, targets.kubernetesClusterIds || []);
    add(Runner, targets.runnerIds || []);
    add(Runbook, targets.runbookIds || []);

    const resourceType: unknown = targets.resource?.resourceType;

    if (isAiResourceType(resourceType) && targets.resource?.resourceId) {
      add(
        ResourceAiAccessService.getResourceService(resourceType)
          .modelType as unknown as { new (): BaseModel },
        [targets.resource.resourceId],
      );
    }

    return named;
  }
}
