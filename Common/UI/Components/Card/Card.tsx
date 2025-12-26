import Button, { ButtonStyleType } from "../Button/Button";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import IconProp from "../../../Types/Icon/IconProp";
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
  const noRightElementsOrButtons: boolean =
    !props.rightElement && (!props.buttons || props.buttons.length === 0);

  return (
    <React.Fragment>
      <div data-testid="card" className={`mb-5 ${props.className || ""}`}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="py-6 px-5 md:px-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start">
              <div
                className={`${noRightElementsOrButtons ? "w-full" : "flex-1 min-w-0"}`}
              >
                {props.title && (
                  <h2
                    data-testid="card-details-heading"
                    id="card-details-heading"
                    className="text-lg font-semibold leading-6 text-gray-900"
                  >
                    {props.title}
                  </h2>
                )}
                {props.description && (
                  <p
                    data-testid="card-description"
                    className="mt-1.5 text-sm text-gray-500 w-full hidden md:block leading-relaxed"
                  >
                    {props.description}
                  </p>
                )}
              </div>
              {(props.rightElement ||
                (props.buttons && props.buttons.length > 0)) && (
                <div className="flex flex-col md:flex-row md:items-center md:w-fit mt-4 md:mt-0 md:ml-4 gap-2 md:gap-0 flex-shrink-0">
                  {props.rightElement && (
                    <div className="mb-2 md:mb-0 md:mr-3">
                      {props.rightElement}
                    </div>
                  )}
                  {props.buttons && props.buttons.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {props.buttons.map(
                        (
                          button: CardButtonSchema | ReactElement,
                          i: number,
                        ) => {
                          return (
                            <div key={i}>
                              {React.isValidElement(button) ? button : null}
                              {React.isValidElement(button) ? null : (
                                <Button
                                  key={i}
                                  title={(button as CardButtonSchema).title}
                                  buttonStyle={
                                    (button as CardButtonSchema).buttonStyle
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
              <div className={props.bodyClassName || "mt-4"}>
                {props.children}
              </div>
            )}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
};

export default Card;
