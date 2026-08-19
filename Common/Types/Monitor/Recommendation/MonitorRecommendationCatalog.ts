import MonitorStep from "../MonitorStep";
import MonitorType from "../MonitorType";
import IconProp from "../../Icon/IconProp";
import RecommendationType from "../../Recommendation/RecommendationType";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
  MonitorRecommendationSeverity,
  buildRecommendationId,
} from "./MonitorRecommendationTypes";

import {
  CephAlertTemplate,
  getAllCephAlertTemplates,
} from "../CephAlertTemplates";
import {
  DockerAlertTemplate,
  getAllDockerAlertTemplates,
} from "../DockerAlertTemplates";
import {
  DockerSwarmAlertTemplate,
  getAllDockerSwarmAlertTemplates,
} from "../DockerSwarmAlertTemplates";
import {
  HostAlertTemplate,
  getAllHostAlertTemplates,
} from "../HostAlertTemplates";
import {
  IoTAlertTemplate,
  getAllIoTAlertTemplates,
} from "../IotAlertTemplates";
import {
  KubernetesAlertTemplate,
  getAllKubernetesAlertTemplates,
} from "../KubernetesAlertTemplates";
import {
  PodmanAlertTemplate,
  getAllPodmanAlertTemplates,
} from "../PodmanAlertTemplates";
import {
  ProxmoxAlertTemplate,
  getAllProxmoxAlertTemplates,
} from "../ProxmoxAlertTemplates";
import {
  RumAlertTemplate,
  getAllRumAlertTemplates,
} from "../RumAlertTemplates";
import {
  ServiceAlertTemplate,
  getAllServiceAlertTemplates,
  getServiceAlertTemplates,
} from "../ServiceAlertTemplates";

/*
 * A resource type's entry in the registry.
 *
 * `identifierFieldName` is documentation that the tests enforce: it names the
 * field the underlying module's `<X>AlertTemplateArgs` actually uses, so that
 * a future rename in a template module fails a test here instead of silently
 * producing monitors scoped to `undefined`.
 */
export interface MonitorRecommendationResourceTypeDefinition {
  resourceType: MonitorRecommendationResourceType;
  /*
   * Infrastructure recommendations all use their resource's dedicated
   * MonitorType. RUM recommendations intentionally span Metrics, Traces and
   * Exceptions, so coverage queries must consider every type in this list.
   */
  monitorTypes: Array<MonitorType>;
  // Human label, singular, e.g. "Kubernetes Cluster".
  resourceLabel: string;
  // The field name in the owning module's own args interface.
  identifierFieldName:
    | "clusterIdentifier"
    | "hostIdentifier"
    | "fleetIdentifier"
    | "rumApplicationId"
    | "serviceId";
  icon: IconProp;
  /*
   * What to recommend for ONE resource of this type.
   *
   * Nine of the ten resource types ignore the argument entirely — every
   * Kubernetes cluster is offered the same eighteen recommendations, and a
   * zero-argument function satisfies this type, so those nine are declared
   * exactly as they were. Services are the exception: see
   * `MonitorRecommendationContext`.
   *
   * Passing no context means "nothing is known about this resource", and the
   * only honest answer to that is the context-free subset. It does NOT mean
   * "give me everything" — that is what `getAllPossibleRecommendations` is
   * for, and conflating the two is how a UI ends up offering JVM monitors to
   * a Go service.
   */
  getRecommendations: (
    context?: MonitorRecommendationContext | undefined,
  ) => Array<MonitorRecommendation>;
  /*
   * Every recommendation this resource type can EVER produce, across every
   * context. Only worth setting on a resource type whose set actually varies;
   * `getAllRecommendations` falls back to `getRecommendations()` for the rest.
   *
   * This is what the registry-wide invariants have to run against — globally
   * unique recommendation ids, globally distinct coverage fingerprints,
   * a severity every mapper understands. Running them over the context-free
   * subset instead would leave every language-specific template unchecked,
   * which is precisely the set most likely to collide.
   */
  getAllPossibleRecommendations?:
    | (() => Array<MonitorRecommendation>)
    | undefined;
}

/*
 * The structural shape every `<X>AlertTemplate` interface shares. The ten
 * modules declare ten separate interfaces that differ only in the literal
 * union used for `category` (and the args type of `getMonitorStep`), so the
 * normalizer below widens `category` to `string` rather than trying to union
 * ten unrelated literal unions.
 */
interface StructuralAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: MonitorRecommendationSeverity;
}

