import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import RunbookScheduleCard from "../../../Components/Runbook/Triggers/RunbookScheduleCard";
import RunbookWebhookCard from "../../../Components/Runbook/Triggers/RunbookWebhookCard";

/*
 * A runbook's Triggers: the ways it starts with nobody pressing Run Now.
 * A schedule - every few minutes, every day, on days of the week, or a cron
 * expression, on a time zone's clock - and a webhook URL another tool calls.
 * Both start runs through the same path Run Now does, and each run says on
 * its page what started it.
 */
const RunbookTriggers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <RunbookScheduleCard runbookId={modelId} />
      <RunbookWebhookCard runbookId={modelId} />
    </Fragment>
  );
};

export default RunbookTriggers;
