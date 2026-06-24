import Link from "../../Link/Link";
import { FormFieldSideLink } from "../Types/Field";
import useTranslateValue from "../../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  id?: string | undefined;
  htmlFor?: string | undefined;
  required?: boolean | undefined;
  sideLink?: FormFieldSideLink | undefined;
  description?: string | ReactElement | undefined;
  isHeading?: boolean | undefined;
  hideOptionalLabel?: boolean | undefined;
  className?: string | undefined;
}

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
  return (
    <>
      <label
        id={props.id}
        htmlFor={props.htmlFor}
        className={
          props.className ||
          `${
            props.isHeading ? "text-lg" : "text-sm"
          }  font-medium text-gray-900 flex items-center justify-between`
        }
      >
        <span>
          {translatedTitle}{" "}
          <span className="text-gray-500 text-xs">
            {props.required || props.hideOptionalLabel
              ? ""
              : translateString("(Optional)") ?? "(Optional)"}
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

      {translatedDescription && (
        <div className="mt-1 text-sm text-gray-500">
          {translatedDescription}
        </div>
      )}
    </>
  );
};

export default FieldLabelElement;
