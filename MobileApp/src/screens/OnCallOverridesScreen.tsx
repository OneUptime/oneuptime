import React, { useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { useScreenPadding } from "../hooks/useScreenPadding";
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

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await overrides.refetch();
  };

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

  if (overrides.isLoading) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
        >
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (overrides.isError) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: bottomPadding,
          flexGrow: 1,
        }}
      >
        <EmptyState
          title="Could not load overrides"
          subtitle="Pull to refresh or try again."
          icon="alerts"
          actionLabel="Retry"
          onAction={() => {
            return overrides.refetch();
          }}
        />
      </ScrollView>
    );
  }

  const hasAny: boolean =
    overrides.active.length > 0 ||
    overrides.upcoming.length > 0 ||
    overrides.past.length > 0;

  return (
    <ScrollView
      testID="overrides-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ScreenIntro
        title="Coverage"
        description="Know who is covering, and make the next handoff simple."
      />
      {hasAny ? (
        <View
          testID="coverage-counts"
          style={{
            flexDirection: "row",
            gap: 24,
            paddingBottom: 24,
            marginBottom: 22,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.borderSubtle,
          }}
        >
          <View style={{ flex: 1, gap: 5 }}>
            <Text
              style={{
                fontSize: 36,
                lineHeight: 42,
                fontWeight: "600",
                letterSpacing: -1,
                color: theme.colors.textPrimary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {overrides.active.length}
            </Text>
            <Text
              style={{
                fontSize: 14,
                lineHeight: 21,
                color: theme.colors.textSecondary,
              }}
            >
              Active now
            </Text>
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text
              style={{
                fontSize: 36,
                lineHeight: 42,
                fontWeight: "600",
                letterSpacing: -1,
                color: theme.colors.textPrimary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {overrides.upcoming.length}
            </Text>
            <Text
              style={{
                fontSize: 14,
                lineHeight: 21,
                color: theme.colors.textSecondary,
              }}
            >
              Scheduled
            </Text>
          </View>
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
        <View
          style={{
            marginTop: 24,
            paddingVertical: 24,
            borderTopWidth: 1,
            borderTopColor: theme.colors.borderSubtle,
          }}
        >
          <Text
            style={{
              fontSize: 15,
              lineHeight: 23,
              color: theme.colors.textSecondary,
            }}
          >
            No overrides yet. Create one when you need somebody else to take
            your pages, or when you are covering for a teammate.
          </Text>
        </View>
      ) : null}

      {overrides.active.length > 0 ? (
        <View style={{ marginTop: 30 }}>
          <SectionHeader title="In effect now" />
          <View style={{ gap: 12 }}>
            {overrides.active.map((override: OnCallOverrideItem) => {
              return (
                <OverrideCard
                  key={override._id}
                  override={override}
                  state="active"
                  currentUserId={currentUserId}
                  now={now}
                  onCancel={confirmCancel}
                  isCancelling={cancellingId === override._id}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {overrides.upcoming.length > 0 ? (
        <View style={{ marginTop: 30 }}>
          <SectionHeader title="Scheduled" />
          <View style={{ gap: 12 }}>
            {overrides.upcoming.map((override: OnCallOverrideItem) => {
              return (
                <OverrideCard
                  key={override._id}
                  override={override}
                  state="upcoming"
                  currentUserId={currentUserId}
                  now={now}
                  onCancel={confirmCancel}
                  isCancelling={cancellingId === override._id}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {overrides.past.length > 0 ? (
        <View style={{ marginTop: 30 }}>
          <SectionHeader title="Ended" />
          <View style={{ gap: 12 }}>
            {overrides.past.map((override: OnCallOverrideItem) => {
              return (
                <OverrideCard
                  key={override._id}
                  override={override}
                  state="past"
                  currentUserId={currentUserId}
                  now={now}
                />
              );
            })}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
