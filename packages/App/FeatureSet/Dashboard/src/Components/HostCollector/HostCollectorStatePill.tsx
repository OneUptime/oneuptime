import React, { FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import Color from "Common/Types/Color";
import { Amber500, Blue, Gray500, Green, Red } from "Common/Types/BrandColors";
import {
  HostCollectorFields,
  HostCollectorState,
  HostCollectorStateView,
  HostCollectorTone,
  getHostCollectorStateView,
} from "./HostCollectorStatus";

/*
 * Where a managed host's collector stands, as a pill: Running, Applying
 * config, Config failed, Collector error, Not reporting, Starting - or
 * Installed by hand for a host OneUptime does not manage.
 */

/*
 * Amber for a warning, as the product's other warnings are: the coral
 * Orange read as a second red beside Config failed.
 */
export const HOST_COLLECTOR_TONE_COLORS: Record<HostCollectorTone, Color> = {
  success: Green,
  info: Blue,
  warning: Amber500,
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
    /*
     * A box of the pill's own height: an inline wrapper sat the pill on the
     * line of the cell or sentence around it, a few pixels below the pills
     * beside it.
     */
    <span
      className="inline-flex max-w-full align-middle"
      data-testid={`host-collector-state-${view.state}`}
    >
      <Pill
        text={view.label}
        color={HOST_COLLECTOR_TONE_COLORS[view.tone]}
        isPulsing={
          view.state === HostCollectorState.Applying ||
          view.state === HostCollectorState.Waiting
        }
      />
    </span>
  );
};

export default HostCollectorStatePill;
