import ComponentMetadata, {
  ComponentType,
} from "../../../Types/Workflow/Component";

/*
 * Helpers for the "database records" drill-down in the component picker.
 *
 * Every database model that enables workflows contributes ~11 near-identical
 * components (Find/Create/Update/Delete + On-Create/Update/Delete). Listing
 * them all is overwhelming, but they can be grouped: each such component
 * carries the model's tableName. We group the REAL catalog components by model
 * — no ids are reconstructed or morphed, so there's zero fidelity risk; the
 * picker still hands back the exact component object the engine executes.
 */

export interface ModelGroup {
  tableName: string;
  name: string;
  components: Array<ComponentMetadata>;
}

export type GroupComponentsByModelFunction = (
  components: Array<ComponentMetadata>,
  componentType: ComponentType,
) => Array<ModelGroup>;

/*
 * Group the model-backed components (those with a tableName) of the given type
 * by model, sorted by display name. Static components (no tableName) are
 * excluded — they're listed directly in the picker.
 */
export const groupComponentsByModel: GroupComponentsByModelFunction = (
  components: Array<ComponentMetadata>,
  componentType: ComponentType,
): Array<ModelGroup> => {
  const byTable: Map<string, ModelGroup> = new Map<string, ModelGroup>();

  for (const component of components) {
    if (component.componentType !== componentType) {
      continue;
    }
    if (!component.tableName) {
      continue;
    }

    let group: ModelGroup | undefined = byTable.get(component.tableName);
    if (!group) {
      group = {
        tableName: component.tableName,
        name: component.category,
        components: [],
      };
      byTable.set(component.tableName, group);
    }
    group.components.push(component);
  }

  return Array.from(byTable.values()).sort((a: ModelGroup, b: ModelGroup) => {
    return a.name.localeCompare(b.name);
  });
};

export type FilterModelGroupsFunction = (
  groups: Array<ModelGroup>,
  search: string,
) => Array<ModelGroup>;

export const filterModelGroups: FilterModelGroupsFunction = (
  groups: Array<ModelGroup>,
  search: string,
): Array<ModelGroup> => {
  const query: string = search.trim().toLowerCase();
  if (!query) {
    return groups;
  }
  return groups.filter((group: ModelGroup) => {
    return group.name.toLowerCase().includes(query);
  });
};
