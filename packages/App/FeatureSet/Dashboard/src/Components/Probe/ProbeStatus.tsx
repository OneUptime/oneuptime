import { Green, Red, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProbeBehindUtil, {
  ProbeBehindRead,
} from "Common/Types/Probe/ProbeBehind";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";
import RelativeTime from "../EpisodeView/RelativeTime";

export interface ComponentProps {
  probe: Probe | JSONObject;
  /*
   * Only whether it is connected: the probe's page, which says whether it
   * keeps up in a field of its own (ProbeChecksElement).
   */
  isConnectionOnly?: boolean | undefined;
  /*
   * One of the project's own probes, which the person can fix: a
   * disconnected one says what to check (#7273). A global probe - one of
   * OneUptime's, or the server's - is not theirs to check.
   */
  isProjectProbe?: boolean | undefined;
}

/*
 * What to check when a project's own probe stopped checking in (#7273):
 * "Disconnected" and when it was last seen said that it was gone, and
 * nothing about why. A probe that does not check in is a container that
 * stopped, or one that runs with another probe's ID or a key that was
 * reset.
 */
export const DISCONNECTED_PROBE_WHAT_TO_CHECK: string = translationKey(
  "Check that its container is running, with this probe's PROBE_ID and PROBE_KEY.",
);

/*
 * When a probe that is behind fell behind, under Behind: Behind alone read
 * the same for a probe late for a minute and one handed nothing to check
 * for twelve hours. {{time}} is a RelativeTime ("3 hours ago"), the exact
 * time on hover, as Last seen is.
 */
export const PROBE_FELL_BEHIND: string = translationKey("Fell behind {{time}}");

/*
 * When a disconnected probe was last heard from (#9597): its lastAlive,
 * when the list read it. A list that did not is said nothing of, rather
 * than "never".
 */
export function getProbeLastSeenAt(probe: Probe | JSONObject): Date | null {
  const lastAlive: unknown = (probe as JSONObject)["lastAlive"];

  if (!lastAlive) {
    return null;
  }

  const date: Date =
    lastAlive instanceof Date
      ? lastAlive
      : OneUptimeDate.fromString(lastAlive as string);

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * A probe's status: Connected; Behind when it is connected but its
 * monitors are checked, or its network devices polled, later than their
 * interval (OneUptime issues #9488 and #9499, Types/Probe/ProbeBehind),
 * and when it fell behind - a list that says so selects checksLateSince
 * and checksLastLateAt, and devicePollsLateSince and devicePollsLastLateAt
 * where the probe's network devices matter (a monitor's own Probes do not:
 * its checks are what it is late on); Disconnected otherwise, and when it
 * was last heard from - a list that says so selects lastAlive.
 */
const ProbeStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (
    props.probe &&
    props.probe["connectionStatus"] === ProbeConnectionStatus.Connected
  ) {
    const behindSince: Date | null = props.isConnectionOnly
      ? null
      : ProbeBehindUtil.getProbeBehindSince(props.probe as ProbeBehindRead);

    if (behindSince) {
      return (
        <div className="flex flex-col items-start gap-0.5">
          <Statusbubble text={"Behind"} color={Yellow} shouldAnimate={false} />
          <span
            data-testid="probe-status-behind-since"
            className="text-xs text-gray-500"
          >
            <TranslatedSentence
              template={PROBE_FELL_BEHIND}
              slots={{ time: <RelativeTime date={behindSince} /> }}
            />
          </span>
        </div>
      );
    }

    return (
      <Statusbubble text={"Connected"} color={Green} shouldAnimate={true} />
    );
  }

  const lastSeenAt: Date | null = props.probe
    ? getProbeLastSeenAt(props.probe)
    : null;

  /*
   * Disconnected says since when: "Last seen 3 hours ago" tells a probe
   * that dropped a minute ago from one that has been gone for a week.
   */
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Statusbubble text={"Disconnected"} color={Red} shouldAnimate={false} />
      {lastSeenAt ? (
        <span
          data-testid="probe-status-last-seen"
          className="text-xs text-gray-500"
          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            lastSeenAt,
          )}
        >
          <TranslatedSentence
            template="Last seen {{time}}"
            slots={{ time: <RelativeTime date={lastSeenAt} /> }}
          />
        </span>
      ) : (
        <></>
      )}
      {props.isProjectProbe ? (
        <span
          data-testid="probe-status-what-to-check"
          className="text-xs text-gray-500"
        >
          {translator.translateText(DISCONNECTED_PROBE_WHAT_TO_CHECK)}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ProbeStatusElement;
