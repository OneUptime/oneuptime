import { Green, Red, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import ProbeBehindUtil, {
  ProbeBehindBy,
  ProbeBehindByUnit,
} from "Common/Types/Probe/ProbeBehind";
import { translationKey } from "Common/Types/Translator";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A GLOBAL PROBE'S STATUS, AS OneUptime Health AND Settings > Global Probes
 * SHOW IT.
 *
 *   - Connected: it reported in the last GLOBAL_PROBE_REPORTING_MINUTES.
 *   - Behind: it reports, but its monitors are checked, or its network
 *     devices polled, later than their interval (OneUptime issues #9488
 *     and #9499, Types/Probe/ProbeBehind), with how far once a due time
 *     is kept: "Behind by 15 minutes" (GLOBAL_PROBE_BEHIND_BY). Overview's
 *     What needs attention says which, since when, and what to do.
 *   - Disconnected: otherwise.
 *
 * The two pages each worked out Connected on their own; a table that shows
 * this selects lastAlive, checksLateSince, checksLastLateAt,
 * checksLastLateDueAt, devicePollsLateSince, devicePollsLastLateAt and
 * devicePollsLastLateDueAt.
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

/*
 * How far behind a global probe that is behind is, as its status: how long
 * its longest-waiting monitor check, or network device poll, whichever is
 * further behind, had waited past its time at the latest reading, in the
 * unit ProbeBehindUtil.getBehindByAmount picked. On 27 November 2026 Behind
 * read the same for a probe a minute late and for one handed nothing to
 * check for twelve hours. The words the Dashboard's probe lists say it in
 * (Dashboard's Components/Probe/ProbeStatus), so a master admin and a
 * customer read the same of one probe. Plain Behind while no due time is
 * kept yet (the probe's first reading after an upgrade).
 */
export const GLOBAL_PROBE_BEHIND_BY: Record<ProbeBehindByUnit, PluralTemplate> =
  {
    minute: {
      one: "Behind by {{count}} minute",
      other: "Behind by {{count}} minutes",
    },
    hour: {
      one: "Behind by {{count}} hour",
      other: "Behind by {{count}} hours",
    },
    day: {
      one: "Behind by {{count}} day",
      other: "Behind by {{count}} days",
    },
  };

// How far behind a probe that is behind is, or null while it is not known.
export const getGlobalProbeBehindBy: (probe: Probe) => ProbeBehindBy | null = (
  probe: Probe,
): ProbeBehindBy | null => {
  const behindByMs: number | null = ProbeBehindUtil.getProbeBehindByMs(probe);

  return behindByMs === null
    ? null
    : ProbeBehindUtil.getBehindByAmount(behindByMs);
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
  const translator: Translator = useTranslator();
  const status: GlobalProbeStatus = getGlobalProbeStatus(props.probe);
  const behindBy: ProbeBehindBy | null =
    status === GlobalProbeStatus.Behind
      ? getGlobalProbeBehindBy(props.probe)
      : null;

  if (behindBy) {
    return (
      <Statusbubble
        text={translator.translatePlural(
          GLOBAL_PROBE_BEHIND_BY[behindBy.unit],
          behindBy.count,
        )}
        // Already in the reader's language.
        isUserContent={true}
        color={Yellow}
        shouldAnimate={false}
      />
    );
  }

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
