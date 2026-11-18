import React, { FunctionComponent, ReactElement } from "react";
import Pill from "Common/UI/Components/Pill/Pill";
import Color from "Common/Types/Color";
import { Amber500, Blue, Gray500, Green, Red } from "Common/Types/BrandColors";
import {
  HostCollectorFields,
  HostCollectorState,
  HostCollectorStateView,
  HostCollectorTone,
  getHostCollectorErrorSummary,
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
  /*
   * Under a Config failed or Collector error pill, why, in the collector's
   * own one line - for a list where the pill alone sent the reader to each
   * host's page to find out (#9537). The host's errors must be read.
   */
  isErrorShown?: boolean | undefined;
}

const HostCollectorStatePill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const view: HostCollectorStateView = getHostCollectorStateView(props.host);
  const error: string | null = props.isErrorShown
    ? getHostCollectorErrorSummary(props.host)
    : null;

  if (error) {
    return (
      <span className="inline-flex max-w-full flex-col items-start gap-0.5">
        <span
          className="inline-flex max-w-full align-middle"
          data-testid={`host-collector-state-${view.state}`}
        >
          <Pill
            text={view.label}
            color={HOST_COLLECTOR_TONE_COLORS[view.tone]}
          />
        </span>
        <span
          data-testid="host-collector-error"
          title={error}
          className={`line-clamp-2 text-xs [overflow-wrap:anywhere] ${
            view.tone === "danger" ? "text-red-700" : "text-amber-700"
          }`}
        >
          <bdi>{error}</bdi>
        </span>
      </span>
    );
  }

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
