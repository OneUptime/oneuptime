import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerRule from "../../../Models/DatabaseModels/AlertEpisodeOwnerRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerRule from "../../../Models/DatabaseModels/IncidentEpisodeOwnerRule";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ServiceModel from "../../../Models/DatabaseModels/Service";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OwnerRulePreview, {
  OWNER_RULE_PREVIEW_DRAFT_LISTS,
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
  OwnerRulePreviewRule,
} from "../../../Types/Rules/OwnerRulePreview";
import AlertEpisodeOwnerRuleEngineService from "../../Services/AlertEpisodeOwnerRuleEngineService";
import AlertOwnerRuleEngineService from "../../Services/AlertOwnerRuleEngineService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import DatabaseService from "../../Services/DatabaseService";
import DockerHostService from "../../Services/DockerHostService";
import HostService from "../../Services/HostService";
import IncidentEpisodeOwnerRuleEngineService from "../../Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentOwnerRuleEngineService from "../../Services/IncidentOwnerRuleEngineService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import LabelService from "../../Services/LabelService";
import MonitorService from "../../Services/MonitorService";
import PodmanHostService from "../../Services/PodmanHostService";
import ServiceService from "../../Services/ServiceService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import CallerPermission from "../Permission/CallerPermission";
import { OwnerRulePlanEntry } from "./OwnerRulePlan";

/*
 * WHICH OWNER RULES WILL RUN FOR AN EVENT THAT DOES NOT EXIST YET
 * (Types/Rules/OwnerRulePreview), for POST /<event>/owner-rule-preview.
 *
 * The draft - the event as its create form holds it - is made into the
 * event the create would write, in the caller's project and with the caller
 * as its creator, and handed to the owner rule engine of its kind, whose
 * plan is the one the create carries out (planRules). Nothing is written.
 *
 * What the caller learns is bounded:
 *
 *   - only someone who may read the event's owner rules may ask: the answer
 *     is those rules, by name;
 *   - every record the draft names must be the project's - another
 *     project's id is refused, not looked up;
 *   - the answer is ids: the dashboard names the people and teams by reading
 *     them with the caller's own permissions, as every owners list does.
 */

// The answer to a severity that is not the project's, or is none.
const INCIDENT_SEVERITY_NOT_FOUND: string =
  "This incident severity was not found in this project.";
const ALERT_SEVERITY_NOT_FOUND: string =
  "This alert severity was not found in this project.";

// What each event's preview reads, and how it is told apart.
interface EventDefinition {
  // The rules it shows: who may read them may ask.
  ruleModelType: { new (): BaseModel };
  // Whether the event has monitors and other resources rules match on.
  hasResources: boolean;
  // Whether it has one monitor at most (an alert).
  hasOneMonitor: boolean;
  // The severity service of the event, and the answer to one not found.
  severityService: DatabaseService<BaseModel>;
  severityNotFound: string;
}

const getEventDefinition: (event: OwnerRulePreviewEvent) => EventDefinition = (
  event: OwnerRulePreviewEvent,
): EventDefinition => {
  switch (event) {
    case OwnerRulePreviewEvent.Incident:
      return {
        ruleModelType: IncidentOwnerRule,
        hasResources: true,
        hasOneMonitor: false,
        severityService:
          IncidentSeverityService as unknown as DatabaseService<BaseModel>,
        severityNotFound: INCIDENT_SEVERITY_NOT_FOUND,
      };
    case OwnerRulePreviewEvent.Alert:
      return {
        ruleModelType: AlertOwnerRule,
        hasResources: true,
        hasOneMonitor: true,
        severityService:
          AlertSeverityService as unknown as DatabaseService<BaseModel>,
        severityNotFound: ALERT_SEVERITY_NOT_FOUND,
      };
    case OwnerRulePreviewEvent.IncidentEpisode:
      return {
        ruleModelType: IncidentEpisodeOwnerRule,
        hasResources: false,
        hasOneMonitor: false,
        severityService:
          IncidentSeverityService as unknown as DatabaseService<BaseModel>,
        severityNotFound: INCIDENT_SEVERITY_NOT_FOUND,
      };
    case OwnerRulePreviewEvent.AlertEpisode:
      return {
        ruleModelType: AlertEpisodeOwnerRule,
        hasResources: false,
        hasOneMonitor: false,
        severityService:
          AlertSeverityService as unknown as DatabaseService<BaseModel>,
        severityNotFound: ALERT_SEVERITY_NOT_FOUND,
      };
  }
};

