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
        <div className="m-auto text-center">
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
          <p className="mt-1 text-sm text-gray-500">
            {translateValue(props.description)}
          </p>
          {props.footer && <div className="mt-6">{props.footer}</div>}
        </div>
      </div>
    </React.Fragment>
  );
};

export default EmptyState;
