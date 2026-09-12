import PageComponentProps from "../../PageComponentProps";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import Incident from "Common/Models/DatabaseModels/Incident";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/**
 * Every incident this SLO's burn rate rules have declared.
 *
 * The twin of the Alerts tab, and found the same way: the worker stamps the
 * same fingerprint on both records it can declare,
 * `slo:<sloId>:burn-rule:<ruleId>` (see
 * ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint), so a
 * StartsWith on the SLO-scoped prefix matches every rule of this SLO and
 * nothing else. `seriesFingerprint` is indexed on Incident too, so this stays
 * a cheap query.
 *
 * Worth its own tab rather than a filter on the global incident list: a
 * burn-rate incident is deliberately invisible on status pages and carries no
 * monitors, so this is the only place it is discoverable from the thing that
 * declared it.
 */
const SloIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Incident> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    seriesFingerprint: new StartsWith(
      `slo:${modelId.toString()}:burn-rule:`,
    ) as unknown as string,
  };

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <IncidentsTable
        query={query}
        title="Incidents"
        description="Incidents declared by this SLO's burn rate rules. They are ordinary incidents, so they carry severity, on-call escalation, notes and the usual state timeline — but they are never published to status pages."
        noItemsMessage="This SLO has not declared any incidents. Turn on Declare Incident for a burn rate rule to open one when the error budget starts burning too fast."
        /*
         * An incident here only means something if a rule declared it — a
         * hand-created one would carry no fingerprint and so would never
         * appear in this list again.
         */
        disableCreate={true}
      />
    </Fragment>
  );
};

export default SloIncidents;
