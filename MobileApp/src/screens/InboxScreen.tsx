import React, { useEffect } from "react";
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
import type { InboxStackParamList } from "../navigation/types";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import ScreenIntro from "../components/ScreenIntro";
import IncidentsScreen from "./IncidentsScreen";
import AlertsScreen from "./AlertsScreen";

type InboxView = "incidents" | "alerts";
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
];

/** Incidents and alerts are adjacent views, not competing top-level destinations. */
export default function InboxScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const navigation: InboxNavigation = useNavigation<InboxNavigation>();
  const route: RouteProp<InboxStackParamList, "InboxList"> =
    useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const selectedView: InboxView = route.params?.initialView ?? "incidents";
  const focusedRoute: string = useNavigationState(
    (state: NavigationState): string => {
      return state.routes[state.index]?.name ?? "InboxList";
    },
  );

  useEffect((): void => {
    const detailView: InboxView | null = focusedRoute.startsWith("Incident")
      ? "incidents"
      : focusedRoute.startsWith("Alert")
        ? "alerts"
        : null;

    // A page may open a different category from the one last read. Keep Back useful.
    if (detailView && detailView !== selectedView) {
      navigation.setParams({
        initialView: detailView,
        initialSegment: focusedRoute.includes("Episode")
          ? "episodes"
          : detailView,
        initialFilter: "all",
      });
    }
  }, [focusedRoute, navigation, selectedView]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}>
      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.xl }}>
        <ScreenIntro title="Inbox" compact />
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
          {categories.map((category: InboxCategory): React.JSX.Element => {
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
                    navigation.setParams({
                      initialView: category.key,
                      initialSegment: category.key,
                      initialFilter: "all",
                    });
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
                <Ionicons
                  name={selected ? category.selectedIcon : category.icon}
                  size={18}
                  color={contentColor}
                />
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
      {selectedView === "incidents" ? (
        <IncidentsScreen embedded />
      ) : (
        <AlertsScreen embedded />
      )}
    </View>
  );
}
