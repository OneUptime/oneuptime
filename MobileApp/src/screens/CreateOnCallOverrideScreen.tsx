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
import { useHaptics } from "../hooks/useHaptics";
import { useProject } from "../hooks/useProject";
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
import type { ProjectItem, ProjectUserItem } from "../api/types";

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
  const { successFeedback, errorFeedback, selectionFeedback } = useHaptics();
  const navigation: CreateOverrideNavProp =
    useNavigation<CreateOverrideNavProp>();
  const route: CreateOverrideRouteProp = useRoute<CreateOverrideRouteProp>();
  const prefill: CreateOnCallOverrideParams | undefined = route.params;
  const prefilledWindow: OverrideWindow | null =
    useMemo((): OverrideWindow | null => {
      return readPrefilledWindow(prefill);
    }, [prefill]);

  const { projectList } = useProject();
  const currentUserId: string | null = useCurrentUserId();
  const overrides: ReturnType<typeof useOnCallOverrides> = useOnCallOverrides();

  /*
   * A prefilled shift is always MINE (the list only shows the signed-in
   * user's shifts), so the only direction that makes sense is handing it to
   * somebody else; the segmented control is not offered in that case.
   */
  const [direction, setDirection] = useState<OverrideDirection>("cover-me");
  const [projectId, setProjectId] = useState<string | null>(
    prefill?.projectId || null,
  );
  const [counterpart, setCounterpart] = useState<ProjectUserItem | null>(null);
  const [durationHours, setDurationHours] = useState<number>(4);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect((): void => {
    if (!projectId && projectList.length > 0) {
      setProjectId(projectList[0]!._id);
    }
  }, [projectId, projectList]);

  /*
   * A prefill normally settles the project, which is why the picker below is
   * hidden for one. "Normally" is doing work there: a prefill can arrive
   * naming a project this user is not in, or none at all, and the effect
   * above then silently substitutes the first project in the list. Showing
   * the picker in that case turns a silent substitution into a visible
   * choice.
   */
  const isPrefilledProjectKnown: boolean = projectList.some(
    (project: ProjectItem) => {
      return project._id === prefill?.projectId;
    },
  );

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
        contentContainerStyle={{ padding: 20, paddingBottom: 56 }}
        keyboardShouldPersistTaps="handled"
      >
        {prefilledWindow ? (
          <View
            testID="prefilled-shift"
            style={{
              padding: 16,
              borderRadius: 18,
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.oncallActive + "55",
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: theme.colors.textTertiary,
              }}
            >
              Cover for my shift
            </Text>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "600",
                marginTop: 6,
                color: theme.colors.textPrimary,
              }}
              numberOfLines={1}
            >
              {prefill?.scheduleName ?? "On-call shift"}
            </Text>
            <Text
              style={{
                fontSize: 13,
                marginTop: 4,
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
          <SegmentedControl<OverrideDirection>
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
        )}

        {projectList.length > 1 && (!prefill || !isPrefilledProjectKnown) ? (
          <View style={{ marginTop: 24 }}>
            <SectionHeader title="Project" iconName="folder-open-outline" />
            <View style={{ gap: 8 }}>
              {projectList.map((project: ProjectItem) => {
                const isSelected: boolean = project._id === projectId;

                return (
                  <Pressable
                    key={project._id}
                    testID={`project-option-${project._id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Select project ${project.name}`}
                    onPress={() => {
                      selectionFeedback();
                      setProjectId(project._id);
                      setError(null);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      borderRadius: 14,
                      backgroundColor: theme.colors.backgroundElevated,
                      borderWidth: 1,
                      borderColor: isSelected
                        ? theme.colors.oncallActive + "55"
                        : theme.colors.borderGlass,
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 14,
                        fontWeight: "600",
                        color: theme.colors.textPrimary,
                      }}
                      numberOfLines={1}
                    >
                      {project.name}
                    </Text>
                    {isSelected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={theme.colors.oncallActive}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: 24 }}>
          <SectionHeader
            title={
              direction === "cover-me" ? "Route pages to" : "Take over from"
            }
            iconName="person-outline"
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
              paddingVertical: 16,
              paddingHorizontal: 16,
              borderRadius: 14,
              backgroundColor: theme.colors.backgroundElevated,
              borderWidth: 1,
              borderColor: theme.colors.borderGlass,
            }}
          >
            <Ionicons
              name="person-circle-outline"
              size={20}
              color={theme.colors.textSecondary}
            />
            <Text
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: counterpart ? "600" : "400",
                marginLeft: 10,
                color: counterpart
                  ? theme.colors.textPrimary
                  : theme.colors.textTertiary,
              }}
              numberOfLines={1}
            >
              {counterpart ? counterpartName : "Choose a teammate"}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={theme.colors.textTertiary}
            />
          </Pressable>
        </View>

        {prefilledWindow ? null : (
          <View style={{ marginTop: 24 }}>
            <SectionHeader title="For how long" iconName="time-outline" />
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
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
                      onPress={() => {
                        selectionFeedback();
                        setDurationHours(preset.hours);
                        setError(null);
                      }}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 16,
                        borderRadius: 9999,
                        backgroundColor: isSelected
                          ? theme.colors.oncallActiveBg
                          : theme.colors.backgroundElevated,
                        borderWidth: 1,
                        borderColor: isSelected
                          ? theme.colors.oncallActive + "55"
                          : theme.colors.borderGlass,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: "600",
                          color: isSelected
                            ? theme.colors.oncallActive
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
          </View>
        )}

        <View
          testID="override-preview"
          style={{
            marginTop: 24,
            padding: 16,
            borderRadius: 18,
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: theme.colors.textTertiary,
            }}
          >
            Summary
          </Text>
          <Text
            style={{
              fontSize: 14,
              lineHeight: 20,
              marginTop: 6,
              color: theme.colors.textPrimary,
            }}
          >
            {previewSentence}
          </Text>
          {endsAtLabel ? (
            <Text
              style={{
                fontSize: 12,
                marginTop: 6,
                color: theme.colors.textSecondary,
              }}
            >
              {startsNow
                ? `Starts now, ends ${endsAtLabel}.`
                : `Starts ${
                    formatShiftTime(
                      prefilledWindow?.startsAt.toISOString() ?? null,
                    ) ?? "with the shift"
                  }, ends ${endsAtLabel}.`}
            </Text>
          ) : null}
        </View>

        {error ? (
          <View
            testID="override-error"
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 14,
              backgroundColor: theme.colors.statusErrorBg,
              borderWidth: 1,
              borderColor: theme.colors.statusError + "33",
            }}
          >
            <Text
              style={{
                fontSize: 13,
                lineHeight: 19,
                color: theme.colors.statusError,
              }}
            >
              {error}
            </Text>
          </View>
        ) : null}

        <GradientButton
          testID="submit-override"
          label="Create override"
          icon="swap-horizontal-outline"
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
