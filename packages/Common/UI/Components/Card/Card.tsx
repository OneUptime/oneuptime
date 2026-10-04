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
 * Where a card's actions go. Whatever the layout, what a card offers - Edit,
 * Create, the ⋯ menu, a status badge, a picker - sits at the RIGHT edge of
 * the header, on the title's line ("Why are edit buttons not on the right?").
 * When it does not fit there it moves onto the next line, still at the right
 * edge. It is never centred, and never put under the description at the
 * left.
 *
 * How the header shares its width:
 *
 * "default" is for a card as wide as the page's content: the title and the
 * description on the left, the actions beside them on the right, their top
 * level with the title's. Below md the description is hidden, and the title
 * and the actions share a line the way the stacked header's do.
 *
 * "stacked" is for a narrow column (the one-third sidebar of an overview
 * page, or a card whose header holds a row of controls). Beside the actions
 * the description would be squeezed into a column a word or two wide, so the
 * title and the actions share the first line and the description runs under
 * both, across the card's whole width.
 */
export type CardHeaderLayout = "default" | "stacked";

/*
 * Every layout, for the tests that hold each of them to the rule above: a
 * Record, so a layout added to the type cannot be left out of the list.
 */
const CARD_HEADER_LAYOUT_SET: Record<CardHeaderLayout, true> = {
  default: true,
  stacked: true,
};

export const CARD_HEADER_LAYOUTS: ReadonlyArray<CardHeaderLayout> = Object.keys(
  CARD_HEADER_LAYOUT_SET,
) as Array<CardHeaderLayout>;

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

/*
 * The header's class names, exported so the layout tests and the guard
 * (Common/Tests/UI/Components/CardHeaderActionsGuard.test.ts) read the same
 * strings Card draws with.
 */

/*
 * The actions: one row that wraps, at the right edge of the header. ml-auto
 * keeps the row at the right edge when it has a line to itself, and
 * justify-end keeps each of its own lines there when it wraps.
 */
export const CARD_HEADER_ACTIONS_CLASS_NAME: string =
  "ml-auto flex max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-2";

/*
 * The title's share of the line it shares with the actions.
 *
 * On a phone the title keeps its whole width: the actions stay beside it
 * while the two fit, and move to the next line, at the right edge, when they
 * do not - the title is never broken to make room for them.
 *
 * In the stacked header from md up - the one-third column of an overview
 * page, about 230px of header at 1280px - the title grows into whatever the
 * actions leave, and keeps the line with them as long as they leave it at
 * least half of it: "Affected Resources" breaks over two lines beside Edit
 * rather than dropping Edit onto a line of its own. Actions wider than that
 * - a probe picker and Test Monitor, or Assign and Refresh in that narrow
 * column - move to the next line instead, so a title is never squeezed
 * beside a row of controls.
 *
 * In the default header from md up the title and the description fill what
 * the actions leave, on one line that does not wrap.
 */
export const CARD_HEADER_TITLE_BLOCK_CLASS_NAME: string = "min-w-0 md:flex-1";

export const CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME: string =
  "min-w-0 md:grow md:basis-1/2";

/*
 * Each action's own box. Button carries a left margin meant for a dialog's
 * footer (md:ml-3 on a normal button, ml-1 on an outline one), which made
 * the gaps between a card's buttons uneven - 18px between two normal
 * buttons, 10px before the ⋯. The row's gap spaces them, so that margin is
 * cleared on the action itself (a <button>, or the one element a button
 * sits in: a disabled button's tooltip span, the ⋯ menu's wrapper) and never
 * on the buttons inside a control, such as a picker or a dialog it opens.
 */
export const CARD_HEADER_ACTION_CLASS_NAME: string =
  "flex items-center [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0";

const Card: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  const hasButtons: boolean = Boolean(
    props.buttons && props.buttons.length > 0,
  );
  const hasActions: boolean = Boolean(props.rightElement) || hasButtons;
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
          <div key={i} className={CARD_HEADER_ACTION_CLASS_NAME}>
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
        className="text-lg font-semibold leading-6 text-gray-900 text-balance break-words"
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

  const actionsElement: ReactElement | null = hasActions ? (
    <div
      data-testid="card-header-actions"
      className={`${CARD_HEADER_ACTIONS_CLASS_NAME}${
        isStacked ? "" : " md:flex-shrink-0"
      }`}
    >
      {props.rightElement && (
        <div className="flex items-center">{props.rightElement}</div>
      )}
      {hasButtons && renderButtons()}
    </div>
  ) : null;

  /*
   * The title and the actions share one line that wraps: side by side while
   * the actions leave the title its share, the actions on the next line - at
   * the right edge - when they do not (see the title block's class above).
   * On a phone the two are centred on each other; from md up their tops are
   * level, as in the default header. The description is not on that line,
   * so its length cannot push the actions off it: it runs under both, across
   * the card's whole width.
   */
  const stackedHeader: ReactElement = (
    <div data-testid="card-header" data-header-layout="stacked">
      {(titleElement || actionsElement) && (
        <div
          data-testid="card-header-title-row"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 md:items-start"
        >
          {titleElement && (
            <div
              data-testid="card-header-title-block"
              className={
                actionsElement
                  ? CARD_HEADER_STACKED_TITLE_BLOCK_CLASS_NAME
                  : "w-full min-w-0"
              }
            >
              {titleElement}
            </div>
          )}
          {actionsElement}
        </div>
      )}
      {descriptionElement}
    </div>
  );

  /*
   * From md up the title and the description are one block on the left, and
   * the actions sit beside it at the right edge, their top level with the
   * title's. Below md the description is hidden, so the title and the
   * actions share a line the way the stacked header's do: centred on each
   * other while they fit, the actions on the next line, at the right edge,
   * when they do not.
   */
  const defaultHeader: ReactElement = (
    <div
      data-testid="card-header"
      data-header-layout="default"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 md:flex-nowrap md:items-start"
    >
      <div
        data-testid="card-header-title-block"
        className={
          hasActions ? CARD_HEADER_TITLE_BLOCK_CLASS_NAME : "w-full min-w-0"
        }
      >
        {titleElement}
        {descriptionElement}
      </div>
      {actionsElement}
    </div>
  );

  return (
    <React.Fragment>
      <div data-testid="card" className={`mb-5 ${props.className || ""}`}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
          <div className="py-6 px-5 md:px-6">
            {isStacked ? stackedHeader : defaultHeader}

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
