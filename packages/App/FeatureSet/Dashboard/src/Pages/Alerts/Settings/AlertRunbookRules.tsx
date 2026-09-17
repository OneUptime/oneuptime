import PageComponentProps from "../../PageComponentProps";
import RunbookRulesTable from "../../../Components/Runbook/RunbookRulesTable";
import RunbookRuleTriggerEntity from "Common/Types/Runbook/RunbookRuleTriggerEntity";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const AlertRunbookRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <RunbookRulesTable
        triggerEntityType={RunbookRuleTriggerEntity.Alert}
        entityLabel="alert"
      />
    </Fragment>
  );
};

export default AlertRunbookRulesPage;
