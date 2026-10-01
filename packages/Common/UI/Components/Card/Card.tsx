import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ShortcutKey from "../ShortcutKey/ShortcutKey";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface CardButtonSchema {
  title: string;
  buttonStyle?: ButtonStyleType | undefined;
  onClick: () => void;
  disabled?: boolean | undefined;
  /*
   * Shown on hover. The reason a disabled button is disabled belongs here -
   * Button keeps a disabled button hoverable precisely so this can be read.
   */
  tooltip?: string | undefined;
  icon: IconProp;
  isLoading?: undefined | boolean;
  className?: string | undefined;
  shortcutKey?: undefined | ShortcutKey;
  buttonSize?: ButtonSize | undefined;
}

/*
 * How the header shares its width.
 *
 * "default" puts the actions to the right of the title on md and up, which
 * suits a full-width card. In a narrow column (the one-third sidebar of an
 * overview page) that squeezes the title and description into a column a
 * word or two wide beside the buttons, so "stacked" gives the title and
 * description the whole width and moves the actions onto their own row
 * underneath.
 *
 * "inline" keeps what is on the right beside the title at any width they
 * both fit in, phones included, and is for something small such as a status
 * badge. Below md the default layout always drops it under the title and
 * centres it, which suits a row of buttons but leaves a badge alone in the
 * middle of a phone's card; from md up it also holds it 12px short of the
 * card's right edge. Inline ends it at the edge the card's content ends at,
 * and when the two do not fit it goes under the title, at its left edge.
 */
export type CardHeaderLayout = "default" | "stacked" | "inline";

export interface ComponentProps {
  title?: string | ReactElement | undefined;
  description?: string | ReactElement | undefined;
  buttons?: undefined | Array<CardButtonSchema | ReactElement>;
  children?: undefined | Array<ReactElement> | ReactElement;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  rightElement?: ReactElement | undefined;
  headerLayout?: CardHeaderLayout | undefined;
}

const Card: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  const hasButtons: boolean = Boolean(
    props.buttons && props.buttons.length > 0,
  );
  const noRightElementsOrButtons: boolean = !props.rightElement && !hasButtons;
  const isStacked: boolean = props.headerLayout === "stacked";
  const translatedTitle: string | ReactElement | undefined = translateValue(
    props.title,
  );
  const translatedDescription: string | ReactElement | undefined =
    translateValue(props.description);

  const renderButtons: () => Array<ReactElement> = (): Array<ReactElement> => {
    return (props.buttons || []).map(
      (button: CardButtonSchema | ReactElement, i: number) => {
        return (
          <div key={i} className="flex items-center">
            {React.isValidElement(button) ? button : null}
            {React.isValidElement(button) ? null : (
              <Button
                key={i}
                title={(button as CardButtonSchema).title}
                buttonStyle={(button as CardButtonSchema).buttonStyle}
                buttonSize={(button as CardButtonSchema).buttonSize}
                className={(button as CardButtonSchema).className}
                onClick={() => {
                  if ((button as CardButtonSchema).onClick) {
                    (button as CardButtonSchema).onClick();
                  }
                }}
                disabled={(button as CardButtonSchema).disabled}
                tooltip={(button as CardButtonSchema).tooltip}
                icon={(button as CardButtonSchema).icon}
                shortcutKey={(button as CardButtonSchema).shortcutKey}
                dataTestId="card-button"
                isLoading={(button as CardButtonSchema).isLoading}
              />
            )}
          </div>
        );
      },
    );
  };

  const titleElement: ReactElement | false | "" | undefined =
    translatedTitle && (
      <h2
        data-testid="card-details-heading"
        id="card-details-heading"
        className="text-lg font-semibold leading-6 text-gray-900"
      >
        {translatedTitle}
      </h2>
    );

  const descriptionElement: ReactElement | false | "" | undefined =
    translatedDescription && (
      <p
        data-testid="card-description"
        className="mt-1.5 text-sm text-gray-500 w-full max-md:hidden md:block leading-relaxed"
      >
        {translatedDescription}
      </p>
    );

  const titleAndDescription: ReactElement = (
    <React.Fragment>
      {titleElement}
      {descriptionElement}
    </React.Fragment>
  );

  /*
   * Button carries a left margin for the side-by-side header (ml-1 or
   * md:ml-3, depending on its style). On a row of its own that margin only
   * pushes the first button off the title's left edge, and the gap already
   * spaces the rest, so it is cleared here.
   */
  const stackedHeader: ReactElement = (
    <div data-testid="card-header" data-header-layout="stacked">
      <div className="w-full min-w-0">{titleAndDescription}</div>
      {(props.rightElement || hasButtons) && (
        <div
          data-testid="card-header-actions"
          className="mt-3 flex flex-wrap items-center gap-2 [&_button]:ml-0 [&_button]:md:ml-0"
        >
          {props.rightElement && (
            <div className="flex items-center">{props.rightElement}</div>
          )}
          {hasButtons && renderButtons()}
        </div>
      )}
    </div>
  );

  /*
   * The title and what is on the right share one row that wraps: beside
   * each other while both fit, and the right element under the title, at
   * its left edge, when they do not (a long badge on a phone). The title is
   * never squeezed into two lines to make room. The description is not part
   * of that row, so its length cannot push the right element off it.
   */
  const inlineHeader: ReactElement = (
    <div data-testid="card-header" data-header-layout="inline">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {titleElement}
        {(props.rightElement || hasButtons) && (
          <div
            data-testid="card-header-actions"
            className="flex flex-wrap items-center gap-2 [&_button]:ml-0 [&_button]:md:ml-0"
          >
            {props.rightElement && (
              <div className="flex items-center">{props.rightElement}</div>
            )}
            {hasButtons && renderButtons()}
          </div>
        )}
      </div>
      {descriptionElement}
    </div>
  );

  const defaultHeader: ReactElement = (
    <div className="flex flex-col md:flex-row md:justify-between md:items-start">
      <div
        className={`${noRightElementsOrButtons ? "w-full" : "flex-1 min-w-0"}`}
      >
        {titleAndDescription}
      </div>
      {(props.rightElement || hasButtons) && (
        <div className="flex flex-col md:flex-row md:items-center md:w-fit mt-4 md:mt-0 md:ml-4 gap-2 md:gap-0 flex-shrink-0 items-center">
          {props.rightElement && (
            <div className="mb-2 md:mb-0 md:mr-3">{props.rightElement}</div>
          )}
          {hasButtons && (
            <div className="flex flex-wrap items-center gap-1.5">
              {renderButtons()}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <React.Fragment>
      <div data-testid="card" className={`mb-5 ${props.className || ""}`}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
          <div className="py-6 px-5 md:px-6">
            {isStacked
              ? stackedHeader
              : props.headerLayout === "inline"
                ? inlineHeader
                : defaultHeader}

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
