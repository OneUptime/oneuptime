import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.5)",
        }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={{
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: 36,
            backgroundColor: theme.isDark
              ? theme.colors.backgroundElevated
              : theme.colors.backgroundPrimary,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View
            style={{ alignItems: "center", paddingTop: 4, paddingBottom: 20 }}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 9999,
                backgroundColor: theme.colors.borderDefault,
              }}
            />
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
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
              style={{
                fontSize: 18,
                fontWeight: "bold",
                color: theme.colors.textPrimary,
                letterSpacing: -0.3,
              }}
            >
              Add Note
            </Text>
          </View>

          <TextInput
            style={{
              minHeight: 120,
              borderRadius: 12,
              padding: 16,
              fontSize: 15,
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

          <View
            style={{
              flexDirection: "row",
              gap: 12,
              marginTop: 20,
              alignItems: "center",
            }}
          >
            <Pressable
              style={({ pressed }: { pressed: boolean }) => {
                return {
                  flex: 1,
                  height: 50,
                  borderRadius: 12,
                  alignItems: "center" as const,
                  justifyContent: "center" as const,
                  borderWidth: 1,
                  borderColor: theme.colors.borderDefault,
                  opacity: pressed ? 0.7 : 1,
                };
              }}
              onPress={handleClose}
              disabled={isSubmitting}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: theme.colors.textSecondary,
                }}
              >
                Cancel
              </Text>
            </Pressable>

            <GradientButton
              label="Submit"
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={!noteText.trim() || isSubmitting}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
