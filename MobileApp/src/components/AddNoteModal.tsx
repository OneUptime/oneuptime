import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing, typography } from "../theme/tokens";
import GradientButton from "./GradientButton";
import IconBadge from "./IconBadge";
import { useScreenPadding } from "../hooks/useScreenPadding";

interface AddNoteModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
  isSubmitting: boolean;
}

export default function AddNoteModal({
  visible,
  onClose,
  onSubmit,
  isSubmitting,
}: AddNoteModalProps): React.JSX.Element {
  const { theme } = useTheme();
  const paddingBottom: number = useScreenPadding({ tabBar: false });
  const [noteText, setNoteText] = useState("");
  const [focused, setFocused] = useState(false);

  /*
   * The draft outlives the submit, and is dropped only once the note is
   * actually filed.
   *
   * `onSubmit` starts a POST and returns immediately, so clearing the box next
   * to the call threw the note away while the request was still in the air.
   * When the POST then failed the responder was left with a "Failed to add
   * note" alert and an empty box - and the note they had just typed, often the
   * only written record of what they had done to the incident, was gone with
   * nothing to retry from.
   *
   * Every screen that hosts this modal closes it (`visible` goes false) on
   * success and leaves it open on failure, so the parent hiding us IS the
   * signal that the note landed - and it is the only one available here, since
   * those screens swallow the error themselves to show their own alert. So the
   * draft is cleared on the way out instead: it survives a failed submit, ready
   * for another attempt, and the next Add Note still opens on an empty box.
   */
  useEffect((): void => {
    if (!visible) {
      setNoteText("");
    }
  }, [visible]);

  const canSubmit: boolean = noteText.trim().length > 0 && !isSubmitting;

  const handleSubmit: () => void = (): void => {
    const trimmed: string = noteText.trim();
    if (trimmed && !isSubmitting) {
      onSubmit(trimmed);
    }
  };

  const handleClose: () => void = (): void => {
    if (isSubmitting) {
      return;
    }
    setNoteText("");
    onClose();
  };

  /*
   * Tapping the dimmed screen behind the sheet dismisses it only while the box
   * is empty. A stray tap above the keyboard must not throw away a note that is
   * half written; Cancel is still there for that.
   */
  const handleBackdropPress: () => void = (): void => {
    if (!noteText.trim()) {
      handleClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        testID="add-note-backdrop"
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: theme.colors.overlay,
        }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          testID="add-note-dismiss-area"
          accessible={false}
          importantForAccessibility="no"
          onPress={handleBackdropPress}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="add-note-sheet"
          style={{
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
            <View
              style={{
                alignItems: "center",
                paddingBottom: spacing.lg,
              }}
            >
              <View
                testID="add-note-grabber"
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
                alignItems: "center",
                gap: spacing.md,
                marginBottom: spacing.lg,
              }}
            >
              <IconBadge
                name="create-outline"
                color={theme.colors.actionPrimary}
              />
              <View style={{ flex: 1, gap: spacing.xxs }}>
                <Text
                  accessibilityRole="header"
                  style={{
                    ...typography.title3,
                    color: theme.colors.textPrimary,
                  }}
                >
                  Add Note
                </Text>
                <Text
                  style={{
                    ...typography.footnote,
                    color: theme.colors.textSecondary,
                  }}
                >
                  Share an update with your team. Markdown is supported.
                </Text>
              </View>
            </View>

            <TextInput
              testID="add-note-input"
              accessibilityLabel="Note"
              style={{
                /*
                 * Size only: a lineHeight on a multiline iOS TextInput pushes
                 * the caret off the text it belongs to.
                 */
                fontSize: typography.body.fontSize,
                minHeight: 148,
                maxHeight: 280,
                borderRadius: radius.md,
                /*
                 * The focus ring is one point thicker, so the padding gives
                 * that point back and the text does not shift as it appears.
                 */
                paddingHorizontal: spacing.lg - (focused ? 1 : 0),
                paddingVertical: spacing.md - (focused ? 1 : 0),
                backgroundColor: theme.colors.backgroundPrimary,
                borderWidth: focused ? 2 : 1,
                borderColor: focused
                  ? theme.colors.actionPrimary
                  : theme.colors.borderDefault,
                color: theme.colors.textPrimary,
                opacity: isSubmitting ? 0.6 : 1,
              }}
              placeholder="Write a note..."
              placeholderTextColor={theme.colors.textTertiary}
              selectionColor={theme.colors.actionPrimary}
              cursorColor={theme.colors.actionPrimary}
              keyboardAppearance={theme.dark ? "dark" : "light"}
              value={noteText}
              onChangeText={setNoteText}
              onFocus={() => {
                setFocused(true);
              }}
              onBlur={() => {
                setFocused(false);
              }}
              multiline
              scrollEnabled
              textAlignVertical="top"
              editable={!isSubmitting}
            />

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                marginTop: spacing.sm,
                paddingHorizontal: spacing.xxs,
              }}
            >
              <Ionicons
                name="lock-closed-outline"
                size={13}
                color={theme.colors.textTertiary}
              />
              <Text
                style={{
                  ...typography.caption,
                  flex: 1,
                  fontWeight: "400",
                  color: theme.colors.textTertiary,
                }}
              >
                Internal notes are never shown on status pages.
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                gap: spacing.md,
                marginTop: spacing.xl,
              }}
            >
              <GradientButton
                testID="add-note-cancel"
                label="Cancel"
                variant="secondary"
                onPress={handleClose}
                disabled={isSubmitting}
                style={{ flex: 1, minHeight: 52 }}
              />
              <GradientButton
                testID="add-note-submit"
                label="Submit"
                icon="send"
                onPress={handleSubmit}
                loading={isSubmitting}
                disabled={!canSubmit}
                style={{ flex: 1, minHeight: 52 }}
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
