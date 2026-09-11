import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import getToggleAccessibilityProps from "../utils/getToggleAccessibilityProps";
import { useScreenPadding } from "../hooks/useScreenPadding";
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
 * Unparseable params read as "no prefill" rather than as a broken window: the
 * sheet is still usable, the user just picks a duration.
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

  /*
   * Changing project invalidates the person: the picker lists that project's
   * members, and an override naming somebody who is not in the project would
   * be rejected server-side after the user had already stopped reading.
   */
  useEffect((): void => {
    setCounterpart(null);
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
      new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString(),
    );
  }, [durationHours, prefilledWindow]);

  const startsNow: boolean =
    !prefilledWindow || prefilledWindow.startsAt.getTime() <= Date.now();

  const onSubmit: () => Promise<void> = async (): Promise<void> => {
    setError(null);

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

  return (
    <>
      <ScrollView
        testID="create-override-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenIntro
          title={prefilledWindow ? "Cover this shift" : "Arrange coverage"}
          description="A clear handoff, for exactly as long as you need."
        />
        <View
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderRadius: 22,
            padding: 18,
          }}
        >
          {prefilledWindow ? (
            <View
              testID="prefilled-shift"
              style={{
                paddingBottom: 22,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.borderSubtle,
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 21,
                  color: theme.colors.textSecondary,
                }}
              >
                Cover for my shift
              </Text>
              <Text
                style={{
                  fontSize: 20,
                  lineHeight: 28,
                  fontWeight: "600",
                  marginTop: 6,
                  color: theme.colors.textPrimary,
                }}
              >
                {prefill?.scheduleName ?? "On-call shift"}
              </Text>
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 22,
                  marginTop: 6,
                  color: theme.colors.textSecondary,
                }}
              >
                {formatShiftWindow(
                  prefilledWindow.startsAt.toISOString(),
                  prefilledWindow.endsAt.toISOString(),
                ) ?? ""}
              </Text>
            </View>
          ) : (
            <View>
              <SectionHeader title="Coverage type" />
              <SegmentedControl<OverrideDirection>
                style={{ marginHorizontal: 0, marginTop: 0 }}
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
          <View style={{ marginTop: 26 }}>
            <SectionHeader
              title={
                prefilledWindow
                  ? "Who will cover this shift?"
                  : direction === "cover-me"
                    ? "Who will cover for you?"
                    : "Who are you covering for?"
              }
            />
            <Pressable
              testID="open-user-picker"
              accessibilityRole="button"
              accessibilityLabel={
                counterpart
                  ? `Selected ${counterpartName}. Tap to change.`
                  : "Choose a teammate"
              }
              onPress={() => {
                setIsPickerOpen(true);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 14,
                gap: 12,
                minHeight: 64,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.borderDefault,
              }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.colors.iconBackground,
                }}
              >
                <Ionicons
                  name="person-outline"
                  size={19}
                  color={theme.colors.actionPrimary}
                />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text
                  style={{
                    fontSize: 16,
                    lineHeight: 23,
                    fontWeight: "600",
                    color: counterpart
                      ? theme.colors.textPrimary
                      : theme.colors.actionPrimary,
                  }}
                >
                  {counterpart ? counterpartName : "Choose a teammate"}
                </Text>
                <Text
                  testID="coverage-project-name"
                  style={{
                    fontSize: 13,
                    lineHeight: 20,
                    color: theme.colors.textSecondary,
                  }}
                >
                  {projectList[0]?.name ?? "No project available"}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={17}
                color={theme.colors.textTertiary}
              />
            </Pressable>
          </View>
          {!prefilledWindow ? (
            <View style={{ marginTop: 26 }}>
              <SectionHeader title="How long?" />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
                        style={{
                          flexGrow: 1,
                          flexBasis: "28%",
                          paddingVertical: 12,
                          paddingHorizontal: 8,
                          minHeight: 48,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 12,
                          backgroundColor: isSelected
                            ? theme.colors.textPrimary
                            : theme.colors.backgroundPrimary,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 14,
                            lineHeight: 21,
                            fontWeight: "600",
                            color: isSelected
                              ? theme.colors.textInverse
                              : theme.colors.textSecondary,
                          }}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    );
                  },
                )}
              </View>
              <Text
                style={{
                  fontSize: 14,
                  lineHeight: 22,
                  color: theme.colors.textSecondary,
                  marginTop: 14,
                }}
              >
                Starts when you confirm. Your usual routing resumes
                automatically when coverage ends.
              </Text>
            </View>
          ) : null}
        </View>
        <View
          testID="override-preview"
          style={{
            marginTop: 28,
            paddingBottom: 24,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.borderSubtle,
          }}
        >
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              fontWeight: "600",
              color: theme.colors.textSecondary,
            }}
          >
            Review your coverage
          </Text>
          <Text
            style={{
              fontSize: 18,
              lineHeight: 27,
              fontWeight: "600",
              marginTop: 8,
              color: theme.colors.textPrimary,
            }}
          >
            {previewSentence}
          </Text>
          {endsAtLabel ? (
            <Text
              style={{
                fontSize: 14,
                lineHeight: 22,
                marginTop: 8,
                color: theme.colors.textSecondary,
              }}
            >
              {startsNow
                ? `Starts now, ends ${endsAtLabel}.`
                : `Starts ${formatShiftTime(prefilledWindow?.startsAt.toISOString() ?? null) ?? "with the shift"}, ends ${endsAtLabel}.`}
            </Text>
          ) : null}
        </View>
        {error ? (
          <View
            testID="override-error"
            accessibilityRole="alert"
            style={{
              marginTop: 18,
              padding: 16,
              borderRadius: 14,
              backgroundColor: theme.colors.statusErrorBg,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                lineHeight: 22,
                color: theme.colors.statusError,
              }}
            >
              {error}
            </Text>
          </View>
        ) : null}
        <GradientButton
          testID="submit-override"
          label="Confirm coverage"
          loading={overrides.isCreating}
          onPress={onSubmit}
          style={{ marginTop: 24 }}
        />
      </ScrollView>
      <UserPickerModal
        visible={isPickerOpen}
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
