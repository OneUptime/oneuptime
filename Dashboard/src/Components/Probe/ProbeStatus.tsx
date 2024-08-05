import { Green, Red } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import Statusbubble from "CommonUI/src/Components/StatusBubble/StatusBubble";
import Probe, { ProbeConnectionStatus } from "Common/AppModels/Models/Probe";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probe: Probe | JSONObject;
}

const ProbeStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    props.probe &&
    props.probe["connectionStatus"] === ProbeConnectionStatus.Connected
  ) {
    return (
      <Statusbubble text={"Connected"} color={Green} shouldAnimate={true} />
    );
  }

  return (
    <Statusbubble text={"Disconnected"} color={Red} shouldAnimate={false} />
  );
};

export default ProbeStatusElement;
