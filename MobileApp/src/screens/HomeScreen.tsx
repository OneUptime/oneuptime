import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useProject } from "../hooks/useProject";
import { useHaptics } from "../hooks/useHaptics";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "../navigation/types";
import Logo from "../components/Logo";
import GradientButton from "../components/GradientButton";

type HomeNavProp = BottomTabNavigationProp<MainTabParamList, "Home">;

interface StatCardProps {
  count: number | undefined;
  label: string;
  accentColor: string;
  iconName: keyof typeof Ionicons.glyphMap;
  isLoading: boolean;
  onPress: () => void;
}

function StatCard({
  count,
  label,
  accentColor,
  iconName,
  isLoading,
  onPress,
}: StatCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();

  const handlePress: () => void = (): void => {
    lightImpact();
    onPress();
  };

  return (
    <TouchableOpacity
      className="flex-1 rounded-3xl overflow-hidden"
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityLabel={`${count ?? 0} ${label}. Tap to view.`}
      accessibilityRole="button"
    >
      <LinearGradient
        colors={[theme.colors.accentGradientStart + "2B", theme.colors.accentGradientEnd + "1A"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: "absolute",
          top: -36,
          left: -20,
          width: 160,
          height: 160,
          borderRadius: 999,
        }}
      />
      <View
        className="p-4"
        style={{
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          borderRadius: 22,
          shadowColor: theme.isDark ? "#000" : theme.colors.accentGradientMid,
          shadowOpacity: theme.isDark ? 0.25 : 0.1,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 16,
          elevation: 6,
        }}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View
            className="w-10 h-10 rounded-2xl items-center justify-center"
            style={{ backgroundColor: accentColor + "14" }}
          >
            <Ionicons name={iconName} size={18} color={accentColor} />
          </View>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={theme.colors.textTertiary}
          />
        </View>
        <Text
          className="text-[30px] font-bold"
          style={{
            color: theme.colors.textPrimary,
            fontVariant: ["tabular-nums"],
            letterSpacing: -1.1,
          }}
        >
          {isLoading ? "--" : count ?? 0}
        </Text>
        <Text
          className="text-[12px] font-semibold mt-1"
          style={{
            color: theme.colors.textSecondary,
            letterSpacing: 0.3,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function getGreeting(): string {
  const hour: number = new Date().getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

export default function HomeScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { projectList, isLoadingProjects, refreshProjects } = useProject();
  const navigation: HomeNavProp = useNavigation<HomeNavProp>();

  const {
    incidentCount,
    alertCount,
    incidentEpisodeCount,
    alertEpisodeCount,
    isLoading: anyLoading,
    refetch,
  } = useAllProjectCounts();

  const { lightImpact } = useHaptics();

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await Promise.all([refetch(), refreshProjects()]);
  };

  if (!isLoadingProjects && projectList.length === 0) {
    return (
      <ScrollView
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="w-20 h-20 rounded-2xl items-center justify-center mb-6"
            style={{
              backgroundColor: "#000000",
              borderWidth: 1,
              borderColor: "#1F1F1F",
            }}
          >
            <Logo size={76} />
          </View>

          <Text
            className="text-[22px] font-bold text-center"
            style={{
              color: theme.colors.textPrimary,
              letterSpacing: -0.5,
            }}
          >
            No Projects Found
          </Text>
          <Text
            className="text-[15px] text-center mt-2 leading-[22px] max-w-[300px]"
            style={{ color: theme.colors.textSecondary }}
          >
            You don&apos;t have access to any projects. Contact your
            administrator or pull to refresh.
          </Text>

          <View className="mt-8 w-[200px]">
            <GradientButton
              label="Retry"
              onPress={refreshProjects}
              icon="refresh-outline"
            />
          </View>
        </View>
      </ScrollView>
    );
  }

  if (isLoadingProjects) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
      </View>
    );
  }

  const subtitle: string =
    projectList.length === 1
      ? projectList[0]!.name
      : `${projectList.length} Projects`;

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <View className="px-5 pt-4 pb-4">
        <View
          className="rounded-3xl overflow-hidden p-5"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
            shadowColor: theme.isDark ? "#000" : theme.colors.accentGradientMid,
            shadowOpacity: theme.isDark ? 0.3 : 0.12,
            shadowOffset: { width: 0, height: 10 },
            shadowRadius: 18,
            elevation: 7,
          }}
        >
          <LinearGradient
            colors={[
              theme.colors.accentGradientStart + "2B",
              theme.colors.accentGradientEnd + "08",
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: "absolute",
              top: -60,
              left: -20,
              right: -20,
              height: 220,
            }}
          />

          <View className="flex-row items-center">
            <View
              className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
              style={{
                backgroundColor: "#000000",
                borderWidth: 1,
                borderColor: "#1F1F1F",
              }}
            >
              <Logo size={44} />
            </View>
            <View className="flex-1">
              <Text
                className="text-[13px] font-medium"
                style={{
                  color: theme.colors.textSecondary,
                }}
              >
                {getGreeting()}
              </Text>
              <Text
                className="text-[24px] font-bold"
                accessibilityRole="header"
                style={{
                  color: theme.colors.textPrimary,
                  letterSpacing: -0.6,
                }}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            </View>
          </View>

          <View className="mt-4">
            <View>
              <Text
                className="text-[12px]"
                style={{ color: theme.colors.textTertiary }}
              >
                Total active issues
              </Text>
              <Text
                className="text-[30px] font-bold"
                style={{
                  color: theme.colors.textPrimary,
                  fontVariant: ["tabular-nums"],
                  letterSpacing: -1,
                }}
              >
                {(incidentCount ?? 0) + (alertCount ?? 0)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View className="gap-3 px-5">
        <View className="flex-row gap-3">
          <StatCard
            count={incidentCount}
            label="Active Incidents"
            accentColor={theme.colors.severityCritical}
            iconName="warning"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Incidents");
            }}
          />
          <StatCard
            count={alertCount}
            label="Active Alerts"
            accentColor={theme.colors.severityMajor}
            iconName="notifications"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Alerts");
            }}
          />
        </View>

        <View className="flex-row gap-3">
          <StatCard
            count={incidentEpisodeCount}
            label="Inc. Episodes"
            accentColor={theme.colors.severityInfo}
            iconName="layers"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Incidents");
            }}
          />
          <StatCard
            count={alertEpisodeCount}
            label="Alert Episodes"
            accentColor={theme.colors.severityWarning}
            iconName="albums"
            isLoading={anyLoading}
            onPress={() => {
              return navigation.navigate("Alerts");
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}
