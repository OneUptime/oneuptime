import Link from "../../Link/Link";
import InfoTooltip from "../../Tooltip/InfoTooltip";
import { FormFieldSideLink } from "../Types/Field";
import {
  splitTitleOptionalMark,
  TitleOptionalMark,
} from "../Utils/OptionalMark";
import useTranslateValue from "../../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  id?: string | undefined;
  htmlFor?: string | undefined;
  required?: boolean | undefined;
  sideLink?: FormFieldSideLink | undefined;
  description?: string | ReactElement | undefined;
  /*
   * The id the description is drawn with, for the field's control to be
   * described by it (aria-describedby): a screen reader reads the help as
   * the reader reaches the field, not only when reading the page through.
   */
  descriptionId?: string | undefined;
  /*
   * More about the field than its one-line description should hold - the
   * exact rule a probe follows, say. Shown in an (i) beside the title, on
   * hover or keyboard focus, so the field itself reads in one line - the
   * same prop, and the same (i), as a details card's FieldLabel. The (i)
   * sits outside the <label>: inside it, its "About <title>" would join the
   * name the field is read out by.
   */
  tooltip?: string | undefined;
  isHeading?: boolean | undefined;
  hideOptionalLabel?: boolean | undefined;
  className?: string | undefined;
}

// The data-testid of the (i) beside a field's title.
export const FIELD_LABEL_TOOLTIP_TEST_ID: string = "field-label-tooltip";

const FieldLabelElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, translateValue } = useTranslateValue();
  const translatedTitle: string = translateString(props.title) ?? props.title;
  const translatedSideLinkText: string | undefined = translateString(
    props.sideLink?.text,
  );
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);

  /*
   * A title that says "(Optional)" itself - "DNS Server (Optional)", the
   * LLM budgets' "Service (optional)" - is drawn without those words and
   * with the label's own mark: one mark, worded as every other field's on
   * the form ("Service (optional)" beside "Daily Budget (USD) (Optional)",
   * or a French "(facultatif)" beside "(Optionnel)", read as two different
   * marks). Its mark shows even on a field marked required or told to hide
   * it, as its title asks (Utils/OptionalMark).
   */
  const titleMark: TitleOptionalMark = splitTitleOptionalMark({
    englishTitle: props.title,
    drawnTitle: translatedTitle,
  });

  const drawnTitle: string = titleMark.mark
    ? titleMark.title.trimEnd()
    : translatedTitle;

  const showsOptionalMark: boolean =
    Boolean(titleMark.mark) || !(props.required || props.hideOptionalLabel);

  const label: ReactElement = (
    <label
      id={props.id}
      htmlFor={props.htmlFor}
      className={
        props.className ||
        `block ${
          props.isHeading ? "text-lg" : "text-sm"
        }  font-medium text-gray-700 flex justify-between`
      }
    >
      <span>
        {drawnTitle}{" "}
        <span className="text-gray-400 text-xs">
          {showsOptionalMark
            ? translateString("(Optional)") ?? "(Optional)"
            : ""}
        </span>
      </span>
      {props.sideLink && translatedSideLinkText && props.sideLink?.url && (
        <span data-testid="login-forgot-password">
          <Link
            to={props.sideLink?.url}
            openInNewTab={props.sideLink?.openLinkInNewTab}
            className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
          >
            {translatedSideLinkText}
          </Link>
        </span>
      )}
    </label>
  );

  return (
    <>
      {props.tooltip ? (
        <div className="flex items-center gap-1">
          {label}
          {/*
           * The English title: InfoTooltip words "About <title>" in the
           * reader's language and translates the title within it.
           */}
          <InfoTooltip
            text={props.tooltip}
            label={props.title}
            dataTestId={FIELD_LABEL_TOOLTIP_TEST_ID}
          />
        </div>
      ) : (
        label
      )}

      {translatedDescription && (
        <div id={props.descriptionId} className="mt-1 text-sm text-gray-500">
          {translatedDescription}
        </div>
      )}
    </>
  );
};

export default FieldLabelElement;
