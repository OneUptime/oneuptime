import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { elevation, radius, spacing, typography } from "../../theme/tokens";
import { useScreenPadding } from "../../hooks/useScreenPadding";
import { SHEET_MAX_WIDTH } from "../../layout/windowLayout";
import IconBadge from "../IconBadge";
import StatusPill, { type StatusTone } from "../StatusPill";

interface CaseSheetProps {
  visible: boolean;
  title: string;
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  /*
   * Whether tapping the dimmed screen behind the sheet closes it. A sheet with
   * something typed in it keeps it: a stray tap above the keyboard must not
   * throw a closing note away.
   */
  dismissible?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  // The sheet's buttons, kept under its content.
  footer?: React.ReactNode;
  testID: string;
}

/**
 * The bottom sheet every decision on a case is made in - its status, its
 * priority, how it closes, a playbook step's approval - drawn the way the
 * note sheet is: a grabber, the question with what it does, the choices, and
 * the buttons last. On a wide window it stops at 640 points and centres.
 */
export default function CaseSheet({
  visible,
  title,
  description,
  icon,
  iconColor,
  dismissible = true,
  onClose,
  children,
  footer,
  testID,
}: CaseSheetProps): React.JSX.Element {
  const { theme } = useTheme();
  const paddingBottom: number = useScreenPadding({ tabBar: false });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        testID={`${testID}-backdrop`}
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: theme.colors.overlay,
        }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          testID={`${testID}-dismiss-area`}
          accessible={false}
          importantForAccessibility="no"
          onPress={(): void => {
            if (dismissible) {
              onClose();
            }
          }}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID={testID}
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: SHEET_MAX_WIDTH,
            alignSelf: "center",
            maxHeight: "92%",
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: theme.dark ? 1 : 0,
            borderBottomWidth: 0,
            borderColor: theme.colors.borderSubtle,
            ...elevation("overlay", theme.dark),
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            bounces={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.sm,
              paddingBottom: Math.max(paddingBottom, spacing.xl),
            }}
          >
            <View style={{ alignItems: "center", paddingBottom: spacing.lg }}>
              <View
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: radius.pill,
                  backgroundColor: theme.colors.borderDefault,
                }}
              />
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.md,
                marginBottom: spacing.lg,
              }}
            >
              <IconBadge
                name={icon}
                color={iconColor ?? theme.colors.actionPrimary}
              />
              <View style={{ flex: 1, gap: spacing.xxs }}>
                <Text
                  accessibilityRole="header"
                  style={{
                    ...typography.title3,
                    color: theme.colors.textPrimary,
                  }}
                >
                  {title}
                </Text>
                {description ? (
                  <Text
                    style={{
                      ...typography.footnote,
                      color: theme.colors.textSecondary,
                    }}
                  >
                    {description}
                  </Text>
                ) : null}
              </View>
            </View>

            {children}

            {footer ? (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: spacing.md,
                  marginTop: spacing.xl,
                }}
              >
                {footer}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface CaseSheetOptionTag {
  label: string;
  tone: StatusTone;
}

interface CaseSheetOptionProps {
  label: string;
  description?: string;
  // The value's own colour, as the project set it: a dot beside its name.
  dotColor?: string;
  // Words beside the name: "Current", "Suggested by OneUptime AI".
  tags?: Array<CaseSheetOptionTag>;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * One choice in a sheet, read as a radio button: its name (and its colour
 * dot), what it means, and why it is marked. 52 points tall at least.
 */
export function CaseSheetOption({
  label,
  description,
  dotColor,
  tags = [],
  selected,
  disabled = false,
  onPress,
  testID,
}: CaseSheetOptionProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={[
        label,
        ...tags.map((tag: CaseSheetOptionTag): string => {
          return tag.label;
        }),
      ].join(", ")}
      accessibilityHint={description}
      accessibilityState={{ selected, checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => {
        return {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          minHeight: 52,
          paddingVertical: spacing.md - (selected ? 1 : 0),
          paddingHorizontal: spacing.lg - (selected ? 1 : 0),
          marginBottom: spacing.sm,
          borderRadius: radius.md,
          borderWidth: selected ? 2 : 1,
          borderColor: selected
            ? theme.colors.actionPrimary
            : theme.colors.borderSubtle,
          backgroundColor: selected
            ? theme.colors.cardAccent
            : pressed
              ? theme.colors.backgroundTertiary
              : theme.colors.backgroundElevated,
          opacity: disabled ? 0.6 : 1,
        };
      }}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={
          selected ? theme.colors.actionPrimary : theme.colors.textTertiary
        }
      />
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          {dotColor ? (
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: dotColor,
              }}
            />
          ) : null}
          <Text
            style={{
              ...typography.headline,
              color: theme.colors.textPrimary,
            }}
          >
            {label}
          </Text>
          {tags.map((tag: CaseSheetOptionTag): React.JSX.Element => {
            return (
              <StatusPill
                key={tag.label}
                label={tag.label}
                tone={tag.tone}
                size="sm"
              />
            );
          })}
        </View>
        {description ? (
          <Text
            style={{
              ...typography.footnote,
              color: theme.colors.textSecondary,
            }}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
