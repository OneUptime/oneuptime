import PageComponentProps from "../../PageComponentProps";
import RunbookRulesTable from "../../../Components/Runbook/RunbookRulesTable";
import RunbookRuleTriggerEntity from "Common/Types/Runbook/RunbookRuleTriggerEntity";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ScheduledMaintenanceRunbookRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <RunbookRulesTable
        triggerEntityType={RunbookRuleTriggerEntity.ScheduledMaintenance}
        entityLabel="scheduled maintenance event"
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceRunbookRulesPage;
