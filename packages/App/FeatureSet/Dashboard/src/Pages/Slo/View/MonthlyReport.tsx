import PageComponentProps from "../../PageComponentProps";
import SloMonthlyReportElement from "../../../Components/Slo/SloMonthlyReport";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * An SLO's Monthly Report: how it did each calendar month of the last 3,
 * 6, 9 or 12 months, or of a calendar year, with the period's total and,
 * for an SLO of several monitors, each monitor's own months (#5476).
 *
 * The banner sits above the report, as on every SLO page, so a disabled,
 * archived or misconfigured SLO says so here too: the report still reads
 * its monitors' history, but its newest months may have nothing in them.
 */
const SloMonthlyReport: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <SloMonthlyReportElement sloId={modelId} />
    </Fragment>
  );
};

export default SloMonthlyReport;
