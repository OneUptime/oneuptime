import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing, typography } from "../theme/tokens";
import { formatDateTime, formatRelativeTime } from "../utils/date";
import IconBadge from "./IconBadge";
import SectionHeader from "./SectionHeader";
import { getToneColors, type StatusTone } from "./StatusPill";

type IconName = keyof typeof Ionicons.glyphMap;

/** What `formatDateTime` and `formatRelativeTime` print for a missing time. */
const UNKNOWN_TIME: string = "—";

/**
 * "2h ago · 30 Aug 2026, 10:07" for a note or feed entry.
 *
 * The relative half is what a responder scans for; the absolute half is what
 * goes into a post-mortem. A timestamp the server did not send stays a single
 * em dash, so nothing reads as a time that was never recorded.
 */
export function formatResponseTimestamp(dateString: string): string {
  const absolute: string = formatDateTime(dateString);
  if (absolute === UNKNOWN_TIME) {
    return UNKNOWN_TIME;
  }
  return `${formatRelativeTime(dateString)} · ${absolute}`;
}

/**
 * "Declared 2h ago" for the header, or nothing when the server sent no usable
 * time - a header line that says "Declared —" helps nobody.
 */
export function describeResponseAge(
  verb: string,
  dateString: string | undefined,
): string | undefined {
  const relative: string = formatRelativeTime(dateString ?? "");
  return relative === UNKNOWN_TIME ? undefined : `${verb} ${relative}`;
}

export type ResponseStage = "open" | "acknowledged" | "resolved";

export function getResponseStage(
  isResolved: boolean,
  isAcknowledged: boolean,
): ResponseStage {
  if (isResolved) {
    return "resolved";
  }
  return isAcknowledged ? "acknowledged" : "open";
}

/*
 * The titles deliberately avoid the words servers use for state names
 * ("Acknowledged", "Resolved"): the state pill already says those, and the
 * guidance is about what to do next.
 */
const stageAppearance: Record<
  ResponseStage,
  { tone: StatusTone; icon: IconName; title: string }
> = {
  open: {
    tone: "warning",
    icon: "alert-circle-outline",
    title: "Needs a responder",
  },
  acknowledged: {
    tone: "info",
    icon: "construct-outline",
    title: "Response in progress",
  },
  resolved: {
    tone: "success",
    icon: "checkmark-circle-outline",
    title: "Response complete",
  },
};

export function getResponseStageAppearance(stage: ResponseStage): {
  tone: StatusTone;
  icon: IconName;
  title: string;
} {
  return stageAppearance[stage];
}

/** Icons for the two response actions, shared by every detail screen. */
export const responseActionIcons: Readonly<{
  acknowledge: IconName;
  resolve: IconName;
}> = {
  acknowledge: "eye-outline",
  resolve: "checkmark-circle-outline",
};

interface ResponseDetailHeaderProps {
  title: string;
  kind: string;
  number?: string;
  state?: string;
  stateColor: string;
  severity?: string;
  /** Server colour for the severity flag; the word always carries the meaning. */
  severityColor?: string;
  /** One short line under the pills, e.g. "Declared 2h ago". */
  meta?: string;
}

