import React, { useState } from "react";
import { View, ScrollView, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useOnCallOverrides } from "../hooks/useOnCallOverrides";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useNow } from "../hooks/useNow";
import OverrideCard from "../components/OverrideCard";
import SectionHeader from "../components/SectionHeader";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import GradientButton from "../components/GradientButton";
import AppText from "../components/AppText";
import Card from "../components/Card";
import IconBadge from "../components/IconBadge";
import { getFriendlyErrorMessage } from "../utils/error";
import type { OnCallStackParamList } from "../navigation/types";
import type { OnCallOverrideItem } from "../api/types";

type OverridesNavProp = NativeStackNavigationProp<
  OnCallStackParamList,
  "OnCallOverrides"
>;

/*
 * Every cover arrangement, split by whether it is doing anything right now.
 *
 * Cancelling is confirmed rather than immediate: an override is the only thing
 * standing between a colleague and a 3am page, and an accidental tap that
 * silently puts it back on them is not a mistake they can see happening.
 */
export default function OnCallOverridesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const { lightImpact, successFeedback, errorFeedback } = useHaptics();
  const navigation: OverridesNavProp = useNavigation<OverridesNavProp>();
  const now: number = useNow();
  const currentUserId: string | null = useCurrentUserId();

  const overrides: ReturnType<typeof useOnCallOverrides> =
    useOnCallOverrides(now);

  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    lightImpact();
    await overrides.refetch();
  });

  const performCancel: (override: OnCallOverrideItem) => Promise<void> = async (
    override: OnCallOverrideItem,
  ): Promise<void> => {
    setCancellingId(override._id);

    try {
      await overrides.cancelOverride(override);
      successFeedback();
    } catch (err: unknown) {
      errorFeedback();
      Alert.alert("Could not cancel override", getFriendlyErrorMessage(err));
    } finally {
      setCancellingId(null);
    }
  };

  const confirmCancel: (override: OnCallOverrideItem) => void = (
    override: OnCallOverrideItem,
  ): void => {
    Alert.alert(
      "Cancel this override?",
      "Pages will go back to whoever the schedule says is on call.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel override",
          style: "destructive",
          onPress: () => {
            performCancel(override);
          },
        },
      ],
    );
  };

  const intro: React.JSX.Element = (
    <ScreenIntro
      title="Coverage"
      description="Know who is covering, and make the next handoff simple."
    />
  );

  if (overrides.isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: spacing.xl,
            paddingBottom: bottomPadding,
          }}
        >
          {intro}
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (overrides.isError) {
    return (
      <ScrollView
        testID="overrides-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.actionPrimary}
          />
        }
      >
        {intro}
        <EmptyState
          title="Could not load overrides"
          subtitle="Pull to refresh or try again."
          icon="error"
          actionLabel="Retry"
          onAction={onRefresh}
        />
      </ScrollView>
    );
  }

  const hasAny: boolean =
    overrides.active.length > 0 ||
    overrides.upcoming.length > 0 ||
    overrides.past.length > 0;

  const renderSection: (
    title: string,
    iconName: keyof typeof Ionicons.glyphMap,
    items: OnCallOverrideItem[],
    state: "active" | "upcoming" | "past",
  ) => React.JSX.Element | null = (
    title: string,
    iconName: keyof typeof Ionicons.glyphMap,
    items: OnCallOverrideItem[],
    state: "active" | "upcoming" | "past",
  ): React.JSX.Element | null => {
    if (items.length === 0) {
      return null;
    }

    return (
      <View
        testID={`overrides-section-${state}`}
        style={{ marginTop: spacing.xxl }}
      >
        <SectionHeader title={title} iconName={iconName} count={items.length} />
        <View style={{ gap: spacing.md }}>
          {items.map((override: OnCallOverrideItem) => {
            return (
              <OverrideCard
                key={override._id}
                override={override}
                state={state}
                currentUserId={currentUserId}
                now={now}
                onCancel={state === "past" ? undefined : confirmCancel}
                isCancelling={cancellingId === override._id}
              />
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      testID="overrides-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: bottomPadding,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      {intro}
      {hasAny ? (
        <View
          testID="coverage-counts"
          style={{
            flexDirection: "row",
            gap: spacing.md,
            marginBottom: spacing.lg,
          }}
        >
          <StatTile
            testID="coverage-count-active"
            iconName="shield-checkmark-outline"
            color={theme.colors.oncallActive}
            value={overrides.active.length}
            label="Active now"
          />
          <StatTile
            testID="coverage-count-upcoming"
            iconName="calendar-outline"
            color={theme.colors.statusInfo}
            value={overrides.upcoming.length}
            label="Scheduled"
          />
        </View>
      ) : null}
      <GradientButton
        testID="new-override"
        label="Arrange coverage"
        icon="add-outline"
        onPress={() => {
          lightImpact();
          navigation.navigate("CreateOnCallOverride");
        }}
      />

      {!hasAny ? (
        <Card
          testID="overrides-empty"
          variant="outlined"
          style={{ marginTop: spacing.xxl }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.md,
            }}
          >
            <IconBadge
              name="swap-horizontal-outline"
              color={theme.colors.actionPrimary}
            />
            <View style={{ flex: 1, gap: spacing.xxs }}>
              <AppText variant="headline">No overrides yet</AppText>
              <AppText variant="subhead" tone="secondary">
                Create one when you need somebody else to take your pages, or
                when you are covering for a teammate.
              </AppText>
            </View>
          </View>
        </Card>
      ) : null}

      {renderSection(
        "In effect now",
        "radio-button-on-outline",
        overrides.active,
        "active",
      )}
      {renderSection(
        "Scheduled",
        "calendar-outline",
        overrides.upcoming,
        "upcoming",
      )}
      {renderSection("Ended", "time-outline", overrides.past, "past")}
    </ScrollView>
  );
}

function StatTile({
  iconName,
  color,
  value,
  label,
  testID,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  color: string;
  value: number;
  label: string;
  testID: string;
}): React.JSX.Element {
  return (
    <Card
      testID={testID}
      accessibilityLabel={`${value} ${label.toLowerCase()}`}
      style={{ flex: 1, gap: spacing.sm }}
    >
      <IconBadge name={iconName} color={color} size="sm" />
      <View>
        <AppText variant="title" style={{ fontVariant: ["tabular-nums"] }}>
          {value}
        </AppText>
        <AppText variant="footnote" tone="secondary">
          {label}
        </AppText>
      </View>
    </Card>
  );
}
