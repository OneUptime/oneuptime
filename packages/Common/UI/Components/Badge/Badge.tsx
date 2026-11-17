import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { getPillColors, getPillToneStyle } from "../Pill/PillColors";
import { getPillToneColor, PillTone } from "../Pill/PillTone";

/*
 * A COUNT BESIDE A SIDE MENU'S ENTRY (Incidents 12, Alerts 3).
 *
 * Only for counts in menus; a status or a label is a Pill with a tone. It is
 * painted in the Pill's tones (PillTone, PillColors), so a red count and a
 * red "Error" pill are the same red, read at 4.5:1 or better in both themes,
 * and swap together in the dark theme. It was a gradient with a shadow of its
 * own (#9137).
 */

export enum BadgeType {
  DANGER,
  SUCCESS,
  WARNING,
  // A count that says nothing about how things are doing: grey.
  NEUTRAL,
  /*
   * A count of something someone switched off on purpose: monitors
   * disabled by choice. Grey like NEUTRAL, but in the tone a choice is
   * drawn in (PillTone.Paused), never a fault's (#9126, #9255).
   */
  PAUSED,
}

export const BADGE_TONES: Readonly<Record<BadgeType, PillTone>> = Object.freeze(
  {
    [BadgeType.DANGER]: PillTone.Danger,
    [BadgeType.SUCCESS]: PillTone.Success,
    [BadgeType.WARNING]: PillTone.Warning,
    [BadgeType.NEUTRAL]: PillTone.Neutral,
    [BadgeType.PAUSED]: PillTone.Paused,
  },
);

export interface ComponentProps {
  badgeCount: number;
  badgeType?: undefined | BadgeType;
  id?: string | undefined;
}

const Badge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.badgeCount) {
    return <></>;
  }

  const tone: PillTone =
    props.badgeType === undefined
      ? PillTone.Neutral
      : BADGE_TONES[props.badgeType];

  return (
    <span
      id={props.id}
      data-testid={props.id}
      data-tone={tone}
      data-ou-pill=""
      className="ml-auto min-w-[1.75rem] whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs font-semibold leading-4 tabular-nums"
      style={getPillToneStyle(getPillColors(getPillToneColor(tone)))}
      aria-hidden="true"
    >
      {/*
       * Written as the reader's language writes a number, as every other
       * count on the page is: "۱۲" on a Persian page - where "12" sat
       * beside a side menu's Persian words - and "1,234" in English.
       */}
      {translator.formatNumber(props.badgeCount)}
    </span>
  );
};

export default Badge;
