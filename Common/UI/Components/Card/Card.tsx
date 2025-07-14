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
      <div data-testid="card" className={`mb-4 ${props.className || ""}`}>
        <div className="shadow md:rounded-md">
          <div className="bg-white py-6 px-4 md:p-6">
            <div className="flex flex-col md:flex-row md:justify-between">
              <div className={`${noRightElementsOrButtons ? "w-full" : ""}`}>
                {props.title && (
                  <h2
                    data-testid="card-details-heading"
                    id="card-details-heading"
                    className="text-lg font-medium leading-6 text-gray-900"
                  >
                    {props.title}
                  </h2>
                )}
                {props.description && (
                  <p
                    data-testid="card-description"
                    className="mt-1 text-sm text-gray-500 w-full hidden md:block"
                  >
                    {props.description}
                  </p>
                )}
              </div>
              {(props.rightElement ||
                (props.buttons && props.buttons.length > 0)) && (
                <div className="flex flex-col md:flex-row md:w-fit mt-4 md:mt-0 gap-2 md:gap-0">
                  {props.rightElement && (
                    <div className="mb-2 md:mb-0 md:mr-2">
                      {props.rightElement}
                    </div>
                  )}
                  {props.buttons && props.buttons.length > 0 && (
                    <div className="flex flex-wrap gap-2 md:gap-0">
                      {props.buttons.map(
                        (
                          button: CardButtonSchema | ReactElement,
                          i: number,
                        ) => {
                          return (
                            <div className="md:ml-2 first:md:ml-0" key={i}>
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
              <div className={props.bodyClassName || "mt-6"}>
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
