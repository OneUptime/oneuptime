import PageComponentProps from "../../PageComponentProps";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import Alert from "Common/Models/DatabaseModels/Alert";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/**
 * Every alert this SLO's burn rate rules have raised.
 *
 * Burn rate alerts are ordinary Alerts, which is what makes on-call
 * escalation, acknowledgement and Slack routing work — but it also meant
 * they landed in the global alert list with no way back to the SLO that
 * raised them, and the SLO itself had no record that it had ever paged
 * anyone.
 *
 * They are found by the fingerprint the worker stamps on every alert it
 * creates, `slo:<sloId>:burn-rule:<ruleId>` (see
 * ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint) —
 * a StartsWith on the SLO-scoped prefix therefore matches every rule of
 * this SLO and nothing else. `seriesFingerprint` is indexed, so this stays
 * a cheap query.
 */
const SloAlerts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Alert> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    seriesFingerprint: new StartsWith(
      `slo:${modelId.toString()}:burn-rule:`,
    ) as unknown as string,
  };

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <AlertsTable
        query={query}
        title="Alerts"
        description="Alerts raised by this SLO's burn rate rules. They are ordinary alerts, so they carry severity, on-call escalation and the usual state timeline."
        noItemsMessage="This SLO has not raised any alerts. Burn rate rules create one when the error budget starts burning too fast."
        /*
         * An alert here only means something if a rule raised it — a
         * hand-created one would carry no fingerprint and so would never
         * appear in this list again.
         */
        disableCreate={true}
      />
    </Fragment>
  );
};

export default SloAlerts;
