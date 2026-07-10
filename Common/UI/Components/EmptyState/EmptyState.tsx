import Icon from "../Icon/Icon";
import {
  SurfaceStyle,
  useSurfaceStyle,
} from "../../Contexts/SurfaceStyleContext";
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
  const surfaceStyle: SurfaceStyle = useSurfaceStyle();
  const isQuiet: boolean = surfaceStyle === SurfaceStyle.Quiet;
  const rootClassName: string = isQuiet
    ? `flex min-h-64 px-6 py-16 ${
        props.showSolidBackground
          ? "rounded-lg border border-slate-200 bg-white"
          : ""
      }`
    : `flex pb-52 pt-52 ${
        props.showSolidBackground ? "rounded bg-white shadow" : ""
      }`;

  return (
    <React.Fragment>
      <div
        id={props.id}
        data-testid="empty-state"
        data-surface-style={surfaceStyle}
        className={rootClassName}
      >
        <div
          className={
            isQuiet ? "m-auto max-w-md text-center" : "m-auto text-center"
          }
        >
          {props.icon && (
            <Icon
              icon={props.icon}
              className={
                props.iconClassName ||
                (isQuiet
                  ? "mx-auto h-10 w-10 text-slate-400"
                  : "mx-auto h-12 w-12 text-gray-400")
              }
            />
          )}

          <h3
            className={
              isQuiet
                ? "mt-3 text-[15px] font-medium text-slate-900"
                : "mt-2 text-sm font-medium text-gray-900"
            }
          >
            {translateValue(props.title)}
          </h3>
          <p
            className={
              isQuiet
                ? "mt-1 text-sm leading-5 text-slate-500"
                : "mt-1 text-sm text-gray-500"
            }
          >
            {translateValue(props.description)}
          </p>
          {props.footer && (
            <div className={isQuiet ? "mt-5" : "mt-6"}>{props.footer}</div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
};

export default EmptyState;
