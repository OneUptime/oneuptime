import ActionButtonSchema, {
  ActionButtonPlacement,
} from "./ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import GenericObject from "../../../Types/GenericObject";

/*
 * A row carries one action as a button and folds everything else into a ⋯ menu
 * beside it. Six outlined buttons on every row of a table is the loudest thing
 * on the page and says nothing about which one matters; one button and a menu
 * says exactly that.
 *
 * Which action gets the button, in order:
 *
 *  1. The first visible action marked ActionButtonPlacement.Primary. ModelTable
 *     marks its "View" action this way, because opening the record is what a
 *     row is for.
 *  2. The first action styled as a call to action (NORMAL, PRIMARY, SUCCESS,
 *     WARNING). The author already said which one is prominent.
 *  3. The first action that is not destructive - usually Edit.
 *  4. A lone destructive action. With nothing else on the row, hiding "Delete"
 *     behind a menu of one would only add a click.
 *
 * Destructive actions are never promoted over anything else, and actions marked
 * ActionButtonPlacement.MoreMenu are never promoted at all. The menu keeps the
 * authored order, except that destructive actions sink to the bottom - the
 * place people look for them, and the place they are least likely to be hit by
 * a slip of the pointer.
 */

export interface IndexedActionButton<T extends GenericObject> {
  button: ActionButtonSchema<T>;
  // Position in the array the caller passed in.
  index: number;
}

export interface SplitActionButtonsResult<T extends GenericObject> {
  primary: IndexedActionButton<T> | null;
  moreMenu: Array<IndexedActionButton<T>>;
}

export interface SplitActionButtonsOptions<T extends GenericObject> {
  actionButtons: Array<ActionButtonSchema<T>> | undefined;
  item: T;
  isMobile?: boolean | undefined;
}

const DESTRUCTIVE_STYLES: Array<ButtonStyleType> = [
  ButtonStyleType.DANGER,
  ButtonStyleType.DANGER_OUTLINE,
  ButtonStyleType.HOVER_DANGER_OUTLINE,
];

const CALL_TO_ACTION_STYLES: Array<ButtonStyleType> = [
  ButtonStyleType.NORMAL,
  ButtonStyleType.PRIMARY,
  ButtonStyleType.SUCCESS,
  ButtonStyleType.WARNING,
];

export const isDestructiveActionButton: <T extends GenericObject>(
  button: ActionButtonSchema<T>,
) => boolean = <T extends GenericObject>(
  button: ActionButtonSchema<T>,
): boolean => {
  return DESTRUCTIVE_STYLES.includes(button.buttonStyleType);
};

export const isActionButtonVisible: <T extends GenericObject>(
  button: ActionButtonSchema<T>,
  item: T,
  isMobile: boolean,
) => boolean = <T extends GenericObject>(
  button: ActionButtonSchema<T>,
  item: T,
  isMobile: boolean,
): boolean => {
  if (button.isVisible && !button.isVisible(item)) {
    return false;
  }

  if (button.hideOnMobile && isMobile) {
    return false;
  }

  return true;
};

type SplitActionButtonsFunction = <T extends GenericObject>(
  options: SplitActionButtonsOptions<T>,
) => SplitActionButtonsResult<T>;

const splitActionButtons: SplitActionButtonsFunction = <
  T extends GenericObject,
>(
  options: SplitActionButtonsOptions<T>,
): SplitActionButtonsResult<T> => {
  const visible: Array<IndexedActionButton<T>> = [];

  (options.actionButtons || []).forEach(
    (button: ActionButtonSchema<T>, index: number) => {
      if (
        isActionButtonVisible(button, options.item, Boolean(options.isMobile))
      ) {
        visible.push({ button, index });
      }
    },
  );

  const candidates: Array<IndexedActionButton<T>> = visible.filter(
    (entry: IndexedActionButton<T>) => {
      return entry.button.placement !== ActionButtonPlacement.MoreMenu;
    },
  );

  const nonDestructiveCandidates: Array<IndexedActionButton<T>> =
    candidates.filter((entry: IndexedActionButton<T>) => {
      return !isDestructiveActionButton(entry.button);
    });

  const primary: IndexedActionButton<T> | null =
    candidates.find((entry: IndexedActionButton<T>) => {
      return entry.button.placement === ActionButtonPlacement.Primary;
    }) ||
    nonDestructiveCandidates.find((entry: IndexedActionButton<T>) => {
      return CALL_TO_ACTION_STYLES.includes(entry.button.buttonStyleType);
    }) ||
    nonDestructiveCandidates[0] ||
    (visible.length === 1 && candidates.length === 1 ? candidates[0]! : null);

  const rest: Array<IndexedActionButton<T>> = visible.filter(
    (entry: IndexedActionButton<T>) => {
      return entry !== primary;
    },
  );

  return {
    primary,
    moreMenu: [
      ...rest.filter((entry: IndexedActionButton<T>) => {
        return !isDestructiveActionButton(entry.button);
      }),
      ...rest.filter((entry: IndexedActionButton<T>) => {
        return isDestructiveActionButton(entry.button);
      }),
    ],
  };
};

export default splitActionButtons;
