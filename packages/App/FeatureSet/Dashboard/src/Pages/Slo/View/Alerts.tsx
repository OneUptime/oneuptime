import PageComponentProps from "../../PageComponentProps";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Alert from "Common/Models/DatabaseModels/Alert";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/**
 * Every alert this SLO's burn rate rules have raised.
 *
 * Burn rate alerts are ordinary Alerts, which is what makes on-call
 * escalation, acknowledgement and Slack routing work. What ties one back to
 * this SLO is the alert's `serviceLevelObjectives` relation: the worker links
 * the SLO when a rule raises the alert, and the same link puts the SLO in the
 * alert's Affected Resources card, its row in every alert list, the Affected
 * Resources filter and the alert's "created" feed item. Alerts raised before
 * the relation existed were linked by the migration that added it, from the
 * fingerprint the worker has always stamped (`slo:<sloId>:burn-rule:<ruleId>`).
 *
 * The list reads the relation rather than a StartsWith on that fingerprint so
 * that it agrees with every other surface - in particular the open-alert
 * badge on this SLO's side menu, which counts the same relation. The
 * fingerprint is still what the worker dedupes and auto-resolves on.
 *
 * The Incidents tab is the twin of this one, over the same relation on
 * Incident.
 */
const SloAlerts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Alert> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    serviceLevelObjectives: new Includes([modelId]),
  };

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <AlertsTable
        query={query}
        title="Alerts"
        description="Alerts raised by this SLO's burn rate rules. They are ordinary alerts, so they carry severity, on-call escalation and the usual state timeline, and each one lists this SLO under its affected resources. A rule that declares incidents instead shows them on the Incidents tab."
        noItemsMessage="This SLO has not raised any alerts. Burn rate rules create one when the error budget starts burning too fast."
        /*
         * An alert belongs here only because a rule linked it to this SLO.
         * That link is not offered when creating or editing an alert, so a
         * hand-created one would never appear in this list.
         */
        disableCreate={true}
      />
    </Fragment>
  );
};

export default SloAlerts;
