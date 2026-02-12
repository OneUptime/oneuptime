import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
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
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="rounded-t-3xl p-5 pb-9 bg-bg-primary">
          <Text className="text-title-md text-text-primary mb-4">
            Add Note
          </Text>

          <TextInput
            className="min-h-[120px] rounded-[14px] border p-3 text-[15px] bg-bg-primary text-text-primary border-border-default"
            placeholder="Add a note..."
            placeholderTextColor={theme.colors.textTertiary}
            value={noteText}
            onChangeText={setNoteText}
            multiline
            textAlignVertical="top"
            editable={!isSubmitting}
          />

          <View className="flex-row gap-3 mt-4">
            <TouchableOpacity
              className="flex-1 py-3.5 rounded-[14px] items-center justify-center min-h-[48px] bg-bg-tertiary border border-border-subtle"
              onPress={handleClose}
              disabled={isSubmitting}
            >
              <Text className="text-[15px] font-bold text-text-secondary">
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-1 py-3.5 rounded-[14px] items-center justify-center min-h-[48px]"
              style={{
                backgroundColor:
                  noteText.trim() && !isSubmitting
                    ? theme.colors.actionPrimary
                    : theme.colors.backgroundTertiary,
              }}
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
                  className="text-[15px] font-bold"
                  style={{
                    color: noteText.trim()
                      ? theme.colors.textInverse
                      : theme.colors.textTertiary,
                  }}
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
