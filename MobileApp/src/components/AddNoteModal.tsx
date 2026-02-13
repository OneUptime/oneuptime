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
import { Ionicons } from "@expo/vector-icons";
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
        style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          className="rounded-t-[28px] p-5 pb-9"
          style={{
            backgroundColor: theme.colors.backgroundPrimary,
            shadowColor: "#000",
            shadowOpacity: 0.2,
            shadowOffset: { width: 0, height: -8 },
            shadowRadius: 24,
            elevation: 16,
          }}
        >
          {/* Drag Handle */}
          <View className="items-center pt-1 pb-5">
            <View
              className="w-10 h-1.5 rounded-full"
              style={{ backgroundColor: theme.colors.borderDefault }}
            />
          </View>

          <View className="flex-row items-center mb-5">
            <View
              className="w-9 h-9 rounded-lg items-center justify-center mr-3"
              style={{
                backgroundColor: theme.colors.accentGradientStart + "15",
              }}
            >
              <Ionicons
                name="chatbubble-outline"
                size={18}
                color={theme.colors.accentGradientStart}
              />
            </View>
            <Text
              className="text-title-md text-text-primary"
              style={{ letterSpacing: -0.3 }}
            >
              Add Note
            </Text>
          </View>

          <TextInput
            className="min-h-[120px] rounded-xl p-4 text-[15px] text-text-primary"
            style={{
              backgroundColor: theme.colors.backgroundSecondary,
              borderWidth: 1,
              borderColor: theme.colors.borderDefault,
            }}
            placeholder="Write a note..."
            placeholderTextColor={theme.colors.textTertiary}
            value={noteText}
            onChangeText={setNoteText}
            multiline
            textAlignVertical="top"
            editable={!isSubmitting}
          />

          <View className="flex-row gap-3 mt-5">
            <TouchableOpacity
              className="flex-1 py-3.5 rounded-xl items-center justify-center min-h-[48px]"
              style={{
                backgroundColor: theme.colors.backgroundTertiary,
                borderWidth: 1,
                borderColor: theme.colors.borderSubtle,
              }}
              onPress={handleClose}
              disabled={isSubmitting}
              activeOpacity={0.7}
            >
              <Text className="text-[15px] font-bold text-text-secondary">
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-1 py-3.5 rounded-xl items-center justify-center min-h-[48px]"
              style={{
                backgroundColor:
                  noteText.trim() && !isSubmitting
                    ? theme.colors.actionPrimary
                    : theme.colors.backgroundTertiary,
                shadowColor: theme.colors.actionPrimary,
                shadowOpacity: noteText.trim() && !isSubmitting ? 0.25 : 0,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 12,
                elevation: noteText.trim() && !isSubmitting ? 4 : 0,
              }}
              onPress={handleSubmit}
              disabled={!noteText.trim() || isSubmitting}
              activeOpacity={0.85}
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
