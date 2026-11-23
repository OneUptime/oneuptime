import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A CUSTOM ROLE'S OWN MENU, as a team's page has one (Pages/Teams/View).
 *
 *   - Custom Role > Overview: the role itself - what it gives, who has it,
 *     the workflows that run as it and deleting it - on one page, in the
 *     order they are used (the Enterprise RoleViewPage);
 *   - Developer, folded: Terraform, Crossplane, API, CLI and AI Assistants
 *     for this role (#10139), where the API and CLI pages' Delete it step
 *     says what the workflows that run as it run as instead (#10031).
 *
 * The role's page used to be drawn inside the Teams menu, with Roles marked
 * and no menu of its own, so no Developer page of a custom role could be
 * reached. Its trail leads back to Roles: Project > Teams > Roles >
 * Incident Responder.
 */
const TeamRoleViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: Array<SideMenuSectionProps> = [
    {
      title: "Custom Role",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.TEAM_ROLE_VIEW] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Info,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: CustomRole,
    scope: DeveloperDocsScope.View,
    modelId: props.modelId,
  });

  return <SideMenu sections={sections} />;
};

export default TeamRoleViewSideMenu;
