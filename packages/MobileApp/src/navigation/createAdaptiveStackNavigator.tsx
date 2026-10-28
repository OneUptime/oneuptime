import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import {
  createNavigatorFactory,
  NavigationMetaContext,
  NavigationProvider,
  StackActions,
  useNavigationBuilder,
  type EventArg,
  type ParamListBase,
  type StackActionHelpers,
  type StackNavigationState,
  type TypedNavigator,
} from "@react-navigation/native";
import {
  NativeStackView,
  type NativeStackNavigationEventMap,
  type NativeStackNavigationOptions,
  type NativeStackNavigationProp,
  type NativeStackNavigatorProps,
} from "@react-navigation/native-stack";
import {
  Header,
  SafeAreaProviderCompat,
  getHeaderTitle,
} from "@react-navigation/elements";
import { useTheme } from "../theme";
import {
  PaneProvider,
  useHeaderHeightOverride,
  useListPaneWidthControl,
  useWindowLayout,
  type ListPaneWidthControl,
  type PaneLayout,
} from "../layout/WindowLayout";
import type { ListPaneWidthRange, WindowLayout } from "../layout/windowLayout";
import { clampListPaneWidth } from "../layout/paneDivider";
import PaneDivider from "./PaneDivider";
import {
  AdaptiveStackRouter,
  type AdaptiveStackRouterOptions,
} from "./adaptiveStackRouter";
import {
  ListPaneProvider,
  PaneStateScope,
  type DetailSelection,
} from "./paneState";

/*
 * A native stack that becomes a list and its detail when the window has room.
 *
 * On a phone, or a foldable's cover screen, it is exactly the native stack it
 * replaces: native push and pop, native headers, the iOS back swipe. When the
 * window is wide enough for two panes (windowLayout.ts decides), the stack's
 * first screen - the list - moves to a pane on the left with its own header,
 * and the same native stack carries on in a pane on the right, showing
 * whatever was opened from the list.
 *
 * Nothing in the navigation state changes when the window does, so folding
 * an open incident keeps the incident on screen (now full width, with Back
 * to the list), and unfolding puts it beside the list again. The screens on
 * the right never leave their place in the tree, which is what keeps a
 * half-written note, an open sheet and a scroll position through the fold.
 * Only the list is drawn afresh, and it keeps its own view state through
 * paneState.tsx.
 *
 * Where the platform says how the window folds, two more layouts follow
 * from windowLayout.ts, in the same tree. Half open on a table, the panes
 * stack: the detail stands above the fold, the list lies below it. Lying
 * flat, the divider carries a handle the reader can drag (PaneDivider).
 */

type StackState = StackNavigationState<ParamListBase>;
type StackDescriptorMap = React.ComponentProps<
  typeof NativeStackView
>["descriptors"];
type StackDescriptor = StackDescriptorMap[string];

export interface AdaptiveStackConfig {
  /** What the detail pane shows while nothing is open in it. */
  emptyDetail: React.ComponentType;
  /**
   * When the empty pane is one of the stack's own screens rather than a
   * placeholder - On-Call shows the team's roster beside the overview - that
   * screen's name, so the list marks its row as the one showing until
   * something else is opened.
   */
  emptyDetailRouteName?: string;
  /**
   * Screens that open over the detail pane rather than in it - a form
   * presented as a sheet. They push in both layouts, so the screen beneath
   * them stays.
   */
  overlayRouteNames?: ReadonlyArray<string>;
}

export type AdaptiveStackNavigatorProps = NativeStackNavigatorProps &
  AdaptiveStackConfig;

/**
 * The route the detail pane is showing, as the list should mark it: the
 * screen opened from the list, or - while nothing is - the screen the empty
 * pane stands in for, if it is one.
 */
export function getDetailSelection(
  state: StackState,
  overlayRouteNames: ReadonlyArray<string>,
  emptyDetailRouteName?: string,
): DetailSelection | null {
  const open: StackState["routes"][number] | undefined = state.routes[1];
  if (!open || overlayRouteNames.includes(open.name)) {
    // A sheet opened from the list sits over the empty pane, not in its place.
    return emptyDetailRouteName ? { name: emptyDetailRouteName } : null;
  }
  return {
    name: open.name,
    params: open.params as Record<string, unknown> | undefined,
  };
}

