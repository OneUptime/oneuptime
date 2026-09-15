import PageComponentProps from "../../PageComponentProps";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const SloMonitorRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // The route is <sloId>/monitor-rules, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <Card
        title="Monitor Rules"
        description="Rules that attach matching monitors to this SLO automatically, and detach them again when they stop matching."
      />
    </Fragment>
  );
};

export default SloMonitorRules;
