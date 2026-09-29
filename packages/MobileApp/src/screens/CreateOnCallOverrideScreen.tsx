import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { radius, spacing, touchTarget } from "../theme/tokens";
import getToggleAccessibilityProps from "../utils/getToggleAccessibilityProps";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useNow } from "../hooks/useNow";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useActiveProject } from "../hooks/useProject";
import { useProjectUsers } from "../hooks/useProjectUsers";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useOnCallOverrides } from "../hooks/useOnCallOverrides";
import GradientButton from "../components/GradientButton";
import SegmentedControl from "../components/SegmentedControl";
import SectionHeader from "../components/SectionHeader";
import UserPickerModal from "../components/UserPickerModal";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import IconBadge from "../components/IconBadge";
import { getInitials } from "../components/RosterScheduleCard";
import { formatShiftTime, formatShiftWindow } from "../utils/duration";
import { getFriendlyErrorMessage } from "../utils/error";
import {
  buildOverrideRequest,
  describeOverride,
  DURATION_PRESETS,
  type BuildOverrideResult,
  type OverrideDirection,
  type OverrideWindow,
} from "../oncall/overrideDraft";
import type {
  CreateOnCallOverrideParams,
  OnCallStackParamList,
} from "../navigation/types";
import type { ProjectUserItem } from "../api/types";

type CreateOverrideNavProp = NativeStackNavigationProp<
  OnCallStackParamList,
  "CreateOnCallOverride"
>;

type CreateOverrideRouteProp = RouteProp<
  OnCallStackParamList,
  "CreateOnCallOverride"
>;

/**
 * The shift window a "Get cover" tap carried in, or null when the sheet was
 * opened from "Cover for me" and the window is "now plus a duration".
 *
 * Unparseable params return null so they are never formatted as dates. The
 * submit handler also rejects them instead of changing the requested window.
 */
export function readPrefilledWindow(
  params: CreateOnCallOverrideParams | undefined,
): OverrideWindow | null {
  if (!params) {
    return null;
  }

  const startsAt: Date = new Date(params.startsAt);
  const endsAt: Date = new Date(params.endsAt);

  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime())
  ) {
    return null;
  }

  return { startsAt, endsAt };
}

/*
 * "I can't take this - somebody else has it."
 *
 * The whole screen is three decisions and a confirmation sentence, because it
 * is used in exactly two situations: you are about to get on a plane, or you
 * are already awake and cannot deal with the next page. Neither is a moment
 * for a date picker.
 *
 * Overrides start NOW and run for a preset number of hours. A future-dated
 * override is a planning task and belongs on the web, where a calendar is
 * usable - with one exception: "Get cover" on a shift card arrives here with
 * that shift's window already known, and then the sheet covers exactly that
 * shift (from now, if it has already started) and asks only who takes it.
 */
