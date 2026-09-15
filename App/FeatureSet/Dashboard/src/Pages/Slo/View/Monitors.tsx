import PageComponentProps from "../../PageComponentProps";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const SloMonitors: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // The route is <sloId>/monitors, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <Card
        title="Monitors"
        description="The monitors whose uptime this SLO measures, whether attached by hand or by one of this SLO's monitor rules."
      />
    </Fragment>
  );
};

export default SloMonitors;
