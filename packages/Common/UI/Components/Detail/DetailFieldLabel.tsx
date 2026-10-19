import Link from "../Link/Link";
import { DetailSideLink } from "./Field";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a field of a detail card says about itself: its name, a link beside
 * it, and a line on what it means. The value follows under it.
 *
 * The name is written as the card writes it, in a muted grey, so the value
 * under it is what the eye lands on: the old label was tracked capitals in
 * a small bold face with a dot after it - "NAME •" - which shouted the
 * names louder than the values they name.
 *
 * Its shape is the one every detail field has had: a block holding a
 * <label> (the name, then the link) and the description after it. The
 * value is the block's next sibling, so whatever walks from a field's name
 * to its value - the pages' tests, the end-to-end suites reading the cards'
 * <label>s - still finds it.
 */

// The name's reading size, unless a field asks for its own.
export const DETAIL_FIELD_LABEL_SIZE_CLASS_NAME: string = "text-sm";

type GetDetailFieldLabelClassNameFunction = (sizeClassName: string) => string;

export const getDetailFieldLabelClassName: GetDetailFieldLabelClassNameFunction =
  (sizeClassName: string): string => {
    return `flex-wrap items-center gap-x-2 gap-y-0.5 ${sizeClassName} font-medium leading-5 text-gray-500`;
  };

export const DETAIL_FIELD_LABEL_CLASS_NAME: string =
  getDetailFieldLabelClassName(DETAIL_FIELD_LABEL_SIZE_CLASS_NAME);

export const DETAIL_FIELD_DESCRIPTION_CLASS_NAME: string =
  "text-xs leading-5 text-gray-500";

export const DETAIL_FIELD_SIDE_LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-sm text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export interface ComponentProps {
  title?: string | undefined;
  description?: string | ReactElement | undefined;
  sideLink?: DetailSideLink | undefined;
  // Where the name and the description sit: "flex justify-start" and so on.
  alignClassName?: string | undefined;
  // A field's own text size for its name (Field.fieldTitleSize).
  sizeClassName?: string | undefined;
}

const DetailFieldLabel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, translateValue } = useTranslateValue();
  const translatedTitle: string | undefined = translateString(props.title);
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);
  const translatedSideLinkText: string | undefined = translateString(
    props.sideLink?.text,
  );
  const alignClassName: string = props.alignClassName || "flex justify-start";

  const labelClassName: string = getDetailFieldLabelClassName(
    props.sizeClassName || DETAIL_FIELD_LABEL_SIZE_CLASS_NAME,
  );

  return (
    <div className="space-y-1">
      {translatedTitle && (
        <label
          className={`${alignClassName} ${labelClassName}`}
          data-testid="detail-label"
        >
          <span>{translatedTitle}</span>
          {props.sideLink && translatedSideLinkText && props.sideLink.url && (
            <Link
              to={props.sideLink.url}
              openInNewTab={props.sideLink.openLinkInNewTab}
              className={DETAIL_FIELD_SIDE_LINK_CLASS_NAME}
            >
              <span>{translatedSideLinkText}</span>
              {/*
               * An inline <svg>: the Icon component draws a <div>, which has
               * no place inside a link inside a <label>.
               */}
              {props.sideLink.openLinkInNewTab ? (
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                  data-testid="detail-side-link-new-tab"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              ) : (
                <></>
              )}
            </Link>
          )}
        </label>
      )}
      {translatedDescription && (
        <div
          className={`${alignClassName} ${DETAIL_FIELD_DESCRIPTION_CLASS_NAME}`}
          data-testid="detail-description"
        >
          {translatedDescription}
        </div>
      )}
    </div>
  );
};

export default DetailFieldLabel;
