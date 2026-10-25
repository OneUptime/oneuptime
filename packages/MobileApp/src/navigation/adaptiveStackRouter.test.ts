import { describe, expect, test } from "@jest/globals";
import {
  CommonActions,
  StackActions,
  type ParamListBase,
  type PartialState,
  type RouterConfigOptions,
  type StackNavigationState,
} from "@react-navigation/native";
import {
  AdaptiveStackRouter,
  type AdaptiveStackRouterOptions,
} from "./adaptiveStackRouter";
import { areParamsEqual, paramsInclude } from "./routeParams";

/*
 * What opening something from a list means, on a phone and beside a detail
 * pane.
 *
 * On a narrow window the stack must behave exactly like the native stack it
 * replaced - every assertion in the first block holds for StackRouter too.
 * Beside a detail pane, a row tapped in the list replaces whatever is open on
 * the right instead of stacking on it, so Back never walks back through every
 * row the reader has looked at; anything opened from inside the detail pane
 * still pushes, as on a phone.
 */

type State = StackNavigationState<ParamListBase>;

const ROUTE_NAMES: Array<string> = [
  "InboxList",
  "IncidentDetail",
  "AlertDetail",
  "Sheet",
];

const CONFIG: RouterConfigOptions = {
  routeNames: ROUTE_NAMES,
  routeParamList: {},
  routeGetIdList: {},
};

function makeRouter(split: { current: boolean }): ReturnType<
  typeof AdaptiveStackRouter
> {
  const options: AdaptiveStackRouterOptions = {
    isSplit: (): boolean => {
      return split.current;
    },
    overlayRouteNames: ["Sheet"],
  };
  return AdaptiveStackRouter(options);
}

function listOnlyState(): State {
  return {
    stale: false,
    type: "stack",
    key: "stack-1",
    index: 0,
    routeNames: ROUTE_NAMES,
    preloadedRoutes: [],
    routes: [{ key: "list-key", name: "InboxList", params: undefined }],
  };
}

function withRoutes(
  routes: Array<{ key: string; name: string; params?: object }>,
): State {
  return {
    ...listOnlyState(),
    index: routes.length - 1,
    routes: routes as State["routes"],
  };
}

function apply(
  router: ReturnType<typeof AdaptiveStackRouter>,
  state: State,
  action: Parameters<ReturnType<typeof AdaptiveStackRouter>["getStateForAction"]>[1],
): State {
  const next: State | PartialState<State> | null = router.getStateForAction(
    state,
    action,
    CONFIG,
  );
  if (next === null) {
    throw new Error("the router refused the action");
  }
  return next as State;
}

function names(state: State): Array<string> {
  return state.routes.map((route: State["routes"][number]): string => {
    return route.name;
  });
}

const OPEN_INCIDENT_1: ReturnType<typeof CommonActions.navigate> = {
  ...CommonActions.navigate("IncidentDetail", {
    incidentId: "incident-1",
    projectId: "project-1",
  }),
  source: "list-key",
};

describe("On a narrow window it is the plain native stack", () => {
  test("opening from the list pushes", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: false,
    });
    const next: State = apply(router, listOnlyState(), OPEN_INCIDENT_1);

    expect(names(next)).toEqual(["InboxList", "IncidentDetail"]);
    expect(next.index).toBe(1);
  });

  test("opening a second record from the list stacks it on the first, as it always did", () => {
    /*
     * Only reachable on a phone by code (the list is covered by the detail),
     * and the stack behaves as React Navigation's own would.
     */
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: false,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        { key: "a", name: "IncidentDetail", params: { incidentId: "x" } },
      ]),
      {
        ...CommonActions.navigate("AlertDetail", { alertId: "y" }),
        source: "list-key",
      },
    );

    expect(names(next)).toEqual(["InboxList", "IncidentDetail", "AlertDetail"]);
  });
});