/*
 * The bar above whatever the detail pane shows first - its empty state, or
 * the record opened from the list. No Back button (the list beside it is the
 * way back) and no title, since every such screen opens on a title of its
 * own ("INCIDENT · INC-7, Checkout is down"). It is drawn on the canvas with
 * no hairline, so it reads as space, and it keeps the pane's content level
 * with the list's, whatever the pane shows.
 */
const EMPTY_BAR_OPTIONS: NativeStackNavigationOptions = {
  headerTitle: "",
  headerBackVisible: false,
  headerLeft: (): null => {
    return null;
  },
};

/**
 * The descriptors the stack on the right draws from while there are two
 * panes. Its first screen is the list, which is on the left now, so in its
 * place it shows the empty detail. The screen opened from the list appears
 * without a push animation, as switching rows should feel. Both sit under
 * the same empty bar, level with the list's header, so the pane's content
 * never jumps when the first record opens. Screens opened further in keep
 * their Back button and their push, under a bar with no title.
 */
export function getSplitDescriptors(
  descriptors: StackDescriptorMap,
  state: StackState,
  EmptyDetail: React.ComponentType,
  overlayRouteNames: ReadonlyArray<string>,
): StackDescriptorMap {
  const next: StackDescriptorMap = { ...descriptors };

  state.routes.forEach(
    (route: StackState["routes"][number], index: number): void => {
      const descriptor: StackDescriptor | undefined = descriptors[route.key];
      if (!descriptor) {
        return;
      }

      if (index === 0) {
        next[route.key] = {
          ...descriptor,
          options: { ...descriptor.options, ...EMPTY_BAR_OPTIONS },
          /*
           * In the list's place, with the list route's own navigation: what
           * the empty pane opens is opened "from the list", so it fills the
           * pane. (The web stack does not provide the route's context to a
           * screen itself - only to its header - so it is provided here.)
           */
          render: (): React.JSX.Element => {
            return (
              <NavigationProvider
                route={descriptor.route}
                navigation={descriptor.navigation}
              >
                <EmptyDetail />
              </NavigationProvider>
            );
          },
        };
        return;
      }

      const opensThePane: boolean =
        index === 1 && !overlayRouteNames.includes(route.name);
      /*
       * Further in - a screen opened inside the pane, or a sheet over it -
       * the bar keeps its Back button and takes no title either. The project
       * switcher heads the list now, and every screen opens on a title of
       * its own, so a title in the bar would only repeat it in other words
       * ("New Override" above "Arrange coverage"). A phone's bar shows no
       * page title either.
       */
      const options: NativeStackNavigationOptions = {
        ...descriptor.options,
        headerTitle: "",
      };

      next[route.key] = {
        ...descriptor,
        options: opensThePane
          ? {
              ...options,
              ...EMPTY_BAR_OPTIONS,
              gestureEnabled: false,
              animation: "none",
            }
          : options,
      };
    },
  );

  return next;
}

/*
 * The top of the pane above a tabletop fold, as on a phone: the bar keeps the
 * project switcher, since the list below the fold has no header of its own -
 * half a screen is too short for one. The empty detail and the record opened
 * from the list have no Back button (the list is right there, below the
 * fold); the record appears without a push, as switching rows should feel.
 */
const FIRST_IN_STACKED_PANE_OPTIONS: NativeStackNavigationOptions = {
  headerBackVisible: false,
  headerLeft: (): null => {
    return null;
  },
};

/**
 * The descriptors the stack above a tabletop fold draws from: like
 * getSplitDescriptors, the empty detail in the list's place and the record
 * opened from the list without a push - but every bar keeps the stack's own
 * title, the project switcher, as a phone's does.
 */
