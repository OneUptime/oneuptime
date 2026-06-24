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
}

const EmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  return (
    <React.Fragment>
      <div
        id={props.id}
        className={`flex py-20 sm:py-28 ${
          props.showSolidBackground
            ? "bg-white rounded-xl border border-gray-200 shadow-sm"
            : ""
        }`}
      >
        <div className="m-auto text-center">
          {props.icon &&
            (props.iconClassName ? (
              <Icon icon={props.icon} className={props.iconClassName} />
            ) : (
              <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <Icon icon={props.icon} className="h-6 w-6 text-gray-400" />
              </div>
            ))}

          <h3 className="mt-2 text-base font-semibold text-gray-900">
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
