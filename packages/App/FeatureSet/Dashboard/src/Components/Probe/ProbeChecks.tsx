import Route from "Common/Types/API/Route";
import { Green, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProbeBehindUtil, {
  ProbeLateChecksRead,
} from "Common/Types/Probe/ProbeBehind";
import { translationKey } from "Common/Types/Translator";
import Link from "Common/UI/Components/Link/Link";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHETHER A PROBE KEEPS UP WITH ITS MONITORS, ON ITS PAGE (OneUptime issue
 * #9488).
 *
 * A probe that cannot keep up checks what it can and the rest wait: every
 * page went on showing the monitors up, checked as often as set, while each
 * was checked half as often. On Time, or Behind with since when, why it
 * matters and what to do: update the probe - one that predates #9488 asks
 * for its monitors once a minute - or let it check more at once. The
 * answer is OneUptime's, kept on the probe once a minute
 * (Types/Probe/ProbeBehind); the page reads it with checksLateSince and
 * checksLastLateAt.
 */

export const PROBE_BEHIND_GUIDE_PATH: string =
  "/docs/probe/custom-probe#a-probe-is-behind";

export const PROBE_CHECKS_COPY: {
  title: string;
  description: string;
  onTime: string;
  behind: string;
  behindWords: string;
  behindFix: string;
  readTheGuide: string;
} = {
  title: translationKey("Monitor Checks"),
  description: translationKey(
    "Whether this probe checks its monitors as often as they are set.",
  ),
  onTime: translationKey("On Time"),
  behind: translationKey("Behind"),
  behindWords: translationKey(
    "Since {{time}}, its monitors have waited more than a minute past their check time, so they are checked less often than set.",
  ),
  behindFix: translationKey(
    "Update the probe, or let it check more monitors at once: raise PROBE_MONITORING_WORKERS on the probe and restart it.",
  ),
  readTheGuide: translationKey("Read the guide"),
};

export interface ComponentProps {
  probe: Probe | JSONObject;
}

const ProbeChecksElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const behindSince: Date | null = ProbeBehindUtil.getBehindSince(
    props.probe as ProbeLateChecksRead,
  );

  if (!behindSince) {
    return (
      <Statusbubble
        text={PROBE_CHECKS_COPY.onTime}
        color={Green}
        shouldAnimate={false}
      />
    );
  }

  return (
    <div className="space-y-1" data-testid="probe-checks-behind">
      <Statusbubble
        text={PROBE_CHECKS_COPY.behind}
        color={Yellow}
        shouldAnimate={false}
      />
      <p className="break-words text-sm text-gray-700">
        {translator.translateTemplate(PROBE_CHECKS_COPY.behindWords, {
          time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            behindSince,
          ),
        })}
      </p>
      <p className="break-words text-sm text-gray-600">
        {translator.translateText(PROBE_CHECKS_COPY.behindFix)}
      </p>
      <Link
        to={new Route(PROBE_BEHIND_GUIDE_PATH)}
        openInNewTab={true}
        className="inline-block text-sm text-indigo-600 hover:underline"
      >
        {translator.translateText(PROBE_CHECKS_COPY.readTheGuide)}
      </Link>
    </div>
  );
};

export default ProbeChecksElement;
