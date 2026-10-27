import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import { getDeveloperSideMenuSection } from "../../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../../Components/DeveloperDocs/DeveloperDocsPages";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A cloud account's pages: what it holds first (its Overview, its
 * Resources and how they fit together), then what OneUptime AI may do and
 * did in it, what changed in it, its own settings, its API pages and,
 * last, deleting it.
 */
const CloudAccountSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Resources",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.SquareStack}
        />
        <SideMenuItem
          link={{
            title: "Topology",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_TOPOLOGY] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.FlowDiagram}
        />
      </SideMenuSection>

      {/*
       * What OneUptime AI may do in the account (its Cloud AI agent) and
       * everything it did there.
       */}
      <SideMenuSection title="AI">
        <SideMenuItem
          link={{
            title: "AI agent",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_AI_AGENT] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Automation}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_AI_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.QueueList}
        />
      </SideMenuSection>

      <SideMenuSection title="Activity">
        <SideMenuItem
          link={{
            title: "Changes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_CHANGES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Activity}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: CloudAccount,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Account",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_DELETE] as Route,
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

export default CloudAccountSideMenu;
