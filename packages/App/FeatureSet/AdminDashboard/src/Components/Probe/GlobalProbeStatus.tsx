import { Green, Red, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import ProbeBehindUtil from "Common/Types/Probe/ProbeBehind";
import { translationKey } from "Common/Types/Translator";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A GLOBAL PROBE'S STATUS, AS OneUptime Health AND Settings > Global Probes
 * SHOW IT.
 *
 *   - Connected: it reported in the last GLOBAL_PROBE_REPORTING_MINUTES.
 *   - Behind: it reports, but its monitors are checked, or its network
 *     devices polled, later than their interval (OneUptime issues #9488
 *     and #9499, Types/Probe/ProbeBehind). Overview's What needs attention
 *     says which, since when, and what to do.
 *   - Disconnected: otherwise.
 *
 * The two pages each worked out Connected on their own; a table that shows
 * this selects lastAlive, checksLateSince, checksLastLateAt,
 * devicePollsLateSince and devicePollsLastLateAt.
 */

export const GLOBAL_PROBE_REPORTING_MINUTES: number = 5;

export enum GlobalProbeStatus {
  Connected = "connected",
  Behind = "behind",
  Disconnected = "disconnected",
}

export const GLOBAL_PROBE_STATUS_WORDS: Readonly<
  Record<GlobalProbeStatus, string>
> = {
  [GlobalProbeStatus.Connected]: translationKey("Connected"),
  [GlobalProbeStatus.Behind]: translationKey("Behind"),
  [GlobalProbeStatus.Disconnected]: translationKey("Disconnected"),
};

export const getGlobalProbeStatus: (
  probe: Probe,
  now?: Date,
) => GlobalProbeStatus = (
  probe: Probe,
  now: Date = OneUptimeDate.getCurrentDate(),
): GlobalProbeStatus => {
  const lastAlive: Date | undefined = probe?.lastAlive
    ? OneUptimeDate.fromString(probe.lastAlive)
    : undefined;

  if (
    !lastAlive ||
    OneUptimeDate.getNumberOfMinutesBetweenDates(lastAlive, now) >=
      GLOBAL_PROBE_REPORTING_MINUTES
  ) {
    return GlobalProbeStatus.Disconnected;
  }

  return ProbeBehindUtil.isProbeBehind(probe)
    ? GlobalProbeStatus.Behind
    : GlobalProbeStatus.Connected;
};

const GlobalProbeStatusElement: FunctionComponent<{ probe: Probe }> = (props: {
  probe: Probe;
}): ReactElement => {
  const status: GlobalProbeStatus = getGlobalProbeStatus(props.probe);

  return (
    <Statusbubble
      text={GLOBAL_PROBE_STATUS_WORDS[status]}
      color={
        status === GlobalProbeStatus.Connected
          ? Green
          : status === GlobalProbeStatus.Behind
            ? Yellow
            : Red
      }
      shouldAnimate={status === GlobalProbeStatus.Connected}
    />
  );
};

export default GlobalProbeStatusElement;
