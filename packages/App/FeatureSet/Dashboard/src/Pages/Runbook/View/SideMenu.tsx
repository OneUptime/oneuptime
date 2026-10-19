import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import RunbookModel from "Common/Models/DatabaseModels/Runbook";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A runbook's own menu shows as little as it can: Basic holds what people
 * open a runbook for - its Overview, with Run Now, and its Steps - and every
 * other section is folded down to its title, as the maintainer asked:
 *
 *   "move executions to logs in the side menu, in the log section, which
 *   should be collapsed by default ... move triggers to the settings side
 *   menu, which should also be collapsed by default ... show as little stuff
 *   as possible to the user, so it reduces decision paralysis."
 *
 * Logs and Settings fold by their titles (SECTION_TITLES_COLLAPSED_BY_DEFAULT
 * in SideMenuSectionState.ts), like every Logs and Settings section in the
 * product, and each opens by itself on a page inside it, so the page someone
 * is on is never folded away. The Overview still leads to the runs in one
 * click: Last Run opens that run, and Total Runs the Executions list.
 */
const RunbookViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * One run's page is one of the runs Executions lists, so Executions stays
   * the marked entry there (and the phone menu's button says Logs /
   * Executions rather than nothing). Matching on the run's route only while
   * that page is open keeps Executions marked on its own page too.
   */
  const executionRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
    { modelId: props.modelId },
  );
  const isOnExecutionPage: boolean = Navigation.isOnThisPage(executionRoute);

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Steps",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
      </SideMenuSection>

      {/*
       * The runs: looked at when something needs checking, so folded away
       * like the Logs of an on-call policy, schedule or incoming call policy.
       */}
      <SideMenuSection title="Logs">
        <SideMenuItem
          link={{
            title: "Executions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route,
              { modelId: props.modelId },
            ),
          }}
          activeRoute={isOnExecutionPage ? executionRoute : undefined}
          icon={IconProp.Play}
        />
      </SideMenuSection>

      <SideMenuSection title="Owners">
        <SideMenuItem
          link={{
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Team}
        />
      </SideMenuSection>

      {/*
       * How the runbook runs, set up once and revisited rarely: its schedule
       * and webhook (Triggers), and whether it may run at all (Settings).
       * The Settings page sits in the Settings section, as a resource's own
       * Settings page does in the other menus that have one (a database's,
       * a RUM application's), so nobody looks for it under Advanced.
       */}
      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Triggers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_TRIGGERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Bolt}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: RunbookModel,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Delete Runbook",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOK_VIEW_DELETE] as Route,
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

export default RunbookViewSideMenu;
