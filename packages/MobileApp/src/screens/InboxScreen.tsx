import React, { useEffect, useRef } from "react";
import {
  Pressable,
  Text,
  View,
  type ViewStyle,
  type PressableStateCallbackType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useNavigationState,
  useRoute,
  type RouteProp,
  type NavigationState,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { InboxStackParamList, InboxView } from "../navigation/types";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import ScreenIntro from "../components/ScreenIntro";
import {
  useContentGutters,
  usePane,
  useWindowLayout,
  type PaneLayout,
} from "../layout/WindowLayout";
import type { ContentGutters, WindowLayout } from "../layout/windowLayout";
import { useSecurityCasesAvailability } from "../hooks/useSecurityCases";
import IncidentsScreen from "./IncidentsScreen";
import AlertsScreen from "./AlertsScreen";
import SecurityCasesScreen from "./SecurityCasesScreen";
type InboxNavigation = NativeStackNavigationProp<
  InboxStackParamList,
  "InboxList"
>;

interface InboxCategory {
  key: InboxView;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selectedIcon: keyof typeof Ionicons.glyphMap;
}

const categories: Array<InboxCategory> = [
  {
    key: "incidents",
    label: "Incidents",
    icon: "warning-outline",
    selectedIcon: "warning",
  },
  {
    key: "alerts",
    label: "Alerts",
    icon: "notifications-outline",
    selectedIcon: "notifications",
  },
  {
    key: "security",
    label: "Security",
    icon: "shield-outline",
    selectedIcon: "shield",
  },
];

/*
 * The narrowest a category tab may be with its icon beside its label:
 * "Incidents" in bold and an 18-point icon take about 96 points. Three tabs
 * on a 320-point phone get 90 each, so there the labels stand alone.
 */
export const CATEGORY_TAB_MIN_WIDTH_WITH_ICON: number = 104;

// The category a detail screen belongs to, by its route's name.
export function getInboxViewOfRoute(routeName: string): InboxView | null {
  if (routeName.startsWith("SecurityCase")) {
    return "security";
  }
  if (routeName.startsWith("Incident")) {
    return "incidents";
  }
  if (routeName.startsWith("Alert")) {
    return "alerts";
  }
  return null;
}

/** Incidents and alerts are adjacent views, not competing top-level destinations. */
export default function InboxScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const gutters: ContentGutters = useContentGutters();
  const windowLayout: WindowLayout = useWindowLayout();
  /*
   * On a short window - a phone on its side - the page title gives its
   * height to the list: the tab or rail beside it already says Inbox.
   */
  const showTitle: boolean = windowLayout.heightClass !== "compact";
  const pane: PaneLayout = usePane();
  const navigation: InboxNavigation = useNavigation<InboxNavigation>();
  const route: RouteProp<InboxStackParamList, "InboxList"> =
    useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const selectedView: InboxView = route.params?.initialView ?? "incidents";
  /*
   * Security is a category only for the people who can read the project's
   * cases, in a project that has had one; everybody else's Inbox keeps its
   * two. Once it is the category on screen - a case opened from a push -
   * it stays, whatever the check says.
   */
  const security: ReturnType<typeof useSecurityCasesAvailability> =
    useSecurityCasesAvailability();
  const visibleCategories: Array<InboxCategory> = categories.filter(
    (category: InboxCategory): boolean => {
      return (
        category.key !== "security" ||
        security.isAvailable ||
        selectedView === "security"
      );
    },
  );
  const tabWidth: number =
    (pane.width -
      gutters.paddingLeft -
      gutters.paddingRight -
      spacing.xs * (visibleCategories.length - 1)) /
    visibleCategories.length;
  const showIcons: boolean = tabWidth >= CATEGORY_TAB_MIN_WIDTH_WITH_ICON;
  const focusedRoute: string = useNavigationState(
    (state: NavigationState): string => {
      return state.routes[state.index]?.name ?? "InboxList";
    },
  );

  /*
   * The category follows a record when one is OPENED, not afterwards. On a
   * phone the list is hidden behind an open record, so nothing can change
   * the category meanwhile; beside a detail pane it is on screen, and the
   * reader must be able to look at Alerts while an incident stays open on
   * the right. Following the open record on every render undid that tap.
   */
  const lastFollowedRoute: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  useEffect((): void => {
    if (lastFollowedRoute.current === focusedRoute) {
      return;
    }
    lastFollowedRoute.current = focusedRoute;

    const detailView: InboxView | null = getInboxViewOfRoute(focusedRoute);

    // A page may open a different category from the one last read. Keep Back useful.
    if (detailView && detailView !== selectedView) {
      navigation.setParams(
        detailView === "security"
          ? { initialView: "security", initialCaseFilter: "open" }
          : {
              initialView: detailView,
              initialSegment: focusedRoute.includes("Episode")
                ? "episodes"
                : detailView,
              initialFilter: "all",
            },
      );
    }
  }, [focusedRoute, navigation, selectedView]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}>
      <View
        style={{
          paddingTop: showTitle ? spacing.xl : spacing.sm,
          ...gutters,
        }}
      >
        {showTitle ? <ScreenIntro title="Inbox" compact /> : null}
        {/*
         * The category switch is the page's own navigation, so it reads as
         * tabs: a hairline the width of the page with a rounded indicator
         * under the selected label. The incidents/episodes switch inside each
         * list is a filled segmented track, which keeps the two levels from
         * looking like one control stacked twice.
         */}
        <View
          accessibilityRole="tablist"
          accessibilityLabel="Inbox categories"
          style={{
            flexDirection: "row",
            gap: spacing.xs,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.borderSubtle,
          }}
        >
          {visibleCategories.map((category: InboxCategory): React.JSX.Element => {
            const selected: boolean = category.key === selectedView;
            const contentColor: string = selected
              ? theme.colors.actionPrimary
              : theme.colors.textSecondary;
            return (
              <Pressable
                key={category.key}
                accessibilityRole="tab"
                accessibilityLabel={category.label}
                accessibilityState={{ selected }}
                aria-selected={selected}
                testID={`inbox-category-${category.key}`}
                onPress={(): void => {
                  if (!selected) {
                    navigation.setParams(
                      category.key === "security"
                        ? { initialView: "security" }
                        : {
                            initialView: category.key,
                            initialSegment: category.key,
                            initialFilter: "all",
                          },
                    );
                  }
                }}
                style={({ pressed }: PressableStateCallbackType): ViewStyle => {
                  return {
                    flex: 1,
                    minHeight: 48,
                    flexDirection: "row",
                    gap: spacing.sm,
                    alignItems: "center",
                    justifyContent: "center",
                    borderTopLeftRadius: radius.md,
                    borderTopRightRadius: radius.md,
                    backgroundColor: pressed
                      ? withAlpha(
                          theme.colors.actionPrimary,
                          theme.dark ? 0.16 : 0.08,
                        )
                      : "transparent",
                  };
                }}
              >
                {showIcons ? (
                  <Ionicons
                    name={selected ? category.selectedIcon : category.icon}
                    size={18}
                    color={contentColor}
                  />
                ) : null}
                <Text
                  style={{
                    ...typography.callout,
                    fontWeight: selected ? "700" : "600",
                    color: contentColor,
                  }}
                >
                  {category.label}
                </Text>
                <View
                  testID={`inbox-category-${category.key}-indicator`}
                  style={{
                    position: "absolute",
                    left: spacing.lg,
                    right: spacing.lg,
                    bottom: -1,
                    height: 3,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                    backgroundColor: selected
                      ? theme.colors.actionPrimary
                      : "transparent",
                  }}
                />
              </Pressable>
            );
          })}
        </View>
      </View>
      {selectedView === "security" ? (
        <SecurityCasesScreen />
      ) : selectedView === "alerts" ? (
        <AlertsScreen embedded />
      ) : (
        <IncidentsScreen embedded />
      )}
    </View>
  );
}
