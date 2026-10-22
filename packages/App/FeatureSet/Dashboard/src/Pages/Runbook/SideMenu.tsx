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
        /*
         * The Runners sit with the runbooks, not in Settings: a Bash, SSH or
         * kubectl step runs on one, and this is where people look to see
         * whether theirs is still connected. The AI pages that need a Runner
         * (code fixes, remediation commands) link straight here too.
         *
         * They had a section of their own while AI Access stood beside them
         * (the runbook credentials OneUptime AI's commands reached a host or a
         * cluster with). AI Access is gone - hosts and Kubernetes clusters
         * have AI agents of their own - and a section holding one row named
         * like itself is a fold to open for nothing, so the row is here.
         */
        {
          link: {
            title: "Runners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,
            ),
          },
          icon: IconProp.Terminal,
        },
      ],
    },
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Global Variables",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_VARIABLES] as Route,
            ),
          },
          icon: IconProp.Variable,
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
