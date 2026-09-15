import {
  RESOURCE_FACET_CATALOG,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import { FacetConfig } from "./types";

export interface BuildResourceFacetConfigsOptions {
  /*
   * Priority of the first resource facet. The rest follow in catalog order
   * at 0.01 steps, so every resource facet sorts between `basePriority` and
   * the next whole number the viewer uses for its own facets.
   */
  basePriority: number;
  /*
   * Names the viewer already loaded, per facet key. Facets without a map
   * still render names: the server resolves resource facet values against
   * Postgres and returns a displayName with each value.
   */
  valueDisplayMaps?:
    | Partial<Record<string, Record<string, string> | undefined>>
    | undefined;
}

/*
 * One FacetConfig per catalog resource type — searchable against the
 * server, iconed, and folded away while empty so a project without, say,
 * Podman hosts does not show a "Podman Host" section with nothing in it.
 */
export function buildResourceFacetConfigs(
  options: BuildResourceFacetConfigsOptions,
): Array<FacetConfig> {
  return RESOURCE_FACET_CATALOG.map(
    (definition: ResourceFacetDefinition, index: number): FacetConfig => {
      return {
        key: definition.facetKey,
        title: definition.label,
        icon: definition.icon,
        priority: options.basePriority + index * 0.01,
        serverSearchable: true,
        hideWhenEmpty: true,
        emptyStateNoun: definition.pluralLabel,
        valueDisplayMap: options.valueDisplayMaps?.[definition.facetKey],
      };
    },
  );
}
