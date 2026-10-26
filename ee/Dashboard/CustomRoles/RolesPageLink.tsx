import AppLink from "@oneuptime/dashboard/Components/AppLink/AppLink";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/dashboard/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "the Roles page", as a link to it, in the reader's language - the {{roles}}
 * slot of the sentences that send people there: a team's and an API key's
 * Custom Roles cards, and their Add a Custom Role dialogs. The page waits in
 * the Teams menu's folded Settings section, and neither a team's menu nor a
 * key's page leads to it, so its name alone left the reader to find it.
 */

export const ROLES_PAGE_LINK_TEST_ID: string = "roles-page-link";

const RolesPageLink: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <AppLink
      className="font-medium text-indigo-600 hover:underline"
      to={RouteUtil.populateRouteParams(RouteMap[PageMap.TEAM_ROLES] as Route)}
      dataTestId={ROLES_PAGE_LINK_TEST_ID}
    >
      {translator.translateText("Roles") || "Roles"}
    </AppLink>
  );
};

export default RolesPageLink;
