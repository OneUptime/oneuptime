import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import ProbeBehindUtil, {
  ProbeBehindRead,
} from "Common/Types/Probe/ProbeBehind";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probe: Probe | JSONObject;
  /*
   * Only whether it is connected: the probe's page, which says whether it
   * keeps up in a field of its own (ProbeChecksElement).
   */
  isConnectionOnly?: boolean | undefined;
}

/*
 * A probe's status: Connected; Behind when it is connected but its
 * monitors are checked, or its network devices polled, later than their
 * interval (OneUptime issues #9488 and #9499, Types/Probe/ProbeBehind) - a
 * list that says so selects checksLateSince, checksLastLateAt,
 * devicePollsLateSince and devicePollsLastLateAt; Disconnected otherwise.
 */
const ProbeStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    props.probe &&
    props.probe["connectionStatus"] === ProbeConnectionStatus.Connected
  ) {
    if (
      !props.isConnectionOnly &&
      ProbeBehindUtil.isProbeBehind(props.probe as ProbeBehindRead)
    ) {
      return (
        <Statusbubble text={"Behind"} color={Yellow} shouldAnimate={false} />
      );
    }

    return (
      <Statusbubble text={"Connected"} color={Green} shouldAnimate={true} />
    );
  }

  return (
    <Statusbubble text={"Disconnected"} color={Red} shouldAnimate={false} />
  );
};

export default ProbeStatusElement;
