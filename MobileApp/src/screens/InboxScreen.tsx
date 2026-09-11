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
}

const categories: Array<InboxCategory> = [
  { key: "incidents", label: "Incidents", icon: "warning-outline" },
  { key: "alerts", label: "Alerts", icon: "notifications-outline" },
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
      <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
        <ScreenIntro
          title="Inbox"
          description="Your team's response queue, in one place."
          compact
        />
        <View
          accessibilityRole="tablist"
          accessibilityLabel="Inbox categories"
          style={{
            flexDirection: "row",
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.borderDefault,
          }}
        >
          {categories.map((category: InboxCategory): React.JSX.Element => {
            const selected: boolean = category.key === selectedView;
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
                    minHeight: 52,
                    flexDirection: "row",
                    gap: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    borderBottomWidth: 3,
                    borderBottomColor: selected
                      ? theme.colors.actionPrimary
                      : "transparent",
                    backgroundColor: pressed
                      ? theme.colors.iconBackground
                      : "transparent",
                  };
                }}
              >
                <Ionicons
                  name={category.icon}
                  size={18}
                  color={
                    selected
                      ? theme.colors.actionPrimary
                      : theme.colors.textSecondary
                  }
                />
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: selected ? "700" : "500",
                    color: selected
                      ? theme.colors.actionPrimary
                      : theme.colors.textSecondary,
                  }}
                >
                  {category.label}
                </Text>
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