type MonitorStepBuilder = (args: MonitorRecommendationArgs) => MonitorStep;

function normalize(data: {
  resourceType: MonitorRecommendationResourceType;
  monitorType: MonitorType;
  template: StructuralAlertTemplate;
  getMonitorStep: MonitorStepBuilder;
}): MonitorRecommendation {
  return {
    recommendationId: buildRecommendationId(
      data.resourceType,
      data.template.id,
    ),
    recommendationType: RecommendationType.Monitor,
    resourceType: data.resourceType,
    monitorType: data.monitorType,
    templateId: data.template.id,
    name: data.template.name,
    description: data.template.description,
    category: data.template.category,
    severity: data.template.severity,
    getMonitorStep: data.getMonitorStep,
  };
}

/*
 * One adapter per module. Each is deliberately written out rather than
 * generated from a lookup table: the args field rename is the only thing that
 * differs, and doing it explicitly keeps every call site fully type-checked
 * against that module's real args interface. A generic version would need
 * `any` and would not catch a renamed field.
 */

function getKubernetesRecommendations(): Array<MonitorRecommendation> {
  return getAllKubernetesAlertTemplates().map(
    (template: KubernetesAlertTemplate) => {
      return normalize({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        monitorType: MonitorType.Kubernetes,
        template: template,
        getMonitorStep: (args: MonitorRecommendationArgs) => {
          return template.getMonitorStep({
            clusterIdentifier: args.resourceIdentifier,
            onlineMonitorStatusId: args.onlineMonitorStatusId,
            offlineMonitorStatusId: args.offlineMonitorStatusId,
            defaultIncidentSeverityId: args.defaultIncidentSeverityId,
            defaultAlertSeverityId: args.defaultAlertSeverityId,
            monitorName: args.monitorName,
          });
        },
      });
    },
  );
}

function getHostRecommendations(): Array<MonitorRecommendation> {
  return getAllHostAlertTemplates().map((template: HostAlertTemplate) => {
    return normalize({
      resourceType: MonitorRecommendationResourceType.Host,
      monitorType: MonitorType.Host,
      template: template,
      getMonitorStep: (args: MonitorRecommendationArgs) => {
        return template.getMonitorStep({
          hostIdentifier: args.resourceIdentifier,
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          defaultIncidentSeverityId: args.defaultIncidentSeverityId,
          defaultAlertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
        });
      },
    });
  });
}

function getDockerRecommendations(): Array<MonitorRecommendation> {
  return getAllDockerAlertTemplates().map((template: DockerAlertTemplate) => {
    return normalize({
      resourceType: MonitorRecommendationResourceType.Docker,
      monitorType: MonitorType.Docker,
      template: template,
      getMonitorStep: (args: MonitorRecommendationArgs) => {
        return template.getMonitorStep({
          hostIdentifier: args.resourceIdentifier,
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          defaultIncidentSeverityId: args.defaultIncidentSeverityId,
          defaultAlertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
        });
      },
    });
  });
}

function getDockerSwarmRecommendations(): Array<MonitorRecommendation> {
  return getAllDockerSwarmAlertTemplates().map(
    (template: DockerSwarmAlertTemplate) => {
      return normalize({
        resourceType: MonitorRecommendationResourceType.DockerSwarm,
        monitorType: MonitorType.DockerSwarm,
        template: template,
        getMonitorStep: (args: MonitorRecommendationArgs) => {
          return template.getMonitorStep({
            clusterIdentifier: args.resourceIdentifier,
            onlineMonitorStatusId: args.onlineMonitorStatusId,
            offlineMonitorStatusId: args.offlineMonitorStatusId,
            defaultIncidentSeverityId: args.defaultIncidentSeverityId,
            defaultAlertSeverityId: args.defaultAlertSeverityId,
            monitorName: args.monitorName,
          });
        },
      });
    },
  );
}

function getPodmanRecommendations(): Array<MonitorRecommendation> {
  return getAllPodmanAlertTemplates().map((template: PodmanAlertTemplate) => {
    return normalize({
      resourceType: MonitorRecommendationResourceType.Podman,
      monitorType: MonitorType.Podman,
      template: template,
      getMonitorStep: (args: MonitorRecommendationArgs) => {
        return template.getMonitorStep({
          hostIdentifier: args.resourceIdentifier,
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          defaultIncidentSeverityId: args.defaultIncidentSeverityId,
          defaultAlertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
        });
      },
    });
  });
}

