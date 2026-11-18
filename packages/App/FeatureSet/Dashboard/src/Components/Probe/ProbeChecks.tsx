import Route from "Common/Types/API/Route";
import { Green, Yellow } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProbeBehindUtil, {
  ProbeBehindRead,
  ProbeBehindWork,
} from "Common/Types/Probe/ProbeBehind";
import { translationKey } from "Common/Types/Translator";
import Link from "Common/UI/Components/Link/Link";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHETHER A PROBE KEEPS UP WITH ITS MONITORS, AND WITH THE NETWORK DEVICES
 * IT POLLS, ON ITS PAGE (OneUptime issues #9488, #9499).
 *
 * A probe that cannot keep up checks what it can and the rest wait: every
 * page went on showing the monitors up, checked as often as set, while each
 * was checked half as often. On Time, or Behind with since when, why it
 * matters and what to do: update the probe - one that predates #9488
 * asks for its monitors once a minute, and one that predates #9499 for
 * at most 250 devices a minute - or let it do more at once. The answer is
 * OneUptime's, kept on the probe once a minute (Types/Probe/ProbeBehind);
 * the page reads it with checksLateSince and checksLastLateAt, and
 * devicePollsLateSince and devicePollsLastLateAt.
 *
 * Monitor Checks always shows while the probe is connected. Network Device
 * Polls shows only while it is behind on them: most probes poll no device,
 * and an On Time for none would say nothing.
 */

export const PROBE_BEHIND_GUIDE_PATH: string =
  "/docs/probe/custom-probe#a-probe-is-behind";

export interface ProbeChecksCopy {
  title: string;
  description: string;
  onTime: string;
  behind: string;
  behindWords: string;
  behindFix: string;
  readTheGuide: string;
}

export const PROBE_CHECKS_COPY: ProbeChecksCopy = {
  title: translationKey("Monitor Checks"),
  description: translationKey(
    "Whether this probe checks its monitors as often as they are set.",
  ),
  onTime: translationKey("On Time"),
  behind: translationKey("Behind"),
  behindWords: translationKey(
    "Since {{time}}, its monitors have waited more than a minute past their check time, so they are checked less often than set.",
  ),
  // {{setting}}: the probe's setting, drawn as code.
  behindFix: translationKey(
    "Update the probe, or let it check more monitors at once: raise {{setting}} on the probe and restart it.",
  ),
  readTheGuide: translationKey("Read the guide"),
};

export const PROBE_DEVICE_POLLS_COPY: ProbeChecksCopy = {
  title: translationKey("Network Device Polls"),
  description: translationKey(
    "Whether this probe polls its network devices as often as they are set.",
  ),
  onTime: translationKey("On Time"),
  behind: translationKey("Behind"),
  behindWords: translationKey(
    "Since {{time}}, its network devices have waited more than a minute past their poll time, so they are polled less often than set.",
  ),
  // {{setting}}: the probe's setting, drawn as code.
  behindFix: translationKey(
    "Update the probe, or let it poll more devices at once: raise {{setting}} on the probe and restart it.",
  ),
  readTheGuide: translationKey("Read the guide"),
};

// The setting that lets a probe check more monitors at once.
export const PROBE_WORKERS_SETTING: string = "PROBE_MONITORING_WORKERS";

// The setting that lets a probe poll more network devices at once.
export const PROBE_DEVICE_POLL_CONCURRENCY_SETTING: string =
  "PROBE_NETWORK_DEVICE_POLL_CONCURRENCY";

// What the page says of each kind of work a probe can fall behind on.
const WORK_COPY: Record<
  ProbeBehindWork,
  { copy: ProbeChecksCopy; setting: string; testId: string }
> = {
  [ProbeBehindWork.MonitorChecks]: {
    copy: PROBE_CHECKS_COPY,
    setting: PROBE_WORKERS_SETTING,
    testId: "probe-checks-behind",
  },
  [ProbeBehindWork.DevicePolls]: {
    copy: PROBE_DEVICE_POLLS_COPY,
    setting: PROBE_DEVICE_POLL_CONCURRENCY_SETTING,
    testId: "probe-device-polls-behind",
  },
};

export interface ComponentProps {
  probe: Probe | JSONObject;
  // Monitor checks unless it says otherwise.
  work?: ProbeBehindWork | undefined;
}

const ProbeChecksElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const work: ProbeBehindWork = props.work || ProbeBehindWork.MonitorChecks;
  const { copy, setting, testId } = WORK_COPY[work];
  const state: ProbeBehindRead = props.probe as ProbeBehindRead;

  const behindSince: Date | null =
    work === ProbeBehindWork.DevicePolls
      ? ProbeBehindUtil.getDevicePollsBehindSince(state)
      : ProbeBehindUtil.getBehindSince(state);

  if (!behindSince) {
    return (
      <Statusbubble text={copy.onTime} color={Green} shouldAnimate={false} />
    );
  }

  return (
    <div className="space-y-1" data-testid={testId}>
      <Statusbubble text={copy.behind} color={Yellow} shouldAnimate={false} />
      <p className="break-words text-sm text-gray-700">
        {translator.translateTemplate(copy.behindWords, {
          time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            behindSince,
          ),
        })}
      </p>
      <p className="break-words text-sm text-gray-600">
        <TranslatedSentence
          template={copy.behindFix}
          slots={{
            setting: (
              <code className="break-all rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
                {setting}
              </code>
            ),
          }}
        />
      </p>
      <Link
        to={new Route(PROBE_BEHIND_GUIDE_PATH)}
        openInNewTab={true}
        className="inline-block text-sm text-indigo-600 hover:underline"
      >
        {translator.translateText(copy.readTheGuide)}
      </Link>
    </div>
  );
};

export default ProbeChecksElement;
