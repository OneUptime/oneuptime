import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Host from "Common/Models/DatabaseModels/Host";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Service from "Common/Models/DatabaseModels/Service";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import DROPDOWN_MENU_Z_INDEX from "Common/UI/Components/Dropdown/DropdownMenuZIndex";
import Icon from "Common/UI/Components/Icon/Icon";
import { consumePressForAnchoredPopup } from "Common/UI/Types/LayeredDismissal";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import User from "Common/UI/Utils/User";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  ComposedValue,
  composedValue,
  translatableTerm,
  translateTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import {
  AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT,
  AFFECTED_RESOURCE_SEARCH_MAX_LIMIT,
  AffectedResourceKind,
  AffectedResourceSearchCount,
  AffectedResourceSearchKindResult,
  AffectedResourceSearchMatch,
  AffectedResourceSearchResult,
} from "Common/Types/AffectedResources/AffectedResourceSearch";
import { searchAffectedResources } from "./AffectedResourceSearchApi";

/*
 * Every kind the picker can offer: the kinds the server's one search reads
 * (Common/Types/AffectedResources/AffectedResourceSearch), so a kind the
 * picker shows is always one the search answers for.
 */
export type AffectedResourceType = `${AffectedResourceKind}`;

export interface AffectedResourceItem {
  _id: string;
  name: string;
  type: AffectedResourceType;
  /*
   * What tells two of one name apart in the results - a network device's
   * address. Results only; a chip names the resource alone.
   */
  detail?: string | undefined;
  /*
   * True while the picker is still looking up the name of a resource that
   * reached it as a bare ID. `name` is a placeholder until the lookup lands.
   */
  isNameLoading?: boolean | undefined;
}

/*
 * Shape that the picker passes to onChange. The wrapper sentinel lets the
 * form-level handler tell our payload apart from a regular Array<Monitor>
 * the form may produce or receive from the API.
 *
 * A type the picker shows is always an array. A type it does not show (the
 * viewer cannot read it, or the page left it out of `resourceTypes`) is the
 * prop handed in, as IDs, unchanged - and stays undefined if that prop was
 * undefined, so the page writes back exactly what the form already held.
 */
export interface AffectedResourcesPayload {
  __affectedResourcesPayload: true;
  monitors: Array<string> | undefined;
  hosts: Array<string> | undefined;
  networkDevices: Array<string> | undefined;
  kubernetesClusters: Array<string> | undefined;
  dockerHosts: Array<string> | undefined;
  podmanHosts: Array<string> | undefined;
  proxmoxClusters: Array<string> | undefined;
  vmwareVCenters: Array<string> | undefined;
  cephClusters: Array<string> | undefined;
  storageArrays: Array<string> | undefined;
  dockerSwarmClusters: Array<string> | undefined;
  iotFleets: Array<string> | undefined;
  databaseServers: Array<string> | undefined;
  cloudResources: Array<string> | undefined;
  networkSites: Array<string> | undefined;
  services: Array<string> | undefined;
}

type AffectedResourceArrayKey = Exclude<
  keyof AffectedResourcesPayload,
  "__affectedResourcesPayload"
>;

export interface ComponentProps {
  monitors?: Array<Monitor> | undefined;
  hosts?: Array<Host> | undefined;
  networkDevices?: Array<NetworkDevice> | undefined;
  kubernetesClusters?: Array<KubernetesCluster> | undefined;
  dockerHosts?: Array<DockerHost> | undefined;
  podmanHosts?: Array<PodmanHost> | undefined;
  proxmoxClusters?: Array<ProxmoxCluster> | undefined;
  vmwareVCenters?: Array<VMwareVCenter> | undefined;
  cephClusters?: Array<CephCluster> | undefined;
  storageArrays?: Array<StorageArray> | undefined;
  dockerSwarmClusters?: Array<DockerSwarmCluster> | undefined;
  iotFleets?: Array<IoTFleet> | undefined;
  databaseServers?: Array<DatabaseServer> | undefined;
  cloudResources?: Array<CloudResource> | undefined;
  networkSites?: Array<NetworkSite> | undefined;
  services?: Array<Service> | undefined;
  resourceTypes?: Array<AffectedResourceType> | undefined;
  onChange: (payload: AffectedResourcesPayload) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /*
   * Chips only: no search input and no remove buttons. For a summary that
   * should name the selection (the picker looks names up for bare IDs)
   * without offering to change it.
   */
  readOnly?: boolean | undefined;
  /*
   * The id of the label the search input is named by - a form field's own
   * label (CustomElementProps.ariaLabelledby). A step can hold two pickers,
   * Declare Incident's Monitors and Other Affected Resources, and a screen
   * reader tells them apart by their labels.
   */
  ariaLabelledby?: string | undefined;
  /*
   * The title of the form's own monitor field, when monitors are picked
   * there rather than here - Declare Incident's Monitors, Create Alert's
   * Monitor. A search here that also matches monitors then says so, and
   * where they are picked, instead of finding nothing (issue #5341).
   */
  monitorFieldTitle?: string | undefined;
}

interface ResourceConfig {
  // English, translated where it is drawn.
  label: string;
  pluralLabel: string;
  icon: IconProp;
  modelType: { new (): BaseModel };
  // The key holding this type's resources in ComponentProps and the payload.
  key: AffectedResourceArrayKey;
  /*
   * Whether the model carries a `labels` relation. The Labels tab bulk-adds
   * by querying `{ labels: Includes([...]) }`, which is a 400 against a
   * model with no such column — silently swallowed by fetchByQuery, but a
   * wasted round trip per label per expand. Types that opt out are simply
   * not offered to that query; they stay fully selectable by search.
   */
  supportsLabels: boolean;
}

const RESOURCE_CONFIG: Record<AffectedResourceType, ResourceConfig> = {
  Monitor: {
    label: "Monitor",
    pluralLabel: "Monitors",
    icon: IconProp.AltGlobe,
    modelType: Monitor,
    key: "monitors",
    supportsLabels: true,
  },
  Host: {
    label: "Host",
    pluralLabel: "Hosts",
    icon: IconProp.Server,
    modelType: Host,
    key: "hosts",
    supportsLabels: true,
  },
  NetworkDevice: {
    label: "Network Device",
    pluralLabel: "Network Devices",
    icon: IconProp.Signal,
    modelType: NetworkDevice,
    key: "networkDevices",
    supportsLabels: true,
  },
  KubernetesCluster: {
    label: "Kubernetes Cluster",
    pluralLabel: "Kubernetes Clusters",
    icon: IconProp.Kubernetes,
    modelType: KubernetesCluster,
    key: "kubernetesClusters",
    supportsLabels: true,
  },
  DockerHost: {
    label: "Docker Host",
    pluralLabel: "Docker Hosts",
    icon: IconProp.Docker,
    modelType: DockerHost,
    key: "dockerHosts",
    supportsLabels: true,
  },
  PodmanHost: {
    label: "Podman Host",
    pluralLabel: "Podman Hosts",
    icon: IconProp.Podman,
    modelType: PodmanHost,
    key: "podmanHosts",
    supportsLabels: true,
  },
  ProxmoxCluster: {
    label: "Proxmox Cluster",
    pluralLabel: "Proxmox Clusters",
    icon: IconProp.Proxmox,
    modelType: ProxmoxCluster,
    key: "proxmoxClusters",
    supportsLabels: true,
  },
  VMwareVCenter: {
    label: "vCenter",
    pluralLabel: "vCenters",
    icon: IconProp.VMware,
    modelType: VMwareVCenter,
    key: "vmwareVCenters",
    supportsLabels: true,
  },
  CephCluster: {
    label: "Ceph Cluster",
    pluralLabel: "Ceph Clusters",
    icon: IconProp.Ceph,
    modelType: CephCluster,
    key: "cephClusters",
    supportsLabels: true,
  },
  StorageArray: {
    label: "Storage Array",
    pluralLabel: "Storage Arrays",
    icon: IconProp.StorageArray,
    modelType: StorageArray,
    key: "storageArrays",
    supportsLabels: true,
  },
  DockerSwarmCluster: {
    label: "Docker Swarm Cluster",
    pluralLabel: "Docker Swarm Clusters",
    icon: IconProp.DockerSwarm,
    modelType: DockerSwarmCluster,
    key: "dockerSwarmClusters",
    supportsLabels: true,
  },
  IoTFleet: {
    label: "IoT Fleet",
    pluralLabel: "IoT Fleets",
    icon: IconProp.IoT,
    modelType: IoTFleet,
    key: "iotFleets",
    supportsLabels: true,
  },
  DatabaseServer: {
    label: "Database",
    pluralLabel: "Databases",
    icon: IconProp.Database,
    modelType: DatabaseServer,
    key: "databaseServers",
    supportsLabels: true,
  },
  CloudResource: {
    label: "Cloud Resource",
    pluralLabel: "Cloud Resources",
    icon: IconProp.Cloud,
    modelType: CloudResource,
    key: "cloudResources",
    supportsLabels: true,
  },
  NetworkSite: {
    label: "Network Site",
    pluralLabel: "Network Sites",
    icon: IconProp.BuildingOffice,
    modelType: NetworkSite,
    key: "networkSites",
    /*
     * NetworkSite has no labels relation — it is organised by its own
     * hierarchy instead, and attaching a parent covers everything under it.
     */
    supportsLabels: false,
  },
  Service: {
    label: "Service",
    pluralLabel: "Services",
    icon: IconProp.SquareStack,
    modelType: Service,
    key: "services",
    supportsLabels: true,
  },
};

/*
 * The default set. Proxmox / VMware / Ceph / Storage Array / Docker Swarm /
 * IoT / Database / Cloud Resource are deliberately NOT here: a page only
 * gets them by naming them in `resourceTypes`, because offering a type the
 * page's onChange handler does not write back would silently drop the
 * user's selection on save.
 */
const ALL_TYPES: Array<AffectedResourceType> = [
  "Monitor",
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "Service",
];

const SEARCH_DEBOUNCE_MS: number = 250;
/*
 * How many of each kind the results list: a page per kind while every kind
 * is shown, more once the person narrows to one kind.
 */
const SEARCH_LIMIT_PER_TYPE: number = AFFECTED_RESOURCE_SEARCH_DEFAULT_LIMIT;
const SEARCH_LIMIT_FOR_ONE_TYPE: number = AFFECTED_RESOURCE_SEARCH_MAX_LIMIT;
/*
 * Cap on rendered selected-chip nodes. Bulk label selection can attach
 * thousands of resources to one incident/alert; rendering every chip in a
 * flex-wrap above the input jank-locks the tab. Past this cap we show the
 * first MAX_VISIBLE_CHIPS and an overflow badge ("+N more selected") that
 * reveals the rest on demand. Selection state is unaffected — only the
 * DOM render is capped.
 */
