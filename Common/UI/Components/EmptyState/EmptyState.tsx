import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string | ReactElement;
  description: string | ReactElement;
  icon: IconProp | undefined;
  footer?: ReactElement | undefined;
  id: string;
  iconClassName?: string;
  showSolidBackground?: boolean | undefined;
  /*
   * Vertical padding. The default is 13rem top and bottom, which suits a
   * full-page dashboard empty state but swamps a short page. Override it
   * rather than changing the default — several call sites cancel the 13rem
   * with negative margins and would overlap their neighbours if it shrank.
   */
  paddingClassName?: string | undefined;
}

const EmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  return (
    <React.Fragment>
      <div
        id={props.id}
        className={`flex ${props.paddingClassName || "pt-52 pb-52"} ${
          props.showSolidBackground ? "bg-white rounded shadow" : ""
        }`}
      >
        {/*
         * Full width so the footer can lay out a wide block (a grid of
         * guides) without being squeezed to its content; everything inside
         * is centred on its own.
         */}
        <div className="m-auto w-full text-center">
          {props.icon && (
            <Icon
              icon={props.icon}
              className={
                props.iconClassName || `mx-auto h-12 w-12 text-gray-400`
              }
            />
          )}

          <h3 className="mt-2 text-sm font-medium text-gray-900">
            {translateValue(props.title)}
          </h3>
          {/*
           * Capped at a readable measure. Uncapped, a long description in a
           * wide table ran edge to edge as a single line.
           */}
          <p
            className="mx-auto mt-1 max-w-xl text-sm leading-6 text-gray-500"
            data-testid={`${props.id}-description`}
          >
            {translateValue(props.description)}
          </p>
          {/*
           * A flex row, so a footer that is itself a block-level flex box
           * (an OUTLINE Button is one) is centred instead of stretching
           * across the row with its label pinned to the left edge.
           */}
          {props.footer && (
            <div
              className="mt-6 flex justify-center"
              data-testid={`${props.id}-footer`}
            >
              {props.footer}
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
};

export default EmptyState;
