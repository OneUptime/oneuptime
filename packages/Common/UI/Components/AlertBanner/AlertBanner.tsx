import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export enum AlertBannerType {
  Success = "success",
  Warning = "warning",
  Danger = "danger",
  Info = "info",
}

export interface ComponentProps {
  title: string;
  /*
   * The title is in the reader's words already - a sentence the page built
   * around a count ("3 Regeln haben Probleme ...") - and is drawn as given,
   * never looked up again: a translation looked up a second time can come
   * back as another word (#8070, #8431).
   */
  isTitleTranslated?: boolean | undefined;
  type: AlertBannerType;
  children?: ReactElement | undefined;
  rightElement?: ReactElement | undefined;
  className?: string | undefined;
  /** Replaces the type's default icon when a more specific one fits. */
  icon?: IconProp | undefined;
  dataTestId?: string | undefined;
}

type BannerRole = "alert" | "status";

interface BannerStyle {
  container: string;
  icon: string;
  title: string;
  defaultIcon: IconProp;
  role: BannerRole;
}

/*
 * A banner sits above a page's real content, so it has to read as context
 * for that content rather than as the page itself. It used to be a
 * full-bleed tinted block with a text-lg title - as loud as the card title
 * beneath it - so a purely informational note looked like an outage.
 *
 * Info and Success are therefore neutral surfaces that carry their meaning
 * in a coloured icon. Only Warning and Danger, which ask the user to act,
 * keep a soft tint and a tinted title.
 *
 * The dashboard's dark theme is a hand-written remap of specific classes in
 * Common/UI/Styles/Theme.css, so every class below is one it already maps
 * (bg-white, border-gray-200, bg-amber-50, border-red-200, text-*-600 and
 * so on). A class outside that list would stay light on a dark page.
 *
 * Role follows urgency: role="alert" is announced assertively and
 * interrupts whatever a screen reader is saying, which is right for a
 * problem and wrong for a page that simply opens with a note.
 */
/*
 * WHERE THE ACTION GOES (#8034).
 *
 * A banner's action (rightElement: Unarchive, Turn monitoring on) acts on
 * what its sentence says, so it comes after the sentence: in the page's
 * order, which a screen reader and Tab follow, and on screen wherever the
 * banner is narrow. It used to share a wrapping row with the title, the
 * sentence below: on a 390px phone, or beside a long German or Danish
 * title, the row wrapped and the button landed between the title and the
 * sentence it acts on ("Fjern fra arkivet" before why).
 *
 * Where the banner is wide enough for both, the action stays at the end of
 * the title's line, as it always was, and the sentence runs under both.
 * "Wide enough" is the banner's own width - a container query - not the
 * window's: a banner also sits in a narrow card on a wide screen. Start
 * and end, never left and right, so it mirrors on an Arabic or Persian
 * page: under the sentence at the right, at the title's left end.
 */

// The banner's words and action: the box whose width the query reads.
export const ALERT_BANNER_CONTENT_CLASS_NAME: string =
  "min-w-0 flex-1 [container-type:inline-size]";

/*
 * One column - title, sentence, action - until the banner's words have
 * 32rem: then the title and the action share the first line, and the
 * sentence runs under both.
 */
export const ALERT_BANNER_LAYOUT_CLASS_NAME: string =
  "grid grid-cols-[minmax(0,1fr)] [@container(min-width:32rem)]:grid-cols-[minmax(0,1fr)_auto] [@container(min-width:32rem)]:gap-x-4";

export const ALERT_BANNER_TITLE_PLACE_CLASS_NAME: string =
  "[@container(min-width:32rem)]:col-start-1 [@container(min-width:32rem)]:row-start-1";

export const ALERT_BANNER_BODY_PLACE_CLASS_NAME: string =
  "mt-1 [@container(min-width:32rem)]:col-span-2 [@container(min-width:32rem)]:row-start-2";

/*
 * Under the sentence, at its start; at the end of the title's line where
 * there is room. Its own height, never stretched to the row's.
 */
export const ALERT_BANNER_ACTION_PLACE_CLASS_NAME: string =
  "mt-3 flex items-center self-start justify-self-start [@container(min-width:32rem)]:col-start-2 [@container(min-width:32rem)]:row-start-1 [@container(min-width:32rem)]:mt-0 [@container(min-width:32rem)]:justify-self-end";

export const ALERT_BANNER_ACTION_TEST_ID: string = "alert-banner-action";

const bannerStyles: Record<AlertBannerType, BannerStyle> = {
  [AlertBannerType.Info]: {
    container: "border-gray-200 bg-white",
    icon: "text-blue-600",
    title: "text-gray-900",
    defaultIcon: IconProp.Info,
    role: "status",
  },
  [AlertBannerType.Success]: {
    container: "border-gray-200 bg-white",
    icon: "text-emerald-600",
    title: "text-gray-900",
    defaultIcon: IconProp.CheckCircle,
    role: "status",
  },
  [AlertBannerType.Warning]: {
    container: "border-amber-200 bg-amber-50",
    icon: "text-amber-600",
    title: "text-amber-800",
    defaultIcon: IconProp.Alert,
    role: "alert",
  },
  [AlertBannerType.Danger]: {
    container: "border-red-200 bg-red-50",
    icon: "text-red-600",
    title: "text-red-800",
    defaultIcon: IconProp.ExclaimationCircle,
    role: "alert",
  },
};

const AlertBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedTitle: string = props.isTitleTranslated
    ? props.title
    : translateString(props.title) ?? props.title;
  const styles: BannerStyle = bannerStyles[props.type];

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-sm ${styles.container} ${props.className || ""}`}
      role={styles.role}
      data-testid={props.dataTestId}
    >
      {/*
       * Decorative: the title beside it already says what kind of banner
       * this is, so the icon stays hidden from assistive technology.
       */}
      <Icon
        icon={props.icon || styles.defaultIcon}
        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${styles.icon}`}
      />
      <div className={ALERT_BANNER_CONTENT_CLASS_NAME}>
        <div className={ALERT_BANNER_LAYOUT_CLASS_NAME}>
          {/*
           * The title stays a text node of its own, so callers and their
           * tests can find the banner by its exact wording.
           */}
          <p
            className={`text-sm font-semibold leading-6 ${styles.title} ${ALERT_BANNER_TITLE_PLACE_CLASS_NAME}`}
          >
            {translatedTitle}
          </p>
          {props.children && (
            <div
              className={`text-sm leading-relaxed text-gray-600 ${ALERT_BANNER_BODY_PLACE_CLASS_NAME}`}
            >
              {props.children}
            </div>
          )}
          {/* After the sentence it acts on (ALERT_BANNER_ACTION_PLACE_CLASS_NAME). */}
          {props.rightElement && (
            <div
              className={ALERT_BANNER_ACTION_PLACE_CLASS_NAME}
              data-testid={ALERT_BANNER_ACTION_TEST_ID}
            >
              {props.rightElement}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlertBanner;