export function getStackedDescriptors(
  descriptors: StackDescriptorMap,
  state: StackState,
  EmptyDetail: React.ComponentType,
  overlayRouteNames: ReadonlyArray<string>,
): StackDescriptorMap {
  const next: StackDescriptorMap = { ...descriptors };

  state.routes.forEach(
    (route: StackState["routes"][number], index: number): void => {
      const descriptor: StackDescriptor | undefined = descriptors[route.key];
      if (!descriptor) {
        return;
      }

      if (index === 0) {
        next[route.key] = {
          ...descriptor,
          options: { ...descriptor.options, ...FIRST_IN_STACKED_PANE_OPTIONS },
          render: (): React.JSX.Element => {
            return (
              <NavigationProvider
                route={descriptor.route}
                navigation={descriptor.navigation}
              >
                <EmptyDetail />
              </NavigationProvider>
            );
          },
        };
        return;
      }

      if (index === 1 && !overlayRouteNames.includes(route.name)) {
        next[route.key] = {
          ...descriptor,
          options: {
            ...descriptor.options,
            ...FIRST_IN_STACKED_PANE_OPTIONS,
            gestureEnabled: false,
            animation: "none",
          },
        };
      }
    },
  );

  return next;
}

/*
 * The list's own screen, drawn once per descriptor: while the reader drags
 * the divider only the pane around it changes width, so the list is not
 * rendered again on every move.
 */
function ListPaneContent({
  descriptor,
}: {
  descriptor: StackDescriptor;
}): React.JSX.Element {
  return descriptor.render() as React.JSX.Element;
}

const MemoListPaneContent: React.MemoExoticComponent<typeof ListPaneContent> =
  React.memo(ListPaneContent);

function ListPane({
  descriptor,
  width,
  drawnWidth,
  height,
  selection,
}: {
  descriptor: StackDescriptor;
  /** The pane's width, as screens inside read it. */
  width: number;
  /** The width it is drawn at: the same, except while the divider is dragged. */
  drawnWidth: number;
  /** Below a tabletop fold: the pane's height. Beside the detail it is the window's. */
  height?: number;
  selection: DetailSelection | null;
}): React.JSX.Element {
  const { theme } = useTheme();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const headerHeight: number | undefined = useHeaderHeightOverride();
  const stacked: boolean = height !== undefined;
  const pane: PaneLayout = useMemo((): PaneLayout => {
    if (height !== undefined) {
      // Below the fold: the window's full width, and its bottom edge, but not its top.
      return {
        kind: "list",
        arrangement: "stacked",
        width,
        height,
        insetLeft: insets?.left ?? 0,
        insetRight: insets?.right ?? 0,
        insetTop: 0,
      };
    }
    return {
      kind: "list",
      width,
      insetLeft: insets?.left ?? 0,
      insetRight: 0,
    };
  }, [width, height, insets?.left, insets?.right]);
  const { options, route, navigation } = descriptor;

  return (
    <PaneProvider pane={pane}>
      <View
        testID="list-pane"
        style={
          stacked
            ? {
                height,
                borderTopWidth: 1,
                borderTopColor: theme.colors.borderSubtle,
                backgroundColor: theme.colors.backgroundPrimary,
              }
            : {
                width: drawnWidth,
                borderRightWidth: 1,
                borderRightColor: theme.colors.borderSubtle,
                backgroundColor: theme.colors.backgroundPrimary,
              }
        }
      >
        {stacked ? null : (
          <NavigationProvider route={route} navigation={navigation}>
            <Header
              title={getHeaderTitle(options, route.name)}
              headerTitle={options.headerTitle}
              headerTitleAlign={options.headerTitleAlign}
              headerTintColor={options.headerTintColor}
              headerTitleStyle={options.headerTitleStyle}
              headerStyle={
                headerHeight === undefined
                  ? options.headerStyle
                  : [options.headerStyle, { height: headerHeight }]
              }
              headerShadowVisible={options.headerShadowVisible}
            />
          </NavigationProvider>
        )}
        <ListPaneProvider selection={selection}>
          <View key={route.key} style={styles.fill}>
            <MemoListPaneContent descriptor={descriptor} />
          </View>
        </ListPaneProvider>
      </View>
    </PaneProvider>
  );
}

