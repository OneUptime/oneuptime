import React, { useContext, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type AccessibilityState,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { withAlpha } from "../utils/color";
import AppText from "./AppText";
import Logo from "./Logo";
import ScreenIntro from "./ScreenIntro";
import { getToneColors, type StatusTone } from "./StatusPill";

/*
 * The sign-in family: server address, password, SSO, password recovery, two
 * factor, recovery codes and the biometric lock. Everything these screens have
 * in common lives here so they read as one flow rather than seven forms that
 * each picked their own border, height and error colour.
 */

type IconName = keyof typeof Ionicons.glyphMap;

type FieldFocusEvent = Parameters<NonNullable<TextInputProps["onFocus"]>>[0];

/** Height of every text field and primary action on the auth screens. */
export const AUTH_CONTROL_HEIGHT: number = 52;

/** The taller field used for one-time codes, so the digits are easy to read. */
export const AUTH_CODE_FIELD_HEIGHT: number = 64;

/** The shape the auth screens give their filled primary action. */
export const authPrimaryButtonStyle: ViewStyle = {
  minHeight: AUTH_CONTROL_HEIGHT,
};

interface AuthLayoutProps {
  title: string;
  description?: string;
  eyebrow?: string;
  /** Shows the OneUptime wordmark above the title. */
  showBrand?: boolean;
  compact?: boolean;
  /** A tinted icon above the title, for screens that do not show the brand. */
  icon?: IconName;
  iconTone?: StatusTone;
  /** Centres the brand, icon and title - the calm, single-action lock screen. */
  centered?: boolean;
  children: React.ReactNode;
}

/** A scrollable, keyboard-aware sign-in layout that also fits small phones. */
export default function AuthLayout({
  title,
  description,
  eyebrow,
  showBrand = false,
  compact = false,
  icon,
  iconTone = "accent",
  centered = false,
  children,
}: AuthLayoutProps): React.JSX.Element {
  const { theme } = useTheme();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);
  const paddingBottom: number = useScreenPadding({ tabBar: false });
  const tone: { text: string; background: string } = getToneColors(
    theme,
    iconTone,
  );

  return (
    <KeyboardAvoidingView
      testID="auth-keyboard"
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        testID="auth-scroll"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: spacing.xl,
          paddingTop:
            Math.max(insets?.top ?? 0, spacing.lg) + (compact ? 0 : spacing.sm),
          paddingBottom,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 440,
            alignSelf: "center",
            flexGrow: centered ? 1 : 0,
            justifyContent: centered ? "center" : "flex-start",
          }}
        >
          {showBrand ? (
            <View
              testID="auth-brand"
              accessible
              accessibilityRole="image"
              accessibilityLabel="OneUptime"
              style={{
                alignSelf: centered ? "center" : "flex-start",
                marginBottom: compact ? spacing.xxl : spacing.xxxl,
              }}
            >
              <Logo
                size={26}
                variant="wordmark"
                color={theme.colors.textPrimary}
                accentColor={theme.colors.actionPrimary}
              />
            </View>
          ) : null}

          {icon && centered ? (
            <View
              testID="auth-icon"
              style={{
                alignSelf: "center",
                width: 112,
                height: 112,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: spacing.xxl,
                backgroundColor: withAlpha(tone.text, theme.dark ? 0.12 : 0.08),
              }}
            >
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: tone.background,
                }}
              >
                <Ionicons name={icon} size={36} color={tone.text} />
              </View>
            </View>
          ) : null}

          {icon && !centered ? (
            <View
              testID="auth-icon"
              style={{
                alignSelf: "flex-start",
                width: 52,
                height: 52,
                borderRadius: radius.lg,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: spacing.lg,
                backgroundColor: tone.background,
              }}
            >
              <Ionicons name={icon} size={26} color={tone.text} />
            </View>
          ) : null}

          {centered ? (
            <View
              style={{
                alignItems: "center",
                gap: spacing.xs,
                marginBottom: spacing.xxl,
              }}
            >
              {eyebrow ? (
                <AppText variant="overline" tone="accent" align="center">
                  {eyebrow}
                </AppText>
              ) : null}
              <AppText
                accessibilityRole="header"
                variant={compact ? "title" : "largeTitle"}
                align="center"
              >
                {title}
              </AppText>
              {description ? (
                <AppText variant="callout" tone="secondary" align="center">
                  {description}
                </AppText>
              ) : null}
            </View>
          ) : (
            <ScreenIntro
              title={title}
              description={description}
              eyebrow={eyebrow}
              compact={compact}
            />
          )}

          <View
            testID="auth-form"
            style={{ marginTop: compact ? 0 : spacing.sm }}
          >
            {children}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export interface AuthTextFieldProps extends Omit<TextInputProps, "style"> {
  /** The visible label above the field. */
  label: string;
  icon?: IconName;
  /** Draws the field in its error colour without a message of its own. */
  invalid?: boolean;
  /** Shown under the field, drawn in the error colour and announced. */
  errorMessage?: string | null;
  /** Quiet help text under the field when there is no error. */
  hint?: string;
  /** Adds a show/hide control to a secure field. */
  revealable?: boolean;
  /** "code" is a large, centred field for one-time codes. */
  variant?: "default" | "code";
  inputRef?: React.Ref<TextInput>;
  containerTestID?: string;
}

