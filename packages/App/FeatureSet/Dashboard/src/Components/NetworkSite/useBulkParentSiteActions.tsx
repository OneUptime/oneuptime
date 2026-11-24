import React, { ReactElement } from "react";

import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useBulkRelationActions, {
  BulkRelationActionsResult,
  SetRelationFormData,
} from "../BulkRelation/useBulkRelationActions";
import { gateSiteBulkAction } from "./BulkSiteActionGate";
import {
  ALREADY_UNDER_SITE_REASON,
  AT_TOP_LEVEL_REASON,
  CLEAR_PARENT_SITE_ACTION_TITLE,
  CLEAR_PARENT_SITE_CONFIRM_MESSAGE,
  CLEAR_PARENT_SITE_CONFIRM_TITLE,
  IS_PICKED_PARENT_REASON,
  PARENT_SITE_FIELD_PLACEHOLDER,
  PARENT_SITE_FIELD_TITLE,
  SET_PARENT_SITE_ACTION_TITLE,
  SET_PARENT_SITE_DESCRIPTION,
  SITE_TYPE_FIELD_DESCRIPTION,
  SITE_TYPE_FIELD_PLACEHOLDER,
  SITE_TYPE_FIELD_TITLE,
} from "./BulkSiteActionWords";

/*
 * "Set Parent Site" / "Clear Parent Site" on Network -> Sites (#10188).
 *
 * An import of a Meraki organization leaves a site per network, all at the
 * top: hundreds of them, to be placed under a region or a brand. Placing
 * them is one dialog - pick the parent, save - and each site moves with
 * everything below it, as when its own Settings page names a parent.
 *
 * A site needs a type to sit under another, and a site the import added has
 * none: when some of the selection has none, the dialog asks for the type
 * they take as they move, and the others keep theirs. The server decides
 * the rest - a site cannot go under itself or a site below it, nor under a
 * site of a unit-level type - and a site it refuses is listed with why.
 */

// The site types each site of the selection holds, from its row.
function readSiteTypeId(site: NetworkSite): string | null {
  return (
    (site.networkSiteTypeId || site.networkSiteType?._id)?.toString() || null
  );
}

function countWithoutType(sites: Array<NetworkSite>): number {
  return sites.filter((site: NetworkSite): boolean => {
    return !readSiteTypeId(site);
  }).length;
}

export interface BulkParentSiteActionsOptions {
  // Told once the sites have moved: the page draws its hierarchy again.
  onDone?: (() => void) | undefined;
}

function useBulkParentSiteActions(
  options?: BulkParentSiteActionsOptions,
): BulkRelationActionsResult<NetworkSite> {
  const translator: Translator = useTranslator();

  return useBulkRelationActions<NetworkSite>({
    modelType: NetworkSite,
    column: "parentSiteId",
    onDone: options?.onDone,
    set: {
      title: SET_PARENT_SITE_ACTION_TITLE,
      icon: IconProp.BuildingOffice,
      description: SET_PARENT_SITE_DESCRIPTION,
      submitButtonText: SET_PARENT_SITE_ACTION_TITLE,
      field: {
        title: PARENT_SITE_FIELD_TITLE,
        placeholder: PARENT_SITE_FIELD_PLACEHOLDER,
        dropdownModal: {
          type: NetworkSite,
          labelField: "name",
          valueField: "_id",
          sort: { name: SortOrder.Ascending },
        },
      },
      getMoreFields: (
        sites: Array<NetworkSite>,
      ): Array<Field<SetRelationFormData>> => {
        const withoutType: number = countWithoutType(sites);

        if (withoutType === 0) {
          return [];
        }

        const description: ReactElement = (
          <span data-testid="set-parent-site-type-description">
            {translator.translatePlural(
              SITE_TYPE_FIELD_DESCRIPTION,
              withoutType,
            )}
          </span>
        );

        return [
          {
            field: {
              networkSiteTypeId: true,
            },
            title: SITE_TYPE_FIELD_TITLE,
            description: description,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownModal: {
              type: NetworkSiteType,
              labelField: "name",
              valueField: "_id",
              sort: { order: SortOrder.Ascending },
            },
            placeholder: SITE_TYPE_FIELD_PLACEHOLDER,
          },
        ];
      },
    },
    clear: {
      title: CLEAR_PARENT_SITE_ACTION_TITLE,
      icon: IconProp.LinkSlash,
      confirmTitle: CLEAR_PARENT_SITE_CONFIRM_TITLE,
      confirmMessage: CLEAR_PARENT_SITE_CONFIRM_MESSAGE,
    },
    readRelationId: (site: NetworkSite): string | null => {
      return (site.parentSiteId || site.parentSite?._id)?.toString() || null;
    },
    alreadySetReason: ALREADY_UNDER_SITE_REASON,
    notSetReason: AT_TOP_LEVEL_REASON,
    // The parent picked may be one of the sites selected: it stays where it is.
    getUnchangedReason: (
      site: NetworkSite,
      parentSiteId: ObjectID,
    ): string | null => {
      return site.id?.toString() === parentSiteId.toString()
        ? IS_PICKED_PARENT_REASON
        : null;
    },
    getMoreWriteData: (
      site: NetworkSite,
      formData: SetRelationFormData,
    ): JSONObject => {
      const siteTypeId: string = String(formData["networkSiteTypeId"] || "");

      if (readSiteTypeId(site) || !siteTypeId) {
        return {};
      }

      return { networkSiteTypeId: new ObjectID(siteTypeId) };
    },
    gate: gateSiteBulkAction,
  });
}

export default useBulkParentSiteActions;
