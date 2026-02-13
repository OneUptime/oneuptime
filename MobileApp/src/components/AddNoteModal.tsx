import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import GradientButton from "./GradientButton";

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
          className="rounded-t-3xl p-5 pb-9"
          style={{
            backgroundColor: theme.isDark
              ? theme.colors.backgroundElevated
              : theme.colors.backgroundPrimary,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View className="items-center pt-1 pb-5">
            <View
              className="w-9 h-1 rounded-full"
              style={{ backgroundColor: theme.colors.borderDefault }}
            />
          </View>

          <View className="flex-row items-center mb-5">
            <View
              className="w-8 h-8 rounded-lg items-center justify-center mr-3"
              style={{
                backgroundColor: theme.colors.iconBackground,
              }}
            >
              <Ionicons
                name="chatbubble-outline"
                size={16}
                color={theme.colors.actionPrimary}
              />
            </View>
            <Text
              className="text-[18px] font-bold"
              style={{
                color: theme.colors.textPrimary,
                letterSpacing: -0.3,
              }}
            >
              Add Note
            </Text>
          </View>

          <TextInput
            className="min-h-[120px] rounded-xl p-4 text-[15px]"
            style={{
              backgroundColor: theme.colors.backgroundSecondary,
              borderWidth: 1,
              borderColor: theme.colors.borderDefault,
              color: theme.colors.textPrimary,
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
              className="flex-1 py-3 rounded-xl items-center justify-center min-h-[48px]"
              style={{
                borderWidth: 1,
                borderColor: theme.colors.borderDefault,
              }}
              onPress={handleClose}
              disabled={isSubmitting}
              activeOpacity={0.7}
            >
              <Text
                className="text-[15px] font-semibold"
                style={{ color: theme.colors.textSecondary }}
              >
                Cancel
              </Text>
            </TouchableOpacity>

            <View className="flex-1">
              <GradientButton
                label="Submit"
                onPress={handleSubmit}
                loading={isSubmitting}
                disabled={!noteText.trim() || isSubmitting}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
