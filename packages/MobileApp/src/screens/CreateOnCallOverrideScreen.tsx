import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useContentGutters } from "../layout/WindowLayout";
import type { ContentGutters } from "../layout/windowLayout";
import { useNow } from "../hooks/useNow";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useActiveProject } from "../hooks/useProject";
import { useProjectUsers } from "../hooks/useProjectUsers";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useOnCallOverrides } from "../hooks/useOnCallOverrides";
import { useGlobalOverrideAccess } from "../hooks/useGlobalOverrideLock";
import {
  useCoverPolicies,
  type CoverPoliciesState,
} from "../hooks/useCoverPolicies";
import {
  GLOBAL_OVERRIDE_LIMITED_REASON,
  getGlobalOverrideLockReason,
  type GlobalOverrideAccess,
} from "../oncall/globalOverrideAccess";
import type { CoverPolicy } from "../api/onCallOverrides";
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
  describePolicyScope,
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
 *
 * The cover it arranges applies to every on-call policy in the project,
 * which takes a permission to add overrides over the whole project. For
 * someone whose permission covers only some policies, the sheet offers the
 * policies the server says they may cover instead, and arranges the cover
 * on each one ticked. For someone who may cover none of them, or may add no
 * override at all, it says why in place of the form, before anything is
 * chosen.
 */
