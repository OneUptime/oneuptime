import { ButtonStyleType } from "../Button/Button";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import type { ReactElement } from "react";

/*
 * What a list hands a row action as it runs it, for an action that changes
 * the row it was taken on - its state, a switch, an owner - and wants the
 * list to show the change: `refresh` reads the list's rows again, keeping
 * its page, sort and filters. ModelTable passes it; a list that does not
 * passes nothing, and the action carries on without it.
 */
export interface RowActionContext {
  refresh: () => void;
}

/*
 * The question a row action asks before it runs (getConfirmation): the
 * dialog's words, English or already in the reader's language. The submit
 * runs the action, and the dialog stays open, its button busy, until the
 * action says it is done (onCompleteAction) - or says why not (onError),
 * which the dialog shows in place, so nobody has to start again.
 */
export interface RowActionConfirmation {
  title: string;
  description: string | ReactElement;
  submitButtonText: string;
  // PRIMARY when left out. DANGER for an action that destroys something.
  submitButtonType?: ButtonStyleType | undefined;
  // Drawn under the description: what the action does, say.
  details?: ReactElement | undefined;
}

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
   * What the action says when it is the row's one button (RowActions), when
   * that can be shorter than its title: "View" for "View On-Call Schedule".
   * The row names its record in its first column and the list's title
   * names their kind, so repeating the kind on every row's button only
   * widened the Actions column - "View Scheduled Maintenance Template" took
   * the room two columns needed, and pushed tables past their card. The
   * title still names the action in the ⋯ menu and to a screen reader: the
   * button's accessible name is the title, which starts with (or, in
   * another language, holds) these words, so speech control still finds
   * the button by what it shows. Where a translation's title does not hold
   * them, the row says the whole title (ShortButtonWords).
   */
  rowButtonTitle?: string | undefined;
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
  /*
   * The kind of action this is (ActionMenuGroup, or a list's own kind): the
   * ⋯ menu draws a gap where one kind ends and the next begins, so a long
   * menu reads in short runs. Left out, the action sits with its unnamed
   * neighbours, as every action always has.
   */
  menuGroup?: string | undefined;
  /*
   * The question to ask before the action runs on this row, or undefined to
   * run it at once - Disable on a workflow says what a disabled workflow
   * stops doing, as the bulk Disable does; Enable needs no question. The
   * row draws the dialog (RowActions), so a list asks with no state of its
   * own.
   */
  getConfirmation?:
    | ((item: T) => RowActionConfirmation | undefined)
    | undefined;
  /*
   * `context` is the list's (RowActionContext): an action that changed the
   * row calls its refresh once the change is saved.
   */
  onClick: (
    item: T,
    onCompleteAction: VoidFunction,
    onError: ErrorFunction,
    context?: RowActionContext | undefined,
  ) => void;
}

export default ActionButtonSchema;
