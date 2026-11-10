import React, { FunctionComponent, ReactElement } from "react";
import useTranslateValue from "../../Utils/Translation";

export enum StatusBadgeType {
  Success = "success",
  Warning = "warning",
  Danger = "danger",
  Info = "info",
  Neutral = "neutral",
}

export interface ComponentProps {
  text: string;
  type?: StatusBadgeType | undefined;
  className?: string | undefined;
  /*
   * The text is drawn as given, never looked up: a name someone typed - a
   * session's own signal, "Payment failed" - which a translation of the
   * same English words would otherwise replace.
   */
  isUserContent?: boolean | undefined;
  /*
   * The badge keeps to one line, never wider than the box it is in: words
   * too long for the room end in "..." - a name someone typed can be long.
   * Without it a badge wraps, as one of a few short words may.
   */
  isOneLine?: boolean | undefined;
}

const statusStyles: Record<StatusBadgeType, string> = {
  [StatusBadgeType.Success]:
    "bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200/80",
  [StatusBadgeType.Warning]:
    "bg-gradient-to-r from-amber-50 to-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200/80",
  [StatusBadgeType.Danger]:
    "bg-gradient-to-r from-red-50 to-red-100 text-red-800 ring-1 ring-inset ring-red-200/80",
  [StatusBadgeType.Info]:
    "bg-gradient-to-r from-blue-50 to-blue-100 text-blue-800 ring-1 ring-inset ring-blue-200/80",
  [StatusBadgeType.Neutral]:
    "bg-gradient-to-r from-gray-50 to-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200/80",
};

const StatusBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const type: StatusBadgeType = props.type || StatusBadgeType.Neutral;
  const { translateString } = useTranslateValue();
  const text: string = props.isUserContent
    ? props.text
    : translateString(props.text) ?? props.text;

  if (props.isOneLine) {
    return (
      <span
        className={`inline-flex min-w-0 max-w-full items-center whitespace-nowrap px-2.5 py-0.5 text-xs font-semibold rounded-full ${statusStyles[type]} ${props.className || ""}`}
      >
        {/*
         * A name reads the way it is written - an English one on a Persian
         * page ends in "..." at its own end, not before its first word.
         */}
        <span
          className="min-w-0 truncate"
          dir={props.isUserContent ? "auto" : undefined}
          data-testid="status-badge-text"
        >
          {text}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${statusStyles[type]} ${props.className || ""}`}
    >
      {text}
    </span>
  );
};

export default StatusBadge;