/** The resource at the top of a detail page: what it is, and where it stands. */
export function ResponseDetailHeader({
  title,
  kind,
  number,
  state,
  stateColor,
  severity,
  severityColor,
  meta,
}: ResponseDetailHeaderProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      testID="response-detail-header"
      style={{
        paddingTop: spacing.xs,
        marginBottom: spacing.xl,
        gap: spacing.sm,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        <Text
          style={{
            ...typography.overline,
            color: theme.colors.actionPrimary,
          }}
        >
          {kind}
        </Text>
        {number ? (
          <>
            <View
              style={{
                width: 3,
                height: 3,
                borderRadius: 2,
                backgroundColor: theme.colors.textTertiary,
              }}
            />
            <Text
              style={{
                ...typography.footnote,
                fontWeight: "600",
                color: theme.colors.textSecondary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {number}
            </Text>
          </>
        ) : null}
      </View>
      <Text
        accessibilityRole="header"
        style={{
          ...typography.title,
          color: theme.colors.textPrimary,
        }}
      >
        {title}
      </Text>
      {state || severity ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: spacing.sm,
            marginTop: spacing.xs,
          }}
        >
          {state ? (
            <View
              testID="detail-state-pill"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                minHeight: 32,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 2,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.backgroundElevated,
                borderWidth: 1,
                borderColor: theme.colors.borderSubtle,
              }}
            >
              <View
                testID="detail-state-dot"
                style={{
                  height: 10,
                  width: 10,
                  borderRadius: 5,
                  backgroundColor: stateColor,
                }}
              />
              <Text
                style={{
                  ...typography.subhead,
                  fontWeight: "700",
                  color: theme.colors.textPrimary,
                }}
              >
                {state}
              </Text>
            </View>
          ) : null}
          {severity ? (
            <View
              testID="detail-severity-pill"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs + 2,
                minHeight: 32,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 2,
                borderRadius: radius.pill,
                backgroundColor: theme.colors.backgroundTertiary,
              }}
            >
              <Ionicons
                name="flag"
                size={13}
                color={severityColor ?? theme.colors.textSecondary}
              />
              <Text
                style={{
                  ...typography.subhead,
                  fontWeight: "600",
                  color: theme.colors.textSecondary,
                }}
              >
                {severity}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {meta ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs + 2,
          }}
        >
          <Ionicons
            name="time-outline"
            size={14}
            color={theme.colors.textTertiary}
          />
          <Text
            style={{
              ...typography.footnote,
              color: theme.colors.textTertiary,
            }}
          >
            {meta}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface ResponseGuidanceProps {
  tone: StatusTone;
  icon: IconName;
  title: string;
  message: string;
  /** Usually the response actions, so the next step sits beside its buttons. */
  children?: React.ReactNode;
  testID?: string;
}

/**
 * Where the response stands and what to do next, in one card.
 *
 * The text is a polite live region: when a responder acknowledges or resolves,
 * the new guidance is announced without stealing focus from the button.
 */
export function ResponseGuidance({
  tone,
  icon,
  title,
  message,
  children,
  testID = "response-guidance",
}: ResponseGuidanceProps): React.JSX.Element {
  const { theme } = useTheme();
  const toneColors: { text: string; background: string } = getToneColors(
    theme,
    tone,
  );
  const hasChildren: boolean = React.Children.toArray(children).length > 0;

  return (
    <View
      testID={testID}
      style={{
        marginBottom: spacing.xxl,
        padding: spacing.lg,
        gap: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderSubtle,
        ...elevation("card", theme.dark),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.md,
        }}
      >
        <IconBadge
          testID={`${testID}-icon`}
          name={icon}
          color={toneColors.text}
          background={toneColors.background}
        />
        <View
          testID={`${testID}-content`}
          accessibilityLiveRegion="polite"
          style={{ flex: 1, gap: spacing.xxs }}
        >
          <Text
            style={{
              ...typography.headline,
              color: theme.colors.textPrimary,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              ...typography.subhead,
              color: theme.colors.textSecondary,
            }}
          >
            {message}
          </Text>
        </View>
      </View>
      {hasChildren ? children : null}
    </View>
  );
}

export interface ResponseAction {
  label: string;
  accessibilityLabel: string;
  busyAccessibilityLabel?: string;
  onPress: () => void | Promise<void>;
  primary?: boolean;
  icon?: IconName;
}

export function ResponseActions({
  actions,
  busy,
  style,
}: {
  actions: ResponseAction[];
  busy: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      testID="response-actions"
      style={[
        {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.md,
          marginBottom: spacing.xxl,
        },
        style,
      ]}
    >
      {actions.map((action: ResponseAction) => {
        const contentColor: string = action.primary
          ? theme.colors.textInverse
          : theme.colors.textPrimary;
        return (
          <Pressable
            key={action.accessibilityLabel}
            onPress={action.onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={
              busy
                ? action.busyAccessibilityLabel ?? action.accessibilityLabel
                : action.accessibilityLabel
            }
            accessibilityState={{ disabled: busy, busy }}
            aria-disabled={busy}
            aria-busy={busy}
            style={({ pressed }: { pressed: boolean }): ViewStyle => {
              return {
                flex: 1,
                flexDirection: "row",
                gap: spacing.sm,
                minWidth: 128,
                minHeight: 54,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.lg,
                borderRadius: radius.md,
                justifyContent: "center",
                alignItems: "center",
                borderWidth: action.primary ? 0 : 1,
                borderColor: theme.colors.borderDefault,
                backgroundColor: action.primary
                  ? pressed
                    ? theme.colors.actionPrimaryPressed
                    : theme.colors.actionPrimary
                  : pressed
                    ? theme.colors.backgroundTertiary
                    : theme.colors.backgroundElevated,
                opacity: busy ? 0.65 : 1,
                transform: [{ scale: pressed && !busy ? 0.98 : 1 }],
              };
            }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={contentColor} />
            ) : (
              <>
                {action.icon ? (
                  <Ionicons name={action.icon} size={20} color={contentColor} />
                ) : null}
                <Text
                  style={{
                    ...typography.headline,
                    fontWeight: "700",
                    color: contentColor,
                  }}
                >
                  {action.label}
                </Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A titled card. Direct children are separated by hairlines, so a list of
 * info rows reads as one group without each row drawing its own border.
 */
export function ResponseSection({
  title,
  children,
  iconName,
  count,
  actionLabel,
  onAction,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  iconName?: IconName;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const items: React.ReactNode[] = React.Children.toArray(children);
  return (
    <View testID={testID} style={{ marginBottom: spacing.xxl }}>
      <SectionHeader
        title={title}
        iconName={iconName}
        count={count}
        actionLabel={actionLabel}
        onAction={onAction}
      />
      <View
        testID="response-section-card"
        style={{
          borderRadius: radius.lg,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.xs,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
          ...elevation("card", theme.dark),
        }}
      >
        {items.map((item: React.ReactNode, index: number) => {
          return (
            <View
              key={index}
              style={{
                paddingVertical: items.length > 1 ? 0 : spacing.md,
                borderTopWidth: index > 0 ? 1 : 0,
                borderTopColor: theme.colors.borderSubtle,
              }}
            >
              {item}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function ResponseInfoRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.lg,
        minHeight: 44,
        paddingVertical: spacing.md,
      }}
    >
      <Text
        style={{
          ...typography.subhead,
          width: 96,
          flexShrink: 0,
          color: theme.colors.textSecondary,
        }}
      >
        {label}
      </Text>
      <Text
        selectable
        style={{
          ...typography.subhead,
          flex: 1,
          fontWeight: "500",
          color: theme.colors.textPrimary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * The shape of a detail page while it loads: header, guidance card with its
 * two buttons, and a section card, so nothing jumps when the data lands.
 *
 * The pulse waits for the reduce-motion answer and never starts if the person
 * asked for stillness, or if the question itself fails.
 */
export function ResponseDetailSkeleton(): React.JSX.Element {
  const { theme } = useTheme();
  const opacity: Animated.Value = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect((): (() => void) => {
    let active: boolean = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled: boolean): void => {
        if (active) {
          setReduceMotion(enabled);
        }
      })
      .catch((): void => {
        if (active) {
          setReduceMotion(true);
        }
      });
    return (): void => {
      active = false;
    };
  }, []);

  useEffect((): (() => void) | undefined => {
    if (reduceMotion !== false) {
      return undefined;
    }
    const animation: Animated.CompositeAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return (): void => {
      animation.stop();
    };
  }, [opacity, reduceMotion]);

  const block: (
    width: DimensionValue | undefined,
    height: number,
    extra?: ViewStyle,
  ) => React.JSX.Element = (
    width: DimensionValue | undefined,
    height: number,
    extra?: ViewStyle,
  ): React.JSX.Element => {
    return (
      <View
        style={{
          width,
          height,
          borderRadius: radius.sm,
          backgroundColor: theme.colors.backgroundTertiary,
          ...extra,
        }}
      />
    );
  };

  const surface: ViewStyle = {
    borderRadius: radius.lg,
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...elevation("card", theme.dark),
  };

  return (
    <Animated.View
      testID="response-detail-skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading content"
      style={{ opacity }}
    >
      <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
        {block(88, 12)}
        {block("88%", 26, { marginTop: spacing.xs })}
        {block("56%", 26)}
        <View
          style={{
            flexDirection: "row",
            gap: spacing.sm,
            marginTop: spacing.xs,
          }}
        >
          {block(104, 32, { borderRadius: radius.pill })}
          {block(80, 32, { borderRadius: radius.pill })}
        </View>
      </View>
      <View
        style={{
          ...surface,
          padding: spacing.lg,
          gap: spacing.lg,
          marginBottom: spacing.xxl,
        }}
      >
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          {block(38, 38, { borderRadius: radius.md })}
          <View style={{ flex: 1, gap: spacing.sm, paddingTop: 2 }}>
            {block("48%", 14)}
            {block("92%", 12)}
            {block("70%", 12)}
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          {block(undefined, 54, { flex: 1, borderRadius: radius.md })}
          {block(undefined, 54, { flex: 1, borderRadius: radius.md })}
        </View>
      </View>
      {block(96, 18, { marginBottom: spacing.md })}
      <View
        style={{
          ...surface,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.xs,
        }}
      >
        {[0, 1, 2].map((index: number) => {
          return (
            <View
              key={index}
              style={{
                flexDirection: "row",
                gap: spacing.lg,
                paddingVertical: spacing.md + 2,
                borderTopWidth: index > 0 ? 1 : 0,
                borderTopColor: theme.colors.borderSubtle,
              }}
            >
              {block(72, 14)}
              {block(index === 1 ? "40%" : "55%", 14)}
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}