function getProxmoxRecommendations(): Array<MonitorRecommendation> {
  return getAllProxmoxAlertTemplates().map((template: ProxmoxAlertTemplate) => {
    return normalize({
      resourceType: MonitorRecommendationResourceType.Proxmox,
      monitorType: MonitorType.Proxmox,
      template: template,
      getMonitorStep: (args: MonitorRecommendationArgs) => {
        return template.getMonitorStep({
          clusterIdentifier: args.resourceIdentifier,
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          defaultIncidentSeverityId: args.defaultIncidentSeverityId,
          defaultAlertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
        });
      },
    });
  });
}

function getCephRecommendations(): Array<MonitorRecommendation> {
  return getAllCephAlertTemplates().map((template: CephAlertTemplate) => {
    return normalize({
      resourceType: MonitorRecommendationResourceType.Ceph,
      monitorType: MonitorType.Ceph,
      template: template,
      getMonitorStep: (args: MonitorRecommendationArgs) => {
        return template.getMonitorStep({
          clusterIdentifier: args.resourceIdentifier,
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          defaultIncidentSeverityId: args.defaultIncidentSeverityId,
          defaultAlertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
        });
      },
    });
  });
}

function getIoTRecommendations(): Array<MonitorRecommendation> {
  return getAllIoTAlertTemplates().map((template: IoTAlertTemplate) => {
    return normalize({
      resourceType: MonitorRecommendationResourceType.IoTDevice,
      monitorType: MonitorType.IoTDevice,
      template: template,
      getMonitorStep: (args: MonitorRecommendationArgs) => {
        return template.getMonitorStep({
          fleetIdentifier: args.resourceIdentifier,
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          defaultIncidentSeverityId: args.defaultIncidentSeverityId,
          defaultAlertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
        });
      },
    });
  });
}

function getRumRecommendations(): Array<MonitorRecommendation> {
  return getAllRumAlertTemplates().map((template: RumAlertTemplate) => {
    return normalize({
      resourceType: MonitorRecommendationResourceType.RumApplication,
      monitorType: template.monitorType,
      template: template,
      getMonitorStep: (args: MonitorRecommendationArgs) => {
        return template.getMonitorStep({
          rumApplicationId: args.resourceIdentifier,
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          defaultIncidentSeverityId: args.defaultIncidentSeverityId,
          defaultAlertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
        });
      },
    });
  });
}

/*
 * The Service adapter, and the only one that is two functions rather than one.
 *
 * `getServiceRecommendations` answers "what should THIS service be offered",
 * which depends on its runtime. `getAllServiceRecommendations` answers "what
 * can a service ever be offered", which does not. Both go through the same
 * normalizer so a template cannot be shaped differently depending on which
 * door it came through.
 */
function normalizeServiceTemplate(
  template: ServiceAlertTemplate,
): MonitorRecommendation {
  return normalize({
    resourceType: MonitorRecommendationResourceType.Service,
    /*
     * Read off the template rather than fixed, because the service catalog —
     * like RUM's — deliberately spans metric, trace and exception monitors.
     */
    monitorType: template.monitorType,
    template: template,
    getMonitorStep: (args: MonitorRecommendationArgs) => {
      return template.getMonitorStep({
        serviceId: args.resourceIdentifier,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
        monitorName: args.monitorName,
      });
    },
  });
}

function getServiceRecommendations(
  context?: MonitorRecommendationContext | undefined,
): Array<MonitorRecommendation> {
  return getServiceAlertTemplates(context?.serviceLanguage).map(
    (template: ServiceAlertTemplate) => {
      return normalizeServiceTemplate(template);
    },
  );
}

function getAllServiceRecommendations(): Array<MonitorRecommendation> {
  return getAllServiceAlertTemplates().map((template: ServiceAlertTemplate) => {
    return normalizeServiceTemplate(template);
  });
}