// How each list of the draft is named in an answer, and whose records it holds.
interface DraftListDefinition {
  key: (typeof OWNER_RULE_PREVIEW_DRAFT_LISTS)[number];
  name: string;
  service: DatabaseService<BaseModel>;
  // Only an event with resources reads it.
  isResource: boolean;
}

const getDraftListDefinitions: () => Array<DraftListDefinition> =
  (): Array<DraftListDefinition> => {
    /*
     * Built per call: these services sit in an import graph that loops back
     * here, and a table at module load could capture one not loaded yet.
     */
    return [
      {
        key: "labelIds",
        name: "labels",
        service: LabelService as unknown as DatabaseService<BaseModel>,
        isResource: false,
      },
      {
        key: "monitorIds",
        name: "monitors",
        service: MonitorService as unknown as DatabaseService<BaseModel>,
        isResource: true,
      },
      {
        key: "hostIds",
        name: "hosts",
        service: HostService as unknown as DatabaseService<BaseModel>,
        isResource: true,
      },
      {
        key: "kubernetesClusterIds",
        name: "Kubernetes clusters",
        service:
          KubernetesClusterService as unknown as DatabaseService<BaseModel>,
        isResource: true,
      },
      {
        key: "dockerHostIds",
        name: "Docker hosts",
        service: DockerHostService as unknown as DatabaseService<BaseModel>,
        isResource: true,
      },
      {
        key: "podmanHostIds",
        name: "Podman hosts",
        service: PodmanHostService as unknown as DatabaseService<BaseModel>,
        isResource: true,
      },
      {
        key: "serviceIds",
        name: "services",
        service: ServiceService as unknown as DatabaseService<BaseModel>,
        isResource: true,
      },
    ];
  };

// Related rows the engines read by id, as the create's own payload has them.
const stubsOf: <T extends BaseModel>(
  modelType: { new (id?: ObjectID): T },
  ids: Array<string>,
) => Array<T> = <T extends BaseModel>(
  modelType: { new (id?: ObjectID): T },
  ids: Array<string>,
): Array<T> => {
  return ids.map((id: string): T => {
    return new modelType(new ObjectID(id));
  });
};

export default class OwnerRulePreviewBuilder {
  /*
   * Refuses a caller who may not read the event's owner rules: the answer
   * names them. Read the way every permission check reads it
   * (CallerPermission): a block with no labels on the rules takes it away.
   */
  public static assertCallerMayPreview(data: {
    props: DatabaseCommonInteractionProps;
    event: OwnerRulePreviewEvent;
  }): void {
    if (data.props.isMasterAdmin) {
      return;
    }

    const definition: EventDefinition = getEventDefinition(data.event);

    if (
      !CallerPermission.holdsModelPermission(data.props, {
        model: new definition.ruleModelType(),
        operation: "read",
      })
    ) {
      throw new NotAuthorizedException(
        "You do not have permission to see which owner rules would run. You need a permission that can read the owner rules.",
      );
    }
  }

  /*
   * The request body as a draft, or refused: text where text is asked for,
   * ids that are ids, and no more of them than any form sends. A list the
   * event does not have - an episode's monitors - is not read.
   */
  public static parseDraft(data: {
    body: unknown;
    event: OwnerRulePreviewEvent;
  }): OwnerRulePreviewDraft {
    const body: JSONObject =
      data.body && typeof data.body === "object" && !Array.isArray(data.body)
        ? (data.body as JSONObject)
        : {};

    const definition: EventDefinition = getEventDefinition(data.event);
    const draft: OwnerRulePreviewDraft = OwnerRulePreview.emptyDraft();

    draft.title = OwnerRulePreviewBuilder.parseText(body["title"], "title");
    draft.description = OwnerRulePreviewBuilder.parseText(
      body["description"],
      "description",
    );

    const severityId: unknown = body["severityId"];

    if (severityId !== undefined && severityId !== null && severityId !== "") {
      draft.severityId = OwnerRulePreviewBuilder.parseId(
        severityId,
        "severityId",
      );
    }

    for (const list of getDraftListDefinitions()) {
      if (list.isResource && !definition.hasResources) {
        continue;
      }

      draft[list.key] = OwnerRulePreviewBuilder.parseIds(
        body[list.key],
        list.key,
      );
    }

    if (definition.hasOneMonitor && draft.monitorIds.length > 1) {
      throw new BadDataException("An alert has one monitor at most.");
    }

    return draft;
  }

