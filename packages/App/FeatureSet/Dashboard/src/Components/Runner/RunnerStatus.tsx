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

export interface RunnerLiveStatusBubbleProps {
  status: RunnerLiveStatus;
  // Said after the status, as " · <suffix>": how long a Runner has been gone.
  suffix?: string | undefined;
  // A connected Runner's dot pulses; a settings value's stays still.
  isConnectedAnimated?: boolean | undefined;
}

/*
 * A Runner's status as the dashboard draws it everywhere: a green dot for
 * Connected, red for Disconnected, grey for Never connected. For a status
 * read some other way than a Runner row's lastAlive - a global Runner's,
 * which the server reports as a status only, or one a picker's choices
 * carry - so a code repository's Runner on its settings card is drawn as
 * the Runners page draws it.
 */
export const RunnerLiveStatusBubble: FunctionComponent<
  RunnerLiveStatusBubbleProps
> = (props: RunnerLiveStatusBubbleProps): ReactElement => {
  const { translateString }: UseTranslateValueResult = useTranslateValue();

  const status: RunnerLiveStatus = props.status;
  const label: string = getRunnerLiveStatusLabel(status);
  const translated: string = translateString(label) || label;
  const text: string = props.suffix
    ? `${translated} · ${props.suffix}`
    : translated;

  if (status === RunnerLiveStatus.Connected) {
    return (
      <Statusbubble
        text={text}
        color={Green}
        shouldAnimate={props.isConnectedAnimated !== false}
      />
    );
  }

  /*
   * Grey, not red. A Runner nobody has installed yet has not failed at
   * anything, and painting it the same colour as a Runner that died in
   * production teaches people to ignore the colour.
   */
  if (status === RunnerLiveStatus.NeverConnected) {
    return <Statusbubble text={text} color={Gray500} shouldAnimate={false} />;
  }

  return <Statusbubble text={text} color={Red} shouldAnimate={false} />;
};

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
  const lastAlive: Date | string | null | undefined = props.runner[
    "lastAlive"
  ] as Date | string | null | undefined;

  const status: RunnerLiveStatus = getRunnerLiveStatus(lastAlive);

  if (status !== RunnerLiveStatus.Disconnected) {
    return <RunnerLiveStatusBubble status={status} />;
  }

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

  return (
    <RunnerLiveStatusBubble
      status={status}
      suffix={
        showLastSeen && hasUsableLastAlive
          ? OneUptimeDate.fromNow(lastAliveDate as Date)
          : undefined
      }
    />
  );
};

export default RunnerStatusElement;
