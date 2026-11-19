import React, { useMemo, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Alert,
  type ViewStyle,
} from "react-native";
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
import { useContentGutters } from "../layout/WindowLayoutProvider";
import type { ContentGutters } from "../layout/windowLayout";
import { useNow } from "../hooks/useNow";
import { useHaptics } from "../hooks/useHaptics";
import { useProjectUsers } from "../hooks/useProjectUsers";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import {
  findOverlapConflict,
  toSavedTimes,
  useOnCallOverrides,
} from "../hooks/useOnCallOverrides";
import ScreenIntro from "../components/ScreenIntro";
import SectionHeader from "../components/SectionHeader";
import SegmentedControl from "../components/SegmentedControl";
import UserPickerModal from "../components/UserPickerModal";
import GradientButton from "../components/GradientButton";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import {
  displayNameForUser,
  getInitials,
} from "../components/RosterScheduleCard";
import { formatShiftTime } from "../utils/duration";
import { getFriendlyErrorMessage } from "../utils/error";
import { DURATION_PRESETS } from "../oncall/overrideDraft";
import { describeEndNow, type EndNowQuestion } from "../oncall/overrideEndNow";
import {
  OVERRIDE_ENDED_REFUSAL,
  getEditRefusal,
  getEndNow,
  getStartOfMinute,
  hasStarted,
  isOverlapRefusal,
  type OverrideSavedTimes,
} from "../oncall/overrideEdit";
import type { OnCallOverrideChange } from "../api/onCallOverrides";
import type { OnCallStackParamList } from "../navigation/types";
import type { OnCallOverrideItem, ProjectUserItem } from "../api/types";

type EditOverrideNavProp = NativeStackNavigationProp<
  OnCallStackParamList,
  "EditOnCallOverride"
>;

type EditOverrideRouteProp = RouteProp<
  OnCallStackParamList,
  "EditOnCallOverride"
>;

// Who covers: a teammate, or the next person in the rotation (a skip).
export type CoverChoice = "person" | "rotation";

// When it starts: as saved, or now.
export type StartChoice = "saved" | "now";

// When it ends: as saved, or so many hours after its start - or from now, once it is under way.
export type EndChoice = "saved" | number;

export const ROTATION_COVERS_TEXT: string = "Next person in the rotation";

// The dashboard's words for the rows its Edit shows but does not change.
export const AWAY_LOCKED_TEXT: string =
  "Who is away can't be changed. For somebody else, add a new override.";

export const START_LOCKED_TEXT: string =
  "It has already started, so when it starts can't be changed.";

export const SAME_PERSON_REFUSAL: string =
  "Choose someone other than the person who is away.";

export const NO_TEAMMATE_REFUSAL: string =
  "Choose a teammate, or let the next person in the rotation cover.";

/*
 * What the sheet would send, from what is chosen on it, at `now`: only
 * what changes - who covers (null: the rotation), the start, the end. A
 * start of now is this minute, as a picker's now is; an end of so many
 * hours counts from the start, or from now once the override is under way.
 */
export function buildOverrideChange(data: {
  saved: OverrideSavedTimes;
  savedCoverId: string | null;
  coverChoice: CoverChoice;
  coverUserId: string | null;
  startChoice: StartChoice;
  endChoice: EndChoice;
  now: number;
}): OnCallOverrideChange {
  const change: OnCallOverrideChange = {};

  const coverId: string | null =
    data.coverChoice === "rotation" ? null : data.coverUserId;

  if ((coverId || null) !== (data.savedCoverId || null)) {
    change.routeAlertsToUserId = coverId;
  }

  const startsAt: Date =
    data.startChoice === "now"
      ? getStartOfMinute(new Date(data.now))
      : data.saved.startsAt;

  if (data.startChoice === "now") {
    change.startsAt = startsAt;
  }

  if (data.endChoice !== "saved") {
    const from: number = hasStarted(data.saved, new Date(data.now))
      ? data.now
      : startsAt.getTime();

    change.endsAt = new Date(from + data.endChoice * 60 * 60 * 1000);
  }

  return change;
}