/**
 * A labelled text field: 52 points tall, 12 round, an indigo focus ring, a red
 * error state and the right keyboard for the current appearance.
 */
export function AuthTextField({
  label,
  icon,
  invalid = false,
  errorMessage,
  hint,
  revealable = false,
  variant = "default",
  inputRef,
  containerTestID,
  accessibilityLabel,
  secureTextEntry,
  editable,
  onFocus,
  onBlur,
  ...inputProps
}: AuthTextFieldProps): React.JSX.Element {
  const { theme } = useTheme();
  const [focused, setFocused] = useState<boolean>(false);
  const [revealed, setRevealed] = useState<boolean>(false);

  const isCode: boolean = variant === "code";
  const isDisabled: boolean = editable === false;
  const hasError: boolean = invalid || Boolean(errorMessage);
  const borderWidth: number = focused || hasError ? 2 : 1;
  const accent: string = hasError
    ? theme.colors.statusError
    : theme.colors.actionPrimary;

  const containerStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: isCode ? AUTH_CODE_FIELD_HEIGHT : AUTH_CONTROL_HEIGHT,
    borderRadius: radius.md,
    borderWidth,
    borderColor: hasError || focused ? accent : theme.colors.borderDefault,
    backgroundColor: isDisabled
      ? theme.colors.backgroundTertiary
      : theme.colors.backgroundElevated,
    // The border grows on focus; the padding shrinks to keep the text still.
    paddingLeft: spacing.md + 2 - borderWidth,
    paddingRight: (revealable ? spacing.xs : spacing.md + 2) - borderWidth,
    ...(focused
      ? {
          boxShadow: `0px 0px 0px 3px ${withAlpha(
            accent,
            theme.dark ? 0.35 : 0.18,
          )}`,
        }
      : {}),
  };

  const inputStyle: TextStyle = {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: isCode ? 28 : typography.body.fontSize,
    fontWeight: isCode ? "600" : "400",
    letterSpacing: isCode ? 6 : 0,
    textAlign: isCode ? "center" : "left",
    fontVariant: isCode ? ["tabular-nums"] : undefined,
    color: isDisabled ? theme.colors.textSecondary : theme.colors.textPrimary,
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="subhead" weight="600" tone="secondary">
        {label}
      </AppText>
      <View testID={containerTestID} style={containerStyle}>
        {icon && !isCode ? (
          <Ionicons
            name={icon}
            size={20}
            color={hasError || focused ? accent : theme.colors.textTertiary}
          />
        ) : null}
        <TextInput
          {...inputProps}
          ref={inputRef}
          accessibilityLabel={accessibilityLabel ?? label}
          editable={editable}
          secureTextEntry={
            revealable ? Boolean(secureTextEntry) && !revealed : secureTextEntry
          }
          placeholderTextColor={theme.colors.textTertiary}
          selectionColor={theme.colors.actionPrimary}
          cursorColor={theme.colors.actionPrimary}
          keyboardAppearance={theme.dark ? "dark" : "light"}
          onFocus={(event: FieldFocusEvent): void => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event: FieldFocusEvent): void => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={inputStyle}
        />
        {revealable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            onPress={(): void => {
              setRevealed(!revealed);
            }}
            style={({ pressed }: { pressed: boolean }): ViewStyle => {
              return {
                minWidth: 48,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.sm,
                backgroundColor: pressed
                  ? theme.colors.backgroundTertiary
                  : "transparent",
              };
            }}
          >
            <Ionicons
              name={revealed ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={theme.colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {errorMessage ? (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: spacing.xs + 2,
          }}
        >
          <Ionicons
            name="alert-circle"
            size={16}
            color={theme.colors.statusError}
            style={{ marginTop: 2 }}
          />
          <AppText variant="subhead" tone="danger" style={{ flex: 1 }}>
            {errorMessage}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="footnote" tone="secondary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

interface AuthNoticeProps {
  message: string;
  /** "danger" is announced as an alert; the rest are polite status text. */
  tone?: StatusTone;
  icon?: IconName;
  /** Announce changes without interrupting, e.g. progress or a retry hint. */
  live?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const noticeIcons: Record<StatusTone, IconName> = {
  neutral: "information-circle",
  info: "information-circle",
  accent: "sparkles",
  success: "checkmark-circle",
  warning: "warning",
  danger: "alert-circle",
};

/** A tinted message: form errors, passkey progress and retry guidance. */
export function AuthNotice({
  message,
  tone = "danger",
  icon,
  live = false,
  style,
  testID,
}: AuthNoticeProps): React.JSX.Element {
  const { theme } = useTheme();
  const colors: { text: string; background: string } = getToneColors(
    theme,
    tone,
  );
  const isError: boolean = tone === "danger";

  return (
    <View
      testID={testID}
      accessible={isError ? true : undefined}
      accessibilityRole={isError ? "alert" : undefined}
      accessibilityLiveRegion={isError || live ? "polite" : undefined}
      style={[
        {
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.sm + 2,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md + 2,
          borderRadius: radius.md,
          backgroundColor: colors.background,
        },
        style,
      ]}
    >
      <Ionicons
        name={icon ?? noticeIcons[tone]}
        size={18}
        color={colors.text}
        style={{ marginTop: 1 }}
      />
      <AppText
        variant="subhead"
        color={tone === "neutral" ? theme.colors.textSecondary : colors.text}
        style={{ flex: 1 }}
      >
        {message}
      </AppText>
    </View>
  );
}

interface AuthLinkProps {
  label: string;
  onPress: () => void;
  /** "accent" for a way forward, "secondary" for a quieter exit. */
  tone?: "accent" | "secondary";
  icon?: IconName;
  trailingIcon?: IconName;
  align?: "center" | "start";
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  "aria-expanded"?: boolean;
  testID?: string;
}

/** A text-only action with a full-size touch target. */
export function AuthLink({
  label,
  onPress,
  tone = "accent",
  icon,
  trailingIcon,
  align = "center",
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  "aria-expanded": ariaExpanded,
  testID,
}: AuthLinkProps): React.JSX.Element {
  const { theme } = useTheme();
  const color: string =
    tone === "accent" ? theme.colors.actionPrimary : theme.colors.textSecondary;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled }}
      aria-expanded={ariaExpanded}
      disabled={disabled}
      onPress={onPress}
      hitSlop={spacing.xs}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          alignSelf: align === "center" ? "center" : "flex-start",
          justifyContent: "center",
          gap: spacing.xs + 2,
          paddingHorizontal: align === "center" ? spacing.md : 0,
          opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
        };
      }}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <AppText variant="subhead" weight="600" color={color}>
        {label}
      </AppText>
      {trailingIcon ? (
        <Ionicons name={trailingIcon} size={16} color={color} />
      ) : null}
    </Pressable>
  );
}

/** A hairline with a short label, between the main route and the others. */
export function AuthDivider({ label }: { label: string }): React.JSX.Element {
  const { theme } = useTheme();
  const line: ViewStyle = {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.borderDefault,
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        marginVertical: spacing.lg,
      }}
    >
      <View style={line} />
      <AppText variant="footnote" tone="secondary">
        {label}
      </AppText>
      <View style={line} />
    </View>
  );
}

export function AuthStep({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.md,
        marginBottom: spacing.lg,
      }}
    >
      <View
        testID={`auth-step-${number}`}
        style={{
          width: 30,
          height: 30,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.cardAccent,
        }}
      >
        <AppText variant="subhead" weight="700" tone="accent">
          {String(number)}
        </AppText>
      </View>
      <View style={{ flex: 1, gap: spacing.xxs, paddingTop: spacing.xxs }}>
        <AppText accessibilityRole="header" variant="headline">
          {title}
        </AppText>
        {description ? (
          <AppText variant="subhead" tone="secondary">
            {description}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}