  /*
   * Each rule that would add someone to the event the draft describes, and
   * who, with the caller as its creator. Every record the draft names must
   * be the project's.
   */
  public static async build(data: {
    event: OwnerRulePreviewEvent;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    draft: OwnerRulePreviewDraft;
  }): Promise<OwnerRulePreviewResult> {
    await OwnerRulePreviewBuilder.assertDraftInProject(data);

    const creatorUserId: ObjectID | undefined = data.props.userId;
    const { draft, projectId } = data;

    const entries: Array<OwnerRulePlanEntry<BaseModel>> =
      await OwnerRulePreviewBuilder.planFor({
        event: data.event,
        projectId: projectId,
        creatorUserId: creatorUserId,
        draft: draft,
      });

    return {
      rules: entries
        .filter((entry: OwnerRulePlanEntry<BaseModel>): boolean => {
          return entry.userIds.length > 0 || entry.teamIds.length > 0;
        })
        .map((entry: OwnerRulePlanEntry<BaseModel>): OwnerRulePreviewRule => {
          const rule: BaseModel = entry.rule;
          const ruleName: unknown = rule.getColumnValue("name");

          return {
            ruleId: rule.id?.toString() || "",
            ruleName: typeof ruleName === "string" ? ruleName : "",
            userIds: [...entry.userIds],
            teamIds: [...entry.teamIds],
            creatorTeamIds: [...entry.creatorTeamIds],
            notifiesOwners: entry.notify,
          };
        })
        .filter((rule: OwnerRulePreviewRule): boolean => {
          return rule.ruleId.length > 0;
        }),
    };
  }

  // The event the create would write, handed to the engine of its kind.
  private static async planFor(data: {
    event: OwnerRulePreviewEvent;
    projectId: ObjectID;
    creatorUserId: ObjectID | undefined;
    draft: OwnerRulePreviewDraft;
  }): Promise<Array<OwnerRulePlanEntry<BaseModel>>> {
    const { draft } = data;
    const severityId: ObjectID | undefined = draft.severityId
      ? new ObjectID(draft.severityId)
      : undefined;

    switch (data.event) {
      case OwnerRulePreviewEvent.Incident: {
        const incident: Incident = new Incident();
        incident.projectId = data.projectId;
        incident.title = draft.title;
        incident.description = draft.description;

        if (severityId) {
          incident.incidentSeverityId = severityId;
        }

        if (data.creatorUserId) {
          incident.createdByUserId = data.creatorUserId;
        }

        incident.labels = stubsOf(Label, draft.labelIds);
        incident.monitors = stubsOf(Monitor, draft.monitorIds);
        incident.hosts = stubsOf(Host, draft.hostIds);
        incident.kubernetesClusters = stubsOf(
          KubernetesCluster,
          draft.kubernetesClusterIds,
        );
        incident.dockerHosts = stubsOf(DockerHost, draft.dockerHostIds);
        incident.podmanHosts = stubsOf(PodmanHost, draft.podmanHostIds);
        incident.services = stubsOf(ServiceModel, draft.serviceIds);

        return (await IncidentOwnerRuleEngineService.previewRules(
          incident,
        )) as unknown as Array<OwnerRulePlanEntry<BaseModel>>;
      }
      case OwnerRulePreviewEvent.Alert: {
        const alert: Alert = new Alert();
        alert.projectId = data.projectId;
        alert.title = draft.title;
        alert.description = draft.description;

        if (severityId) {
          alert.alertSeverityId = severityId;
        }

        if (data.creatorUserId) {
          alert.createdByUserId = data.creatorUserId;
        }

        const monitorId: string | undefined = draft.monitorIds[0];

        if (monitorId) {
          alert.monitorId = new ObjectID(monitorId);
        }

        alert.labels = stubsOf(Label, draft.labelIds);
        alert.hosts = stubsOf(Host, draft.hostIds);
        alert.kubernetesClusters = stubsOf(
          KubernetesCluster,
          draft.kubernetesClusterIds,
        );
        alert.dockerHosts = stubsOf(DockerHost, draft.dockerHostIds);
        alert.podmanHosts = stubsOf(PodmanHost, draft.podmanHostIds);
        alert.services = stubsOf(ServiceModel, draft.serviceIds);

        return (await AlertOwnerRuleEngineService.previewRules(
          alert,
        )) as unknown as Array<OwnerRulePlanEntry<BaseModel>>;
      }
      case OwnerRulePreviewEvent.IncidentEpisode: {
        const episode: IncidentEpisode = new IncidentEpisode();
        episode.projectId = data.projectId;
        episode.title = draft.title;
        episode.description = draft.description;

        if (severityId) {
          episode.incidentSeverityId = severityId;
        }

        episode.labels = stubsOf(Label, draft.labelIds);

        return (await IncidentEpisodeOwnerRuleEngineService.previewRules(
          episode,
        )) as unknown as Array<OwnerRulePlanEntry<BaseModel>>;
      }
      case OwnerRulePreviewEvent.AlertEpisode: {
        const episode: AlertEpisode = new AlertEpisode();
        episode.projectId = data.projectId;
        episode.title = draft.title;
        episode.description = draft.description;

        if (severityId) {
          episode.alertSeverityId = severityId;
        }

        episode.labels = stubsOf(Label, draft.labelIds);

        return (await AlertEpisodeOwnerRuleEngineService.previewRules(
          episode,
        )) as unknown as Array<OwnerRulePlanEntry<BaseModel>>;
      }
    }
  }

