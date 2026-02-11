import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useTheme } from "../theme";

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
  const [noteText, setNoteText] = useState("");

  const handleSubmit: () => void = (): void => {
    const trimmed: string = noteText.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setNoteText("");
    }
  };

  const handleClose: () => void = (): void => {
    setNoteText("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[
            styles.container,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderDefault,
            },
          ]}
        >
          <Text
            style={[
              theme.typography.titleMedium,
              { color: theme.colors.textPrimary, marginBottom: 16 },
            ]}
          >
            Add Note
          </Text>

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: theme.colors.backgroundTertiary,
                color: theme.colors.textPrimary,
                borderColor: theme.colors.borderSubtle,
              },
            ]}
            placeholder="Add a note..."
            placeholderTextColor={theme.colors.textTertiary}
            value={noteText}
            onChangeText={setNoteText}
            multiline
            textAlignVertical="top"
            editable={!isSubmitting}
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.button,
                {
                  backgroundColor: theme.colors.backgroundTertiary,
                  borderColor: theme.colors.borderSubtle,
                  borderWidth: 1,
                },
              ]}
              onPress={handleClose}
              disabled={isSubmitting}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: theme.colors.textSecondary },
                ]}
              >
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                {
                  backgroundColor:
                    noteText.trim() && !isSubmitting
                      ? theme.colors.actionPrimary
                      : theme.colors.backgroundTertiary,
                },
              ]}
              onPress={handleSubmit}
              disabled={!noteText.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator
                  size="small"
                  color={theme.colors.textInverse}
                />
              ) : (
                <Text
                  style={[
                    styles.buttonText,
                    {
                      color: noteText.trim()
                        ? theme.colors.textInverse
                        : theme.colors.textTertiary,
                    },
                  ]}
                >
                  Submit
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 20,
    paddingBottom: 36,
  },
  input: {
    minHeight: 120,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
