import React from "react";
import {
  View,
  ScrollView,
  Pressable,
  Platform,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { radius, spacing, touchTarget } from "../../theme/tokens";
import { useScreenPadding } from "../../hooks/useScreenPadding";
import { useContentGutters } from "../../layout/WindowLayout";
import type { ContentGutters } from "../../layout/windowLayout";
import { useHaptics } from "../../hooks/useHaptics";
import {
  useCriticalAlertSound,
  type CriticalAlertSoundState,
} from "../../hooks/useCriticalAlertSound";
import {
  CRITICAL_ALERT_VOLUME_OPTIONS,
  type CriticalAlertSoundIdValue,
  type CriticalAlertSoundOption,
} from "../../notifications/criticalAlertSounds";
import AppText from "../../components/AppText";
import Banner from "../../components/Banner";
import IconBadge from "../../components/IconBadge";
import { ListGroup } from "../../components/ListGroup";
import ScreenIntro from "../../components/ScreenIntro";
import { withAlpha } from "../../utils/color";

type IconName = keyof typeof Ionicons.glyphMap;

// A picture for each sound, so the list reads at a glance.
const SOUND_ICONS: Record<CriticalAlertSoundIdValue, IconName> = {
  default: "phone-portrait-outline",
  klaxon: "megaphone-outline",
  siren: "warning-outline",
  digital: "alarm-outline",
  smoke_alarm: "flame-outline",
  rising: "trending-up-outline",
};

function volumeIcon(volume: number): IconName {
  if (volume <= 25) {
    return "volume-low-outline";
  }

  if (volume <= 50) {
    return "volume-medium-outline";
  }

  return "volume-high-outline";
}

function previewFootnote(): string {
  return Platform.OS === "ios"
    ? "Previews play at your ringer volume, and not at all while your iPhone is on silent. A real critical page rings through silent mode at the volume below."
    : "Previews play exactly as a page does: on the alarm channel, at your phone's alarm volume.";
}

/*
 * One sound: choosing it is the row, hearing it is the round button beside
 * it. Two buttons side by side rather than one inside the other, so a screen
 * reader reaches both.
 */
function SoundRow({
  option,
  isSelected,
  isPreviewing,
  isDisabled,
  onSelect,
  onPreview,
}: {
  option: CriticalAlertSoundOption;
  isSelected: boolean;
  isPreviewing: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  onPreview: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      testID={`critical-alert-sound-${option.id}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: isSelected ? theme.colors.cardAccent : "transparent",
      }}
    >
      <Pressable
        testID={`critical-alert-sound-${option.id}-select`}
        accessibilityRole="radio"
        accessibilityLabel={option.title}
        accessibilityHint={option.description}
        accessibilityState={{ checked: isSelected, disabled: isDisabled }}
        aria-checked={isSelected}
        disabled={isDisabled}
        onPress={onSelect}
        style={({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
          return {
            flex: 1,
            minHeight: touchTarget + 16,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            paddingVertical: spacing.md,
            paddingLeft: spacing.lg,
            paddingRight: spacing.sm,
            opacity: pressed && !isSelected ? 0.6 : 1,
          };
        }}
      >
        <Ionicons
          name={isSelected ? "radio-button-on" : "radio-button-off"}
          size={22}
          color={
            isSelected ? theme.colors.actionPrimary : theme.colors.textTertiary
          }
        />
        <IconBadge
          name={SOUND_ICONS[option.id]}
          color={
            isSelected ? theme.colors.actionPrimary : theme.colors.textSecondary
          }
          size="sm"
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText
            variant="headline"
            weight={isSelected ? "700" : undefined}
            color={isSelected ? theme.colors.actionPrimary : undefined}
          >
            {option.title}
          </AppText>
          <AppText variant="footnote" tone="secondary">
            {option.description}
          </AppText>
          {isPreviewing ? (
            <AppText
              testID={`critical-alert-sound-${option.id}-playing`}
              variant="caption"
              tone="accent"
              weight="600"
              accessibilityLiveRegion="polite"
            >
              Playing preview…
            </AppText>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        testID={`critical-alert-sound-${option.id}-preview`}
        accessibilityRole="button"
        accessibilityLabel={
          isPreviewing ? `Stop ${option.title}` : `Play ${option.title}`
        }
        accessibilityHint={
          isPreviewing
            ? "Stops the preview."
            : "Plays this sound the way a critical page would."
        }
        onPress={onPreview}
        hitSlop={6}
        style={({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
          return {
            width: 40,
            height: 40,
            marginRight: spacing.lg,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isPreviewing
              ? theme.colors.actionPrimary
              : withAlpha(theme.colors.actionPrimary, theme.dark ? 0.2 : 0.12),
            opacity: pressed ? 0.7 : 1,
          };
        }}
      >
        <Ionicons
          name={isPreviewing ? "stop" : "play"}
          size={18}
          color={
            isPreviewing ? theme.colors.textInverse : theme.colors.actionPrimary
          }
          style={isPreviewing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>
    </View>
  );
}

// The iPhone's volume steps, as a row of choices with a speaker each.
function VolumePicker({
  volume,
  isDisabled,
  onChange,
}: {
  volume: number;
  isDisabled: boolean;
  onChange: (volume: number) => void;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      testID="critical-alert-volume-picker"
      accessibilityRole="radiogroup"
      accessibilityLabel="Critical alert volume"
      style={{
        flexDirection: "row",
        gap: spacing.xs,
        margin: spacing.md,
        padding: 3,
        borderRadius: radius.md,
        backgroundColor: theme.colors.backgroundTertiary,
      }}
    >
      {CRITICAL_ALERT_VOLUME_OPTIONS.map((option: number) => {
        const isSelected: boolean = option === volume;

        return (
          <Pressable
            key={option}
            testID={`critical-alert-volume-${option}`}
            accessibilityRole="radio"
            accessibilityLabel={`${option} percent`}
            accessibilityState={{ checked: isSelected, disabled: isDisabled }}
            aria-checked={isSelected}
            disabled={isDisabled}
            onPress={() => {
              onChange(option);
            }}
            style={({
              pressed,
            }: {
              pressed: boolean;
            }): StyleProp<ViewStyle> => {
              return {
                flex: 1,
                minHeight: touchTarget,
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                paddingVertical: spacing.sm,
                borderRadius: radius.md - 3,
                backgroundColor: isSelected
                  ? theme.colors.backgroundElevated
                  : "transparent",
                opacity: pressed && !isSelected ? 0.6 : 1,
              };
            }}
          >
            <Ionicons
              name={volumeIcon(option)}
              size={18}
              color={
                isSelected
                  ? theme.colors.actionPrimary
                  : theme.colors.textSecondary
              }
            />
            <AppText
              variant="subhead"
              weight={isSelected ? "700" : "500"}
              color={
                isSelected
                  ? theme.colors.textPrimary
                  : theme.colors.textSecondary
              }
            >
              {`${option}%`}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/*
 * Settings > Alarm sound: the alarm critical on-call pages play on this
 * phone, each one playable before it is chosen, and on an iPhone how loud.
 */
export default function CriticalAlertSoundScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const paddingBottom: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const { selectionFeedback } = useHaptics();
  const alarm: CriticalAlertSoundState = useCriticalAlertSound();

  return (
    <ScrollView
      testID="critical-alert-sound-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        ...gutters,
        paddingBottom,
        gap: spacing.xxl,
      }}
    >
      <ScreenIntro
        title="Alarm sound"
        description="What critical on-call pages play on this phone. Pick one you will not sleep through - press play to hear each."
        compact
        style={{ marginBottom: 0 }}
      />

      {alarm.error ? (
        <Banner
          testID="critical-alert-sound-error"
          tone="danger"
          message={alarm.error}
        />
      ) : null}

      {alarm.channelWarning ? (
        <Banner
          testID="critical-alert-sound-channel-warning"
          tone="warning"
          title="This sound cannot ring through Do Not Disturb"
          message={alarm.channelWarning}
          actionLabel="Open Do Not Disturb access"
          onAction={() => {
            void alarm.openDoNotDisturbAccess();
          }}
        />
      ) : null}

      <ListGroup
        title="Sound"
        footer={previewFootnote()}
        testID="critical-alert-sound-list"
      >
        {alarm.sounds.map((option: CriticalAlertSoundOption) => {
          return (
            <SoundRow
              key={option.id}
              option={option}
              isSelected={alarm.isLoaded && option.id === alarm.sound}
              isPreviewing={alarm.previewingSound === option.id}
              isDisabled={!alarm.isLoaded || alarm.isSaving}
              onSelect={() => {
                if (option.id === alarm.sound) {
                  return;
                }
                void selectionFeedback();
                void alarm.setSound(option.id);
              }}
              onPreview={() => {
                if (alarm.previewingSound === option.id) {
                  void alarm.stopPreview();
                  return;
                }
                void alarm.preview(option.id);
              }}
            />
          );
        })}
      </ListGroup>

      {alarm.isVolumeAdjustable ? (
        <ListGroup
          title="Volume"
          footer="Critical pages play at this volume even when your iPhone is silenced or in Do Not Disturb."
          testID="critical-alert-volume"
        >
          <VolumePicker
            volume={alarm.volume}
            isDisabled={!alarm.isLoaded || alarm.isSaving}
            onChange={(volume: number) => {
              if (volume === alarm.volume) {
                return;
              }
              void selectionFeedback();
              void alarm.setVolume(volume);
            }}
          />
        </ListGroup>
      ) : (
        <Banner
          testID="critical-alert-volume-android"
          tone="info"
          icon="volume-high-outline"
          title="Loudness"
          message="Critical pages play at your phone's alarm volume. Keep it turned up in your phone's sound settings."
        />
      )}
    </ScrollView>
  );
}
