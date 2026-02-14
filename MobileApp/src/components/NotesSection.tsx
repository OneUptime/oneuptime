import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { formatDateTime } from "../utils/date";
import { toPlainText } from "../utils/text";
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
  const addNoteContentColor: string = theme.isDark
    ? theme.colors.backgroundPrimary
    : "#FFFFFF";

  return (
    <View className="mb-2 mt-1">
      <View className="flex-row justify-between items-center mb-3.5">
        <View className="flex-row items-center">
          <Ionicons
            name="chatbubble-outline"
            size={14}
            color={theme.colors.textSecondary}
            style={{ marginRight: 6 }}
          />
          <Text
            className="text-[12px] font-semibold uppercase"
            style={{ color: theme.colors.textSecondary, letterSpacing: 1 }}
          >
            Internal Notes
          </Text>
        </View>
        <TouchableOpacity
          className="flex-row items-center rounded-lg px-3 py-1.5"
          style={{
            backgroundColor: theme.colors.actionPrimary,
          }}
          onPress={() => {
            return setNoteModalVisible(true);
          }}
          activeOpacity={0.85}
        >
          <Ionicons
            name="add"
            size={14}
            color={addNoteContentColor}
            style={{ marginRight: 4 }}
          />
          <Text
            className="text-[12px] font-semibold"
            style={{ color: addNoteContentColor }}
          >
            Add Note
          </Text>
        </TouchableOpacity>
      </View>

      {notes && notes.length > 0
        ? notes.map((note: NoteItem, index: number) => {
            const noteText: string = toPlainText(note.note);
            const authorName: string = toPlainText(note.createdByUser?.name);

            return (
              <View
                key={note._id || `${note.createdAt}-${index}`}
                className="rounded-2xl overflow-hidden mb-2.5"
                style={{
                  backgroundColor: theme.colors.backgroundElevated,
                  borderWidth: 1,
                  borderColor: theme.colors.borderGlass,
                  shadowColor: theme.isDark ? "#000" : theme.colors.accentGradientMid,
                  shadowOpacity: theme.isDark ? 0.16 : 0.06,
                  shadowOffset: { width: 0, height: 5 },
                  shadowRadius: 10,
                  elevation: 3,
                }}
              >
                <View className="p-4">
                  <Text
                    className="text-[14px] leading-[22px]"
                    style={{ color: theme.colors.textPrimary }}
                  >
                    {noteText}
                  </Text>
                  <View className="flex-row justify-between mt-2.5">
                    {note.createdByUser ? (
                      <Text
                        className="text-[12px]"
                        style={{ color: theme.colors.textTertiary }}
                      >
                        {authorName}
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
          className="rounded-2xl p-4 items-center"
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