export function hasAnyChange(change: OnCallOverrideChange): boolean {
  return (
    change.routeAlertsToUserId !== undefined ||
    Boolean(change.startsAt) ||
    Boolean(change.endsAt)
  );
}

/*
 * EDIT ONE OVERRIDE, FROM THE PHONE (#7897).
 *
 * On-call people are on their phones: someone told "edit that override",
 * someone back early, someone handing their cover to a teammate. This is
 * the cover sheet, filled in with the override, held to the rules the
 * dashboard's Edit is held to (oncall/overrideEdit, the server's
 * UserOverrideEdit):
 *
 *   - Who is away is shown, never changed: time away for somebody else is
 *     another override.
 *   - Who covers changes until it ends: a teammate, or the next person in
 *     the rotation.
 *   - When it starts can move until it starts - to now - and is shown,
 *     locked, once it has.
 *   - When it ends can move until it ends: so many hours after its start,
 *     or from now once it is under way; End now ends it at once.
 *
 * As on the cover sheet, no calendar: a planning task belongs on the web.
 * A refusal is the server's whole sentence; one for an overlap offers that
 * override's edit, in this sheet's place.
 */
export default function EditOnCallOverrideScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const now: number = useNow();
  const { successFeedback, errorFeedback, selectionFeedback } = useHaptics();
  const navigation: EditOverrideNavProp = useNavigation<EditOverrideNavProp>();
  const route: EditOverrideRouteProp = useRoute<EditOverrideRouteProp>();
  const override: OnCallOverrideItem = route.params.override;
  const currentUserId: string | null = useCurrentUserId();
  const overrides: ReturnType<typeof useOnCallOverrides> =
    useOnCallOverrides(now);
  const projectUsers: ReturnType<typeof useProjectUsers> = useProjectUsers(
    override.projectId,
  );

  const saved: OverrideSavedTimes | null = useMemo(() => {
    return toSavedTimes(override);
  }, [override]);

  const awayUserId: string | null = override.overrideUser?._id || null;
  const savedCoverId: string | null = override.routeAlertsToUser?._id || null;

  const [coverChoice, setCoverChoice] = useState<CoverChoice>(
    savedCoverId ? "person" : "rotation",
  );
  const [cover, setCover] = useState<{ userId: string; name: string } | null>(
    savedCoverId
      ? {
          userId: savedCoverId,
          name: displayNameForUser(override.routeAlertsToUser),
        }
      : null,
  );
  const [startChoice, setStartChoice] = useState<StartChoice>("saved");
  const [endChoice, setEndChoice] = useState<EndChoice>("saved");
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<OnCallOverrideItem | null>(null);

  const isStarted: boolean = Boolean(saved && hasStarted(saved, new Date(now)));
  const isEnded: boolean = Boolean(
    saved && saved.endsAt.getTime() <= new Date(now).getTime(),
  );
  const awayIsMe: boolean = Boolean(
    currentUserId && awayUserId === currentUserId,
  );
  const awayName: string = awayIsMe
    ? "You"
    : displayNameForUser(override.overrideUser);

  const change: OnCallOverrideChange | null = saved
    ? buildOverrideChange({
        saved,
        savedCoverId,
        coverChoice,
        coverUserId: cover?.userId ?? null,
        startChoice,
        endChoice,
        now,
      })
    : null;

  const previewStartsAt: Date | null =
    change?.startsAt || saved?.startsAt || null;
  const previewEndsAt: Date | null = change?.endsAt || saved?.endsAt || null;

  const clearProblems: () => void = (): void => {
    setError(null);
    setConflict(null);
  };

  const onSave: () => Promise<void> = async (): Promise<void> => {
    clearProblems();

    if (!saved) {
      return;
    }

    if (coverChoice === "person" && !cover) {
      setError(NO_TEAMMATE_REFUSAL);
      errorFeedback();
      return;
    }

    if (cover && awayUserId && cover.userId === awayUserId) {
      setError(SAME_PERSON_REFUSAL);
      errorFeedback();
      return;
    }

    // Worked out again now: the sheet may have been open a while.
    const sentAt: number = Date.now();
    const sent: OnCallOverrideChange = buildOverrideChange({
      saved,
      savedCoverId,
      coverChoice,
      coverUserId: cover?.userId ?? null,
      startChoice,
      endChoice,
      now: sentAt,
    });

    const refusal: string | null = getEditRefusal({
      saved,
      change: { startsAt: sent.startsAt, endsAt: sent.endsAt },
      now: new Date(sentAt),
    });

    if (refusal) {
      setError(refusal);
      errorFeedback();
      return;
    }

    try {
      await overrides.updateOverride(override, sent);
      successFeedback();
      navigation.goBack();
    } catch (err: unknown) {
      const message: string = getFriendlyErrorMessage(err);
      setError(message);
      errorFeedback();

      if (isOverlapRefusal(message) && awayUserId) {
        setConflict(
          await findOverlapConflict({
            project: {
              projectId: override.projectId,
              projectName: override.projectName,
            },
            candidate: {
              id: override._id,
              overrideUserId: awayUserId,
              routeAlertsToUserId:
                sent.routeAlertsToUserId !== undefined
                  ? sent.routeAlertsToUserId
                  : savedCoverId,
              onCallDutyPolicyId:
                override.onCallDutyPolicyId ||
                override.onCallDutyPolicy?._id ||
                null,
              startsAt: sent.startsAt || saved.startsAt,
              endsAt: sent.endsAt || saved.endsAt,
            },
          }),
        );
      }
    }
  };

  const onEndNow: () => void = (): void => {
    clearProblems();

    const question: EndNowQuestion = describeEndNow(
      override,
      currentUserId,
      Date.now(),
    );

    Alert.alert(question.title, question.message, [
      { text: "Keep it", style: "cancel" },
      {
        text: "End now",
        style: "destructive",
        onPress: () => {
          overrides
            .endOverrideNow(override)
            .then(() => {
              successFeedback();
              navigation.goBack();
            })
            .catch((err: unknown) => {
              setError(getFriendlyErrorMessage(err));
              errorFeedback();
            });
        },
      },
    ]);
  };

  const containerStyle: ViewStyle = {
    padding: spacing.xl,
    ...gutters,
    paddingBottom: bottomPadding,
  };

  // Not editable: it has ended, or its times could not be read.
  if (!saved || isEnded) {
    return (
      <ScrollView
        testID="edit-override-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={containerStyle}
      >
        <ScreenIntro title="Edit coverage" />
        <Banner
          testID="edit-override-locked"
          tone="warning"
          message={
            saved
              ? OVERRIDE_ENDED_REFUSAL
              : "This override's times could not be read. Pull to refresh the overrides and open it again."
          }
        />
      </ScrollView>
    );
  }

  const canEndNow: boolean = Boolean(getEndNow(saved, new Date(now)));
  const isBusy: boolean = overrides.isUpdating || overrides.isEnding;

  const chip: (data: {
    testID: string;
    label: string;
    isSelected: boolean;
    onPress: () => void;
    accessibilityLabel?: string;
  }) => React.JSX.Element = (data: {
    testID: string;
    label: string;
    isSelected: boolean;
    onPress: () => void;
    accessibilityLabel?: string;
  }): React.JSX.Element => {
    return (
      <Pressable
        key={data.testID}
        testID={data.testID}
        accessibilityRole="button"
        accessibilityLabel={data.accessibilityLabel || data.label}
        {...getToggleAccessibilityProps(data.isSelected)}
        onPress={() => {
          selectionFeedback();
          clearProblems();
          data.onPress();
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
            borderColor: data.isSelected
              ? theme.colors.actionPrimary
              : theme.colors.borderDefault,
            backgroundColor: data.isSelected
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
          align="center"
          color={
            data.isSelected
              ? theme.colors.textInverse
              : theme.colors.textPrimary
          }
        >
          {data.label}
        </AppText>
      </Pressable>
    );
  };

  const savedStartText: string = formatShiftTime(override.startsAt, now) || "";
  const savedEndText: string = formatShiftTime(override.endsAt, now) || "";

  return (
    <>
      <ScrollView
        testID="edit-override-scroll"
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: theme.colors.backgroundPrimary }}
        contentContainerStyle={containerStyle}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenIntro
          title="Edit coverage"
          description="Change who covers, or when it ends."
        />

        <Card testID="edit-override-away" variant="tinted">
          <AppText variant="footnote" tone="secondary">
            Who is away
          </AppText>
          <AppText variant="title3" style={{ marginTop: spacing.xxs }}>
            {awayName}
          </AppText>
          <AppText
            testID="edit-override-scope"
            variant="subhead"
            tone="secondary"
            style={{ marginTop: spacing.xxs }}
          >
            {override.onCallDutyPolicy?.name || "All on-call policies"}
          </AppText>
          <AppText
            variant="footnote"
            tone="secondary"
            style={{ marginTop: spacing.sm }}
          >
            {AWAY_LOCKED_TEXT}
          </AppText>
        </Card>

        <View style={{ marginTop: spacing.xxl }}>
          <SectionHeader title="Who covers?" />
          <SegmentedControl<CoverChoice>
            style={{ marginHorizontal: 0, marginTop: 0, marginBottom: 0 }}
            segments={[
              { key: "person", label: "A teammate" },
              { key: "rotation", label: "The rotation" },
            ]}
            selected={coverChoice}
            onSelect={(key: CoverChoice) => {
              selectionFeedback();
              clearProblems();
              setCoverChoice(key);
            }}
          />
          {coverChoice === "person" ? (
            <Card
              testID="edit-override-cover"
              accessibilityLabel={
                cover
                  ? `Covered by ${cover.name}. Tap to change.`
                  : "Choose a teammate"
              }
              onPress={() => {
                if (!projectUsers.isError) {
                  setIsPickerOpen(true);
                }
              }}
              padding={spacing.md + 2}
              style={{ marginTop: spacing.md }}
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
                    backgroundColor: cover
                      ? theme.colors.actionPrimary
                      : theme.colors.cardAccent,
                  }}
                >
                  {cover ? (
                    <AppText
                      variant="subhead"
                      weight="700"
                      color={theme.colors.textInverse}
                    >
                      {getInitials(cover.name)}
                    </AppText>
                  ) : (
                    <Ionicons
                      name="person-add-outline"
                      size={19}
                      color={theme.colors.actionPrimary}
                    />
                  )}
                </View>
                <AppText
                  variant="headline"
                  style={{ flex: 1 }}
                  color={
                    cover
                      ? theme.colors.textPrimary
                      : theme.colors.actionPrimary
                  }
                >
                  {cover ? cover.name : "Choose a teammate"}
                </AppText>
                {cover ? (
                  <AppText variant="subhead" weight="600" tone="accent">
                    Change
                  </AppText>
                ) : null}
              </View>
            </Card>
          ) : (
            <AppText
              testID="edit-override-rotation-covers"
              variant="footnote"
              tone="secondary"
              style={{ marginTop: spacing.sm, marginHorizontal: spacing.xs }}
            >
              {`${ROTATION_COVERS_TEXT}: each of their turns goes to the next person in the rotation who is not away.`}
            </AppText>
          )}
        </View>

        <View style={{ marginTop: spacing.xxl }}>
          <SectionHeader title="Starts" />
          {isStarted ? (
            <View testID="edit-override-start-locked">
              <AppText variant="headline">{savedStartText}</AppText>
              <AppText
                variant="footnote"
                tone="secondary"
                style={{ marginTop: spacing.xs }}
              >
                {START_LOCKED_TEXT}
              </AppText>
            </View>
          ) : (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: spacing.sm,
              }}
            >
              {chip({
                testID: "edit-override-start-saved",
                label: savedStartText,
                accessibilityLabel: `Starts as set, ${savedStartText}`,
                isSelected: startChoice === "saved",
                onPress: () => {
                  setStartChoice("saved");
                },
              })}
              {chip({
                testID: "edit-override-start-now",
                label: "Start now",
                isSelected: startChoice === "now",
                onPress: () => {
                  setStartChoice("now");
                },
              })}
            </View>
          )}
        </View>

        <View style={{ marginTop: spacing.xxl }}>
          <SectionHeader title="Ends" />
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}
          >
            {chip({
              testID: "edit-override-end-saved",
              label: savedEndText,
              accessibilityLabel: `Ends as set, ${savedEndText}`,
              isSelected: endChoice === "saved",
              onPress: () => {
                setEndChoice("saved");
              },
            })}
            {DURATION_PRESETS.map(
              (preset: { label: string; hours: number }): React.JSX.Element => {
                return chip({
                  testID: `edit-override-end-${preset.hours}`,
                  label: isStarted ? `In ${preset.label}` : preset.label,
                  accessibilityLabel: isStarted
                    ? `Ends in ${preset.label}`
                    : `Lasts ${preset.label}`,
                  isSelected: endChoice === preset.hours,
                  onPress: () => {
                    setEndChoice(preset.hours);
                  },
                });
              },
            )}
          </View>
          <AppText
            variant="footnote"
            tone="secondary"
            style={{ marginTop: spacing.md, marginHorizontal: spacing.xs }}
          >
            {isStarted
              ? "From now. Then their usual routing resumes."
              : "From when it starts. Then their usual routing resumes."}
          </AppText>
          {canEndNow ? (
            <Pressable
              testID="edit-override-end-now"
              accessibilityRole="button"
              accessibilityLabel="End this override now"
              disabled={isBusy}
              onPress={onEndNow}
              style={({ pressed }: { pressed: boolean }): ViewStyle => {
                return {
                  marginTop: spacing.md,
                  minHeight: touchTarget,
                  alignSelf: "flex-start",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs + 2,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: pressed
                    ? theme.colors.statusErrorBg
                    : "transparent",
                };
              }}
            >
              <Ionicons
                name="stop-circle-outline"
                size={18}
                color={theme.colors.actionDestructive}
              />
              <AppText
                variant="subhead"
                weight="600"
                color={theme.colors.actionDestructive}
              >
                End now
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <Card
          testID="edit-override-preview"
          variant="tinted"
          style={{ marginTop: spacing.xxl }}
        >
          <AppText variant="footnote" weight="600" tone="accent">
            Review your changes
          </AppText>
          <AppText variant="title3" style={{ marginTop: spacing.sm }}>
            {coverChoice === "rotation"
              ? `${awayIsMe ? "Your" : `${displayNameForUser(override.overrideUser)}'s`} turns go to the next person in the rotation.`
              : `${awayIsMe ? "Your" : `${displayNameForUser(override.overrideUser)}'s`} pages go to ${cover ? cover.name : "a teammate"}.`}
          </AppText>
          {previewStartsAt && previewEndsAt ? (
            <AppText
              testID="edit-override-preview-times"
              variant="subhead"
              tone="secondary"
              style={{ marginTop: spacing.sm }}
            >
              {`${isStarted ? "Started" : "Starts"} ${formatShiftTime(previewStartsAt.toISOString(), now) || ""}, ends ${formatShiftTime(previewEndsAt.toISOString(), now) || ""}.`}
            </AppText>
          ) : null}
        </Card>

        {error ? (
          <Banner
            testID="edit-override-error"
            tone="danger"
            message={error}
            actionLabel={conflict ? "Edit that override" : undefined}
            onAction={
              conflict
                ? () => {
                    navigation.replace("EditOnCallOverride", {
                      override: conflict,
                    });
                  }
                : undefined
            }
            style={{ marginTop: spacing.lg }}
          />
        ) : null}

        <GradientButton
          testID="save-override"
          label="Save changes"
          icon="checkmark-circle-outline"
          loading={overrides.isUpdating}
          disabled={!change || !hasAnyChange(change) || overrides.isEnding}
          onPress={onSave}
          style={{ marginTop: spacing.xl }}
        />
      </ScrollView>
      <UserPickerModal
        visible={isPickerOpen && !projectUsers.isError}
        title="Who covers?"
        users={projectUsers.users}
        isLoading={projectUsers.isLoading}
        selectedUserId={cover?.userId ?? null}
        excludeUserId={awayUserId}
        onSelect={(user: ProjectUserItem) => {
          setCover({ userId: user.userId, name: user.name || user.email });
          setIsPickerOpen(false);
          clearProblems();
        }}
        onClose={() => {
          setIsPickerOpen(false);
        }}
      />
    </>
  );
}
