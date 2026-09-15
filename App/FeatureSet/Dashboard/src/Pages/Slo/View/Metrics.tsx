import PageComponentProps from "../../PageComponentProps";
import SloCharts from "./Charts";
import React, { FunctionComponent, ReactElement } from "react";

const SloMetrics: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * The side menu links here instead of to Charts, so until this page has
   * metric views of its own it shows the same history charts - otherwise the
   * SLO's history would only be reachable by typing the old Charts URL.
   * Charts reads the SLO id itself, and <sloId>/metrics puts it in the same
   * place as <sloId>/charts.
   */
  return <SloCharts {...props} />;
};

export default SloMetrics;
