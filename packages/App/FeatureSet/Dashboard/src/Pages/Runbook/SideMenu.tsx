import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { ReactElement } from "react";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import { addDeveloperSideMenuSection } from "../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../Components/DeveloperDocs/DeveloperDocsPages";

const RunbookSideMenu: () => ReactElement = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Runbooks",
      items: [
        {
          link: {
            title: "Runbooks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS] as Route,
            ),
          },
          icon: IconProp.BookOpen,
        },
        {
          link: {
            title: "Executions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_EXECUTIONS] as Route,
            ),
          },
          icon: IconProp.Play,
        },
      ],
    },
    /*
     * Runners have a section of their own, not a row inside Settings: a Bash,
     * SSH or Kubernetes step cannot run without one, and the section's title
     * is where people look to see whether theirs is still connected. The AI
     * pages that need a Runner (code fixes, remediation commands) link
     * straight to these too.
     *
     * Folded down to that title until opened, like every rarely used section:
     * a Runner is installed once and checked now and then, while the
     * runbooks and their executions above are what this menu is opened for.
     * It opens by itself on the Runners and Credentials pages, and on a
     * Runner's own page.
     */
    {
      title: "Runners",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Runners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,
            ),
          },
          icon: IconProp.Terminal,
        },
        {
          link: {
            title: "Credentials",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_RUNNER_CREDENTIALS] as Route,
            ),
          },
          icon: IconProp.Key,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SECRETS] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
  ];

  addDeveloperSideMenuSection(sections, {
    modelType: Runbook,
    scope: DeveloperDocsScope.List,
  });

  return <SideMenu sections={sections} />;
};

export default RunbookSideMenu;