function AdaptiveStackNavigator({
  id,
  initialRouteName,
  UNSTABLE_routeNamesChangeBehavior,
  children,
  layout,
  screenListeners,
  screenOptions,
  screenLayout,
  UNSTABLE_router,
  emptyDetail,
  emptyDetailRouteName,
  overlayRouteNames,
}: AdaptiveStackNavigatorProps): React.JSX.Element {
  const windowLayout: WindowLayout = useWindowLayout();
  const split: boolean = windowLayout.panes === 2;
  const stacked: boolean = split && windowLayout.paneArrangement === "stacked";
  const dividerRange: ListPaneWidthRange | null = split
    ? windowLayout.listPaneWidthRange
    : null;
  const { setPreferredListPaneWidth }: ListPaneWidthControl =
    useListPaneWidthControl();

  /*
   * While the reader drags the divider, the width it is drawn at; the layout
   * takes the new width only when they let go.
   */
  const [draggedListWidth, setDraggedListWidth] = useState<number | null>(null);
  const drawnListWidth: number =
    dividerRange && draggedListWidth !== null
      ? clampListPaneWidth(draggedListWidth, dividerRange)
      : windowLayout.listPaneWidth;
  const commitListWidth: (width: number | null) => void = useCallback(
    (width: number | null): void => {
      setPreferredListPaneWidth(width);
      setDraggedListWidth(null);
    },
    [setPreferredListPaneWidth],
  );
  const cancelListWidth: () => void = useCallback((): void => {
    setDraggedListWidth(null);
  }, []);
  /*
   * A drag the window takes away - half closed, folded, turned to one pane -
   * is dropped, so the divider never comes back at a width nobody let go at.
   */
  const dividerOffered: boolean = dividerRange !== null;
  useEffect((): void => {
    if (!dividerOffered) {
      setDraggedListWidth(null);
    }
  }, [dividerOffered]);

  /*
   * The router is created once, so it reads the current layout through a
   * ref when an action arrives rather than through a prop it was built with.
   */
  const splitRef: React.MutableRefObject<boolean> = useRef<boolean>(split);
  splitRef.current = split;
  const overlays: ReadonlyArray<string> = useMemo((): ReadonlyArray<string> => {
    return overlayRouteNames ?? [];
  }, [overlayRouteNames]);
  const isSplit: () => boolean = useRef((): boolean => {
    return splitRef.current;
  }).current;

  const { state, describe, descriptors, navigation, NavigationContent } =
    useNavigationBuilder<
      StackState,
      AdaptiveStackRouterOptions,
      StackActionHelpers<ParamListBase>,
      NativeStackNavigationOptions,
      NativeStackNavigationEventMap
    >(AdaptiveStackRouter, {
      id,
      initialRouteName,
      UNSTABLE_routeNamesChangeBehavior,
      children,
      layout,
      screenListeners,
      screenOptions,
      screenLayout,
      UNSTABLE_router,
      isSplit,
      overlayRouteNames: overlays,
    });

  const meta: unknown = useContext(NavigationMetaContext);

  // Tapping the tab that is already selected returns its stack to the start.
  useEffect((): (() => void) | undefined => {
    if (
      meta &&
      typeof meta === "object" &&
      "type" in meta &&
      (meta as { type?: unknown }).type === "native-tabs"
    ) {
      return undefined;
    }

    let handle: ReturnType<typeof requestAnimationFrame> | undefined;

    const unsubscribe: (() => void) | undefined = (
      navigation as unknown as {
        addListener?: (
          type: "tabPress",
          callback: (event: EventArg<"tabPress", true>) => void,
        ) => () => void;
      }
    ).addListener?.("tabPress", (event: EventArg<"tabPress", true>) => {
      const isFocused: boolean = navigation.isFocused();

      if (handle !== undefined) {
        cancelAnimationFrame(handle);
      }

      // Next frame, so every listener has had the chance to preventDefault().
      handle = requestAnimationFrame((): void => {
        const currentState: StackState = navigation.getState() as StackState;

        if (isFocused && currentState.index > 0 && !event.defaultPrevented) {
          navigation.dispatch({
            ...StackActions.popToTop(),
            target: currentState.key,
          });
        }
      });
    });

    return (): void => {
      if (handle !== undefined) {
        cancelAnimationFrame(handle);
      }
      unsubscribe?.();
    };
  }, [meta, navigation]);

  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const rootRoute: StackState["routes"][number] = state.routes[0]!;
  const rootDescriptor: StackDescriptor = descriptors[rootRoute.key]!;
  const selection: DetailSelection | null = split
    ? getDetailSelection(state, overlays, emptyDetailRouteName)
    : null;

  const stackDescriptors: StackDescriptorMap =
    useMemo((): StackDescriptorMap => {
      if (!split) {
        return descriptors;
      }
      return stacked
        ? getStackedDescriptors(descriptors, state, emptyDetail, overlays)
        : getSplitDescriptors(descriptors, state, emptyDetail, overlays);
    }, [split, stacked, descriptors, state, emptyDetail, overlays]);

  const stackPane: PaneLayout = useMemo((): PaneLayout => {
    if (stacked) {
      // Above the fold: the window's full width, and its top edge, but not its bottom.
      return {
        kind: "detail",
        arrangement: "stacked",
        width: windowLayout.detailPaneWidth,
        height: windowLayout.detailPaneHeight,
        insetLeft: insets?.left ?? 0,
        insetRight: insets?.right ?? 0,
        insetBottom: 0,
        reachesBottom: false,
      };
    }
    return split
      ? {
          kind: "detail",
          width: windowLayout.detailPaneWidth,
          insetLeft: 0,
          insetRight: insets?.right ?? 0,
        }
      : {
          kind: "full",
          width: windowLayout.contentWidth,
          insetLeft: insets?.left ?? 0,
          insetRight: insets?.right ?? 0,
        };
  }, [
    split,
    stacked,
    windowLayout.detailPaneWidth,
    windowLayout.detailPaneHeight,
    windowLayout.contentWidth,
    insets?.left,
    insets?.right,
  ]);

  /*
   * The element tree is the same in every layout - the list pane, the gap
   * and the divider slots are simply empty on a narrow window - so the stack
   * on the right keeps its place, and every screen in it keeps its state,
   * when the window changes. Stacked, the same children are laid out bottom
   * up: the list below the fold, the gap on it, the detail above.
   */
  return (
    <NavigationContent>
      <SafeAreaProviderCompat>
        <PaneStateScope scope={rootRoute.key}>
          <View
            testID="adaptive-panes"
            style={stacked ? styles.stacked : styles.row}
          >
            {split ? (
              <ListPane
                descriptor={rootDescriptor}
                width={windowLayout.listPaneWidth}
                drawnWidth={drawnListWidth}
                height={stacked ? windowLayout.listPaneHeight : undefined}
                selection={selection}
              />
            ) : null}
            {split && windowLayout.paneGap > 0 ? (
              <View
                testID="pane-gap"
                style={
                  stacked
                    ? { height: windowLayout.paneGap }
                    : { width: windowLayout.paneGap }
                }
              />
            ) : null}
            <PaneProvider pane={stackPane}>
              <View
                testID={split ? "detail-pane" : undefined}
                style={styles.fill}
              >
                <NativeStackView
                  state={state}
                  navigation={navigation}
                  descriptors={stackDescriptors}
                  describe={describe}
                />
              </View>
            </PaneProvider>
            {dividerRange ? (
              <PaneDivider
                width={drawnListWidth}
                defaultWidth={windowLayout.defaultListPaneWidth}
                range={dividerRange}
                contentWidth={windowLayout.contentWidth}
                onDrag={setDraggedListWidth}
                onCommit={commitListWidth}
                onCancel={cancelListWidth}
              />
            ) : null}
          </View>
        </PaneStateScope>
      </SafeAreaProviderCompat>
    </NavigationContent>
  );
}

const styles: {
  row: { flex: number; flexDirection: "row" };
  stacked: { flex: number; flexDirection: "column-reverse" };
  fill: { flex: number };
} = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  stacked: { flex: 1, flexDirection: "column-reverse" },
  fill: { flex: 1 },
});

export type AdaptiveStackTypeBag<ParamList extends ParamListBase> = {
  ParamList: ParamList;
  NavigatorID: string | undefined;
  State: StackNavigationState<ParamList>;
  ScreenOptions: NativeStackNavigationOptions;
  EventMap: NativeStackNavigationEventMap;
  NavigationList: {
    [RouteName in keyof ParamList]: NativeStackNavigationProp<
      ParamList,
      RouteName
    >;
  };
  Navigator: typeof AdaptiveStackNavigator;
};

/**
 * createNativeStackNavigator, for a stack whose first screen is a list: on a
 * wide window the list and what was opened from it are drawn side by side.
 */
export function createAdaptiveStackNavigator<
  const ParamList extends ParamListBase,
>(): TypedNavigator<AdaptiveStackTypeBag<ParamList>, undefined> {
  return createNavigatorFactory(AdaptiveStackNavigator)();
}
