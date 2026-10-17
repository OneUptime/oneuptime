import MonitorGroupMonitorsCopy from "./MonitorGroupMonitorsCopy";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// The data-testid of an empty group's status, wherever it is drawn.
export const NO_MONITORS_STATUS_TEST_ID: string =
  "monitor-group-status-no-monitors";

/*
 * The status of a monitor group with no monitors: it has nothing to be
 * operational about. The server answers such a group's status as the
 * operational one, so the group's Overview and the list of groups both draw
 * this in its place, in quiet grey, instead of a green Operational.
 */
const NoMonitorsStatus: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span
      className="text-sm text-gray-500"
      data-testid={NO_MONITORS_STATUS_TEST_ID}
    >
      {translator.translateText(MonitorGroupMonitorsCopy.emptyGroupStatus) ||
        MonitorGroupMonitorsCopy.emptyGroupStatus}
    </span>
  );
};

export default NoMonitorsStatus;
