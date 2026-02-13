import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { formatDateTime } from "../utils/date";
import type { NoteItem } from "../api/types";

interface NotesSectionProps {
  notes: NoteItem[] | undefined;
  setNoteModalVisible: (visible: boolean) => void;
}

export default function NotesSection({
  notes,
  setNoteModalVisible,
}: NotesSectionProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View className="mb-2">
      <View className="flex-row justify-between items-center mb-3">
        <View className="flex-row items-center">
          <Ionicons
            name="chatbubble-outline"
            size={14}
            color={theme.colors.textTertiary}
            style={{ marginRight: 6 }}
          />
          <Text
            className="text-[12px] font-semibold uppercase"
            style={{ color: theme.colors.textTertiary, letterSpacing: 0.8 }}
          >
            Internal Notes
          </Text>
        </View>
        <TouchableOpacity
          className="flex-row items-center rounded-lg overflow-hidden"
          onPress={() => {
            return setNoteModalVisible(true);
          }}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[
              theme.colors.accentGradientStart,
              theme.colors.accentGradientEnd,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="flex-row items-center px-3 py-1.5"
          >
            <Ionicons
              name="add"
              size={14}
              color="#FFFFFF"
              style={{ marginRight: 4 }}
            />
            <Text
              className="text-[12px] font-semibold"
              style={{ color: "#FFFFFF" }}
            >
              Add Note
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {notes && notes.length > 0
        ? notes.map((note: NoteItem) => {
            return (
              <View
                key={note._id}
                className="rounded-xl overflow-hidden mb-2.5"
                style={{
                  backgroundColor: theme.colors.backgroundElevated,
                  borderWidth: 1,
                  borderColor: theme.colors.borderGlass,
                }}
              >
                <View className="p-4">
                  <Text
                    className="text-[14px] leading-[22px]"
                    style={{ color: theme.colors.textPrimary }}
                  >
                    {note.note}
                  </Text>
                  <View className="flex-row justify-between mt-2.5">
                    {note.createdByUser ? (
                      <Text
                        className="text-[12px]"
                        style={{ color: theme.colors.textTertiary }}
                      >
                        {note.createdByUser.name}
                      </Text>
                    ) : null}
                    <Text
                      className="text-[12px]"
                      style={{ color: theme.colors.textTertiary }}
                    >
                      {formatDateTime(note.createdAt)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        : null}

      {notes && notes.length === 0 ? (
        <View
          className="rounded-xl p-4 items-center"
          style={{
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Text
            className="text-[13px]"
            style={{ color: theme.colors.textTertiary }}
          >
            No notes yet.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
