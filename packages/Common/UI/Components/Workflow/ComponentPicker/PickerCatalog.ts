import IconProp from "../../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
  ComponentType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import {
  DatabaseOperation,
  getDatabaseOperation,
} from "../../../../Types/Workflow/DatabaseOperation";

/*
 * How the Add Component and Add Trigger pickers organise the catalog.
 *
 * The catalog is about two thousand steps, and all but some twenty of them
 * are generated: eight actions and three triggers for each of some two
 * hundred and fifty database models (Create One Incident, Find Many Incident
 * States, Update One On-Call Duty Execution Log, ...). Listed one after the
 * other they buried the handful of steps nearly every workflow is built
 * from, and nobody could tell which of them they needed.
 *
 * So the picker leads with what people use: a short popular set, then the
 * rest of the hand-written steps, then the database steps by resource - pick
 * Incident, then what to do with it - with the common resources up front and
 * every other one behind "Browse all resources". Search covers everything.
 */

/*
 * The steps most workflows are built from, in the order they are shown.
 * An id the catalog does not have is skipped, so a renamed or removed step
 * can never break the picker; a guard test holds this list to the catalog.
 */
export const POPULAR_COMPONENT_IDS: Readonly<
  Record<ComponentType, ReadonlyArray<string>>
> = {
  [ComponentType.Component]: [
    ComponentID.Log,
    ComponentID.IfElse,
    ComponentID.ApiPost,
    ComponentID.ApiGet,
    ComponentID.SlackSendMessageToChannel,
    ComponentID.MicrosoftTeamsSendMessageToChannel,
    ComponentID.DiscordSendMessageToChannel,
    ComponentID.SendEmail,
    ComponentID.JavaScriptCode,
    "incident-create-one",
  ],
  [ComponentType.Trigger]: [
    ComponentID.Manual,
    ComponentID.Schedule,
    ComponentID.Webhook,
    "incident-on-create",
    "incident-on-update",
    "alert-on-create",
    "monitor-on-update",
  ],
};

/*
 * The resources people automate around, by table name, in the order they
 * are shown. Everything else - states, timelines, owners, rules, logs,
 * templates and the other supporting records - is one click away under
 * "Browse all resources", and always in search.
 */
export const COMMON_RESOURCE_TABLE_NAMES: ReadonlyArray<string> = [
  "Incident",
  "Alert",
  "Monitor",
  "StatusPage",
  "ScheduledMaintenance",
  "OnCallDutyPolicy",
  "IncidentPublicNote",
  "IncidentInternalNote",
  "AlertInternalNote",
  "StatusPageAnnouncement",
  "IncidentEpisode",
  "AlertEpisode",
];

/*
 * A resource's steps in the order a person looks for them: what the step
 * does first (create, find, update, delete), one record before many.
 */
export const DATABASE_OPERATION_ORDER: ReadonlyArray<DatabaseOperation> = [
  DatabaseOperation.CreateOne,
  DatabaseOperation.CreateMany,
  DatabaseOperation.FindOne,
  DatabaseOperation.FindMany,
  DatabaseOperation.UpdateOne,
  DatabaseOperation.UpdateMany,
  DatabaseOperation.DeleteOne,
  DatabaseOperation.DeleteMany,
  DatabaseOperation.OnCreate,
  DatabaseOperation.OnUpdate,
  DatabaseOperation.OnDelete,
];

export type GetComponentOperationFunction = (
  componentMetadata: ComponentMetadata,
) => DatabaseOperation | null;

// Which generated operation a step is, or null for a hand-written step.
export const getComponentOperation: GetComponentOperationFunction = (
  componentMetadata: ComponentMetadata,
): DatabaseOperation | null => {
  if (!componentMetadata.tableName) {
    return null;
  }

  return getDatabaseOperation({
    componentId: componentMetadata.id,
    tableName: componentMetadata.tableName,
  });
};

export type GetOperationRankFunction = (
  operation: DatabaseOperation | null,
) => number;

export const getOperationRank: GetOperationRankFunction = (
  operation: DatabaseOperation | null,
): number => {
  if (!operation) {
    return DATABASE_OPERATION_ORDER.length;
  }

  return DATABASE_OPERATION_ORDER.indexOf(operation);
};

