import {
  StackRouter,
  type CommonNavigationAction,
  type ParamListBase,
  type PartialState,
  type Router,
  type RouterConfigOptions,
  type StackActionType,
  type StackNavigationState,
  type StackRouterOptions,
} from "@react-navigation/native";
import { areParamsEqual } from "./routeParams";

/*
 * The stack behind a list and its detail.
 *
 * One navigation state serves both layouts. On a narrow window it is drawn
 * as the stack it is: the list, and each screen opened from it pushed on
 * top. On a wide one the same state is drawn as two panes - the first route
 * (the list) on the left, the rest of the stack on the right. Because the
 * state never changes when the window does, a fold or an unfold cannot lose
 * the incident somebody was reading, its scroll position or the note they
 * were halfway through: only the drawing changes.
 *
 * What does change, while the window is wide, is what opening something from
 * the list means. Tapping the next incident in a list beside an open one
 * must replace the detail pane, not stack a second incident on the first;
 * otherwise Back would walk through every row the reader had ever tapped. So
 * with two panes showing, a screen opened from the list - or from outside
 * the stack, such as a push notification - becomes the detail pane's only
 * screen. Screens opened from inside the detail pane still push, as they do
 * on a phone, and Back returns to them.
 */

type AdaptiveStackState = StackNavigationState<ParamListBase>;
type AdaptiveStackAction = CommonNavigationAction | StackActionType;

export interface AdaptiveStackRouterOptions extends StackRouterOptions {
  /** Read when an action arrives: whether the stack is drawn as two panes right now. */
  isSplit: () => boolean;
  /**
   * Screens that open over whatever is in the detail pane rather than in it,
   * such as a form presented as a sheet. They push, in both layouts.
   */
  overlayRouteNames?: ReadonlyArray<string>;
}

interface OpenAction {
  type: "NAVIGATE" | "PUSH";
  source?: string;
  payload: {
    name: string;
    params?: Record<string, unknown>;
    pop?: boolean;
    merge?: boolean;
  };
}

function isOpenAction(
  action: AdaptiveStackAction,
): action is OpenAction & AdaptiveStackAction {
  return (
    (action.type === "NAVIGATE" || action.type === "PUSH") &&
    typeof (action as { payload?: { name?: unknown } }).payload?.name ===
      "string"
  );
}

/**
 * The next state for an action while the stack is drawn as two panes, or
 * `undefined` to let the ordinary stack handle it.
 */
export function getSplitStateForAction(
  state: AdaptiveStackState,
  action: AdaptiveStackAction,
  stackRouter: Router<AdaptiveStackState, AdaptiveStackAction>,
  configOptions: RouterConfigOptions,
  overlayRouteNames: ReadonlyArray<string>,
): AdaptiveStackState | PartialState<AdaptiveStackState> | null | undefined {
  if (!isOpenAction(action)) {
    return undefined;
  }

  const root: AdaptiveStackState["routes"][number] | undefined =
    state.routes[0];
  const { name, params } = action.payload;

  if (!root || !state.routeNames.includes(name)) {
    return undefined;
  }

  // Opened from inside the detail pane: an ordinary push within it.
  const fromList: boolean =
    action.source === undefined || action.source === root.key;
  if (!fromList || overlayRouteNames.includes(name)) {
    return undefined;
  }

  const listOnly: AdaptiveStackState = {
    ...state,
    index: 0,
    routes: [root],
  };

  if (name === root.name) {
    /*
     * "Show me the list, filtered like this" (a Home shortcut). On a phone
     * that could stack a second list; with the list already on screen on
     * the left, it closes the detail pane and updates the list in place.
     */
    return action.type === "NAVIGATE"
      ? stackRouter.getStateForAction(listOnly, action, configOptions)
      : undefined;
  }

  const open: AdaptiveStackState["routes"][number] | undefined =
    state.routes[1];
  if (
    open &&
    open.name === name &&
    areParamsEqual(open.params, params) &&
    !overlayRouteNames.includes(open.name)
  ) {
    // Already open on the right: go back to it, rather than open it twice.
    return {
      ...state,
      index: 1,
      routes: state.routes.slice(0, 2),
    };
  }

  return stackRouter.getStateForAction(listOnly, action, configOptions);
}

/** A stack router that knows when it is drawn as a list and its detail. */
export function AdaptiveStackRouter(
  options: AdaptiveStackRouterOptions,
): Router<AdaptiveStackState, AdaptiveStackAction> {
  const stackRouter: Router<AdaptiveStackState, AdaptiveStackAction> =
    StackRouter(options);
  const overlayRouteNames: ReadonlyArray<string> =
    options.overlayRouteNames ?? [];

  return {
    ...stackRouter,
    getStateForAction(
      state: AdaptiveStackState,
      action: AdaptiveStackAction,
      configOptions: RouterConfigOptions,
    ): AdaptiveStackState | PartialState<AdaptiveStackState> | null {
      if (options.isSplit()) {
        const splitState:
          | AdaptiveStackState
          | PartialState<AdaptiveStackState>
          | null
          | undefined = getSplitStateForAction(
          state,
          action,
          stackRouter,
          configOptions,
          overlayRouteNames,
        );
        if (splitState !== undefined) {
          return splitState;
        }
      }
      return stackRouter.getStateForAction(state, action, configOptions);
    },
  };
}