export default function CreateOnCallOverrideScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const now: number = useNow();
  const { successFeedback, errorFeedback, selectionFeedback } = useHaptics();
  const navigation: CreateOverrideNavProp =
    useNavigation<CreateOverrideNavProp>();
  const route: CreateOverrideRouteProp = useRoute<CreateOverrideRouteProp>();
  const prefill: CreateOnCallOverrideParams | undefined = route.params;
  const prefilledWindow: OverrideWindow | null =
    useMemo((): OverrideWindow | null => {
      return readPrefilledWindow(prefill);
    }, [prefill]);

  const { projectList } = useActiveProject();
  const currentUserId: string | null = useCurrentUserId();
  const overrides: ReturnType<typeof useOnCallOverrides> = useOnCallOverrides();

  /*
   * A prefilled shift is always MINE (the list only shows the signed-in
   * user's shifts), so the only direction that makes sense is handing it to
   * somebody else; the segmented control is not offered in that case.
   */
  const [direction, setDirection] = useState<OverrideDirection>("cover-me");
  const projectId: string | null = projectList[0]?._id ?? null;
  const [counterpart, setCounterpart] = useState<ProjectUserItem | null>(null);
  const [durationHours, setDurationHours] = useState<number>(4);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const projectUsers: ReturnType<typeof useProjectUsers> =
    useProjectUsers(projectId);
  const { refreshing: isRetryingUsers, onRefresh: retryUsers } = useRefresh(
    projectUsers.refetch,
  );

  /*
   * Changing project invalidates the person: the picker lists that project's
   * members, and an override naming somebody who is not in the project would
   * be rejected server-side after the user had already stopped reading.
   */
  useEffect((): void => {
    setCounterpart(null);
    setIsPickerOpen(false);
    setError(null);
  }, [projectId]);

  const counterpartName: string = counterpart
    ? counterpart.name || counterpart.email
    : "a teammate";

  const windowLabel: string | null = useMemo((): string | null => {
    if (!prefilledWindow) {
      return null;
    }

    const range: string | null = formatShiftWindow(
      prefilledWindow.startsAt.toISOString(),
      prefilledWindow.endsAt.toISOString(),
    );

    const scheduleLabel: string = prefill?.scheduleName
      ? ` on ${prefill.scheduleName}`
      : "";

    return range
      ? `for your shift${scheduleLabel} (${range})`
      : `for your shift${scheduleLabel}`;
  }, [prefilledWindow, prefill?.scheduleName]);

  const previewSentence: string = describeOverride(
    direction,
    counterpartName,
    durationHours,
    windowLabel,
  );

  const endsAtLabel: string | null = useMemo(() => {
    if (prefilledWindow) {
      return formatShiftTime(prefilledWindow.endsAt.toISOString());
    }

    return formatShiftTime(
      new Date(now + durationHours * 60 * 60 * 1000).toISOString(),
    );
  }, [durationHours, prefilledWindow, now]);

  const startsNow: boolean =
    !prefilledWindow || prefilledWindow.startsAt.getTime() <= now;

  const onSubmit: () => Promise<void> = async (): Promise<void> => {
    setError(null);

    if (prefill && !prefilledWindow) {
      setError(
        "This shift's times could not be read. Return to On call and choose the shift again.",
      );
      errorFeedback();
      return;
    }

    if (prefill && prefill.projectId !== projectId) {
      setError(
        "This shift belongs to another project. Return to On call and choose a shift in the selected project.",
      );
      errorFeedback();
      return;
    }

    const result: BuildOverrideResult = buildOverrideRequest(
      {
        direction,
        projectId,
        counterpartUserId: counterpart?.userId ?? null,
        durationHours,
        window: prefilledWindow,
        onCallDutyPolicyId: prefill?.policyId ?? null,
      },
      currentUserId,
      Date.now(),
    );

    if (!result.ok) {
      setError(result.reason);
      errorFeedback();
      return;
    }

    try {
      await overrides.createOverride(result.input);
      successFeedback();
      navigation.goBack();
    } catch (err: unknown) {
      setError(getFriendlyErrorMessage(err));
      errorFeedback();
    }
  };

  const prefilledRange: string | null = prefilledWindow
    ? formatShiftWindow(
        prefilledWindow.startsAt.toISOString(),
        prefilledWindow.endsAt.toISOString(),
      )
    : null;

  return (
    <>
      <ScrollView
        testID="create-override-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: bottomPadding,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenIntro
          title={prefilledWindow ? "Cover this shift" : "Arrange coverage"}
          description="A clear handoff, for exactly as long as you need."
        />

        {prefilledWindow ? (
          <Card testID="prefilled-shift" variant="tinted">
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.md,
              }}
            >
              <IconBadge
                name="calendar-outline"
                color={theme.colors.actionPrimary}
                background={theme.colors.backgroundElevated}
              />
              <View style={{ flex: 1, gap: spacing.xxs }}>
                <AppText variant="footnote" tone="secondary">
                  Cover for my shift
                </AppText>
                <AppText variant="title3">
                  {prefill?.scheduleName ?? "On-call shift"}
                </AppText>
                {prefilledRange ? (
                  <AppText variant="subhead" tone="secondary">
                    {prefilledRange}
                  </AppText>
                ) : null}
              </View>
            </View>
          </Card>
        ) : (
          <View>
            <SectionHeader title="Coverage type" />
            <SegmentedControl<OverrideDirection>
              style={{ marginHorizontal: 0, marginTop: 0, marginBottom: 0 }}
              segments={[
                { key: "cover-me", label: "Cover for me" },
                { key: "take-over", label: "I'll take over" },
              ]}
              selected={direction}
              onSelect={(key: OverrideDirection) => {
                selectionFeedback();
                setDirection(key);
                setError(null);
              }}
            />
          </View>
        )}

        <View style={{ marginTop: spacing.xxl }}>
          <SectionHeader
            title={
              prefilledWindow
                ? "Who will cover this shift?"
                : direction === "cover-me"
                  ? "Who will cover for you?"
                  : "Who are you covering for?"
            }
          />
          <Card
            testID="open-user-picker"
            accessibilityLabel={
              counterpart
                ? `Selected ${counterpartName}. Tap to change.`
                : "Choose a teammate"
            }
            onPress={() => {
              if (!projectUsers.isError) {
                setIsPickerOpen(true);
              }
            }}
            padding={spacing.md + 2}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                minHeight: 44,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: counterpart
                    ? theme.colors.actionPrimary
                    : theme.colors.cardAccent,
                }}
              >
                {counterpart ? (
                  <AppText
                    variant="subhead"
                    weight="700"
                    color={theme.colors.textInverse}
                  >
                    {getInitials(counterpartName)}
                  </AppText>
                ) : (
                  <Ionicons
                    name="person-add-outline"
                    size={19}
                    color={theme.colors.actionPrimary}
                  />
                )}
              </View>
              <View style={{ flex: 1, gap: spacing.xxs }}>
                <AppText
                  variant="headline"
                  color={
                    counterpart
                      ? theme.colors.textPrimary
                      : theme.colors.actionPrimary
                  }
                >
                  {counterpart ? counterpartName : "Choose a teammate"}
                </AppText>
                <AppText
                  testID="coverage-project-name"
                  variant="footnote"
                  tone="secondary"
                >
                  {projectList[0]?.name ?? "No project available"}
                </AppText>
              </View>
              {counterpart ? (
                <AppText variant="subhead" weight="600" tone="accent">
                  Change
                </AppText>
              ) : null}
              <Ionicons
                name="chevron-forward"
                size={18}
                color={theme.colors.textTertiary}
              />
            </View>
          </Card>
          {projectUsers.isError ? (
            <View
              testID="coverage-teammates-error"
              accessibilityRole="alert"
              style={{
                marginTop: spacing.md,
                padding: spacing.lg,
                borderRadius: radius.lg,
                backgroundColor: theme.colors.statusErrorBg,
                gap: spacing.md,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: spacing.md,
                }}
              >
                <Ionicons
                  name="cloud-offline-outline"
                  size={20}
                  color={theme.colors.statusError}
                  style={{ marginTop: 1 }}
                />
                <AppText
                  variant="subhead"
                  color={theme.colors.statusError}
                  style={{ flex: 1 }}
                >
                  Could not load your teammates. Try again to choose who will
                  handle this coverage.
                </AppText>
              </View>
              <GradientButton
                testID="retry-coverage-teammates"
                label="Retry loading teammates"
                icon="refresh-outline"
                variant="secondary"
                size="sm"
                loading={isRetryingUsers}
                onPress={retryUsers}
              />
            </View>
          ) : null}
        </View>

        {!prefilledWindow ? (
          <View style={{ marginTop: spacing.xxl }}>
            <SectionHeader title="How long?" />
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: spacing.sm,
              }}
            >
              {DURATION_PRESETS.map(
                (preset: { label: string; hours: number }) => {
                  const isSelected: boolean = preset.hours === durationHours;
                  return (
                    <Pressable
                      key={preset.hours}
                      testID={`duration-${preset.hours}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Override lasts ${preset.label}`}
                      {...getToggleAccessibilityProps(isSelected)}
                      onPress={() => {
                        selectionFeedback();
                        setDurationHours(preset.hours);
                        setError(null);
                      }}
                      style={({ pressed }: { pressed: boolean }): ViewStyle => {
                        return {
                          flexGrow: 1,
                          flexBasis: "28%",
                          paddingVertical: spacing.md,
                          paddingHorizontal: spacing.sm,
                          minHeight: touchTarget,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: isSelected
                            ? theme.colors.actionPrimary
                            : theme.colors.borderDefault,
                          backgroundColor: isSelected
                            ? theme.colors.actionPrimary
                            : pressed
                              ? theme.colors.backgroundTertiary
                              : theme.colors.backgroundElevated,
                        };
                      }}
                    >
                      <AppText
                        variant="subhead"
                        weight="600"
                        color={
                          isSelected
                            ? theme.colors.textInverse
                            : theme.colors.textPrimary
                        }
                      >
                        {preset.label}
                      </AppText>
                    </Pressable>
                  );
                },
              )}
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.xs + 2,
                marginTop: spacing.md,
                marginHorizontal: spacing.xs,
              }}
            >
              <Ionicons
                name="information-circle-outline"
                size={16}
                color={theme.colors.textTertiary}
                style={{ marginTop: 1 }}
              />
              <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>
                Starts when you confirm. Your usual routing resumes
                automatically when coverage ends.
              </AppText>
            </View>
          </View>
        ) : null}

        <Card
          testID="override-preview"
          variant="tinted"
          style={{ marginTop: spacing.xxl }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Ionicons
              name="eye-outline"
              size={16}
              color={theme.colors.actionPrimary}
            />
            <AppText variant="footnote" weight="600" tone="accent">
              Review your coverage
            </AppText>
          </View>
          <AppText variant="title3" style={{ marginTop: spacing.sm }}>
            {previewSentence}
          </AppText>
          {endsAtLabel ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.xs + 2,
                marginTop: spacing.sm,
              }}
            >
              <Ionicons
                name="time-outline"
                size={15}
                color={theme.colors.textSecondary}
                style={{ marginTop: 3 }}
              />
              <AppText variant="subhead" tone="secondary" style={{ flex: 1 }}>
                {startsNow
                  ? `Starts now, ends ${endsAtLabel}.`
                  : `Starts ${formatShiftTime(prefilledWindow?.startsAt.toISOString() ?? null) ?? "with the shift"}, ends ${endsAtLabel}.`}
              </AppText>
            </View>
          ) : null}
        </Card>

        {error ? (
          <Banner
            testID="override-error"
            tone="danger"
            message={error}
            style={{ marginTop: spacing.lg }}
          />
        ) : null}

        <GradientButton
          testID="submit-override"
          label="Confirm coverage"
          icon="checkmark-circle-outline"
          loading={overrides.isCreating}
          onPress={onSubmit}
          style={{ marginTop: spacing.xl }}
        />
      </ScrollView>
      <UserPickerModal
        visible={isPickerOpen && !projectUsers.isError}
        title={
          direction === "cover-me" ? "Route my pages to" : "Take over from"
        }
        users={projectUsers.users}
        isLoading={projectUsers.isLoading}
        selectedUserId={counterpart?.userId ?? null}
        excludeUserId={currentUserId}
        onSelect={(user: ProjectUserItem) => {
          setCounterpart(user);
          setIsPickerOpen(false);
          setError(null);
        }}
        onClose={() => {
          setIsPickerOpen(false);
        }}
      />
    </>
  );
}
