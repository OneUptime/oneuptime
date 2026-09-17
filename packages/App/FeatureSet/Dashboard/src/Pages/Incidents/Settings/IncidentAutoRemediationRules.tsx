import PageComponentProps from "../../PageComponentProps";
import AutoRemediationRulesTable from "../../../Components/AutoRemediation/AutoRemediationRulesTable";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentAutoRemediationRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <AutoRemediationRulesTable
        triggerEntityType={AutoRemediationTriggerEntity.Incident}
        entityLabel="incident"
      />
    </Fragment>
  );
};

export default IncidentAutoRemediationRulesPage;