// A database model's steps, as the picker shows them.
export interface PickerResource {
  // The model's table name: unique, unlike its display name.
  key: string;
  // The model's singular name, which its steps carry as their category.
  name: string;
  description: string;
  icon: IconProp;
  // Its steps of the picker's type, in DATABASE_OPERATION_ORDER.
  components: Array<ComponentMetadata>;
  // Position in COMMON_RESOURCE_TABLE_NAMES, or null when not one of them.
  commonRank: number | null;
  /*
   * Set when another resource has the same name (two models are both called
   * "Subscriber Notification Template"): the table name in words, shown so
   * the two can be told apart.
   */
  disambiguation: string | null;
}

// Hand-written steps of one category ("API", "Slack", "Utils").
export interface PickerBuiltInGroup {
  name: string;
  icon: IconProp;
  components: Array<ComponentMetadata>;
}

export interface PickerCatalog {
  componentsType: ComponentType;
  // Every step of the picker's type, in catalog order.
  components: Array<ComponentMetadata>;
  popular: Array<ComponentMetadata>;
  // The hand-written steps that are not in `popular`, by category.
  otherBuiltInGroups: Array<PickerBuiltInGroup>;
  // Every resource with a step of the picker's type, A to Z.
  resources: Array<PickerResource>;
  // The common ones, in COMMON_RESOURCE_TABLE_NAMES order.
  commonResources: Array<PickerResource>;
  resourcesByKey: Map<string, PickerResource>;
  popularRankById: Map<string, number>;
}

export type IsResourceComponentFunction = (
  componentMetadata: ComponentMetadata,
) => boolean;

// Generated database steps carry their model's table name.
export const isResourceComponent: IsResourceComponentFunction = (
  componentMetadata: ComponentMetadata,
): boolean => {
  return Boolean(componentMetadata.tableName);
};

export type TableNameToWordsFunction = (tableName: string) => string;

// "StatusPageSubscriberNotificationTemplate" -> "Status Page Subscriber ..."
export const tableNameToWords: TableNameToWordsFunction = (
  tableName: string,
): string => {
  return tableName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
};

export interface BuildPickerCatalogData {
  components: Array<ComponentMetadata>;
  categories: Array<ComponentCategory>;
  componentsType: ComponentType;
}

export type BuildPickerCatalogFunction = (
  data: BuildPickerCatalogData,
) => PickerCatalog;

