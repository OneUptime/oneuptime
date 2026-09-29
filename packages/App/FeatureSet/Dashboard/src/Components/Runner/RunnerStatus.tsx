import { Gray500, Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
} from "Common/Types/Runner/RunnerLiveStatus";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import Runner from "Common/Models/DatabaseModels/Runner";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  runner: Runner | JSONObject;

  /*
   * Appends "· 2 hours ago" to a Disconnected bubble. On by default, because
   * "how long has it been gone" is the whole question when a Runner drops;
   * pass false in a table that already carries its own Last Seen column.
   */
  showLastSeen?: boolean | undefined;
}

/*
 * Every Runner connection indicator in the dashboard renders through here.
 *
 * The status is derived from lastAlive, NOT from the persisted
 * connectionStatus column — see Common/Types/Runner/RunnerLiveStatus.ts for
 * why that column cannot be trusted. Callers must therefore select lastAlive;
 * a Runner queried without it reads as never connected.
 */
const RunnerStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString }: UseTranslateValueResult = useTranslateValue();

  const lastAlive: Date | string | null | undefined = props.runner[
    "lastAlive"
  ] as Date | string | null | undefined;

  const status: RunnerLiveStatus = getRunnerLiveStatus(lastAlive);

  const label: string = getRunnerLiveStatusLabel(status);

  if (status === RunnerLiveStatus.Connected) {
    return (
      <Statusbubble
        text={translateString(label) || label}
        color={Green}
        shouldAnimate={true}
      />
    );
  }

  /*
   * Grey, not red. A Runner nobody has installed yet has not failed at
   * anything, and painting it the same colour as a Runner that died in
   * production teaches people to ignore the colour.
   */
  if (status === RunnerLiveStatus.NeverConnected) {
    return (
      <Statusbubble
        text={translateString(label) || label}
        color={Gray500}
        shouldAnimate={false}
      />
    );
  }

  const disconnected: string = translateString(label) || label;

  /*
   * The relative time is appended rather than interpolated into a translated
   * sentence: moment renders it in its own locale, so a "{{time}} ago"
   * template would end up half-translated in most languages.
   *
   * Disconnected is also where an unparseable timestamp lands, and moment
   * renders one of those as the literal "Invalid date" — so the suffix is
   * added only once the value is known to be a real instant.
   */
  const showLastSeen: boolean = props.showLastSeen !== false;

  const lastAliveDate: Date | null = lastAlive
    ? OneUptimeDate.fromString(lastAlive)
    : null;

  const hasUsableLastAlive: boolean = Boolean(
    lastAliveDate && !isNaN(lastAliveDate.getTime()),
  );

  const text: string =
    showLastSeen && hasUsableLastAlive
      ? `${disconnected} · ${OneUptimeDate.fromNow(lastAliveDate as Date)}`
      : disconnected;

  return <Statusbubble text={text} color={Red} shouldAnimate={false} />;
};

export default RunnerStatusElement;
