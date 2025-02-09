import Icon from "../Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string | ReactElement;
  description: string | ReactElement;
  icon: IconProp | undefined;
  footer?: ReactElement | undefined;
  id: string;
  iconClassName?: string;
  showSolidBackground?: boolean | undefined;
}

const EmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <React.Fragment>
      <div
        id={props.id}
        className={`flex pt-52 pb-52 ${
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
            {props.title}
          </h3>
          <p className="mt-1 text-sm text-gray-500">{props.description}</p>
          {props.footer && <div className="mt-6">{props.footer}</div>}
        </div>
      </div>
    </React.Fragment>
  );
};

export default EmptyState;