  /*
   * Every record the draft names is the project's, read as OneUptime: an
   * id of another project's record - or of none - is refused in the same
   * words, before any rule is read.
   */
  private static async assertDraftInProject(data: {
    event: OwnerRulePreviewEvent;
    projectId: ObjectID;
    draft: OwnerRulePreviewDraft;
  }): Promise<void> {
    const definition: EventDefinition = getEventDefinition(data.event);

    const checks: Array<Promise<void>> = getDraftListDefinitions()
      .filter((list: DraftListDefinition): boolean => {
        return data.draft[list.key].length > 0;
      })
      .map((list: DraftListDefinition): Promise<void> => {
        return OwnerRulePreviewBuilder.assertInProject({
          ids: data.draft[list.key],
          projectId: data.projectId,
          service: list.service,
          notFound: `One or more of these ${list.name} were not found in this project.`,
        });
      });

    if (data.draft.severityId) {
      checks.push(
        OwnerRulePreviewBuilder.assertInProject({
          ids: [data.draft.severityId],
          projectId: data.projectId,
          service: definition.severityService,
          notFound: definition.severityNotFound,
        }),
      );
    }

    await Promise.all(checks);
  }

  private static async assertInProject(data: {
    ids: Array<string>;
    projectId: ObjectID;
    service: DatabaseService<BaseModel>;
    // The answer when one is not the project's, or is none.
    notFound: string;
  }): Promise<void> {
    const found: Array<BaseModel> = await data.service.findBy({
      query: {
        _id: QueryHelper.any(
          data.ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
        projectId: data.projectId,
      } as unknown as Query<BaseModel>,
      select: {
        _id: true,
      },
      limit: data.ids.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const foundIds: Set<string> = new Set<string>(
      found.map((row: BaseModel): string => {
        return row.id?.toString().toLowerCase() || "";
      }),
    );

    const isEveryOneFound: boolean = data.ids.every((id: string): boolean => {
      return foundIds.has(id.toLowerCase());
    });

    if (!isEveryOneFound) {
      throw new BadDataException(data.notFound);
    }
  }

  private static parseText(value: unknown, name: string): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new BadDataException(`${name} must be text.`);
    }

    return value;
  }

  // An id as text, checked.
  private static parseId(value: unknown, name: string): string {
    const id: string = typeof value === "string" ? value.trim() : "";

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(`${name} must be a valid ID.`);
    }

    return id.toLowerCase();
  }

  // A list of ids, each once, in the order sent.
  private static parseIds(value: unknown, name: string): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(`${name} must be a list of IDs.`);
    }

    if (value.length > OwnerRulePreview.maxIdsPerList) {
      throw new BadDataException(
        `${name} can list at most ${OwnerRulePreview.maxIdsPerList} IDs.`,
      );
    }

    const ids: Array<string> = [];

    for (const item of value) {
      const id: string = OwnerRulePreviewBuilder.parseId(item, name);

      if (!ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }
}
