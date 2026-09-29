import PageComponentProps from "../../PageComponentProps";
import SloHistoryCharts from "../../../Components/Slo/SloHistoryCharts";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The legacy Charts route. Its history charts are now the Error Budget
 * History tab of the Metrics page and no side menu entry links here, but the
 * route still resolves so bookmarked and shared links keep showing the same
 * charts instead of a blank layout.
 */
const SloCharts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <SloHistoryCharts sloId={modelId} />
    </Fragment>
  );
};

export default SloCharts;