export const buildPickerCatalog: BuildPickerCatalogFunction = (
  data: BuildPickerCatalogData,
): PickerCatalog => {
  const components: Array<ComponentMetadata> = data.components.filter(
    (componentMetadata: ComponentMetadata): boolean => {
      return componentMetadata.componentType === data.componentsType;
    },
  );

  const categoriesByTable: Map<string, ComponentCategory> = new Map();
  const categoriesByName: Map<string, ComponentCategory> = new Map();

  for (const category of data.categories) {
    if (category.tableName && !categoriesByTable.has(category.tableName)) {
      categoriesByTable.set(category.tableName, category);
    }

    if (!categoriesByName.has(category.name)) {
      categoriesByName.set(category.name, category);
    }
  }

  const componentsById: Map<string, ComponentMetadata> = new Map();

  for (const componentMetadata of components) {
    if (!componentsById.has(componentMetadata.id)) {
      componentsById.set(componentMetadata.id, componentMetadata);
    }
  }

  const popular: Array<ComponentMetadata> = [];
  const popularRankById: Map<string, number> = new Map();

  for (const id of POPULAR_COMPONENT_IDS[data.componentsType] || []) {
    const componentMetadata: ComponentMetadata | undefined =
      componentsById.get(id);

    if (componentMetadata && !popularRankById.has(id)) {
      popularRankById.set(id, popular.length);
      popular.push(componentMetadata);
    }
  }

  const otherBuiltInGroups: Array<PickerBuiltInGroup> = [];
  const builtInGroupsByName: Map<string, PickerBuiltInGroup> = new Map();
  const resourcesByKey: Map<string, PickerResource> = new Map();

  for (const componentMetadata of components) {
    if (isResourceComponent(componentMetadata)) {
      const key: string = componentMetadata.tableName!;
      let resource: PickerResource | undefined = resourcesByKey.get(key);

      if (!resource) {
        const category: ComponentCategory | undefined =
          categoriesByTable.get(key) ||
          categoriesByName.get(componentMetadata.category);
        const commonRank: number = COMMON_RESOURCE_TABLE_NAMES.indexOf(key);

        resource = {
          key: key,
          name: componentMetadata.category || tableNameToWords(key),
          description: category?.description || "",
          icon: category?.icon || IconProp.Database,
          components: [],
          commonRank: commonRank === -1 ? null : commonRank,
          disambiguation: null,
        };
        resourcesByKey.set(key, resource);
      }

      resource.components.push(componentMetadata);
      continue;
    }

    if (popularRankById.has(componentMetadata.id)) {
      continue;
    }

    let group: PickerBuiltInGroup | undefined = builtInGroupsByName.get(
      componentMetadata.category,
    );

    if (!group) {
      const category: ComponentCategory | undefined = categoriesByName.get(
        componentMetadata.category,
      );

      group = {
        name: componentMetadata.category,
        icon: category?.icon || componentMetadata.iconProp,
        components: [],
      };
      builtInGroupsByName.set(componentMetadata.category, group);
      otherBuiltInGroups.push(group);
    }

    group.components.push(componentMetadata);
  }

  // In the order the categories are declared (AI, Webhook, API, Slack, ...).
  const categoryRank: (name: string) => number = (name: string): number => {
    const rank: number = data.categories.findIndex(
      (category: ComponentCategory): boolean => {
        return category.name === name;
      },
    );

    return rank === -1 ? data.categories.length : rank;
  };

  otherBuiltInGroups.sort(
    (groupA: PickerBuiltInGroup, groupB: PickerBuiltInGroup): number => {
      return categoryRank(groupA.name) - categoryRank(groupB.name);
    },
  );

  const resources: Array<PickerResource> = Array.from(
    resourcesByKey.values(),
  ).sort((resourceA: PickerResource, resourceB: PickerResource): number => {
    return (
      resourceA.name.localeCompare(resourceB.name) ||
      resourceA.key.localeCompare(resourceB.key)
    );
  });

  const resourcesByName: Map<string, Array<PickerResource>> = new Map();

  for (const resource of resources) {
    resource.components.sort(
      (
        componentA: ComponentMetadata,
        componentB: ComponentMetadata,
      ): number => {
        return (
          getOperationRank(getComponentOperation(componentA)) -
          getOperationRank(getComponentOperation(componentB))
        );
      },
    );

    const sameName: Array<PickerResource> =
      resourcesByName.get(resource.name) || [];
    sameName.push(resource);
    resourcesByName.set(resource.name, sameName);
  }

  for (const sameName of resourcesByName.values()) {
    if (sameName.length > 1) {
      for (const resource of sameName) {
        resource.disambiguation = tableNameToWords(resource.key);
      }
    }
  }

  const commonResources: Array<PickerResource> = resources
    .filter((resource: PickerResource): boolean => {
      return resource.commonRank !== null;
    })
    .sort((resourceA: PickerResource, resourceB: PickerResource): number => {
      return (resourceA.commonRank || 0) - (resourceB.commonRank || 0);
    });

  return {
    componentsType: data.componentsType,
    components: components,
    popular: popular,
    otherBuiltInGroups: otherBuiltInGroups,
    resources: resources,
    commonResources: commonResources,
    resourcesByKey: resourcesByKey,
    popularRankById: popularRankById,
  };
};

interface CachedCatalog {
  categories: Array<ComponentCategory>;
  catalog: PickerCatalog;
}

const catalogCache: WeakMap<
  Array<ComponentMetadata>,
  Map<ComponentType, CachedCatalog>
> = new WeakMap();

/*
 * buildPickerCatalog, once per catalog: the builder hands the picker the same
 * arrays every time it opens, so only the first opening pays for it.
 */
export const getPickerCatalog: BuildPickerCatalogFunction = (
  data: BuildPickerCatalogData,
): PickerCatalog => {
  let byType: Map<ComponentType, CachedCatalog> | undefined = catalogCache.get(
    data.components,
  );

  if (!byType) {
    byType = new Map();
    catalogCache.set(data.components, byType);
  }

  const cached: CachedCatalog | undefined = byType.get(data.componentsType);

  if (cached && cached.categories === data.categories) {
    return cached.catalog;
  }

  const catalog: PickerCatalog = buildPickerCatalog(data);
  byType.set(data.componentsType, {
    categories: data.categories,
    catalog: catalog,
  });

  return catalog;
};
