import ComplianceFramework, {
  isComplianceFramework,
} from "./ComplianceFramework";
import { ComplianceScopeExclusions } from "./ComplianceRequirementCatalog";
import {
  DataStoreResourceKind,
  DataStoreResourceRef,
  getDataStoreResourceKey,
  isDataStoreResourceKind,
} from "./DataStoreResource";

/*
 * WHAT A RESOURCE TURNED OFF (#9555).
 *
 * Every framework is scored over the stores its data puts in scope
 * (ComplianceRequirementCatalog). A team knows things the data cannot: this
 * cluster holds no card data whatever a scan matched, these databases are
 * backed up by another system. So a resource can turn a framework off, or
 * one requirement of one, for itself - a Kubernetes cluster, a Docker or
 * Podman host, a database, a cloud resource or a service
 * (DataStoreResource.ts) - and each change is one row of
 * DataSecurityComplianceSetting.
 *
 * What is turned off applies to the stores whose compliance the resource
 * owns (getDataStoreComplianceOwner), everywhere they are scored: the
 * resource's own Compliance page and the project's. A framework turned off
 * takes those stores out of its scope; a requirement turned off stops its
 * open issues on them failing it, and reads "Turned off" where no store in
 * scope covers it any more. Turning either on again puts everything back.
 *
 * A setting written for a requirement its framework does not have, or for a
 * framework this version does not know, changes nothing.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

export interface ComplianceScopeSetting {
  resource: DataStoreResourceRef;
  framework: ComplianceFramework;
  // A requirement of the framework, or empty for the framework itself.
  requirement?: string | null | undefined;
  isEnabled: boolean;
}

// A store as scoping reads it: its id, and the resource its compliance is set on.
export interface ComplianceScopeStore {
  id: string;
  owner: DataStoreResourceRef | null;
}

// The requirement a setting names, or "" for its whole framework.
export function getSettingRequirement(
  setting: Pick<ComplianceScopeSetting, "requirement">,
): string {
  return typeof setting.requirement === "string"
    ? setting.requirement.trim()
    : "";
}

/*
 * The stores and requirements one framework leaves out: those whose owner
 * turned it off, or turned one of its requirements off. A setting that is
 * on (or about another framework) leaves nothing out.
 */
export function getComplianceScopeExclusions(
  framework: ComplianceFramework,
  stores: ReadonlyArray<ComplianceScopeStore>,
  settings: ReadonlyArray<ComplianceScopeSetting>,
): ComplianceScopeExclusions {
  const storesByOwner: Map<string, Array<string>> = new Map();

  for (const store of stores) {
    if (!store.owner) {
      continue;
    }

    const key: string = getDataStoreResourceKey(store.owner);
    const ids: Array<string> = storesByOwner.get(key) || [];
    ids.push(store.id);
    storesByOwner.set(key, ids);
  }

  const storeIds: Set<string> = new Set();
  const requirementStoreIds: Map<string, Set<string>> = new Map();

  for (const setting of getEffectiveSettings(settings)) {
    if (setting.isEnabled || setting.framework !== framework) {
      continue;
    }

    const owned: Array<string> =
      storesByOwner.get(getDataStoreResourceKey(setting.resource)) || [];

    if (owned.length === 0) {
      continue;
    }

    const requirement: string = getSettingRequirement(setting);

    if (!requirement) {
      for (const id of owned) {
        storeIds.add(id);
      }
      continue;
    }

    const leftOut: Set<string> =
      requirementStoreIds.get(requirement) || new Set();

    for (const id of owned) {
      leftOut.add(id);
    }

    requirementStoreIds.set(requirement, leftOut);
  }

  return { storeIds, requirementStoreIds };
}

/*
 * One setting per resource, framework and requirement: the last one given
 * wins, as the server reads its rows oldest first, so a duplicate row an
 * older version wrote cannot keep a framework off once it was turned on.
 */
export function getEffectiveSettings(
  settings: ReadonlyArray<ComplianceScopeSetting>,
): Array<ComplianceScopeSetting> {
  const byKey: Map<string, ComplianceScopeSetting> = new Map();

  for (const setting of settings) {
    byKey.set(getComplianceSettingKey(setting), setting);
  }

  return Array.from(byKey.values());
}

export function getComplianceSettingKey(
  setting: Pick<
    ComplianceScopeSetting,
    "resource" | "framework" | "requirement"
  >,
): string {
  return [
    getDataStoreResourceKey(setting.resource),
    setting.framework,
    getSettingRequirement(setting),
  ].join("|");
}

/*
 * What one resource turned off of one framework, as its Compliance page
 * draws it: the framework itself, and the requirements it turned off.
 */
export interface ResourceFrameworkScope {
  isTurnedOff: boolean;
  turnedOffRequirements: Array<string>;
}

export function getResourceFrameworkScope(
  resource: DataStoreResourceRef,
  framework: ComplianceFramework,
  settings: ReadonlyArray<ComplianceScopeSetting>,
): ResourceFrameworkScope {
  const resourceKey: string = getDataStoreResourceKey(resource);
  let isTurnedOff: boolean = false;
  const turnedOffRequirements: Array<string> = [];

  for (const setting of getEffectiveSettings(settings)) {
    if (
      setting.isEnabled ||
      setting.framework !== framework ||
      getDataStoreResourceKey(setting.resource) !== resourceKey
    ) {
      continue;
    }

    const requirement: string = getSettingRequirement(setting);

    if (requirement) {
      turnedOffRequirements.push(requirement);
    } else {
      isTurnedOff = true;
    }
  }

  return { isTurnedOff, turnedOffRequirements };
}

/*
 * A stored setting row read defensively: a resource of a kind this version
 * knows, with an id, a framework it knows, and whether it is on. Anything
 * else is null and changes nothing.
 */
export function readComplianceScopeSetting(row: {
  resourceType?: unknown;
  resourceId?: unknown;
  framework?: unknown;
  requirement?: unknown;
  isEnabled?: unknown;
}): ComplianceScopeSetting | null {
  const resourceId: string =
    row.resourceId === undefined || row.resourceId === null
      ? ""
      : String(row.resourceId).trim();

  if (
    !isDataStoreResourceKind(row.resourceType) ||
    !resourceId ||
    !isComplianceFramework(row.framework)
  ) {
    return null;
  }

  return {
    resource: {
      kind: row.resourceType as DataStoreResourceKind,
      id: resourceId,
    },
    framework: row.framework,
    requirement:
      typeof row.requirement === "string" ? row.requirement.trim() : "",
    isEnabled: row.isEnabled !== false,
  };
}
