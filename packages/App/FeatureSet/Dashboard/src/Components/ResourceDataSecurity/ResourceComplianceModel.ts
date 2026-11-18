import ComplianceFramework from "Common/Types/DataSecurity/ComplianceFramework";
import { DataSecurityResourceComplianceFramework } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";

/*
 * WHAT A RESOURCE'S COMPLIANCE PAGE DRAWS (#9555), worked out without React
 * so a plain test pins it: which frameworks come first, which fold away,
 * where each switch stands, and the words for where a database's switches
 * are set.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * Common/UI/Utils/TranslateTemplate's translationKey does. Each is looked
 * up where it is drawn.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// One switch: a framework, or one of its requirements.
export interface ComplianceSwitchKey {
  framework: ComplianceFramework;
  requirement?: string | null | undefined;
}

export function getComplianceSwitchKey(key: ComplianceSwitchKey): string {
  return `${key.framework}|${(key.requirement || "").trim()}`;
}

export interface ResourceFrameworkSections {
  // In scope and on: tiles to pick, first.
  applying: Array<DataSecurityResourceComplianceFramework>;
  // Turned off for the resource, with a switch to turn each on again.
  turnedOff: Array<DataSecurityResourceComplianceFramework>;
  // On, but no data here puts it in scope.
  notInScope: Array<DataSecurityResourceComplianceFramework>;
}

/*
 * The frameworks, in the catalog's order, as the page sorts them: those the
 * resource's data puts in scope and that are on; those turned off for it;
 * and those no store of it holds data for.
 */
export function splitResourceFrameworks(
  frameworks: ReadonlyArray<DataSecurityResourceComplianceFramework>,
): ResourceFrameworkSections {
  const sections: ResourceFrameworkSections = {
    applying: [],
    turnedOff: [],
    notInScope: [],
  };

  for (const framework of frameworks) {
    if (framework.isTurnedOff) {
      sections.turnedOff.push(framework);
    } else if (framework.storesInScope > 0) {
      sections.applying.push(framework);
    } else {
      sections.notInScope.push(framework);
    }
  }

  return sections;
}

/*
 * Where a switch stands: a framework is on unless the resource turned it
 * off, a requirement unless the resource turned it off.
 */
export function getAppliesSwitchState(
  framework: DataSecurityResourceComplianceFramework,
  key: ComplianceSwitchKey,
): boolean {
  if (framework.isTurnedOff) {
    return false;
  }

  const requirement: string = (key.requirement || "").trim();

  if (!requirement) {
    return true;
  }

  return !framework.turnedOffRequirements.includes(requirement);
}

// Where a database's switches are, when it runs on a cluster or a container host.
export const SET_ON_OWNER_SENTENCES: Readonly<
  Partial<Record<DataStoreResourceKind, string>>
> = {
  [DataStoreResourceKind.KubernetesCluster]: translationKey(
    "Turned on and off for the Kubernetes cluster this database runs on.",
  ),
  [DataStoreResourceKind.DockerHost]: translationKey(
    "Turned on and off for the Docker host this database runs on.",
  ),
  [DataStoreResourceKind.PodmanHost]: translationKey(
    "Turned on and off for the Podman host this database runs on.",
  ),
};

// The notice above a database's frameworks, naming its cluster or host.
export const OWNER_NOTICE_TEMPLATES: Readonly<
  Partial<Record<DataStoreResourceKind, string>>
> = {
  [DataStoreResourceKind.KubernetesCluster]: translationKey(
    "This database runs on the Kubernetes cluster {{name}}, whose Compliance page turns frameworks on and off for every database on it.",
  ),
  [DataStoreResourceKind.DockerHost]: translationKey(
    "This database runs on the Docker host {{name}}, whose Compliance page turns frameworks on and off for every database on it.",
  ),
  [DataStoreResourceKind.PodmanHost]: translationKey(
    "This database runs on the Podman host {{name}}, whose Compliance page turns frameworks on and off for every database on it.",
  ),
};
