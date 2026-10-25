import React, { useContext, useEffect, useMemo, useRef } from "react";
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
  useWindowLayout,
  type PaneLayout,
} from "../layout/WindowLayout";
import type { WindowLayout } from "../layout/windowLayout";
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
   * Screens that open over the detail pane rather than in it - a form
   * presented as a sheet. They push in both layouts, so the screen beneath
   * them stays.
   */
  overlayRouteNames?: ReadonlyArray<string>;
}

export type AdaptiveStackNavigatorProps = NativeStackNavigatorProps &
  AdaptiveStackConfig;

/** The route the detail pane is showing, as the list should mark it. */
export function getDetailSelection(
  state: StackState,
  overlayRouteNames: ReadonlyArray<string>,
): DetailSelection | null {
  const open: StackState["routes"][number] | undefined = state.routes[1];
  if (!open || overlayRouteNames.includes(open.name)) {
    return null;
  }
  return { name: open.name, params: open.params };
}

/**
 * The descriptors the stack on the right draws from while there are two
 * panes. Its first screen is the list, which is on the left now, so in its
 * place it shows the empty detail; the screen opened from the list carries
 * no Back button (the list beside it is the way back) and appears without a
 * push animation, as switching rows should feel. Every detail is titled with
 * its own name, because the project switcher now heads the list.
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
          options: { ...descriptor.options, headerShown: false },
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
      const options: NativeStackNavigationOptions = {
        ...descriptor.options,
        headerTitle: getHeaderTitle(
          { title: descriptor.options.title },
          route.name,
        ),
      };

      next[route.key] = {
        ...descriptor,
        options: opensThePane
          ? {
              ...options,
              headerBackVisible: false,
              headerLeft: (): null => {
                return null;
              },
              gestureEnabled: false,
              animation: "none",
            }
          : options,
      };
    },
  );

  return next;
}

function ListPane({
  descriptor,
  width,
  selection,
}: {
  descriptor: StackDescriptor;
  width: number;
  selection: DetailSelection | null;
}): React.JSX.Element {
  const { theme } = useTheme();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const pane: PaneLayout = useMemo((): PaneLayout => {
    return {
      kind: "list",
      width,
      insetLeft: insets?.left ?? 0,
      insetRight: 0,
    };
  }, [width, insets?.left]);
  const { options, route, navigation } = descriptor;

  return (
    <PaneProvider pane={pane}>
      <View
        testID="list-pane"
        style={{
          width,
          borderRightWidth: 1,
          borderRightColor: theme.colors.borderSubtle,
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <NavigationProvider route={route} navigation={navigation}>
          <Header
            title={getHeaderTitle(options, route.name)}
            headerTitle={options.headerTitle}
            headerTitleAlign={options.headerTitleAlign}
            headerTintColor={options.headerTintColor}
            headerTitleStyle={options.headerTitleStyle}
            headerStyle={options.headerStyle}
            headerShadowVisible={options.headerShadowVisible}
          />
        </NavigationProvider>
        <ListPaneProvider selection={selection}>
          <View key={route.key} style={styles.fill}>
            {descriptor.render()}
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
  overlayRouteNames,
}: AdaptiveStackNavigatorProps): React.JSX.Element {
  const windowLayout: WindowLayout = useWindowLayout();
  const split: boolean = windowLayout.panes === 2;

  /*
   * The router is created once, so it reads the current layout through a
   * ref when an action arrives rather than through a prop it was built with.
   */
  const splitRef: React.MutableRefObject<boolean> = useRef<boolean>(split);
  splitRef.current = split;
  const overlays: ReadonlyArray<string> = useMemo(
    (): ReadonlyArray<string> => {
      return overlayRouteNames ?? [];
    },
    [overlayRouteNames],
  );
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

        if (
          isFocused &&
          currentState.index > 0 &&
          !event.defaultPrevented
        ) {
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
    ? getDetailSelection(state, overlays)
    : null;

  const stackDescriptors: StackDescriptorMap = useMemo(
    (): StackDescriptorMap => {
      return split
        ? getSplitDescriptors(descriptors, state, emptyDetail, overlays)
        : descriptors;
    },
    [split, descriptors, state, emptyDetail, overlays],
  );

  const stackPane: PaneLayout = useMemo((): PaneLayout => {
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
    windowLayout.detailPaneWidth,
    windowLayout.contentWidth,
    insets?.left,
    insets?.right,
  ]);

  /*
   * The element tree is the same in both layouts - the list pane slot is
   * simply empty on a narrow window - so the stack on the right keeps its
   * place, and every screen in it keeps its state, when the window changes.
   */
  return (
    <NavigationContent>
      <SafeAreaProviderCompat>
        <PaneStateScope scope={rootRoute.key}>
          <View style={styles.row}>
            {split ? (
              <ListPane
                descriptor={rootDescriptor}
                width={windowLayout.listPaneWidth}
                selection={selection}
              />
            ) : null}
            <PaneProvider pane={stackPane}>
              <View testID={split ? "detail-pane" : undefined} style={styles.fill}>
                <NativeStackView
                  state={state}
                  navigation={navigation}
                  descriptors={stackDescriptors}
                  describe={describe}
                />
              </View>
            </PaneProvider>
          </View>
        </PaneStateScope>
      </SafeAreaProviderCompat>
    </NavigationContent>
  );
}

const styles: { row: { flex: number; flexDirection: "row" }; fill: { flex: number } } =
  StyleSheet.create({
    row: { flex: 1, flexDirection: "row" },
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
