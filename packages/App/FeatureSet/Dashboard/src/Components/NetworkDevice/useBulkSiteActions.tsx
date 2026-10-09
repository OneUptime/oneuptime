import React from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useBulkDeviceRelationActions, {
  BulkDeviceRelationActionsResult,
} from "./useBulkDeviceRelationActions";

/*
 * "Set Site" / "Clear Site" on Network -> Devices.
 *
 * For an MSP, a site is a customer's building or office, and a discovery
 * scan of a customer's range brings in dozens of devices that all belong in
 * one of them. Filing them is one dialog: pick the site, save. Each device
 * then counts toward that site's health, and one without a probe of its own
 * picks up the site's default probe (NetworkDeviceService, on the move).
 *
 * The dialog also says where the same thing happens by itself: a site
 * assignment rule places devices a scan finds later, by subnet or hostname,
 * so the next scan of that customer needs no bulk edit at all.
 */

export const SET_SITE_ACTION_TITLE: string = translationKey("Set Site");

export const CLEAR_SITE_ACTION_TITLE: string = translationKey("Clear Site");

export const SET_SITE_DESCRIPTION: string = translationKey(
  "Moves every selected device into this site, where it counts toward the site's health. A device without a probe of its own picks up the site's default probe.",
);

export const SITE_ASSIGNMENT_RULES_HINT: string = translationKey(
  "Devices that discovery finds later can be placed in a site automatically with a {{siteAssignmentRule}}.",
);

export const SITE_ASSIGNMENT_RULE_LINK_TEXT: string = translationKey(
  "site assignment rule",
);

export const CLEAR_SITE_CONFIRM_TITLE: PluralTemplate = {
  one: "Remove {{count}} device from its site?",
  other: "Remove {{count}} devices from their sites?",
};

/*
 * The rule half is the surprise worth naming: a device with no site is
 * re-evaluated on every poll, so one a rule matches goes straight back.
 */
export const CLEAR_SITE_CONFIRM_MESSAGE: PluralTemplate = {
  one: "It stops counting toward its site's health and keeps its probe. If a site assignment rule matches it, the rule puts it back in that rule's site on its next poll.",
  other:
    "They stop counting toward their sites' health and keep their probes. A device a site assignment rule matches goes back to that rule's site on its next poll.",
};

function useBulkSiteActions(): BulkDeviceRelationActionsResult {
  const translator: Translator = useTranslator();

  const assignmentRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_SITE_ASSIGNMENT_RULES] as Route,
  );

  return useBulkDeviceRelationActions({
    column: "siteId",
    set: {
      title: SET_SITE_ACTION_TITLE,
      icon: IconProp.BuildingOffice,
      description: SET_SITE_DESCRIPTION,
      submitButtonText: "Set Site",
      field: {
        title: "Site",
        placeholder: "Select a site",
        dropdownModal: {
          type: NetworkSite,
          labelField: "name",
          valueField: "_id",
        },
        sideLink: {
          text: "Manage sites",
          url: RouteUtil.populateRouteParams(
            RouteMap[PageMap.NETWORK_SITES] as Route,
          ),
          openLinkInNewTab: true,
        },
      },
      footer: (
        <p
          className="mt-2 text-sm text-gray-500"
          data-testid="set-site-assignment-rules-hint"
        >
          <TranslatedSentence
            template={SITE_ASSIGNMENT_RULES_HINT}
            slots={{
              siteAssignmentRule: (
                <Link
                  to={assignmentRulesRoute}
                  openInNewTab={true}
                  className="font-medium text-indigo-600 hover:underline"
                >
                  {translator.translateText(SITE_ASSIGNMENT_RULE_LINK_TEXT) ||
                    SITE_ASSIGNMENT_RULE_LINK_TEXT}
                </Link>
              ),
            }}
          />
        </p>
      ),
    },
    clear: {
      title: CLEAR_SITE_ACTION_TITLE,
      icon: IconProp.LinkSlash,
      confirmTitle: CLEAR_SITE_CONFIRM_TITLE,
      confirmMessage: CLEAR_SITE_CONFIRM_MESSAGE,
    },
    hasRelation: (device: NetworkDevice): boolean => {
      return Boolean(device.siteId || device.site?._id);
    },
  });
}

export default useBulkSiteActions;
