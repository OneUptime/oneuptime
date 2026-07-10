import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import {
  SurfaceStyle,
  useSurfaceStyle,
} from "../../Contexts/SurfaceStyleContext";
import React, { FunctionComponent, ReactElement } from "react";

export interface CardButtonSchema {
  title: string;
  buttonStyle?: ButtonStyleType | undefined;
  onClick: () => void;
  disabled?: boolean | undefined;
  icon: IconProp;
  isLoading?: undefined | boolean;
  className?: string | undefined;
  shortcutKey?: undefined | ShortcutKey;
  buttonSize?: ButtonSize | undefined;
}

export interface ComponentProps {
  title?: string | ReactElement;
  description?: string | ReactElement;
  buttons?: undefined | Array<CardButtonSchema | ReactElement>;
  children?: undefined | Array<ReactElement> | ReactElement;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  rightElement?: ReactElement | undefined;
}

const Card: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  const surfaceStyle: SurfaceStyle = useSurfaceStyle();
  const isQuiet: boolean = surfaceStyle === SurfaceStyle.Quiet;
  const noRightElementsOrButtons: boolean =
    !props.rightElement && (!props.buttons || props.buttons.length === 0);
  const translatedTitle: string | ReactElement | undefined = translateValue(
    props.title,
  );
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);
  const cardClassName: string = isQuiet
    ? "overflow-visible rounded-lg border border-slate-200 bg-white"
    : "overflow-visible rounded-xl border border-gray-200 bg-white shadow-sm";
  const contentClassName: string = isQuiet
    ? "px-4 py-4 sm:px-5"
    : "px-5 py-6 md:px-6";
  const titleClassName: string = isQuiet
    ? "text-[15px] font-medium leading-6 tracking-[-0.01em] text-slate-900"
    : "text-lg font-semibold leading-6 text-gray-900";
  const descriptionClassName: string = isQuiet
    ? "mt-1 w-full text-sm leading-5 text-slate-500"
    : "mt-1.5 hidden w-full text-sm leading-relaxed text-gray-500 md:block";
  const bodyClassName: string =
    props.bodyClassName || (isQuiet ? "mt-3" : "mt-4");

  return (
    <React.Fragment>
      <div
        data-testid="card"
        data-surface-style={surfaceStyle}
        className={`${isQuiet ? "mb-4" : "mb-5"} ${props.className || ""}`}
      >
        <div data-testid="card-surface" className={cardClassName}>
          <div className={contentClassName}>
            <div
              className={`flex flex-col ${
                isQuiet
                  ? "gap-3 sm:flex-row sm:items-start sm:justify-between"
                  : "md:flex-row md:items-start md:justify-between"
              }`}
            >
              <div
                className={`${noRightElementsOrButtons ? "w-full" : "flex-1 min-w-0"}`}
              >
                {translatedTitle && (
                  <h2
                    data-testid="card-details-heading"
                    id="card-details-heading"
                    className={titleClassName}
                  >
                    {translatedTitle}
                  </h2>
                )}
                {translatedDescription && (
                  <p
                    data-testid="card-description"
                    className={descriptionClassName}
                  >
                    {translatedDescription}
                  </p>
                )}
              </div>
              {(props.rightElement ||
                (props.buttons && props.buttons.length > 0)) && (
                <div
                  className={`flex flex-shrink-0 flex-col items-center gap-2 md:w-fit md:flex-row md:items-center ${
                    isQuiet
                      ? "sm:ml-4 sm:mt-0"
                      : "mt-4 md:ml-4 md:mt-0 md:gap-0"
                  }`}
                >
                  {props.rightElement && (
                    <div className="mb-2 md:mb-0 md:mr-3">
                      {props.rightElement}
                    </div>
                  )}
                  {props.buttons && props.buttons.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {props.buttons.map(
                        (
                          button: CardButtonSchema | ReactElement,
                          i: number,
                        ) => {
                          return (
                            <div key={i} className="flex items-center">
                              {React.isValidElement(button) ? button : null}
                              {React.isValidElement(button) ? null : (
                                <Button
                                  key={i}
                                  title={(button as CardButtonSchema).title}
                                  buttonStyle={
                                    (button as CardButtonSchema).buttonStyle
                                  }
                                  buttonSize={
                                    (button as CardButtonSchema).buttonSize
                                  }
                                  className={
                                    (button as CardButtonSchema).className
                                  }
                                  onClick={() => {
                                    if ((button as CardButtonSchema).onClick) {
                                      (button as CardButtonSchema).onClick();
                                    }
                                  }}
                                  disabled={
                                    (button as CardButtonSchema).disabled
                                  }
                                  icon={(button as CardButtonSchema).icon}
                                  shortcutKey={
                                    (button as CardButtonSchema).shortcutKey
                                  }
                                  dataTestId="card-button"
                                  isLoading={
                                    (button as CardButtonSchema).isLoading
                                  }
                                />
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {props.children && (
              <div className={bodyClassName}>{props.children}</div>
            )}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
};

export default Card;
