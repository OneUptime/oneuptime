import React, { FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import Color from "Common/Types/Color";
import { Blue, Gray500, Green, Orange, Red } from "Common/Types/BrandColors";
import {
  HostCollectorFields,
  HostCollectorState,
  HostCollectorStateView,
  HostCollectorTone,
  getHostCollectorStateView,
} from "./HostCollectorStatus";

/*
 * Where a managed host's collector stands, as a pill: Running, Applying
 * config, Config failed, Collector error, Not reporting, Connecting - or
 * Installed by hand for a host OneUptime does not manage.
 */

const TONE_COLORS: Record<HostCollectorTone, Color> = {
  success: Green,
  info: Blue,
  warning: Orange,
  danger: Red,
  neutral: Gray500,
};

export interface ComponentProps {
  host: HostCollectorFields;
}

const HostCollectorStatePill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const view: HostCollectorStateView = getHostCollectorStateView(props.host);

  return (
    <span data-testid={`host-collector-state-${view.state}`}>
      <Pill
        text={view.label}
        color={TONE_COLORS[view.tone]}
        isPulsing={
          view.state === HostCollectorState.Applying ||
          view.state === HostCollectorState.Waiting
        }
      />
    </span>
  );
};

export default HostCollectorStatePill;