const RESOURCE_TYPE_DEFINITIONS: Array<MonitorRecommendationResourceTypeDefinition> =
  [
    {
      resourceType: MonitorRecommendationResourceType.Kubernetes,
      monitorTypes: [MonitorType.Kubernetes],
      resourceLabel: "Kubernetes Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.Kubernetes,
      getRecommendations: getKubernetesRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Host,
      monitorTypes: [MonitorType.Host],
      resourceLabel: "Host",
      identifierFieldName: "hostIdentifier",
      icon: IconProp.Server,
      getRecommendations: getHostRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Docker,
      monitorTypes: [MonitorType.Docker],
      resourceLabel: "Docker Host",
      identifierFieldName: "hostIdentifier",
      icon: IconProp.Docker,
      getRecommendations: getDockerRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.DockerSwarm,
      monitorTypes: [MonitorType.DockerSwarm],
      resourceLabel: "Docker Swarm Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.DockerSwarm,
      getRecommendations: getDockerSwarmRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Podman,
      monitorTypes: [MonitorType.Podman],
      resourceLabel: "Podman Host",
      identifierFieldName: "hostIdentifier",
      icon: IconProp.Podman,
      getRecommendations: getPodmanRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Proxmox,
      monitorTypes: [MonitorType.Proxmox],
      resourceLabel: "Proxmox Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.Server,
      getRecommendations: getProxmoxRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Ceph,
      monitorTypes: [MonitorType.Ceph],
      resourceLabel: "Ceph Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.Database,
      getRecommendations: getCephRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.IoTDevice,
      monitorTypes: [MonitorType.IoTDevice],
      resourceLabel: "IoT Fleet",
      identifierFieldName: "fleetIdentifier",
      icon: IconProp.CPUChip,
      getRecommendations: getIoTRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.RumApplication,
      monitorTypes: [
        MonitorType.Metrics,
        MonitorType.Traces,
        MonitorType.Exceptions,
      ],
      resourceLabel: "RUM Application",
      identifierFieldName: "rumApplicationId",
      icon: IconProp.Globe,
      getRecommendations: getRumRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Service,
      monitorTypes: [
        MonitorType.Metrics,
        MonitorType.Traces,
        MonitorType.Exceptions,
      ],
      resourceLabel: "Service",
      identifierFieldName: "serviceId",
      icon: IconProp.Code,
      getRecommendations: getServiceRecommendations,
      getAllPossibleRecommendations: getAllServiceRecommendations,
    },
  ];

export default class MonitorRecommendationCatalog {
  public static getResourceTypeDefinitions(): Array<MonitorRecommendationResourceTypeDefinition> {
    return [...RESOURCE_TYPE_DEFINITIONS];
  }

  public static getResourceTypeDefinition(
    resourceType: MonitorRecommendationResourceType,
  ): MonitorRecommendationResourceTypeDefinition | undefined {
    return RESOURCE_TYPE_DEFINITIONS.find(
      (definition: MonitorRecommendationResourceTypeDefinition) => {
        return definition.resourceType === resourceType;
      },
    );
  }

  /*
   * What to offer ONE resource. `context` is what a caller knows about that
   * specific resource; omitting it is a valid answer meaning "nothing", and
   * yields the subset that is true of every resource of this type.
   */
  public static getRecommendations(
    resourceType: MonitorRecommendationResourceType,
    context?: MonitorRecommendationContext | undefined,
  ): Array<MonitorRecommendation> {
    const definition: MonitorRecommendationResourceTypeDefinition | undefined =
      this.getResourceTypeDefinition(resourceType);

    if (!definition) {
      return [];
    }

    return definition.getRecommendations(context);
  }

  /*
   * Every recommendation the catalog can produce, for any resource, in any
   * context.
   *
   * Deliberately takes no context. Its two jobs — resolving a
   * `recommendationId` back to its recommendation, and giving the
   * registry-wide invariant tests something exhaustive to run over — are both
   * jobs where filtering would silently weaken the answer. Resolving an id in
   * particular has to work from a dismissal row alone, which carries no
   * language.
   */
  public static getAllRecommendations(): Array<MonitorRecommendation> {
    return RESOURCE_TYPE_DEFINITIONS.flatMap(
      (definition: MonitorRecommendationResourceTypeDefinition) => {
        return definition.getAllPossibleRecommendations
          ? definition.getAllPossibleRecommendations()
          : definition.getRecommendations();
      },
    );
  }

  public static getRecommendationById(
    recommendationId: string,
  ): MonitorRecommendation | undefined {
    return this.getAllRecommendations().find(
      (recommendation: MonitorRecommendation) => {
        return recommendation.recommendationId === recommendationId;
      },
    );
  }

  /*
   * Distinct categories for a resource type, in the order the underlying
   * module declares its templates. Order matters for the UI: the modules list
   * their most important templates first, and the page renders category
   * sections in this order.
   */
  public static getCategories(
    resourceType: MonitorRecommendationResourceType,
    context?: MonitorRecommendationContext | undefined,
  ): Array<string> {
    const categories: Array<string> = [];

    for (const recommendation of this.getRecommendations(
      resourceType,
      context,
    )) {
      if (!categories.includes(recommendation.category)) {
        categories.push(recommendation.category);
      }
    }

    return categories;
  }
}
