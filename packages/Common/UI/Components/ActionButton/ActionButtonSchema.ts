import { ButtonStyleType } from "../Button/Button";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A row shows one action as a button and puts every other action in a ⋯ menu
 * beside it (see SplitActionButtons). Most actions never need to say where they
 * go - the split reads it off their style - so this is only for the ones whose
 * style tells the wrong story.
 */
export enum ActionButtonPlacement {
  /*
   * The row's button, ahead of anything the style would have picked. The first
   * visible Primary action wins; any other Primary action goes in the menu.
   */
  Primary = "Primary",
  /*
   * Always in the ⋯ menu, never the row's button - even when it is the only
   * action the row has. For utilities like "Show ID" that every row carries
   * but nobody reaches for first.
   */
  MoreMenu = "MoreMenu",
}

interface ActionButtonSchema<T extends GenericObject> {
  title: string;
  /*
   * Required. Whichever action a row does not show as its button goes in
   * the ⋯ menu, and every item there has an icon, so a menu never mixes
   * items with icons and items without ("Show ID" sat as a bare label above
   * a red "Delete" with its bin). Which actions end up in the menu is only
   * decided per row, so every action carries one. The row's own button is a
   * label (see RowActions).
   */
  icon: IconProp;
  buttonStyleType: ButtonStyleType;
  isLoading?: boolean | undefined;
  isVisible?: (item: T) => boolean | undefined;
  hideOnMobile?: boolean | undefined;
  /*
   * A row action the viewer is not allowed to perform stays on screen, locked,
   * so the row does not silently look different from everybody else's. The
   * tooltip is what turns a dead button into an explanation.
   */
  disabled?: boolean | undefined;
  tooltip?: string | undefined;
  /*
   * An action that is locked for some rows only - Delete on a built-in state
   * that can be renamed but never deleted, say: why it is locked for this
   * row, or undefined when it is not. The row keeps the action, locked, with
   * the reason as its tooltip. A lock from `disabled` (the viewer's
   * permissions) comes first.
   */
  getDisabledReason?: ((item: T) => string | undefined) | undefined;
  placement?: ActionButtonPlacement | undefined;
  onClick: (
    item: T,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
  ) => void;
}

export default ActionButtonSchema;
