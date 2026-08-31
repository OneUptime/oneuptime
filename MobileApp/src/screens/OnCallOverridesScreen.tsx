import React, { useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
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
          contentContainerStyle={{ padding: 20, paddingBottom: 56 }}
        >
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </ScrollView>
      </View>
    );
  }

  if (overrides.isError) {
    return (
      <View
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
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
      </View>
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
      contentContainerStyle={{ padding: 20, paddingBottom: 56 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <GradientButton
        testID="new-override"
        label="New override"
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
            borderRadius: 18,
            padding: 18,
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              lineHeight: 20,
              color: theme.colors.textSecondary,
            }}
          >
            No overrides yet. Create one when you need somebody else to take
            your pages, or when you are covering for a teammate.
          </Text>
        </View>
      ) : null}

      {overrides.active.length > 0 ? (
        <View style={{ marginTop: 28 }}>
          <SectionHeader title="In effect now" iconName="flash-outline" />
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
        <View style={{ marginTop: 28 }}>
          <SectionHeader title="Scheduled" iconName="calendar-outline" />
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
        <View style={{ marginTop: 28 }}>
          <SectionHeader title="Ended" iconName="checkmark-done-outline" />
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