describe("Beside a detail pane, the list chooses what the pane shows", () => {
  test("a row opens its record in the empty pane", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(router, listOnlyState(), OPEN_INCIDENT_1);

    expect(names(next)).toEqual(["InboxList", "IncidentDetail"]);
    expect(next.routes[1]?.params).toEqual({
      incidentId: "incident-1",
      projectId: "project-1",
    });
  });

  test("the next row replaces the open one rather than stacking on it", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        {
          key: "open",
          name: "IncidentDetail",
          params: { incidentId: "incident-1", projectId: "project-1" },
        },
      ]),
      {
        ...CommonActions.navigate("AlertDetail", {
          alertId: "alert-9",
          projectId: "project-1",
        }),
        source: "list-key",
      },
    );

    expect(names(next)).toEqual(["InboxList", "AlertDetail"]);
    expect(next.index).toBe(1);
    expect(next.routes[0]?.key).toBe("list-key");
  });

  test("and closes anything opened inside the old record on its way", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        { key: "a", name: "IncidentDetail", params: { incidentId: "x" } },
        { key: "b", name: "AlertDetail", params: { alertId: "y" } },
      ]),
      {
        ...CommonActions.navigate("IncidentDetail", { incidentId: "z" }),
        source: "list-key",
      },
    );

    expect(names(next)).toEqual(["InboxList", "IncidentDetail"]);
    expect(next.routes[1]?.params).toEqual({ incidentId: "z" });
  });

  test("tapping the row that is already open goes back to it, keeping the same screen", () => {
    /*
     * Same key, so the screen on the right is not drawn again: its scroll
     * position and anything typed into it stay.
     */
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        {
          key: "open",
          name: "IncidentDetail",
          params: { incidentId: "incident-1", projectId: "project-1" },
        },
        { key: "deeper", name: "AlertDetail", params: { alertId: "a" } },
      ]),
      OPEN_INCIDENT_1,
    );

    expect(names(next)).toEqual(["InboxList", "IncidentDetail"]);
    expect(next.routes[1]?.key).toBe("open");
    expect(next.index).toBe(1);
  });

  test("something opened from inside the detail pane pushes within it, so Back returns to it", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        { key: "open", name: "IncidentDetail", params: { incidentId: "x" } },
      ]),
      {
        ...CommonActions.navigate("AlertDetail", { alertId: "y" }),
        source: "open",
      },
    );

    expect(names(next)).toEqual(["InboxList", "IncidentDetail", "AlertDetail"]);
  });

  test("a push notification - an action from outside the stack - fills the pane like a row would", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        { key: "open", name: "IncidentDetail", params: { incidentId: "x" } },
      ]),
      CommonActions.navigate("AlertDetail", { alertId: "paged" }),
    );

    expect(names(next)).toEqual(["InboxList", "AlertDetail"]);
    expect(next.routes[1]?.params).toEqual({ alertId: "paged" });
  });

  test("a sheet opens over the pane, keeping what is beneath it", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        { key: "open", name: "IncidentDetail", params: { incidentId: "x" } },
      ]),
      { ...CommonActions.navigate("Sheet"), source: "list-key" },
    );

    expect(names(next)).toEqual(["InboxList", "IncidentDetail", "Sheet"]);
  });

  test("a sheet already open is not mistaken for the open record", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        { key: "sheet", name: "Sheet" },
      ]),
      OPEN_INCIDENT_1,
    );

    expect(names(next)).toEqual(["InboxList", "IncidentDetail"]);
  });

  test("asking for the list itself closes the pane and updates the list in place", () => {
    /*
     * A Home shortcut ("active incidents"). On a phone this could stack a
     * second list; with the list already on screen, the detail pane closes
     * and the list takes the new params without being drawn again.
     */
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(
      router,
      withRoutes([
        { key: "list-key", name: "InboxList" },
        { key: "open", name: "IncidentDetail", params: { incidentId: "x" } },
      ]),
      CommonActions.navigate("InboxList", { initialFilter: "active" }),
    );

    expect(names(next)).toEqual(["InboxList"]);
    expect(next.routes[0]?.key).toBe("list-key");
    expect(next.routes[0]?.params).toEqual({ initialFilter: "active" });
  });

  test("an explicit push of the list is left to the stack", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const next: State = apply(router, listOnlyState(), {
      ...StackActions.push("InboxList"),
      source: "list-key",
    });

    expect(names(next)).toEqual(["InboxList", "InboxList"]);
  });

  test("Back, popping and resetting work as they always did", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });
    const open: State = withRoutes([
      { key: "list-key", name: "InboxList" },
      { key: "open", name: "IncidentDetail", params: { incidentId: "x" } },
    ]);

    expect(names(apply(router, open, CommonActions.goBack()))).toEqual([
      "InboxList",
    ]);
    expect(names(apply(router, open, StackActions.popToTop()))).toEqual([
      "InboxList",
    ]);
  });

  test("a screen this stack does not have is refused, so the action can bubble up", () => {
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter({
      current: true,
    });

    expect(
      router.getStateForAction(
        listOnlyState(),
        { ...CommonActions.navigate("NotHere"), source: "list-key" },
        CONFIG,
      ),
    ).toBeNull();
  });

  test("the layout is read when each action arrives, not when the router was made", () => {
    const split: { current: boolean } = { current: false };
    const router: ReturnType<typeof AdaptiveStackRouter> = makeRouter(split);
    const open: State = withRoutes([
      { key: "list-key", name: "InboxList" },
      { key: "open", name: "IncidentDetail", params: { incidentId: "x" } },
    ]);
    const openAlert: ReturnType<typeof CommonActions.navigate> = {
      ...CommonActions.navigate("AlertDetail", { alertId: "y" }),
      source: "list-key",
    };

    expect(names(apply(router, open, openAlert))).toHaveLength(3);
    split.current = true;
    expect(names(apply(router, open, openAlert))).toEqual([
      "InboxList",
      "AlertDetail",
    ]);
  });
});

describe("Comparing params", () => {
  test.each([
    [undefined, undefined, true],
    [undefined, {}, true],
    [{}, undefined, true],
    [{ a: 1 }, { a: 1 }, true],
    [{ a: 1 }, { a: 2 }, false],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [{ a: [1, { b: "c" }] }, { a: [1, { b: "c" }] }, true],
    [{ a: [1] }, { a: [1, 2] }, false],
    [{ a: [1] }, { a: { 0: 1 } }, false],
    ["x", "x", true],
    ["x", "y", false],
    [null, undefined, false],
  ] as Array<[unknown, unknown, boolean]>)(
    "%j and %j are equal: %s",
    (left: unknown, right: unknown, expected: boolean) => {
      expect(areParamsEqual(left, right)).toBe(expected);
    },
  );

  test("a row's own keys are enough to recognise the open record", () => {
    expect(
      paramsInclude(
        { incidentId: "i", projectId: "p", extra: true },
        { incidentId: "i", projectId: "p" },
      ),
    ).toBe(true);
    expect(paramsInclude({ incidentId: "i" }, { incidentId: "j" })).toBe(
      false,
    );
    expect(paramsInclude(undefined, { incidentId: "i" })).toBe(false);
    expect(paramsInclude(undefined, {})).toBe(true);
  });
});
