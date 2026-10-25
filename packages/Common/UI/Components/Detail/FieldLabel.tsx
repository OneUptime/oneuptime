import Link from "../Link/Link";
import { DetailSideLink } from "./Field";
import useTranslateValue from "../../Utils/Translation";
import InfoTooltip from "../Tooltip/InfoTooltip";
import React, { FunctionComponent, ReactElement } from "react";

export enum Size {
  Normal = "text-sm",
  Medium = "text-base",
  Large = "text-lg",
}

export interface ComponentProps {
  title?: string | undefined;
  description?: string | ReactElement | undefined;
  alignClassName?: string | undefined;
  sideLink?: DetailSideLink | undefined;
  size?: Size | undefined;
  /*
   * A stat tile's name (InfoCard): muted, so the number under it is what
   * the eye lands on. Without it the name reads as a form field's, as the
   * custom editors that draw their fields with it want.
   */
  isCardStyle?: boolean | undefined;
  // What the field means, shown in an (i) tooltip beside the title.
  tooltip?: string | undefined;
}

/*
 * A name as the card or the form writes it: sentence case in the reading
 * size, no tracked capitals and no dot after it. It was "READY •" - tracked
 * capitals in a small bold face with a dot - on every stat tile (a monitor's
 * summary, the Home overview, Kubernetes, Proxmox and Ceph) and in the
 * custom editors' fields (a monitor's criteria, the log and trace pipelines,
 * the recording rules), right beside detail cards and forms that write their
 * names plainly.
 */
export const FIELD_LABEL_CLASS_NAME: string =
  "font-medium leading-5 flex items-center gap-2";

// A stat tile's name, muted; a form field's, in the form's label colour.
export const FIELD_LABEL_CARD_TEXT_CLASS_NAME: string = "text-gray-500";

export const FIELD_LABEL_FORM_TEXT_CLASS_NAME: string = "text-gray-700";

// The line under a name, at AA on white (gray-400 was 2.5:1).
export const FIELD_LABEL_DESCRIPTION_CLASS_NAME: string =
  "text-xs leading-5 text-gray-500 mt-0.5";

const FieldLabelElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, translateValue } = useTranslateValue();
  const translatedTitle: string | undefined = translateString(props.title);
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);
  const translatedSideLinkText: string | undefined = translateString(
    props.sideLink?.text,
  );
  const isCardStyle: boolean = props.isCardStyle || false;

  return (
    <div className="space-y-1">
      {translatedTitle && (
        <label
          className={`${props.size || Size.Normal} ${FIELD_LABEL_CLASS_NAME} ${
            isCardStyle
              ? FIELD_LABEL_CARD_TEXT_CLASS_NAME
              : FIELD_LABEL_FORM_TEXT_CLASS_NAME
          }`}
        >
          <span className={`${props.alignClassName} flex items-center gap-1.5`}>
            {translatedTitle}
            <InfoTooltip
              label={translatedTitle}
              text={props.tooltip}
              className="relative z-10"
            />
          </span>
          {props.sideLink && translatedSideLinkText && props.sideLink?.url && (
            <Link
              to={props.sideLink?.url}
              className="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-600 transition-all duration-200 font-medium text-xs hover:underline underline-offset-2"
            >
              {translatedSideLinkText}
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </Link>
          )}
        </label>
      )}
      {translatedDescription && (
        <p
          className={`${props.alignClassName} ${FIELD_LABEL_DESCRIPTION_CLASS_NAME}`}
        >
          {translatedDescription}
        </p>
      )}
    </div>
  );
};

export default FieldLabelElement;
