import ActionButtonSchema, { RowActionContext } from "./ActionButtonSchema";
import { ErrorFunction, VoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";

/*
 * A list's row actions, each handed the list's RowActionContext as it runs -
 * the way a list (ModelTable) gives an action that changed its row a way to
 * show the change. A context the caller of onClick passes itself wins: a
 * list inside a list hands its own. The actions are otherwise unchanged, so
 * what decides where an action is drawn (its style, its placement) and
 * whether it is offered (isVisible, the locks) reads exactly as before.
 */
export function withRowActionContext<T extends GenericObject>(
  actions: Array<ActionButtonSchema<T>>,
  context: RowActionContext,
): Array<ActionButtonSchema<T>> {
  return actions.map((action: ActionButtonSchema<T>): ActionButtonSchema<T> => {
    return {
      ...action,
      onClick: (
        item: T,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
        given?: RowActionContext | undefined,
      ): void => {
        action.onClick(item, onCompleteAction, onError, given || context);
      },
    };
  });
}
