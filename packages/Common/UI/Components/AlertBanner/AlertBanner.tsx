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
  const translatedTitle: string = translateString(props.title) ?? props.title;
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
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          {/*
           * The title stays a text node of its own, so callers and their
           * tests can find the banner by its exact wording.
           */}
          <p className={`text-sm font-semibold leading-6 ${styles.title}`}>
            {translatedTitle}
          </p>
          {props.rightElement && (
            <div className="flex flex-shrink-0 items-center">
              {props.rightElement}
            </div>
          )}
        </div>
        {props.children && (
          <div className="mt-1 text-sm leading-relaxed text-gray-600">
            {props.children}
          </div>
        )}
      </div>
    </div>
  );
};

export default AlertBanner;
