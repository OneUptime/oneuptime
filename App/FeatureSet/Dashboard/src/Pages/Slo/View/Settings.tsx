import PageComponentProps from "../../PageComponentProps";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const SloSettings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // The route is <sloId>/settings, so the id is one segment back.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <Card
        title="Settings"
        description="How this SLO measures downtime, when it is evaluated, and whether it is archived."
      />
    </Fragment>
  );
};

export default SloSettings;
