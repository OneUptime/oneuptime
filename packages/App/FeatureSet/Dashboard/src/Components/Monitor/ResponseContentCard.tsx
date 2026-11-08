import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  RESPONSE_CONTENT_SWITCH_COLUMN,
  RESPONSE_CONTENT_SWITCH_TEST_ID,
  ResponseContentSwitchCopyForType,
  getResponseContentSwitchCopy,
} from "./ResponseContentSwitchCopy";

/*
 * "Response content", on a Website, API or Incoming Request monitor's
 * Settings page: one switch that saves when it is flipped
 * (Monitor.keepResponseContent). On, the monitor's incidents and alerts keep
 * an excerpt of the response around what matched and the response body,
 * with secrets and personal data masked; off, they keep none of it. Nothing
 * for the other monitor types, whose checks carry no body.
 */

export interface ComponentProps {
  monitorId: ObjectID;
  monitorType: MonitorType;
}

const ResponseContentCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: ResponseContentSwitchCopyForType | null =
    getResponseContentSwitchCopy(props.monitorType);

  if (!copy) {
    return <Fragment />;
  }

  return (
    <ModelSwitchCard<Monitor>
      modelType={Monitor}
      modelId={props.monitorId}
      column={RESPONSE_CONTENT_SWITCH_COLUMN}
      cardTitle={copy.cardTitle}
      cardDescription={copy.cardDescription}
      title={copy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn ? copy.onDescription : copy.offDescription;
      }}
      dataTestId={RESPONSE_CONTENT_SWITCH_TEST_ID}
    />
  );
};

export default ResponseContentCard;
