import { buildCustomFieldFacets } from "./CustomFieldFacets";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "Common/Types/ObjectID";
import useCustomFieldColumns, {
  CustomFieldColumnsResult,
} from "Common/UI/Components/ModelTable/useCustomFieldColumns";
import { useMemo } from "react";

/*
 * The facet-bar half of a resource's custom fields.
 *
 * Reuses `useCustomFieldColumns` rather than fetching the definitions again:
 * a table that shows custom field columns is exactly a table that should offer
 * custom field chips, the request is the same one, and two copies of it would
 * drift the moment a definition changed. The hook already swallows a failure
 * to load them — custom fields are a paid feature the viewer may not be able
 * to read — so a project without them simply gets no chips.
 */

export interface CustomFieldFacetsResult {
  facets: Array<ResourceFacet>;
  /**
   * True until the definitions have settled. Pass straight through to
   * `useResourceOwners({ areFacetsLoading })`: until it goes false, a facet
   * restored from a shared link has no chip to belong to, and the bar must not
   * treat that as the user having cleared it.
   */
  isLoading: boolean;
}

export type UseCustomFieldFacetsFunction = (data: {
  /**
   * The model holding this resource's custom field *definitions* — e.g.
   * `IncidentCustomField` for a table of incidents. Omit to switch the chips
   * off entirely.
   */
  customFieldsModelType?: { new (): BaseModel } | undefined;
  projectId?: ObjectID | null | undefined;
}) => CustomFieldFacetsResult;

const useCustomFieldFacets: UseCustomFieldFacetsFunction = (data: {
  customFieldsModelType?: { new (): BaseModel } | undefined;
  projectId?: ObjectID | null | undefined;
}): CustomFieldFacetsResult => {
  const definitionsResult: CustomFieldColumnsResult<BaseModel> =
    useCustomFieldColumns<BaseModel>({
      customFieldsModelType: data.customFieldsModelType,
      projectId: data.projectId,
    });

  const facets: Array<ResourceFacet> = useMemo(() => {
    if (!data.customFieldsModelType) {
      return [];
    }

    return buildCustomFieldFacets(definitionsResult.definitions);
    /*
     * Memoised on the definitions themselves: the facet array's identity is
     * what the bar's conflict map and its settle-time reconciliation key on,
     * so rebuilding it every render would re-run both on every keystroke.
     */
  }, [definitionsResult.definitions, data.customFieldsModelType]);

  return {
    facets: facets,
    /*
     * A table with no definition model has nothing to wait for. Reporting
     * `false` there keeps the bar from holding the URL snapshot hostage on
     * every page that does not use custom fields.
     */
    isLoading:
      Boolean(data.customFieldsModelType) && definitionsResult.isLoading,
  };
};

export default useCustomFieldFacets;
