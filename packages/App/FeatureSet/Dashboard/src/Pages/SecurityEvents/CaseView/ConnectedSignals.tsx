import PageComponentProps from "../../PageComponentProps";
import ConnectedSignals from "../../../Components/SecurityConnections/ConnectedSignals";
import { CONNECTED_SIGNALS_CASE_DESCRIPTION } from "../../../Components/SecurityConnections/SecurityConnectionsCopy";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A case's Connected Signals: the users, hosts and addresses it names as the
 * rest of OneUptime knows them - the project's hosts, container hosts,
 * Kubernetes clusters, network devices, services and users - each with its
 * logs, traces and metrics around the case's detections, the incidents and
 * alerts open on it, the monitors watching it and what changed on it
 * (Components/SecurityConnections). Read again whenever the case is (its
 * refresh), as a new detection can name more.
 */
const SecurityCaseConnectedSignalsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();
  const caseId: ObjectID = view.caseId;

  return (
    <ConnectedSignals
      request={{ caseId }}
      requestKey={`case:${caseId.toString()}`}
      refreshToken={view.refreshToggle}
      description={CONNECTED_SIGNALS_CASE_DESCRIPTION}
    />
  );
};

export default SecurityCaseConnectedSignalsPage;
