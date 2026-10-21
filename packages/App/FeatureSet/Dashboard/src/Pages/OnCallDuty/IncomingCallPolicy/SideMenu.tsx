import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * An incoming call policy's menu reads like an on-call policy's: Basic,
 * Logs, Developer, then Advanced with Settings, Audit Logs and Delete
 * Policy. It used to have a Danger Zone section for Delete Policy alone,
 * and a Documentation page that drew a manual of its own in the product -
 * the docs page (/docs/on-call/incoming-call-policy) is the one place for
 * it, linked from the policy list's ⋯ menu, and the old address forwards to
 * the policy's Overview (MovedPagePaths).
 */
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
              RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Escalation Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_ESCALATION
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.BarsArrowDown}
        />
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_OWNERS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      <SideMenuSection title="Logs">
        <SideMenuItem
          link={{
            title: "Call Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: IncomingCallPolicy,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_SETTINGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_AUDIT_LOGS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete Policy",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_DELETE
              ] as Route,
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