const MAX_VISIBLE_CHIPS: number = 50;
/*
 * Chunk size for looking up the names of resources that reached the picker
 * as bare IDs. A bulk label add can attach thousands of resources to one
 * event, so the `_id IN (...)` list is split rather than sent in one go.
 */
export const NAME_LOOKUP_BATCH_SIZE: number = 100;

// An English key: a chip still waiting for its name shows it translated.
export const NAME_LOADING_PLACEHOLDER: string = translationKey("Loading...");

export const getUnnamedResourceLabel: (type: AffectedResourceType) => string = (
  type: AffectedResourceType,
): string => {
  return translateTemplate("Unnamed {{type}}", {
    type: translatableTerm(RESOURCE_CONFIG[type].label),
  });
};

/*
 * Shown when the name lookup could not find the resource (deleted, not
 * readable, or the request failed). Distinct from "Unnamed" on purpose: we
 * do not know that the resource has no name, only that we could not read it.
 */
export const getUnknownResourceLabel: (type: AffectedResourceType) => string = (
  type: AffectedResourceType,
): string => {
  return translateTemplate("Unknown {{type}}", {
    type: translatableTerm(RESOURCE_CONFIG[type].label),
  });
};

const getNameCacheKey: (type: AffectedResourceType, id: string) => string = (
  type: AffectedResourceType,
  id: string,
): string => {
  return `${type}:${id}`;
};

/*
 * Translate the resource arrays already attached to the parent entity into a
 * flat, typed list the picker can render. Server payloads sometimes hand us
 * BaseModel instances, sometimes plain objects, sometimes bare ID strings,
 * so we accept all three shapes. Bare IDs are the common case in an edit
 * form: ModelForm flattens every relation it loads into Array<string>, and
 * the form-level onChange that splits our payload writes Array<string> too.
 *
 * Names that arrive in objects are mirrored into nameCache so later renders
 * against bare IDs can still show them. A resource whose name is neither in
 * the object nor in the cache is marked isNameLoading, and the picker looks
 * it up; once that lookup has failed (failedLookups) it is shown as unknown.
 * Only real names are cached — never a placeholder — so a later lookup or
 * search result can still fill the name in.
 */
export const toItems: (
  models: Array<unknown> | undefined,
  type: AffectedResourceType,
  nameCache: Map<string, string>,
  failedLookups: Set<string>,
) => Array<AffectedResourceItem> = (
  models: Array<unknown> | undefined,
  type: AffectedResourceType,
  nameCache: Map<string, string>,
  failedLookups: Set<string>,
): Array<AffectedResourceItem> => {
  /*
   * Not only an empty list: between our onChange and the page's splitter the
   * form briefly stores this picker's whole payload object under `monitors`.
   * The browser never renders that state (the splitter's microtask runs
   * first), but a synchronous flush would, and iterating it would throw.
   */
  if (!Array.isArray(models) || models.length === 0) {
    return [];
  }

  const toItemWithoutName: (id: string) => AffectedResourceItem = (
    id: string,
  ): AffectedResourceItem => {
    const cacheKey: string = getNameCacheKey(type, id);
    const cachedName: string | undefined = nameCache.get(cacheKey);
    if (cachedName !== undefined) {
      return { _id: id, name: cachedName, type };
    }
    if (failedLookups.has(cacheKey)) {
      return { _id: id, name: getUnknownResourceLabel(type), type };
    }
    return {
      _id: id,
      name: NAME_LOADING_PLACEHOLDER,
      type,
      isNameLoading: true,
    };
  };

  const items: Array<AffectedResourceItem> = [];
  for (const model of models) {
    if (!model) {
      continue;
    }
    if (typeof model === "string") {
      items.push(toItemWithoutName(model));
      continue;
    }
    const anyModel: { _id?: unknown; id?: unknown; name?: unknown } = model as {
      _id?: unknown;
      id?: unknown;
      name?: unknown;
    };
    const id: string | undefined = anyModel._id
      ? String(anyModel._id)
      : anyModel.id
        ? String(anyModel.id)
        : undefined;
    if (!id) {
      continue;
    }
    /*
     * A missing `name` usually means it was never selected (a relation
     * select of `true` comes back as `{ _id }` only), not that the resource
     * is nameless — so it goes through the cache and the lookup like a bare
     * ID. The lookup is what decides a resource really is unnamed.
     */
    if (typeof anyModel.name === "string" && anyModel.name.length > 0) {
      nameCache.set(getNameCacheKey(type, id), anyModel.name);
      items.push({ _id: id, name: anyModel.name, type });
      continue;
    }
    items.push(toItemWithoutName(id));
  }
  return items;
};

/*
 * IDs of a resource array the picker is NOT showing - a type the viewer
 * cannot read, or one the page left out of `resourceTypes`. notify() hands
 * these back unchanged: emitting [] instead would detach every one of them
 * on save, because an empty many-to-many array clears the junction rows.
 *
 * Anything that is not an array (never loaded, or the transient payload
 * described on toItems) stays undefined, which the form leaves out of the
 * request, so the server keeps that relation as it is.
 */
const toIds: (models: unknown) => Array<string> | undefined = (
  models: unknown,
): Array<string> | undefined => {
  if (!Array.isArray(models)) {
    return undefined;
  }
  const ids: Array<string> = [];
  for (const model of models) {
    if (typeof model === "string") {
      if (model) {
        ids.push(model);
      }
      continue;
    }
    if (!model || typeof model !== "object") {
      continue;
    }
    const anyModel: { _id?: unknown; id?: unknown } = model as {
      _id?: unknown;
      id?: unknown;
    };
    if (anyModel._id) {
      ids.push(String(anyModel._id));
    } else if (anyModel.id) {
      ids.push(String(anyModel.id));
    }
  }
  return ids;
};

/*
 * Placement of the results panel. The same rules, and the same numbers, as
 * EntityDropdown's menu, so the two look alike when they share a form.
 */
const DROPDOWN_GAP_PX: number = 4;
const DROPDOWN_MAX_HEIGHT_PX: number = 384;
const DROPDOWN_MIN_USEFUL_HEIGHT_PX: number = 160;
const DROPDOWN_VIEWPORT_PADDING_PX: number = 8;

/*
 * Viewport coordinates for the results panel. Exactly one of top and bottom
 * is set: top when it opens below the search input, bottom when it flips
 * above - so a panel shorter than its maxHeight still sits against the input
 * rather than floating off the far end of the room it was given.
 */
export interface DropdownPosition {
  top: number | undefined;
  bottom: number | undefined;
  left: number;
  width: number;
  maxHeight: number;
}

export type DropdownAnchorRect = Pick<
  DOMRect,
  "top" | "bottom" | "left" | "width"
>;

/*
 * The results panel is `position: fixed`. As an absolute child it sat inside
 * the Edit modal's scrolling body, which counts an absolute descendant towards
 * its scrollable area: opening the list grew a scrollbar and hid the lower
 * part of the results until the user scrolled the modal. A fixed panel is
 * laid out against the viewport instead, so nothing between it and the
 * viewport can clip it - but it has to be placed by hand, against the input.
 *
 * Below the input by default. Above it when the room below is too small to
 * be useful and there is more room above. As wide as the input, but never
 * wider than the viewport, and never taller than the room it has.
 */
export const getDropdownPosition: (
  anchorRect: DropdownAnchorRect,
  viewportWidth: number,
  viewportHeight: number,
) => DropdownPosition = (
  anchorRect: DropdownAnchorRect,
  viewportWidth: number,
  viewportHeight: number,
): DropdownPosition => {
  const availableWidth: number = Math.max(
    0,
    viewportWidth - DROPDOWN_VIEWPORT_PADDING_PX * 2,
  );
  const width: number = Math.min(anchorRect.width, availableWidth);
  const maximumLeft: number = Math.max(
    DROPDOWN_VIEWPORT_PADDING_PX,
    viewportWidth - DROPDOWN_VIEWPORT_PADDING_PX - width,
  );
  const left: number = Math.min(
    Math.max(anchorRect.left, DROPDOWN_VIEWPORT_PADDING_PX),
    maximumLeft,
  );
  const spaceBelow: number = Math.max(
    0,
    viewportHeight -
      anchorRect.bottom -
      DROPDOWN_GAP_PX -
      DROPDOWN_VIEWPORT_PADDING_PX,
  );
  const spaceAbove: number = Math.max(
    0,
    anchorRect.top - DROPDOWN_GAP_PX - DROPDOWN_VIEWPORT_PADDING_PX,
  );
  const shouldOpenAbove: boolean =
    spaceBelow < DROPDOWN_MIN_USEFUL_HEIGHT_PX && spaceAbove > spaceBelow;

  return {
    top: shouldOpenAbove ? undefined : anchorRect.bottom + DROPDOWN_GAP_PX,
    bottom: shouldOpenAbove
      ? viewportHeight - anchorRect.top + DROPDOWN_GAP_PX
      : undefined,
    left,
    width,
    maxHeight: Math.min(
      DROPDOWN_MAX_HEIGHT_PX,
      shouldOpenAbove ? spaceAbove : spaceBelow,
    ),
  };
};

const isSameDropdownPosition: (
  current: DropdownPosition,
  next: DropdownPosition,
) => boolean = (current: DropdownPosition, next: DropdownPosition): boolean => {
  return (
    current.top === next.top &&
    current.bottom === next.bottom &&
    current.left === next.left &&
    current.width === next.width &&
    current.maxHeight === next.maxHeight
  );
};

/*
 * Pre-flight permission check so we don't render dropdown options the user
 * could never read. Master admin bypasses everything. For anyone else we
 * intersect the model's readRecordPermissions against the user's tenant
 * permissions — same pattern CardModelDetail uses for the edit button.
 */
const filterTypesByReadPermission: (types: Array<AffectedResourceType>) => {
  allowed: Array<AffectedResourceType>;
  denied: Array<AffectedResourceType>;
} = (
  types: Array<AffectedResourceType>,
): {
  allowed: Array<AffectedResourceType>;
  denied: Array<AffectedResourceType>;
} => {
  if (User.isMasterAdmin()) {
    return { allowed: types, denied: [] };
  }
  if (!PermissionGate.hasPermissionSnapshot()) {
    /*
     * No permissions cached yet — let the API decide; the catch block
     * around each request will silence per-type 403s.
     */
    return { allowed: types, denied: [] };
  }
  const allowed: Array<AffectedResourceType> = [];
  const denied: Array<AffectedResourceType> = [];
  for (const type of types) {
    const cfg: ResourceConfig = RESOURCE_CONFIG[type];
    const model: BaseModel = new cfg.modelType();
    // The model's read gate, read the way the server reads it.
    if (
      model.readRecordPermissions.length === 0 ||
      PermissionGate.check(model, ModelAction.Read).isAllowed
    ) {
      allowed.push(type);
    } else {
      denied.push(type);
    }
  }
  return { allowed, denied };
};

const AffectedResourcesPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const requestedTypes: Array<AffectedResourceType> =
    props.resourceTypes && props.resourceTypes.length > 0
      ? props.resourceTypes
      : ALL_TYPES;

  /*
   * Pages hand the kinds in as an inline array, a new one each render. Keyed
   * on the kinds themselves, so a parent's re-render never re-runs the
   * search.
   */
  const requestedTypesKey: string = requestedTypes.join("|");

  const {
    allowed: resourceTypes,
    denied: deniedTypes,
  }: {
    allowed: Array<AffectedResourceType>;
    denied: Array<AffectedResourceType>;
  } = useMemo(() => {
    return filterTypesByReadPermission(requestedTypes);
  }, [requestedTypesKey]);

  const resourceTypesKey: string = resourceTypes.join("|");

  /*
   * Whether a search here also counts the monitors it matches, to say they
   * are picked in the form's monitor field: only on a picker that does not
   * offer monitors itself, beside such a field, for someone who may read
   * monitors.
   */
  const countsMonitorsForHint: boolean = useMemo((): boolean => {
    if (!props.monitorFieldTitle || resourceTypes.includes("Monitor")) {
      return false;
    }

    return filterTypesByReadPermission(["Monitor"]).allowed.length > 0;
  }, [props.monitorFieldTitle, resourceTypesKey]);

  /*
   * The subset the Labels tab can query. A model with no `labels` relation
   * cannot be selected by label, and asking anyway is a guaranteed-failed
   * request per label per expand.
   */
  const labelSelectableTypes: Array<AffectedResourceType> = useMemo(() => {
    return resourceTypes.filter((type: AffectedResourceType): boolean => {
      return RESOURCE_CONFIG[type].supportsLabels;
    });
  }, [resourceTypes]);

  /*
   * nameCache survives across renders so that after the form serializes the
   * selected items down to bare IDs, we can still show user-recognisable
   * names. Keyed by `${type}:${id}` to avoid collisions across resource types.
   */
  const nameCacheRef: React.MutableRefObject<Map<string, string>> = useRef<
    Map<string, string>
  >(new Map());
  /*
   * Bookkeeping for the name lookup of resources that arrive as bare IDs.
   * pendingLookupsRef stops a re-render from asking for the same ID twice
   * while a request is in flight; failedLookupsRef stops an ID the server
   * did not return from being asked for again on every render. Both are
   * keyed like nameCache. nameCacheVersion re-derives `selected` when a
   * lookup lands, since writing to a ref does not re-render on its own.
   */
  const pendingLookupsRef: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set());
  const failedLookupsRef: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set());
  const [nameCacheVersion, setNameCacheVersion] = useState<number>(0);

  /*
   * Selected items derived from props each render. The parent owns the truth;
   * we never mirror it into local state to avoid drift after setNewFormValues
   * rewrites the form's monitors/hosts/kubernetesClusters/dockerHosts/services
   * arrays.
   */
  const selected: Array<AffectedResourceItem> = useMemo(() => {
    const cache: Map<string, string> = nameCacheRef.current;
    const failed: Set<string> = failedLookupsRef.current;
    const items: Array<AffectedResourceItem> = [];
    if (resourceTypes.includes("Monitor")) {
      items.push(...toItems(props.monitors, "Monitor", cache, failed));
    }
    if (resourceTypes.includes("Host")) {
      items.push(...toItems(props.hosts, "Host", cache, failed));
    }
    if (resourceTypes.includes("NetworkDevice")) {
      items.push(
        ...toItems(props.networkDevices, "NetworkDevice", cache, failed),
      );
    }
    if (resourceTypes.includes("KubernetesCluster")) {
      items.push(
        ...toItems(
          props.kubernetesClusters,
          "KubernetesCluster",
          cache,
          failed,
        ),
      );
    }
    if (resourceTypes.includes("DockerHost")) {
      items.push(...toItems(props.dockerHosts, "DockerHost", cache, failed));
    }
    if (resourceTypes.includes("PodmanHost")) {
      items.push(...toItems(props.podmanHosts, "PodmanHost", cache, failed));
    }
    if (resourceTypes.includes("ProxmoxCluster")) {
      items.push(
        ...toItems(props.proxmoxClusters, "ProxmoxCluster", cache, failed),
      );
    }
    if (resourceTypes.includes("VMwareVCenter")) {
      items.push(
        ...toItems(props.vmwareVCenters, "VMwareVCenter", cache, failed),
      );
    }
    if (resourceTypes.includes("CephCluster")) {
      items.push(...toItems(props.cephClusters, "CephCluster", cache, failed));
    }
    if (resourceTypes.includes("StorageArray")) {
      items.push(
        ...toItems(props.storageArrays, "StorageArray", cache, failed),
      );
    }
    if (resourceTypes.includes("DockerSwarmCluster")) {
      items.push(
        ...toItems(
          props.dockerSwarmClusters,
          "DockerSwarmCluster",
          cache,
          failed,
        ),
      );
    }
    if (resourceTypes.includes("IoTFleet")) {
      items.push(...toItems(props.iotFleets, "IoTFleet", cache, failed));
    }
    if (resourceTypes.includes("DatabaseServer")) {
      items.push(
        ...toItems(props.databaseServers, "DatabaseServer", cache, failed),
      );
    }
    if (resourceTypes.includes("CloudResource")) {
      items.push(
        ...toItems(props.cloudResources, "CloudResource", cache, failed),
      );
    }
    if (resourceTypes.includes("NetworkSite")) {
      items.push(...toItems(props.networkSites, "NetworkSite", cache, failed));
    }
    if (resourceTypes.includes("Service")) {
      items.push(...toItems(props.services, "Service", cache, failed));
    }
    return items;
  }, [
    props.monitors,
    props.hosts,
    props.networkDevices,
    props.kubernetesClusters,
    props.dockerHosts,
    props.podmanHosts,
    props.proxmoxClusters,
    props.vmwareVCenters,
    props.cephClusters,
    props.storageArrays,
    props.dockerSwarmClusters,
    props.iotFleets,
    props.databaseServers,
    props.cloudResources,
    props.networkSites,
    props.services,
    resourceTypes,
    nameCacheVersion,
  ]);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<
    Array<AffectedResourceItem>
  >([]);
  /*
   * How many of each kind match the search - all of them, not only those
   * listed - from the server's answer. Read by the kind filter and by each
   * group's Show all.
   */
  const [kindCounts, setKindCounts] = useState<
    Partial<Record<AffectedResourceType, number>>
  >({});
  // The monitors the search also matches (countsMonitorsForHint).
  const [monitorMatchCount, setMonitorMatchCount] = useState<number>(0);
  // The kinds the server would not read for this person.
  const [unreadableTypes, setUnreadableTypes] = useState<
    Array<AffectedResourceType>
  >([]);
  const [hasSearchFailed, setHasSearchFailed] = useState<boolean>(false);
  /*
   * The one kind the results are narrowed to, or null for every kind: the
   * customer's "All, Hosts, Network Devices" (issue #5341). Narrowed, the
   * search lists more of that kind and still counts the others.
   */
  const [activeKind, setActiveKind] = useState<AffectedResourceType | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  /*
   * Reveal the chips past MAX_VISIBLE_CHIPS only when the user opts in.
   * Revealing thousands at once is intentionally a button-press, not the
   * default, because the resulting flex-wrap can hang the tab.
   */
  const [showAllChips, setShowAllChips] = useState<boolean>(false);
  /*
   * highlightedIndex tracks the keyboard cursor across the *flat* order of
   * availableResults (group order matches resourceTypes). -1 means nothing
   * highlighted; Enter is a no-op until the user arrows into the list.
   */
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  /*
   * Two-mode dropdown: "resources" runs the existing name/description
   * search; "labels" turns the same popover into a multi-select label
   * picker that bulk-adds every resource tagged with the chosen labels.
   * The label flow used to live in a separate modal triggered by a
   * "Select by Labels" link — folding it into the dropdown removes the
   * modal entirely and surfaces label-based selection at the same level
   * of discoverability as the search.
   */
  const [activeTab, setActiveTab] = useState<"resources" | "labels">(
    "resources",
  );
  const [allLabels, setAllLabels] = useState<Array<Label>>([]);
  const [isLoadingLabels, setIsLoadingLabels] = useState<boolean>(false);
  const [labelsLoaded, setLabelsLoaded] = useState<boolean>(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Array<string>>([]);
  const [isApplyingLabels, setIsApplyingLabels] = useState<boolean>(false);
  const [labelError, setLabelError] = useState<string>("");
  /*
   * Per-label preview cache. The user can twist open any label row to see
   * which resources it covers before committing to "Add". Each label's
   * preview is fetched lazily on first expand, then kept warm for the
   * lifetime of the picker so re-expanding is instant. Errors are scoped
   * per label so one failure doesn't blank out the rest of the list.
   */
  const [expandedLabelIds, setExpandedLabelIds] = useState<Set<string>>(
    new Set(),
  );
  const [resourcesByLabel, setResourcesByLabel] = useState<
    Record<string, Array<AffectedResourceItem>>
  >({});
  const [loadingLabelIds, setLoadingLabelIds] = useState<Set<string>>(
    new Set(),
  );
  const [labelLoadErrors, setLabelLoadErrors] = useState<
    Record<string, string>
  >({});
  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);
  const debounceRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  /*
   * searchSeqRef discards stale responses when a new query is fired before
   * the previous one resolves. Without it the UI flickers between results.
   */
  const searchSeqRef: React.MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const isEditable: boolean = !props.disabled && !props.readOnly;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePressOutside: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      /*
       * The results panel is a DOM child of containerRef (it is only laid
       * out as fixed, never portalled), so a press on an option, a tab or a
       * label row is inside, and the pick it starts still lands.
       */
      if (
        !containerRef.current ||
        !(event.target instanceof Node) ||
        containerRef.current.contains(event.target)
      ) {
        return;
      }

      if (isEditable) {
        /*
         * This press is spent on closing the results list. Claiming it
         * stops the Edit modal behind the picker from also reading it as a
         * backdrop press, which closed the list and the modal together and
         * threw the unsaved changes away with them.
         */
        consumePressForAnchoredPopup(event);
      }
      setIsOpen(false);
    };

    /*
     * Capture phase, so the press is claimed before anyone reads it: Modal's
     * backdrop handler is a React onMouseDown, and React runs those from its
     * root container, ahead of a bubble-phase listener on the document.
     */
    document.addEventListener("mousedown", handlePressOutside, true);
    return () => {
      document.removeEventListener("mousedown", handlePressOutside, true);
    };
  }, [isOpen, isEditable]);

  /*
   * The keyboard's side of the outside press above. Tabbing from the search
   * input, or on past the panel's last row, onto another field used to leave
   * the list open, and when that field opened a menu of its own (the Monitor
   * dropdown beside the picker on an alert) the two stacked on top of each
   * other. The panel is a DOM child of containerRef, so moving between the
   * chips, the input and the panel's tabs, rows and buttons stays inside and
   * keeps it open.
   *
   * Only a move onto another element closes it. With no element to go to
   * (relatedTarget null, or the document itself) focus went nowhere in
   * particular - the window lost focus, a press landed on something that
   * takes no focus, the focused row unmounted - and presses are for the
   * listener above to judge.
   */
  const closeListWhenFocusLeaves: (
    event: React.FocusEvent<HTMLDivElement>,
  ) => void = (event: React.FocusEvent<HTMLDivElement>): void => {
    const nextFocused: EventTarget | null = event.relatedTarget;

    if (
      !(nextFocused instanceof Element) ||
      event.currentTarget.contains(nextFocused)
    ) {
      return;
    }

    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  /*
   * Shared fetcher used both for typed searches (name/description filters) and
   * for the default "suggestions" list shown when the dropdown is open with an
   * empty query. Failures per type are swallowed so a 403 on one resource type
   * doesn't blank out results for the others.
   */
  const fetchByQuery: (
    type: AffectedResourceType,
    query: Record<string, unknown>,
    limit: number,
  ) => Promise<Array<AffectedResourceItem>> = async (
    type: AffectedResourceType,
    query: Record<string, unknown>,
    limit: number,
  ): Promise<Array<AffectedResourceItem>> => {
    const cfg: ResourceConfig = RESOURCE_CONFIG[type];
    try {
      const result: { data: Array<BaseModel> } =
        await ModelAPI.getList<BaseModel>({
          modelType: cfg.modelType,
          query: query as never,
          limit,
          skip: 0,
          select: { _id: true, name: true } as never,
          sort: { name: SortOrder.Ascending } as never,
        });
      return (result.data || [])
        .map((item: BaseModel): AffectedResourceItem | null => {
          const id: string | undefined = item._id
            ? String(item._id)
            : undefined;
          const name: string =
            typeof (item as { name?: unknown }).name === "string"
              ? ((item as { name?: string }).name as string)
              : "";
          if (!id) {
            return null;
          }
          return {
            _id: id,
            name: name.length > 0 ? name : getUnnamedResourceLabel(type),
            type,
          };
        })
        .filter((i: AffectedResourceItem | null): i is AffectedResourceItem => {
          return i !== null;
        });
    } catch {
      return [];
    }
  };

  /*
   * Look up the names of selected resources that arrived without one. An
   * edit form hands the picker bare IDs (ModelForm flattens the relations it
   * loads), and on a fresh mount nothing has filled nameCache yet — without
   * this every chip read "Unnamed Monitor". Keyed on the IDs still waiting,
   * so it runs once per new batch rather than on every render.
   *
   * Results are never discarded on re-render or unmount: a name that lands
   * late is still the right name, and dropping the request (as a cancelled
   * flag would under StrictMode's double effect) would leave the chip on
   * "Loading..." for good.
   */
  const idsAwaitingName: string = selected
    .filter((item: AffectedResourceItem): boolean => {
      return Boolean(item.isNameLoading);
    })
    .map((item: AffectedResourceItem): string => {
      return getNameCacheKey(item.type, item._id);
    })
    .join("|");

  useEffect(() => {
    const idsByType: Map<AffectedResourceType, Array<string>> = new Map();
    for (const item of selected) {
      const cacheKey: string = getNameCacheKey(item.type, item._id);
      if (!item.isNameLoading || pendingLookupsRef.current.has(cacheKey)) {
        continue;
      }
      pendingLookupsRef.current.add(cacheKey);
      const ids: Array<string> = idsByType.get(item.type) || [];
      ids.push(item._id);
      idsByType.set(item.type, ids);
    }

    const lookUpBatch: (
      type: AffectedResourceType,
      ids: Array<string>,
    ) => Promise<void> = async (
      type: AffectedResourceType,
      ids: Array<string>,
    ): Promise<void> => {
      // fetchByQuery swallows errors, so a failed request reads as "not found".
      const found: Array<AffectedResourceItem> = await fetchByQuery(
        type,
        { _id: new Includes(ids) },
        ids.length,
      );
      const foundIds: Set<string> = new Set();
      for (const item of found) {
        foundIds.add(item._id);
        nameCacheRef.current.set(getNameCacheKey(type, item._id), item.name);
      }
      for (const id of ids) {
        const cacheKey: string = getNameCacheKey(type, id);
        pendingLookupsRef.current.delete(cacheKey);
        if (!foundIds.has(id)) {
          failedLookupsRef.current.add(cacheKey);
        }
      }
      setNameCacheVersion((version: number): number => {
        return version + 1;
      });
    };

    idsByType.forEach(
      (ids: Array<string>, type: AffectedResourceType): void => {
        for (let i: number = 0; i < ids.length; i += NAME_LOOKUP_BATCH_SIZE) {
          void lookUpBatch(type, ids.slice(i, i + NAME_LOOKUP_BATCH_SIZE));
        }
      },
    );
  }, [idsAwaitingName]);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    /*
     * Skip fetching when the dropdown is closed or the user is on the
     * Labels tab — there's nothing to render. Re-opening (or the user
     * typing) re-runs this effect and refills results.
     */
    if (!isOpen || activeTab !== "resources") {
      return;
    }

    const trimmed: string = searchQuery.trim();
    setIsLoading(true);
    const mySeq: number = ++searchSeqRef.current;
    /*
     * Empty queries fire immediately so the user sees suggestions the moment
     * they focus the input. Typed queries are debounced to spare the API.
     */
    const delay: number = trimmed === "" ? 0 : SEARCH_DEBOUNCE_MS;

    debounceRef.current = window.setTimeout(async () => {
      /*
       * One request for every kind (issue #5341), where the picker used to
       * ask twice per kind - name, then description - per keystroke. The
       * server reads each kind with the person's rights. Narrowed to one
       * kind, it lists more of that kind and only counts the others, so the
       * kind filter keeps its numbers.
       */
      const narrowedTo: AffectedResourceType | null =
        activeKind && resourceTypes.includes(activeKind) ? activeKind : null;
      const listedTypes: Array<AffectedResourceType> = narrowedTo
        ? [narrowedTo]
        : resourceTypes;
      const countedTypes: Array<AffectedResourceType> = [
        ...resourceTypes.filter((type: AffectedResourceType): boolean => {
          return !listedTypes.includes(type);
        }),
        ...(countsMonitorsForHint && trimmed !== ""
          ? (["Monitor"] as Array<AffectedResourceType>)
          : []),
      ];

      try {
        if (listedTypes.length === 0) {
          setSearchResults([]);
          setKindCounts({});
          setMonitorMatchCount(0);
          setUnreadableTypes([]);
          setHasSearchFailed(false);
          return;
        }

        const result: AffectedResourceSearchResult =
          await searchAffectedResources({
            search: trimmed,
            kinds: listedTypes as Array<AffectedResourceKind>,
            limitPerKind: narrowedTo
              ? SEARCH_LIMIT_FOR_ONE_TYPE
              : SEARCH_LIMIT_PER_TYPE,
            countKinds: countedTypes as Array<AffectedResourceKind>,
          });

        if (mySeq !== searchSeqRef.current) {
          return; // stale
        }

        const items: Array<AffectedResourceItem> = [];
        const counts: Partial<Record<AffectedResourceType, number>> = {};

        for (const kindResult of result.kinds) {
          const type: AffectedResourceType = (
            kindResult as AffectedResourceSearchKindResult
          ).kind;
          counts[type] = kindResult.count;

          for (const match of kindResult.matches) {
            const item: AffectedResourceItem = {
              _id: (match as AffectedResourceSearchMatch)._id,
              name:
                match.name.length > 0
                  ? match.name
                  : getUnnamedResourceLabel(type),
              type: type,
            };

            if (match.detail) {
              item.detail = match.detail;
            }

            items.push(item);
          }
        }

        let monitorCount: number = 0;

        for (const counted of result.counts) {
          const type: AffectedResourceType = (
            counted as AffectedResourceSearchCount
          ).kind;

          if (type === "Monitor" && !resourceTypes.includes("Monitor")) {
            monitorCount = counted.count;
            continue;
          }

          counts[type] = counted.count;
        }

        /*
         * Cache names so the selected chips still render readably after the
         * form turns our payload into bare ID arrays.
         */
        for (const item of items) {
          nameCacheRef.current.set(`${item.type}:${item._id}`, item.name);
        }

        setSearchResults(items);
        setKindCounts(counts);
        setMonitorMatchCount(monitorCount);
        setUnreadableTypes(
          result.unreadableKinds.filter((kind: AffectedResourceKind) => {
            return resourceTypes.includes(kind);
          }) as Array<AffectedResourceType>,
        );
        setHasSearchFailed(false);
      } catch {
        if (mySeq === searchSeqRef.current) {
          setSearchResults([]);
          setKindCounts({});
          setMonitorMatchCount(0);
          setHasSearchFailed(true);
        }
      } finally {
        if (mySeq === searchSeqRef.current) {
          setIsLoading(false);
        }
      }
    }, delay);
  }, [
    searchQuery,
    resourceTypesKey,
    isOpen,
    activeTab,
    activeKind,
    countsMonitorsForHint,
  ]);

  // A closed list opens on every kind again.
  useEffect(() => {
    if (!isOpen) {
      setActiveKind(null);
    }
  }, [isOpen]);

  const availableResults: Array<AffectedResourceItem> = useMemo(() => {
    return searchResults.filter((result: AffectedResourceItem) => {
      return !selected.some((s: AffectedResourceItem) => {
        return s._id === result._id && s.type === result.type;
      });
    });
  }, [searchResults, selected]);

  const groupedAvailable: Array<{
    type: AffectedResourceType;
    items: Array<AffectedResourceItem>;
  }> = useMemo(() => {
    const groups: Array<{
      type: AffectedResourceType;
      items: Array<AffectedResourceItem>;
    }> = [];
    for (const type of resourceTypes) {
      if (activeKind && activeKind !== type) {
        continue;
      }
      const items: Array<AffectedResourceItem> = availableResults.filter(
        (r: AffectedResourceItem): boolean => {
          return r.type === type;
        },
      );
      if (items.length > 0) {
        groups.push({ type, items });
      }
    }
    return groups;
  }, [availableResults, resourceTypesKey, activeKind]);

  /*
   * The kinds the filter offers: every kind with a match, in the picker's
   * order, and the one narrowed to even when nothing of it matches now, so
   * it can be left again.
   */
  const filterTypes: Array<AffectedResourceType> = resourceTypes.filter(
    (type: AffectedResourceType): boolean => {
      return (kindCounts[type] || 0) > 0 || activeKind === type;
    },
  );

  const totalMatchCount: number = resourceTypes.reduce(
    (total: number, type: AffectedResourceType): number => {
      return total + (kindCounts[type] || 0);
    },
    0,
  );

  // The filter shows once the results hold two kinds, or one is picked.
  const showsKindFilter: boolean =
    activeKind !== null || filterTypes.length > 1;

  // Narrowing to a kind starts its list from the top.
  const narrowToKind: (type: AffectedResourceType | null) => void = (
    type: AffectedResourceType | null,
  ): void => {
    setActiveKind(type);
    setHighlightedIndex(-1);
  };

  // How many of each kind the answer listed, before the picked are left out.
  const listedCounts: Partial<Record<AffectedResourceType, number>> =
    useMemo(() => {
      const counts: Partial<Record<AffectedResourceType, number>> = {};
      for (const result of searchResults) {
        counts[result.type] = (counts[result.type] || 0) + 1;
      }
      return counts;
    }, [searchResults]);

  /*
   * Flatten groupedAvailable into the same order it renders so the keyboard
   * cursor and the visual order stay in sync.
   */
  const flatAvailable: Array<AffectedResourceItem> = useMemo(() => {
    const flat: Array<AffectedResourceItem> = [];
    for (const group of groupedAvailable) {
      for (const item of group.items) {
        flat.push(item);
      }
    }
    return flat;
  }, [groupedAvailable]);

  /*
   * Rebuilds the payload from `next` for the types this picker shows. Every
   * other type is carried through from props untouched (see toIds): the page
   * writes every array of the payload back into the form, so a type the
   * viewer cannot read must come back exactly as it went in, not as [].
   */
  const notify: (next: Array<AffectedResourceItem>) => void = (
    next: Array<AffectedResourceItem>,
  ): void => {
    const idsFor: (type: AffectedResourceType) => Array<string> | undefined = (
      type: AffectedResourceType,
    ): Array<string> | undefined => {
      if (!resourceTypes.includes(type)) {
        return toIds(props[RESOURCE_CONFIG[type].key]);
      }
      return next
        .filter((i: AffectedResourceItem): boolean => {
          return i.type === type;
        })
        .map((i: AffectedResourceItem): string => {
          return i._id;
        });
    };

    props.onChange({
      __affectedResourcesPayload: true,
      monitors: idsFor("Monitor"),
      hosts: idsFor("Host"),
      networkDevices: idsFor("NetworkDevice"),
      kubernetesClusters: idsFor("KubernetesCluster"),
      dockerHosts: idsFor("DockerHost"),
      podmanHosts: idsFor("PodmanHost"),
      proxmoxClusters: idsFor("ProxmoxCluster"),
      vmwareVCenters: idsFor("VMwareVCenter"),
      cephClusters: idsFor("CephCluster"),
      storageArrays: idsFor("StorageArray"),
      dockerSwarmClusters: idsFor("DockerSwarmCluster"),
      iotFleets: idsFor("IoTFleet"),
      databaseServers: idsFor("DatabaseServer"),
      cloudResources: idsFor("CloudResource"),
      networkSites: idsFor("NetworkSite"),
      services: idsFor("Service"),
    });
  };

  const addItem: (item: AffectedResourceItem) => void = (
    item: AffectedResourceItem,
  ): void => {
    notify([...selected, item]);
    /*
     * Clear the query so the popover snaps back to the empty-search
     * suggestion list. We intentionally DO NOT clear searchResults — when
     * searchQuery was already empty, the fetch effect's deps don't fire
     * again, and an empty searchResults leaves the popover stuck showing
     * "No resources available" even though the project has plenty more
     * to offer. availableResults filters out the just-picked item, so the
     * UI updates correctly without an extra round-trip.
     */
    setSearchQuery("");
    inputRef.current?.focus();
  };

  /*
   * Lazy-load labels the first time the user switches to the Labels tab.
   * The list is cached for the picker's lifetime — switching back and
   * forth between tabs is instant.
   *
   * IMPORTANT: do *not* add `isLoadingLabels` to the dep array. The first
   * thing the loader does is setIsLoadingLabels(true); if that re-fires
   * this effect, its cleanup sets `cancelled = true` and the in-flight
   * request is silently dropped, leaving the popover stuck on
   * "Loading labels...". `activeTab` + `labelsLoaded` are enough to gate
   * re-entry.
   */
  useEffect(() => {
    if (activeTab !== "labels" || labelsLoaded) {
      return;
    }
    let cancelled: boolean = false;
    const loadLabels: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingLabels(true);
      setLabelError("");
      try {
        const result: { data: Array<Label> } = await ModelAPI.getList<Label>({
          modelType: Label,
          query: {} as never,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { _id: true, name: true, color: true } as never,
          sort: { name: SortOrder.Ascending } as never,
        });
        if (cancelled) {
          return;
        }
        setAllLabels(result.data || []);
        setLabelsLoaded(true);
      } catch {
        if (cancelled) {
          return;
        }
        setLabelError(
          "Failed to load labels. You may not have permission to read labels.",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingLabels(false);
        }
      }
    };
    void loadLabels();
    return () => {
      cancelled = true;
    };
  }, [activeTab, labelsLoaded]);

  const toggleLabelId: (id: string) => void = (id: string): void => {
    setSelectedLabelIds((prev: Array<string>): Array<string> => {
      if (prev.includes(id)) {
        return prev.filter((x: string): boolean => {
          return x !== id;
        });
      }
      return [...prev, id];
    });
  };

  /*
   * Preview is capped per type so a label tagging thousands of monitors
   * doesn't drown the popover. The actual Add to Selection (in
   * applyLabelSelection) uses LIMIT_PER_PROJECT, so the preview can show
   * fewer rows than will eventually be added — the "+" suffix flags that.
   */
  const LABEL_PREVIEW_LIMIT_PER_TYPE: number = 50;

  const fetchResourcesForLabel: (labelId: string) => Promise<void> = async (
    labelId: string,
  ): Promise<void> => {
    setLoadingLabelIds((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set(prev);
      next.add(labelId);
      return next;
    });
    setLabelLoadErrors(
      (prev: Record<string, string>): Record<string, string> => {
        const next: Record<string, string> = { ...prev };
        delete next[labelId];
        return next;
      },
    );
    try {
      const requests: Array<Promise<Array<AffectedResourceItem>>> = [];
      for (const type of labelSelectableTypes) {
        requests.push(
          fetchByQuery(
            type,
            { labels: new Includes([labelId]) },
            LABEL_PREVIEW_LIMIT_PER_TYPE,
          ),
        );
      }
      const buckets: Array<Array<AffectedResourceItem>> =
        await Promise.all(requests);
      const merged: Array<AffectedResourceItem> = [];
      for (const bucket of buckets) {
        for (const item of bucket) {
          merged.push(item);
          nameCacheRef.current.set(`${item.type}:${item._id}`, item.name);
        }
      }
      setResourcesByLabel(
        (
          prev: Record<string, Array<AffectedResourceItem>>,
        ): Record<string, Array<AffectedResourceItem>> => {
          return { ...prev, [labelId]: merged };
        },
      );
    } catch {
      setLabelLoadErrors(
        (prev: Record<string, string>): Record<string, string> => {
          return {
            ...prev,
            [labelId]: translationKey("Failed to load resources."),
          };
        },
      );
    } finally {
      setLoadingLabelIds((prev: Set<string>): Set<string> => {
        const next: Set<string> = new Set(prev);
        next.delete(labelId);
        return next;
      });
    }
  };

  const toggleLabelExpansion: (labelId: string) => void = (
    labelId: string,
  ): void => {
    setExpandedLabelIds((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set(prev);
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
        if (resourcesByLabel[labelId] === undefined) {
          void fetchResourcesForLabel(labelId);
        }
      }
      return next;
    });
  };

  /*
   * On the Labels tab the same input filters the label list client-side
   * (we already have all labels in memory). Keeping a single searchQuery
   * for both tabs keeps the input behavior intuitive — the user types,
   * the visible list narrows, regardless of which tab they're on.
   */
  const filteredLabels: Array<Label> = useMemo(() => {
    const q: string = searchQuery.trim().toLowerCase();
    if (q === "") {
      return allLabels;
    }
    return allLabels.filter((label: Label): boolean => {
      const name: string = (label.name || "").toLowerCase();
      return name.includes(q);
    });
  }, [allLabels, searchQuery]);

  /*
   * Clamp the keyboard cursor when the active list shrinks under it (e.g.
   * the user typed and narrowed the results). Both tabs share the cursor —
   * which list it indexes into depends on activeTab.
   */
  useEffect(() => {
    const len: number =
      activeTab === "labels" ? filteredLabels.length : flatAvailable.length;
    if (highlightedIndex >= len) {
      setHighlightedIndex(len - 1);
    }
  }, [flatAvailable, filteredLabels, highlightedIndex, activeTab]);

  /*
   * Pulls every resource (of each enabled type) tagged with any of the chosen
   * labels and merges them into the current selection. Per-type failures are
   * swallowed; the cap is generous (LIMIT_PER_PROJECT) since this is an
   * intentional bulk selection rather than a quick search.
   */
  const applyLabelSelection: () => Promise<void> = async (): Promise<void> => {
    if (selectedLabelIds.length === 0) {
      return;
    }
    setIsApplyingLabels(true);
    setLabelError("");
    try {
      const requests: Array<Promise<Array<AffectedResourceItem>>> = [];
      for (const type of labelSelectableTypes) {
        requests.push(
          fetchByQuery(
            type,
            { labels: new Includes(selectedLabelIds) },
            LIMIT_PER_PROJECT,
          ),
        );
      }
      const buckets: Array<Array<AffectedResourceItem>> =
        await Promise.all(requests);

      // Merge new items into the existing selection, deduping by type+id.
      const existing: Set<string> = new Set(
        selected.map((s: AffectedResourceItem): string => {
          return `${s.type}:${s._id}`;
        }),
      );
      const additions: Array<AffectedResourceItem> = [];
      for (const bucket of buckets) {
        for (const item of bucket) {
          const key: string = `${item.type}:${item._id}`;
          if (existing.has(key)) {
            continue;
          }
          existing.add(key);
          additions.push(item);
          nameCacheRef.current.set(key, item.name);
        }
      }

      if (additions.length === 0) {
        setLabelError(
          "No new resources matched the selected labels (or you don't have read access).",
        );
        setIsApplyingLabels(false);
        return;
      }

      notify([...selected, ...additions]);
      /*
       * Bounce back to the resources view, drop the label selection, and
       * close the popover so the user sees the resulting chips appear.
       */
      setSelectedLabelIds([]);
      setSearchQuery("");
      setActiveTab("resources");
      setIsOpen(false);
    } catch {
      setLabelError("Failed to fetch resources for the selected labels.");
    } finally {
      setIsApplyingLabels(false);
    }
  };

  const removeItem: (item: AffectedResourceItem) => void = (
    item: AffectedResourceItem,
  ): void => {
    notify(
      selected.filter((s: AffectedResourceItem): boolean => {
        return !(s._id === item._id && s.type === item.type);
      }),
    );
  };

  const clearAll: () => void = (): void => {
    notify([]);
    setShowAllChips(false);
  };

  /*
   * Four kinds or more are named by the first three and "and more": the
   * Other Affected Resources picker offers fourteen, and a placeholder that
   * lists them all is cut off long before its end.
   */
  const placeholderTypes: ComposedValue = composedValue(
    (sentenceTranslator: Translator): string => {
      return resourceTypes
        .slice(0, resourceTypes.length > 3 ? 3 : resourceTypes.length)
        .map((t: AffectedResourceType): string => {
          return sentenceTranslator.translateTerm(
            RESOURCE_CONFIG[t].pluralLabel,
            {
              inSentence: true,
            },
          );
        })
        .join(", ");
    },
  );

  const resourcesPlaceholder: string =
    props.placeholder ||
    (resourceTypes.length === ALL_TYPES.length &&
    ALL_TYPES.every((type: AffectedResourceType): boolean => {
      return resourceTypes.includes(type);
    })
      ? "Search monitors, hosts, Kubernetes clusters, Docker hosts, Podman hosts, or services..."
      : resourceTypes.length > 3
        ? translator.translateTemplate("Search {{types}} and more...", {
            types: placeholderTypes,
          })
        : translator.translateTemplate("Search {{types}}...", {
            types: placeholderTypes,
          }));
  const placeholder: string = translator.translateText(
    activeTab === "labels" ? "Search labels..." : resourcesPlaceholder,
  ) as string;

  /*
   * Resources already attached under a type the viewer cannot read. They get
   * no chip - the viewer cannot see what they are, so removing them is not
   * theirs to do - but notify() keeps them, and a note says they are there.
   */
  const hiddenLabels: Array<string> = [];
  let hiddenCount: number = 0;
  for (const type of deniedTypes) {
    const count: number = toIds(props[RESOURCE_CONFIG[type].key])?.length || 0;
    if (count > 0) {
      hiddenCount += count;
      hiddenLabels.push(RESOURCE_CONFIG[type].label);
    }
  }

  /*
   * The kinds the panel says the person may not read: the ones their
   * permissions rule out before asking, and the ones the server would not
   * read for them (labels can leave a kind unreadable as a whole).
   */
  const unreadableNoteTypes: Array<AffectedResourceType> = [
    ...deniedTypes,
    ...unreadableTypes.filter((type: AffectedResourceType): boolean => {
      return !deniedTypes.includes(type);
    }),
  ];

  const chipOverflow: number = Math.max(0, selected.length - MAX_VISIBLE_CHIPS);
  const visibleChips: Array<AffectedResourceItem> =
    showAllChips || chipOverflow === 0
      ? selected
      : selected.slice(0, MAX_VISIBLE_CHIPS);

  /*
   * The results panel is fixed (see getDropdownPosition), so it follows the
   * search input by measurement rather than by layout. It is not shown until
   * the first measurement lands, or it would flash at the viewport's top left
   * corner for a frame.
   */
  const isListOpen: boolean = isOpen && isEditable;
  const [dropdownPosition, setDropdownPosition] =
    useState<DropdownPosition | null>(null);

  const updateDropdownPosition: () => void = useCallback((): void => {
    if (!inputRef.current || typeof window === "undefined") {
      return;
    }

    const next: DropdownPosition = getDropdownPosition(
      inputRef.current.getBoundingClientRect(),
      window.innerWidth,
      window.innerHeight,
    );

    /*
     * Every scroll on the page lands here, the results list's own included.
     * Keeping the current object when nothing moved spares the whole picker
     * a re-render on each of those.
     */
    setDropdownPosition(
      (current: DropdownPosition | null): DropdownPosition => {
        return current && isSameDropdownPosition(current, next)
          ? current
          : next;
      },
    );
  }, []);

  /*
   * Measure again whenever the input may have moved: chips added or removed
   * above it (or renamed once their names load, which can rewrap them), the
   * hidden-resources note, the overflow toggle, a tab switch, a resize, and
   * any scroll - the modal body's included. Scroll does not bubble, hence the
   * capture-phase listener.
   */
  useLayoutEffect(() => {
    if (!isListOpen) {
      setDropdownPosition(null);
      return;
    }

    let animationFrame: number | null = null;
    const schedulePositionUpdate: () => void = (): void => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame((): void => {
        animationFrame = null;
        updateDropdownPosition();
      });
    };

    updateDropdownPosition();
    window.addEventListener("resize", schedulePositionUpdate);
    document.addEventListener("scroll", schedulePositionUpdate, true);

    return () => {
      window.removeEventListener("resize", schedulePositionUpdate);
      document.removeEventListener("scroll", schedulePositionUpdate, true);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [
    isListOpen,
    selected,
    hiddenCount,
    showAllChips,
    activeTab,
    updateDropdownPosition,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative mt-1 w-full"
      onBlur={closeListWhenFocusLeaves}
    >
      {selected.length > 0 && (
        <div className={props.readOnly ? "space-y-2" : "mb-2 space-y-2"}>
          {(chipOverflow > 0 || selected.length >= MAX_VISIBLE_CHIPS) &&
            isEditable && (
              <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs">
                <span className="text-gray-600">
                  <TranslatedSentence
                    template={{
                      one: "{{number}} resource selected",
                      other: "{{number}} resources selected",
                    }}
                    count={selected.length}
                    slots={{
                      number: (
                        <span className="font-semibold text-gray-800">
                          {translator.formatNumber(selected.length)}
                        </span>
                      ),
                    }}
                  />
                </span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="font-medium text-red-600 hover:text-red-700 focus:outline-none focus:ring-1 focus:ring-red-500"
                >
                  {translator.translateText("Clear all")}
                </button>
              </div>
            )}
          <div className="flex flex-wrap gap-2">
            {visibleChips.map((item: AffectedResourceItem) => {
              const cfg: ResourceConfig = RESOURCE_CONFIG[item.type];
              return (
                <span
                  key={`${item.type}-${item._id}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-700"
                >
                  <Icon icon={cfg.icon} className="h-3.5 w-3.5 text-gray-500" />
                  <span className="text-xs uppercase tracking-wide text-gray-500">
                    {translator.translateText(cfg.label)}
                  </span>
                  <span
                    className={
                      item.isNameLoading
                        ? "italic text-gray-400"
                        : "text-gray-800"
                    }
                    aria-busy={item.isNameLoading ? true : undefined}
                  >
                    {item.isNameLoading
                      ? translator.translateText(NAME_LOADING_PLACEHOLDER)
                      : item.name}
                  </span>
                  {isEditable && (
                    <button
                      type="button"
                      aria-label={translator.translateTemplate(
                        "Remove {{name}}",
                        {
                          name: item.isNameLoading
                            ? translatableTerm(cfg.label, { inSentence: true })
                            : item.name,
                        },
                      )}
                      onClick={() => {
                        removeItem(item);
                      }}
                      className="ms-1 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  )}
                </span>
              );
            })}
            {chipOverflow > 0 && (
              <button
                type="button"
                aria-expanded={showAllChips}
                onClick={() => {
                  return setShowAllChips(!showAllChips);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 bg-white px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {showAllChips
                  ? translator.translateText("Show fewer")
                  : translator.translatePlural(
                      { one: "+ {{count}} more", other: "+ {{count}} more" },
                      chipOverflow,
                    )}
              </button>
            )}
          </div>
        </div>
      )}

      {hiddenCount > 0 && (
        <div
          data-testid="affected-resources-hidden-note"
          className={`flex items-start gap-1.5 text-xs text-gray-500 ${
            props.readOnly ? "mt-2" : "mb-2"
          }`}
        >
          <Icon
            icon={IconProp.Lock}
            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
          />
          <span>
            {translator.translatePlural(
              {
                one: "{{count}} resource you don't have permission to view is also attached ({{types}}). It will be kept.",
                other:
                  "{{count}} resources you don't have permission to view are also attached ({{types}}). They will be kept.",
              },
              hiddenCount,
              {
                types: hiddenLabels
                  .map((label: string): string => {
                    return translator.translateText(label) as string;
                  })
                  .join(", "),
              },
            )}
          </span>
        </div>
      )}

      {!props.readOnly && (
        <input
          data-unsaved-changes-ignore
          ref={inputRef}
          type="text"
          value={searchQuery}
          disabled={props.disabled}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-labelledby={props.ariaLabelledby}
          role="combobox"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setSearchQuery(event.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => {
            setIsOpen(true);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            /*
             * The cursor walks whichever list the active tab is showing —
             * resources or labels. Length is checked against the active list
             * so ArrowUp/Down become no-ops when there's nothing to move to.
             */
            const activeLen: number =
              activeTab === "labels"
                ? filteredLabels.length
                : flatAvailable.length;

            if (event.key === "ArrowDown") {
              if (activeLen === 0) {
                return;
              }
              event.preventDefault();
              setIsOpen(true);
              setHighlightedIndex((prev: number): number => {
                const next: number = prev + 1;
                return next >= activeLen ? 0 : next;
              });
              return;
            }
            if (event.key === "ArrowUp") {
              if (activeLen === 0) {
                return;
              }
              event.preventDefault();
              setIsOpen(true);
              setHighlightedIndex((prev: number): number => {
                if (prev <= 0) {
                  return activeLen - 1;
                }
                return prev - 1;
              });
              return;
            }
            if (event.key === "Enter") {
              if (highlightedIndex < 0 || highlightedIndex >= activeLen) {
                return;
              }
              event.preventDefault();
              if (activeTab === "labels") {
                const label: Label | undefined =
                  filteredLabels[highlightedIndex];
                const labelId: string = label?._id ? String(label._id) : "";
                if (labelId) {
                  toggleLabelId(labelId);
                }
                return;
              }
              const target: AffectedResourceItem | undefined =
                flatAvailable[highlightedIndex];
              if (target) {
                addItem(target);
                setHighlightedIndex(-1);
              }
              return;
            }
            if (event.key === "Escape") {
              if (isListOpen) {
                /*
                 * Modal closes on an Escape that reaches the document
                 * unhandled. Claim this one so it closes only the results
                 * list and the Edit modal - with its unsaved changes -
                 * stays; a second Escape, the list already closed, still
                 * closes the modal.
                 */
                event.preventDefault();
              }
              setIsOpen(false);
              setHighlightedIndex(-1);
              return;
            }
            if (
              event.key === "Backspace" &&
              searchQuery === "" &&
              selected.length > 0 &&
              activeTab === "resources"
            ) {
              /*
               * Backspace on empty input removes the last selected chip — same
               * convention as react-select and most tag inputs. Gated to the
               * resources tab so labels-tab backspace doesn't accidentally
               * delete a resource chip the user is no longer looking at.
               */
              event.preventDefault();
              removeItem(selected[selected.length - 1] as AffectedResourceItem);
            }
          }}
          placeholder={placeholder}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-500"
        />
      )}

      {isListOpen && (
        <div
          className="fixed flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-sm shadow-lg"
          data-testid="affected-resources-dropdown"
          role="listbox"
          style={{
            top: dropdownPosition?.top,
            bottom: dropdownPosition?.bottom,
            left: dropdownPosition?.left ?? 0,
            width: dropdownPosition?.width ?? 0,
            maxHeight: dropdownPosition?.maxHeight,
            visibility: dropdownPosition ? "visible" : "hidden",
            zIndex: DROPDOWN_MENU_Z_INDEX,
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
            if (event.key !== "Escape") {
              return;
            }
            /*
             * Focus can be inside the panel too - on a tab or a label row,
             * reached with Tab. Escape there closes the list, not the Edit
             * modal, and hands focus back to the search input rather than
             * leaving it on a button that is about to unmount. Focusing the
             * input asks to open the list; closing it after wins the batch.
             */
            event.preventDefault();
            inputRef.current?.focus();
            setIsOpen(false);
            setHighlightedIndex(-1);
          }}
        >
          {/*
           * Tab strip. Two modes share the same input above: "Resources"
           * runs the live name/description search; "Labels" lets the user
           * bulk-add every resource tagged with the chosen labels.
           */}
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50 px-1.5 py-1">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "resources"}
              onMouseDown={(
                event: React.MouseEvent<HTMLButtonElement>,
              ): void => {
                event.preventDefault();
              }}
              onClick={(): void => {
                setActiveTab("resources");
                setHighlightedIndex(-1);
              }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                activeTab === "resources"
                  ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-600 hover:bg-white/60 hover:text-gray-800"
              }`}
            >
              {translator.translateText("Resources")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "labels"}
              onMouseDown={(
                event: React.MouseEvent<HTMLButtonElement>,
              ): void => {
                event.preventDefault();
              }}
              onClick={(): void => {
                setActiveTab("labels");
                setHighlightedIndex(-1);
              }}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                activeTab === "labels"
                  ? "bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-600 hover:bg-white/60 hover:text-gray-800"
              }`}
            >
              <Icon icon={IconProp.Tag} className="h-3.5 w-3.5" />
              {translator.translateText("Labels")}
              {selectedLabelIds.length > 0 && (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-700">
                  {selectedLabelIds.length}
                </span>
              )}
            </button>
            {/*
             * What each tab is for. Left out on a phone, where it wrapped to
             * three lines beside the tabs and pushed the results down.
             */}
            <span className="ms-auto pe-1 text-[11px] text-gray-400 max-sm:hidden sm:inline">
              {translator.translateText(
                activeTab === "resources"
                  ? "Search and add individually"
                  : "Bulk-add by tag",
              )}
            </span>
          </div>

          {/*
           * The kind filter (issue #5341): every kind, or one of them, each
           * with how many match. Shown once the results hold two kinds, so a
           * picker with one kind, or a search that found one, has no chrome
           * it does not need.
           */}
          {activeTab === "resources" && showsKindFilter && (
            <div
              data-testid="affected-resources-kind-filter"
              role="group"
              aria-label={translator.translateText("Resource type")}
              className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-100 px-2 py-1.5 sm:flex-wrap sm:overflow-visible"
            >
              {[null, ...filterTypes].map(
                (type: AffectedResourceType | null): ReactElement => {
                  const isActive: boolean = activeKind === type;
                  const count: number =
                    type === null ? totalMatchCount : kindCounts[type] || 0;

                  return (
                    <button
                      key={type || "all"}
                      type="button"
                      aria-pressed={isActive}
                      data-testid={`affected-resources-kind-${type || "all"}`}
                      onMouseDown={(
                        event: React.MouseEvent<HTMLButtonElement>,
                      ): void => {
                        event.preventDefault();
                      }}
                      onClick={(): void => {
                        narrowToKind(type);
                      }}
                      className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <span>
                        {type === null
                          ? translator.translateText("All")
                          : translator.translateText(
                              RESOURCE_CONFIG[type].pluralLabel,
                            )}
                      </span>
                      <span
                        className={
                          isActive ? "text-indigo-500" : "text-gray-400"
                        }
                      >
                        {translator.formatNumber(count)}
                      </span>
                    </button>
                  );
                },
              )}
            </div>
          )}

          {/* Resources tab body. */}
          {activeTab === "resources" && (
            <div className="flex-1 overflow-auto pb-1">
              {isLoading && (
                <div className="flex w-full items-center px-3 py-2 text-start text-gray-500">
                  <svg
                    className="animate-spin -ms-0.5 me-2 h-4 w-4 text-indigo-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>{translator.translateText("Searching...")}</span>
                </div>
              )}

              {/*
               * A search that failed says so in red; finding nothing is an
               * answer, in grey.
               */}
              {!isLoading && hasSearchFailed && (
                <div
                  data-testid="affected-resources-search-failed"
                  className="px-3 py-2 text-red-600"
                >
                  {translator.translateText(
                    "Could not search resources. Try again in a moment.",
                  )}
                </div>
              )}

              {!isLoading &&
                !hasSearchFailed &&
                searchQuery.trim() === "" &&
                groupedAvailable.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    {translator.translateText(
                      "No resources available. Type to search across all resources.",
                    )}
                  </div>
                )}

              {!isLoading &&
                !hasSearchFailed &&
                searchQuery.trim() !== "" &&
                groupedAvailable.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    {translator.translateText("No matching resources.")}
                  </div>
                )}

              {!isLoading &&
                (() => {
                  /*
                   * Track the running flat index alongside the visual render
                   * so the highlight class matches the keyboard cursor
                   * exactly.
                   */
                  let flatIdx: number = -1;
                  return groupedAvailable.map(
                    (group: {
                      type: AffectedResourceType;
                      items: Array<AffectedResourceItem>;
                    }) => {
                      const cfg: ResourceConfig = RESOURCE_CONFIG[group.type];
                      const matchCount: number =
                        kindCounts[group.type] || group.items.length;
                      /*
                       * More of this kind match than the answer listed:
                       * Show all narrows the results to it.
                       */
                      const hasMore: boolean =
                        activeKind === null &&
                        matchCount > (listedCounts[group.type] || 0);
                      return (
                        <div
                          key={group.type}
                          data-testid={`affected-resources-group-${group.type}`}
                        >
                          {/*
                           * Each result's kind, kept in view while its rows
                           * scroll under it.
                           */}
                          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-gray-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <span className="min-w-0 truncate">
                              {translator.translateText(cfg.pluralLabel)}
                            </span>
                            {hasMore && (
                              <button
                                type="button"
                                data-testid={`affected-resources-show-all-${group.type}`}
                                onMouseDown={(
                                  event: React.MouseEvent<HTMLButtonElement>,
                                ): void => {
                                  event.preventDefault();
                                }}
                                onClick={(): void => {
                                  narrowToKind(group.type);
                                }}
                                className="flex-shrink-0 rounded font-medium normal-case tracking-normal text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                {translator.translatePlural(
                                  {
                                    one: "Show all {{count}}",
                                    other: "Show all {{count}}",
                                  },
                                  matchCount,
                                )}
                              </button>
                            )}
                          </div>
                          {group.items.map((item: AffectedResourceItem) => {
                            flatIdx += 1;
                            const isHighlighted: boolean =
                              flatIdx === highlightedIndex;
                            return (
                              <button
                                key={`${item.type}-${item._id}`}
                                type="button"
                                role="option"
                                aria-selected={isHighlighted}
                                onMouseEnter={() => {
                                  /*
                                   * Sync the highlight to the mouse so keyboard
                                   * and mouse never disagree on which row is
                                   * about to be picked.
                                   */
                                  setHighlightedIndex(flatIdx);
                                }}
                                onMouseDown={(
                                  event: React.MouseEvent<HTMLButtonElement>,
                                ) => {
                                  /*
                                   * Prevent the input blur from firing before
                                   * onClick resolves the selection.
                                   */
                                  event.preventDefault();
                                }}
                                onClick={() => {
                                  addItem(item);
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-start ${
                                  isHighlighted
                                    ? "bg-indigo-600 text-white"
                                    : "text-gray-700 hover:bg-indigo-50"
                                }`}
                              >
                                <Icon
                                  icon={cfg.icon}
                                  className={`h-4 w-4 flex-shrink-0 ${
                                    isHighlighted
                                      ? "text-white"
                                      : "text-gray-400"
                                  }`}
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {item.name}
                                </span>
                                {/*
                                 * An address reads left to right in every
                                 * language, beside the name it tells apart.
                                 */}
                                {item.detail && (
                                  <span
                                    dir="ltr"
                                    className={`max-w-[45%] flex-shrink-0 truncate text-xs ${
                                      isHighlighted
                                        ? "text-indigo-100"
                                        : "text-gray-400"
                                    }`}
                                  >
                                    {item.detail}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    },
                  );
                })()}

              {/*
               * Narrowed to one kind and more of it match than are listed:
               * how many, and how to find the rest.
               */}
              {!isLoading &&
                activeKind !== null &&
                (kindCounts[activeKind] || 0) >
                  (listedCounts[activeKind] || 0) && (
                  <div
                    data-testid="affected-resources-narrowed-more"
                    className="px-3 py-2 text-xs text-gray-500"
                  >
                    {translator.translateTemplate(
                      "Showing {{shown}} of {{total}}. Type to narrow the list.",
                      {
                        shown: translator.formatNumber(
                          listedCounts[activeKind] || 0,
                        ),
                        total: translator.formatNumber(
                          kindCounts[activeKind] || 0,
                        ),
                      },
                    )}
                  </div>
                )}

              {/*
               * Monitors are picked in the form's own field. A search here
               * that matches some says so, rather than leaving the person to
               * think they cannot be found (issue #5341).
               */}
              {!isLoading &&
                props.monitorFieldTitle &&
                monitorMatchCount > 0 &&
                searchQuery.trim() !== "" && (
                  <div
                    data-testid="affected-resources-monitors-hint"
                    className="flex items-start gap-1.5 border-t border-gray-100 px-3 py-2 text-xs text-gray-500"
                  >
                    <Icon
                      icon={IconProp.AltGlobe}
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                    />
                    <span>
                      {translator.translatePlural(
                        {
                          one: "{{count}} monitor matches too. Monitors are picked under {{field}}.",
                          other:
                            "{{count}} monitors match too. Monitors are picked under {{field}}.",
                        },
                        monitorMatchCount,
                        {
                          field: translator.translateText(
                            props.monitorFieldTitle,
                          ) as string,
                        },
                      )}
                    </span>
                  </div>
                )}

              {unreadableNoteTypes.length > 0 && (
                <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  {translator.translateTemplate(
                    "You don't have permission to read: {{types}}.",
                    {
                      types: unreadableNoteTypes
                        .map((t: AffectedResourceType): string => {
                          return translator.translateText(
                            RESOURCE_CONFIG[t].label,
                          ) as string;
                        })
                        .join(", "),
                    },
                  )}
                </div>
              )}
            </div>
          )}

          {/* Labels tab body. */}
          {activeTab === "labels" && (
            <div className="flex-1 overflow-auto py-1">
              {isLoadingLabels && (
                <div className="flex w-full items-center px-3 py-2 text-start text-gray-500">
                  <svg
                    className="animate-spin -ms-0.5 me-2 h-4 w-4 text-indigo-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  <span>{translator.translateText("Loading labels...")}</span>
                </div>
              )}

              {!isLoadingLabels && labelError !== "" && (
                <div className="px-3 py-2 text-red-600">
                  {translator.translateText(labelError)}
                </div>
              )}

              {!isLoadingLabels &&
                labelError === "" &&
                labelsLoaded &&
                allLabels.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    {translator.translateText(
                      "No labels found in this project. Create labels first to use this shortcut.",
                    )}
                  </div>
                )}

              {!isLoadingLabels &&
                labelError === "" &&
                labelsLoaded &&
                allLabels.length > 0 &&
                filteredLabels.length === 0 && (
                  <div className="px-3 py-2 text-gray-500">
                    {translator.translateTemplate(
                      "No labels match “{{query}}”.",
                      {
                        query: searchQuery.trim(),
                      },
                    )}
                  </div>
                )}

              {!isLoadingLabels &&
                filteredLabels.map(
                  (label: Label, idx: number): ReactElement => {
                    const labelId: string = label._id ? String(label._id) : "";
                    if (!labelId) {
                      return <span key={`empty-${idx}`} />;
                    }
                    const isChecked: boolean =
                      selectedLabelIds.includes(labelId);
                    const isHighlighted: boolean = idx === highlightedIndex;
                    const isExpanded: boolean = expandedLabelIds.has(labelId);
                    const isLoadingResources: boolean =
                      loadingLabelIds.has(labelId);
                    const previewResources:
                      | Array<AffectedResourceItem>
                      | undefined = resourcesByLabel[labelId];
                    const previewError: string | undefined =
                      labelLoadErrors[labelId];
                    const labelColor: string | undefined = label.color
                      ? typeof (label.color as { toString?: unknown })
                          .toString === "function"
                        ? label.color.toString()
                        : (label.color as unknown as string)
                      : undefined;
                    const previewCapTotal: number =
                      LABEL_PREVIEW_LIMIT_PER_TYPE * resourceTypes.length;

                    return (
                      <div
                        key={labelId}
                        onMouseEnter={(): void => {
                          setHighlightedIndex(idx);
                        }}
                        className={`border-b border-gray-100 last:border-b-0 ${
                          isHighlighted ? "bg-indigo-50" : ""
                        }`}
                      >
                        <div className="flex w-full items-center gap-2 px-2 py-1.5">
                          {/*
                           * Twist-down chevron lives on its own button so a
                           * click on it doesn't toggle the checkbox. Lazy-
                           * fetches the preview on first open.
                           */}
                          <button
                            type="button"
                            aria-label={translator.translateText(
                              isExpanded
                                ? "Collapse resources"
                                : "Expand resources",
                            )}
                            aria-expanded={isExpanded}
                            onMouseDown={(
                              event: React.MouseEvent<HTMLButtonElement>,
                            ): void => {
                              event.preventDefault();
                            }}
                            onClick={(): void => {
                              toggleLabelExpansion(labelId);
                            }}
                            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <Icon
                              icon={IconProp.ChevronRight}
                              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                                isExpanded ? "rotate-90" : ""
                              }`}
                            />
                          </button>
                          {/*
                           * The rest of the row is the select-toggle button.
                           * Splitting expand and select keeps each interaction
                           * unambiguous and avoids "did my click toggle or
                           * expand?" surprises.
                           */}
                          <button
                            type="button"
                            role="option"
                            aria-selected={isChecked}
                            onMouseDown={(
                              event: React.MouseEvent<HTMLButtonElement>,
                            ): void => {
                              event.preventDefault();
                            }}
                            onClick={(): void => {
                              toggleLabelId(labelId);
                            }}
                            className={`flex flex-1 items-center gap-2 rounded px-1 py-1 text-start ${
                              isHighlighted
                                ? "text-gray-900"
                                : "text-gray-700 hover:bg-indigo-100/50"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                                isChecked
                                  ? "border-indigo-600 bg-indigo-600 text-white"
                                  : "border-gray-300 bg-white"
                              }`}
                            >
                              {isChecked && (
                                <svg
                                  className="h-3 w-3"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </span>
                            {labelColor && (
                              <span
                                className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: labelColor }}
                                aria-hidden="true"
                              />
                            )}
                            <span className="truncate">
                              {label.name ||
                                translator.translateText("Unnamed Label")}
                            </span>
                          </button>
                          {previewResources !== undefined && (
                            <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                              {previewResources.length}
                              {previewResources.length >= previewCapTotal
                                ? "+"
                                : ""}
                            </span>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 pl-10">
                            {isLoadingResources ? (
                              <div className="flex items-center gap-2 py-1 text-xs text-gray-500">
                                <svg
                                  className="h-3.5 w-3.5 animate-spin text-indigo-500"
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                  />
                                </svg>
                                <span>
                                  {translator.translateText(
                                    "Loading resources...",
                                  )}
                                </span>
                              </div>
                            ) : previewError ? (
                              <div className="py-1 text-xs text-red-600">
                                {translator.translateText(previewError)}
                              </div>
                            ) : !previewResources ||
                              previewResources.length === 0 ? (
                              <div className="py-1 text-xs italic text-gray-500">
                                {translator.translateText(
                                  "No resources tagged with this label.",
                                )}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {resourceTypes.map(
                                  (
                                    type: AffectedResourceType,
                                  ): ReactElement | null => {
                                    const items: Array<AffectedResourceItem> =
                                      previewResources.filter(
                                        (r: AffectedResourceItem): boolean => {
                                          return r.type === type;
                                        },
                                      );
                                    if (items.length === 0) {
                                      return null;
                                    }
                                    const cfg: ResourceConfig =
                                      RESOURCE_CONFIG[type];
                                    return (
                                      <div key={type}>
                                        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                          <Icon
                                            icon={cfg.icon}
                                            className="h-3 w-3 text-gray-400"
                                          />
                                          <span>
                                            {translator.translateText(
                                              cfg.pluralLabel,
                                            )}{" "}
                                            ({items.length}
                                            {items.length >=
                                            LABEL_PREVIEW_LIMIT_PER_TYPE
                                              ? "+"
                                              : ""}
                                            )
                                          </span>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                          {items.map(
                                            (
                                              item: AffectedResourceItem,
                                            ): ReactElement => {
                                              return (
                                                <span
                                                  key={`${item.type}-${item._id}`}
                                                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-700"
                                                >
                                                  <span className="max-w-[10rem] truncate">
                                                    {item.name}
                                                  </span>
                                                </span>
                                              );
                                            },
                                          )}
                                        </div>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
            </div>
          )}

          {/*
           * Sticky footer on the Labels tab. Shows the apply action and a
           * Clear shortcut once the user has picked something — keeps the
           * primary action visible no matter how far they scrolled.
           */}
          {activeTab === "labels" && selectedLabelIds.length > 0 && (
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-2 py-1.5">
              <button
                type="button"
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  setSelectedLabelIds([]);
                }}
                disabled={isApplyingLabels}
                className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-white hover:text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                {translator.translateText("Clear")}
              </button>
              <button
                type="button"
                onMouseDown={(
                  event: React.MouseEvent<HTMLButtonElement>,
                ): void => {
                  event.preventDefault();
                }}
                onClick={(): void => {
                  void applyLabelSelection();
                }}
                disabled={isApplyingLabels}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 disabled:opacity-60"
              >
                {isApplyingLabels && (
                  <svg
                    className="h-3.5 w-3.5 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                )}
                {isApplyingLabels
                  ? translator.translateText("Adding...")
                  : translator.translatePlural(
                      {
                        one: "Add resources from {{count}} label",
                        other: "Add resources from {{count}} labels",
                      },
                      selectedLabelIds.length,
                    )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AffectedResourcesPicker;

/*
 * Splits the picker payload back into the four model arrays so callers can
 * merge them into form state from a top-level onChange hook. Keeping this in
 * the same file ensures the payload shape and the consumer stay in sync.
 */
export const isAffectedResourcesPayload: (
  value: unknown,
) => value is AffectedResourcesPayload = (
  value: unknown,
): value is AffectedResourcesPayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    (value as { __affectedResourcesPayload?: unknown })
      .__affectedResourcesPayload === true
  );
};
