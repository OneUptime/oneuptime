import { Green, Red, Yellow } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import ProbeBehindUtil, {
  ProbeLateChecksRead,
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
 * monitors are checked later than their interval (OneUptime issue #9488,
 * Types/Probe/ProbeBehind) - a list that says so selects checksLateSince
 * and checksLastLateAt; Disconnected otherwise.
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
      ProbeBehindUtil.isBehind(props.probe as ProbeLateChecksRead)
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
