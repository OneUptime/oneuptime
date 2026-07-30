import MonitorStep from "../MonitorStep";
import MonitorType from "../MonitorType";
import IconProp from "../../Icon/IconProp";
import RecommendationType from "../../Recommendation/RecommendationType";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
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
  monitorType: MonitorType;
  // Human label, singular, e.g. "Kubernetes Cluster".
  resourceLabel: string;
  // The field name in the owning module's own args interface.
  identifierFieldName:
    | "clusterIdentifier"
    | "hostIdentifier"
    | "fleetIdentifier";
  icon: IconProp;
  getRecommendations: () => Array<MonitorRecommendation>;
}

/*
 * The structural shape every `<X>AlertTemplate` interface shares. The eight
 * modules declare eight separate interfaces that differ only in the literal
 * union used for `category` (and the args type of `getMonitorStep`), so the
 * normalizer below widens `category` to `string` rather than trying to union
 * eight unrelated literal unions.
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

const RESOURCE_TYPE_DEFINITIONS: Array<MonitorRecommendationResourceTypeDefinition> =
  [
    {
      resourceType: MonitorRecommendationResourceType.Kubernetes,
      monitorType: MonitorType.Kubernetes,
      resourceLabel: "Kubernetes Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.Kubernetes,
      getRecommendations: getKubernetesRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Host,
      monitorType: MonitorType.Host,
      resourceLabel: "Host",
      identifierFieldName: "hostIdentifier",
      icon: IconProp.Server,
      getRecommendations: getHostRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Docker,
      monitorType: MonitorType.Docker,
      resourceLabel: "Docker Host",
      identifierFieldName: "hostIdentifier",
      icon: IconProp.Docker,
      getRecommendations: getDockerRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.DockerSwarm,
      monitorType: MonitorType.DockerSwarm,
      resourceLabel: "Docker Swarm Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.DockerSwarm,
      getRecommendations: getDockerSwarmRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Podman,
      monitorType: MonitorType.Podman,
      resourceLabel: "Podman Host",
      identifierFieldName: "hostIdentifier",
      icon: IconProp.Podman,
      getRecommendations: getPodmanRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Proxmox,
      monitorType: MonitorType.Proxmox,
      resourceLabel: "Proxmox Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.Server,
      getRecommendations: getProxmoxRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.Ceph,
      monitorType: MonitorType.Ceph,
      resourceLabel: "Ceph Cluster",
      identifierFieldName: "clusterIdentifier",
      icon: IconProp.Database,
      getRecommendations: getCephRecommendations,
    },
    {
      resourceType: MonitorRecommendationResourceType.IoTDevice,
      monitorType: MonitorType.IoTDevice,
      resourceLabel: "IoT Fleet",
      identifierFieldName: "fleetIdentifier",
      icon: IconProp.CPUChip,
      getRecommendations: getIoTRecommendations,
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

  public static getRecommendations(
    resourceType: MonitorRecommendationResourceType,
  ): Array<MonitorRecommendation> {
    const definition: MonitorRecommendationResourceTypeDefinition | undefined =
      this.getResourceTypeDefinition(resourceType);

    if (!definition) {
      return [];
    }

    return definition.getRecommendations();
  }

  public static getAllRecommendations(): Array<MonitorRecommendation> {
    return RESOURCE_TYPE_DEFINITIONS.flatMap(
      (definition: MonitorRecommendationResourceTypeDefinition) => {
        return definition.getRecommendations();
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
  ): Array<string> {
    const categories: Array<string> = [];

    for (const recommendation of this.getRecommendations(resourceType)) {
      if (!categories.includes(recommendation.category)) {
        categories.push(recommendation.category);
      }
    }

    return categories;
  }
}
