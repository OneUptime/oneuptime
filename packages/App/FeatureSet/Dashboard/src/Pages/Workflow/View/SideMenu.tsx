import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import React, { FunctionComponent, ReactElement } from "react";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Builder",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_BUILDER] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Workflow}
        />

        <SideMenuItem
          link={{
            title: "Workflow Variables",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_VARIABLES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Variable}
        />
      </SideMenuSection>

      {/*
       * Runs sit in a Logs section of their own, right under the Builder, the
       * same as in the Workflows menu: checking that a change worked is the
       * next thing people do after making it, so the run history must not be
       * filed under Advanced, which is about settings and deletion.
       *
       * Open on purpose. Logs sections start collapsed in other menus, where
       * they hold records looked at now and then (notification logs, say);
       * a workflow's runs are what it is checked by.
       */}
      <SideMenuSection title="Logs" defaultCollapsed={false}>
        <SideMenuItem
          link={{
            title: "Runs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
      </SideMenuSection>

      <SideMenuSection title="Owners">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: Workflow,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />

        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />

        <SideMenuItem
          link={{
            title: "Delete Workflow",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.WORKFLOW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