export default function CreateOnCallOverrideScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
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

  /*
   * Cover for a policy-variant shift names its policy. Every other cover
   * arranged here is global - it applies to every on-call policy in the
   * project - and takes a permission to add overrides over the whole
   * project (oncall/globalOverrideAccess). For someone whose permission
   * covers only some policies, the sheet asks the server which they may
   * cover - of the shift's policies from Get cover, else of the project's -
   * and offers those, one override on each (useCoverPolicies). Where it
   * allows none, or cannot say (a server older than the question), and for
   * someone who may add no override at all, the server would refuse the
   * cover on Confirm, so the sheet says why in place of the form.
   */
  const globalOverrideAccess: GlobalOverrideAccess =
    useGlobalOverrideAccess(projectId);
  const isOnSomePolicies: boolean =
    !prefill?.policyId && globalOverrideAccess === "limited";
  const coverPolicies: CoverPoliciesState = useCoverPolicies({
    projectId,
    // A shift of another project is refused on Confirm, whatever it offers.
    enabled: isOnSomePolicies && (!prefill || prefill.projectId === projectId),
    shiftPolicies: prefill ? prefill.policies ?? [] : undefined,
  });
  const offeredPolicies: CoverPolicy[] =
    coverPolicies.status === "offered" ? coverPolicies.policies : [];
  const isCheckingPolicies: boolean =
    isOnSomePolicies && coverPolicies.status === "checking";

  let lockReason: string | null = null;

  if (isOnSomePolicies) {
    lockReason =
      offeredPolicies.length > 0 || isCheckingPolicies
        ? null
        : GLOBAL_OVERRIDE_LIMITED_REASON;
  } else if (!prefill?.policyId) {
    lockReason = getGlobalOverrideLockReason(globalOverrideAccess);
  }

  // The offered policies unticked: every one is ticked to start with.
  const [untickedPolicyIds, setUntickedPolicyIds] = useState<string[]>([]);
  const pickedPolicies: CoverPolicy[] = offeredPolicies.filter(
    (policy: CoverPolicy): boolean => {
      return !untickedPolicyIds.includes(policy.policyId);
    },
  );

  /*
   * The policies a Confirm has arranged the cover on so far: one that
   * failed part way, tried again, arranges the rest only.
   */
  const savedPolicyIds: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set<string>());

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
    setUntickedPolicyIds([]);
    savedPolicyIds.current = new Set<string>();
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

    if (lockReason) {
      setError(lockReason);
      errorFeedback();
      return;
    }

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

    if (isOnSomePolicies && pickedPolicies.length === 0) {
      setError("Tick at least one on-call policy.");
      errorFeedback();
      return;
    }

    try {
      if (isOnSomePolicies) {
        // One override on each policy ticked, one after another.
        for (const policy of pickedPolicies) {
          if (savedPolicyIds.current.has(policy.policyId)) {
            continue;
          }

          try {
            await overrides.createOverride({
              ...result.input,
              onCallDutyPolicyId: policy.policyId,
            });
          } catch (err: unknown) {
            /*
             * With more than one policy ticked, a refusal says which policy
             * it is about: the server's own words ("already covered ... on
             * this policy") name none.
             */
            throw pickedPolicies.length > 1
              ? new Error(
                  `${policy.policyName}: ${getFriendlyErrorMessage(err)}`,
                )
              : err;
          }
          savedPolicyIds.current.add(policy.policyId);
        }
      } else {
        await overrides.createOverride(result.input);
      }

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

  const prefilledShiftCard: React.JSX.Element | null = prefilledWindow ? (
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
  ) : null;

  /*
   * Asking the server which policies they may cover: the shift being
   * covered, if there is one, and a line saying so - nothing to choose yet.
   */
  if (isCheckingPolicies) {
    return (
      <ScrollView
        testID="create-override-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          ...gutters,
          paddingBottom: bottomPadding,
        }}
      >
        <ScreenIntro
          title={prefilledWindow ? "Cover this shift" : "Arrange coverage"}
        />
        {prefilledShiftCard}
        <Banner
          testID="override-checking-policies"
          tone="info"
          message="Checking which on-call policies you can arrange cover on…"
          style={prefilledShiftCard ? { marginTop: spacing.xxl } : undefined}
        />
      </ScrollView>
    );
  }

  /*
   * Locked: the shift being covered, if there is one, and why it cannot be
   * covered from here - nothing to choose, and nothing to confirm.
   */
  if (lockReason) {
    return (
      <ScrollView
        testID="create-override-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          ...gutters,
          paddingBottom: bottomPadding,
        }}
      >
        <ScreenIntro
          title={prefilledWindow ? "Cover this shift" : "Arrange coverage"}
        />
        {prefilledShiftCard}
        <Banner
          testID="override-locked"
          tone="warning"
          title="Cover can't be arranged here"
          message={lockReason}
          style={prefilledShiftCard ? { marginTop: spacing.xxl } : undefined}
        />
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView
        testID="create-override-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{
          padding: spacing.xl,
          ...gutters,
          paddingBottom: bottomPadding,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenIntro
          title={prefilledWindow ? "Cover this shift" : "Arrange coverage"}
          description="A clear handoff, for exactly as long as you need."
        />

        {prefilledShiftCard ?? (
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

        {isOnSomePolicies && offeredPolicies.length > 0 ? (
          <View testID="cover-policies" style={{ marginTop: spacing.xxl }}>
            <SectionHeader
              title={
                offeredPolicies.length === 1
                  ? "On-call policy"
                  : "On-call policies"
              }
            />
            {offeredPolicies.length === 1 ? (
              <Card testID="cover-policy-only" padding={spacing.md + 2}>
                <AppText variant="headline">
                  {offeredPolicies[0]!.policyName}
                </AppText>
              </Card>
            ) : (
              offeredPolicies.map((policy: CoverPolicy) => {
                const isTicked: boolean = !untickedPolicyIds.includes(
                  policy.policyId,
                );

                return (
                  <Pressable
                    key={policy.policyId}
                    testID={`cover-policy-${policy.policyId}`}
                    accessibilityRole="checkbox"
                    accessibilityLabel={policy.policyName}
                    accessibilityState={{ checked: isTicked }}
                    aria-checked={isTicked}
                    onPress={(): void => {
                      selectionFeedback();
                      setError(null);
                      setUntickedPolicyIds((unticked: string[]): string[] => {
                        return isTicked
                          ? [...unticked, policy.policyId]
                          : unticked.filter((id: string): boolean => {
                              return id !== policy.policyId;
                            });
                      });
                    }}
                    style={({ pressed }: { pressed: boolean }): ViewStyle => {
                      return {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.md,
                        minHeight: touchTarget,
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.sm,
                        marginBottom: spacing.sm,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: theme.colors.borderSubtle,
                        backgroundColor: pressed
                          ? theme.colors.backgroundTertiary
                          : theme.colors.backgroundElevated,
                      };
                    }}
                  >
                    <Ionicons
                      name={isTicked ? "checkbox" : "square-outline"}
                      size={22}
                      color={
                        isTicked
                          ? theme.colors.actionPrimary
                          : theme.colors.textTertiary
                      }
                    />
                    <AppText variant="subhead" weight="600" style={{ flex: 1 }}>
                      {policy.policyName}
                    </AppText>
                  </Pressable>
                );
              })
            )}
            <AppText
              variant="footnote"
              tone="secondary"
              style={{ marginTop: spacing.sm, marginHorizontal: spacing.xs }}
            >
              {offeredPolicies.length === 1
                ? "Your permission to add user overrides covers only this policy, so the cover applies to it alone."
                : "Your permission to add user overrides covers only these policies. The cover applies to each one ticked."}
            </AppText>
          </View>
        ) : null}

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
          {isOnSomePolicies && pickedPolicies.length > 0 ? (
            <AppText
              testID="override-preview-policies"
              variant="subhead"
              tone="secondary"
              style={{ marginTop: spacing.xs }}
            >
              {describePolicyScope(
                pickedPolicies.map((policy: CoverPolicy): string => {
                  return policy.policyName;
                }),
              )}
            </AppText>
          ) : null}
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
