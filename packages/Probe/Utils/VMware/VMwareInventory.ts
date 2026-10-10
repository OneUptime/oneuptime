import {
  MoRef,
  PerfEntityMetric,
  VSphereAbout,
  VSphereObject,
  readMoRef,
} from "./VSphereSoapClient";
import VSphereXml, { XmlElement } from "./VSphereXml";

/*
 * What one collection read from vSphere, before it becomes OpenTelemetry
 * metrics (VMwareOtlpBuilder) - the same objects and properties the VMware
 * agent's vcenter receiver reads through govmomi, held per datacenter as the
 * receiver processes them.
 *
 * The readers below turn a property collector's answer (VSphereObject) into
 * these shapes: numbers as numbers, a property vSphere did not return as
 * null (never as 0 - "not reported" and "zero" are different answers), and
 * references by their managed object id.
 */

export interface VMwareDatastore {
  ref: MoRef;
  name: string;
  capacity: number | null;
  freeSpace: number | null;
}

export interface VMwareComputeResource {
  ref: MoRef;
  name: string;
  isCluster: boolean;
  hostRefs: Array<string>;
  totalCpu: number | null;
  totalMemory: number | null;
  effectiveCpu: number | null;
  effectiveMemory: number | null;
  numHosts: number | null;
  numEffectiveHosts: number | null;
  overallStatus: string | null;
  vsanEnabled: boolean;
  vsanUuid: string | null;
}

export interface VMwareHost {
  ref: MoRef;
  name: string;
  powerState: string | null;
  memorySize: number | null;
  numCpuCores: number | null;
  cpuMhz: number | null;
  vsanNodeUuid: string | null;
  overallMemoryUsage: number | null;
  overallCpuUsage: number | null;
  overallStatus: string | null;
  vmRefs: Array<string>;
  parentRef: string | null;
}

export interface VMwareResourcePoolQuickStats {
  overallCpuUsage: number | null;
  guestMemoryUsage: number | null;
  hostMemoryUsage: number | null;
  overheadMemory: number | null;
  swappedMemory: number | null;
  balloonedMemory: number | null;
  privateMemory: number | null;
  sharedMemory: number | null;
}

export interface VMwareResourcePool {
  ref: MoRef;
  isVirtualApp: boolean;
  name: string;
  ownerRef: string | null;
  inventoryPath: string | null;
  cpuShares: number | null;
  memoryShares: number | null;
  quickStats: VMwareResourcePoolQuickStats | null;
}

export interface VMwareVirtualMachine {
  ref: MoRef;
  name: string;
  // Whether vSphere returned the VM's config at all (an inaccessible VM has none).
  hasConfig: boolean;
  numCpu: number | null;
  instanceUuid: string | null;
  isTemplate: boolean;
  powerState: string | null;
  maxCpuUsage: number | null;
  guestMemoryUsage: number | null;
  balloonedMemory: number | null;
  swappedMemory: number | null;
  ssdSwappedMemory: number | null;
  grantedMemory: number | null;
  overallCpuUsage: number | null;
  overallCpuReadiness: number | null;
  overallStatus: string | null;
  memorySizeMB: number | null;
  hasStorage: boolean;
  storageCommitted: number | null;
  storageUncommitted: number | null;
  hostRef: string | null;
  resourcePoolRef: string | null;
}

// vSAN's samples for one entity (a cluster, host or VM), by metric label.
export interface VMwareVsanMetric {
  label: string;
  intervalInSeconds: number;
  timestamps: Array<Date>;
  values: Array<number>;
}

export interface VMwareVsanResults {
  clustersByUuid: Map<string, Array<VMwareVsanMetric>>;
  hostsByUuid: Map<string, Array<VMwareVsanMetric>>;
  vmsByUuid: Map<string, Array<VMwareVsanMetric>>;
}

export interface VMwareDatacenter {
  ref: MoRef;
  name: string;
  datastores: Array<VMwareDatastore>;
  computes: Map<string, VMwareComputeResource>;
  hosts: Map<string, VMwareHost>;
  resourcePools: Map<string, VMwareResourcePool>;
  vms: Map<string, VMwareVirtualMachine>;
  hostPerf: Map<string, PerfEntityMetric>;
  vmPerf: Map<string, PerfEntityMetric>;
  vsan: VMwareVsanResults;
}

export interface VMwareInventorySnapshot {
  about: {
    name: string | null;
    fullName: string | null;
    version: string | null;
    build: string | null;
    apiType: string | null;
    apiVersion: string | null;
    instanceUuid: string | null;
  };
  datacenters: Array<VMwareDatacenter>;
  // Performance counter names by id, for the samples above.
  counterNames: Map<number, string>;
  collectedAt: Date;
  // Parts left out without failing the collection, in words.
  warnings: Array<string>;
}

export function emptyVsanResults(): VMwareVsanResults {
  return {
    clustersByUuid: new Map(),
    hostsByUuid: new Map(),
    vmsByUuid: new Map(),
  };
}

export function aboutFromServiceContent(
  about: VSphereAbout,
): VMwareInventorySnapshot["about"] {
  return { ...about };
}

/*
 * A property as a number: a vSphere number (int, long, short ...) read from
 * its text. Null when vSphere did not return the property or it is not a
 * number.
 */
export function readNumber(
  object: VSphereObject,
  path: string,
): number | null {
  const element: XmlElement | undefined = object.properties.get(path);

  if (!element) {
    return null;
  }

  return parseNumber(element.text);
}

export function parseNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined) {
    return null;
  }

  const trimmed: string = text.trim();

  if (!trimmed) {
    return null;
  }

  const value: number = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function readString(
  object: VSphereObject,
  path: string,
): string | null {
  const element: XmlElement | undefined = object.properties.get(path);
  return element ? element.text : null;
}

export function readBoolean(object: VSphereObject, path: string): boolean {
  const element: XmlElement | undefined = object.properties.get(path);
  return element ? element.text.trim() === "true" : false;
}

export function readRefValue(
  object: VSphereObject,
  path: string,
): string | null {
  return readMoRef(object.properties.get(path))?.value || null;
}

export function readRefList(
  object: VSphereObject,
  path: string,
): Array<string> {
  const element: XmlElement | undefined = object.properties.get(path);

  if (!element) {
    return [];
  }

  return element.children
    .map((child: XmlElement): string | null => {
      return readMoRef(child)?.value || null;
    })
    .filter((value: string | null): value is string => {
      return value !== null;
    });
}

// A child of a data object property, as a number (e.g. summary -> totalCpu).
export function childNumber(
  element: XmlElement | null | undefined,
  names: Array<string>,
): number | null {
  return parseNumber(VSphereXml.path(element, names)?.text);
}

/*
 * The inventory path of an entity, as govmomi's finder spells it -
 * "/<datacenter>/host/<cluster>/Resources/<pool>": every name from the
 * entity up to, and not including, the root folder. A name holds a "/" as
 * "%2f" already: vSphere escapes it in the name itself.
 */
export function getInventoryPath(data: {
  ref: string;
  rootFolder: string;
  names: Map<string, string>;
  parents: Map<string, string | null>;
}): string | null {
  const names: Array<string> = [];
  let current: string | null = data.ref;
  const seen: Set<string> = new Set();

  while (current && current !== data.rootFolder) {
    if (seen.has(current)) {
      return null;
    }

    seen.add(current);

    const name: string | undefined = data.names.get(current);

    if (name === undefined) {
      return null;
    }

    names.unshift(name);
    current = data.parents.get(current) ?? null;
  }

  if (current !== data.rootFolder) {
    return null;
  }

  return `/${names.join("/")}`;
}
