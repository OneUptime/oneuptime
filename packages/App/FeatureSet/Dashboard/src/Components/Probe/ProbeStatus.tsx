import { Green, Red, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProbeBehindUtil, {
  ProbeBehindRead,
} from "Common/Types/Probe/ProbeBehind";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
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
}

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
 * interval (OneUptime issues #9488 and #9499, Types/Probe/ProbeBehind) - a
 * list that says so selects checksLateSince, checksLastLateAt,
 * devicePollsLateSince and devicePollsLastLateAt; Disconnected otherwise,
 * and when it was last heard from - a list that says so selects lastAlive.
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
    </div>
  );
};

export default ProbeStatusElement;
