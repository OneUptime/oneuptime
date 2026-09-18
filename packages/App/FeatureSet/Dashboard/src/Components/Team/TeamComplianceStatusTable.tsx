import { IDENTITY_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import {
  TeamComplianceStatusTablePluginProps,
  TeamComplianceStatusTableProps,
  TeamComplianceStatusTableRef,
} from "../../Enterprise/EnterprisePlugins";
import { getDashboardPlugins } from "../../Enterprise/Plugins";
import React, { Fragment, ReactElement, forwardRef } from "react";

/*
 * Who on a team satisfies its compliance rules. Same export, props and
 * imperative handle ({ refresh }) as always, so any team surface can keep
 * importing it from here.
 *
 * The table is Enterprise code (ee/Dashboard/TeamCompliance/
 * TeamComplianceStatusTable); this shell renders it through the Dashboard
 * plugin, handing the caller's ref straight to it, when the project may use
 * team compliance and the build includes the Enterprise screens.
 *
 * Otherwise it renders NOTHING rather than an upsell card: it is one section
 * of a page, the page (Teams > View > Compliance) already carries the team
 * compliance upsell, and a second card under it would only repeat it. The ref
 * then stays null, so a caller's `ref.current?.refresh()` is a no-op - exactly
 * as when the old table had nothing to show.
 */
export type ComponentProps = TeamComplianceStatusTableProps;

export type { TeamComplianceStatusTableRef };

const TeamComplianceStatusTable: React.ForwardRefExoticComponent<
  ComponentProps & React.RefAttributes<TeamComplianceStatusTableRef>
> = forwardRef<TeamComplianceStatusTableRef, ComponentProps>(
  (
    props: ComponentProps,
    ref: React.Ref<TeamComplianceStatusTableRef>,
  ): ReactElement => {
    return (
      <EnterprisePluginPage<TeamComplianceStatusTablePluginProps>
        plugin={getDashboardPlugins().TeamComplianceStatusTable}
        pluginProps={{ ...props, ref }}
        requiredPlan={IDENTITY_REQUIRED_PLAN}
        renderUpsell={(): ReactElement => {
          return <Fragment />;
        }}
      />
    );
  },
);

TeamComplianceStatusTable.displayName = "TeamComplianceStatusTable";

export default TeamComplianceStatusTable;
