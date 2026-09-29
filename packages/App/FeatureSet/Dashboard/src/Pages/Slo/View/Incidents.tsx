import PageComponentProps from "../../PageComponentProps";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Incident from "Common/Models/DatabaseModels/Incident";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/**
 * Every incident this SLO's burn rate rules have declared.
 *
 * The twin of the Alerts tab, and found the same way: through the incident's
 * `serviceLevelObjectives` relation, which the worker writes when a rule
 * declares the incident. Incidents declared before the relation existed were
 * linked by the migration that added it, from the fingerprint the worker has
 * always stamped (`slo:<sloId>:burn-rule:<ruleId>`). Reading the relation
 * keeps this list in step with the incident's Affected Resources card, the
 * Affected Resources filter and the open-incident badge on this SLO's side
 * menu, which all read the same link.
 *
 * Worth its own tab rather than a filter on the global incident list: a
 * burn-rate incident is deliberately invisible on status pages and carries no
 * monitors (resolving one would otherwise rewrite monitor status history), so
 * its SLO is the one resource it names, and this is where it is discoverable
 * from the objective that declared it.
 */
const SloIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Incident> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
    serviceLevelObjectives: new Includes([modelId]),
  };

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <IncidentsTable
        query={query}
        title="Incidents"
        description="Incidents declared by this SLO's burn rate rules. They are ordinary incidents, so they carry severity, on-call escalation, notes and the usual state timeline, and each one lists this SLO under its affected resources — but they are never published to status pages."
        noItemsMessage="This SLO has not declared any incidents. Turn on Declare Incident for a burn rate rule to open one when the error budget starts burning too fast."
        /*
         * An incident belongs here only because a rule linked it to this
         * SLO. That link is not offered when declaring or editing an
         * incident, so a hand-created one would never appear in this list.
         */
        disableCreate={true}
      />
    </Fragment>
  );
};

export default SloIncidents;
