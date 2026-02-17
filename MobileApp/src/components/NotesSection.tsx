import React from "react";
import { View, Text, Pressable } from "react-native";
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
    <View style={{ marginBottom: 8, marginTop: 4 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Ionicons
            name="chatbubble-outline"
            size={14}
            color={theme.colors.textSecondary}
            style={{ marginRight: 6 }}
          />
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              color: theme.colors.textSecondary,
              letterSpacing: 1,
            }}
          >
            Internal Notes
          </Text>
        </View>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => {
            return {
              flexDirection: "row" as const,
              alignItems: "center" as const,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 6,
              backgroundColor: theme.colors.actionPrimary,
              opacity: pressed ? 0.85 : 1,
            };
          }}
          onPress={() => {
            return setNoteModalVisible(true);
          }}
        >
          <Ionicons
            name="add"
            size={14}
            color={addNoteContentColor}
            style={{ marginRight: 4 }}
          />
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: addNoteContentColor,
            }}
          >
            Add Note
          </Text>
        </Pressable>
      </View>

      {notes && notes.length > 0
        ? notes.map((note: NoteItem, index: number) => {
            const noteText: string = toPlainText(note.note);
            const authorName: string = toPlainText(note.createdByUser?.name);

            return (
              <View
                key={note._id || `${note.createdAt}-${index}`}
                style={{
                  borderRadius: 16,
                  overflow: "hidden",
                  marginBottom: 10,
                  backgroundColor: theme.colors.backgroundElevated,
                  borderWidth: 1,
                  borderColor: theme.colors.borderGlass,
                  shadowColor: theme.isDark
                    ? "#000"
                    : theme.colors.accentGradientMid,
                  shadowOpacity: theme.isDark ? 0.16 : 0.06,
                  shadowOffset: { width: 0, height: 5 },
                  shadowRadius: 10,
                  elevation: 3,
                }}
              >
                <View style={{ padding: 16 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      lineHeight: 22,
                      color: theme.colors.textPrimary,
                    }}
                  >
                    {noteText}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginTop: 10,
                    }}
                  >
                    {note.createdByUser ? (
                      <Text
                        style={{
                          fontSize: 12,
                          color: theme.colors.textTertiary,
                        }}
                      >
                        {authorName}
                      </Text>
                    ) : null}
                    <Text
                      style={{
                        fontSize: 12,
                        color: theme.colors.textTertiary,
                      }}
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
          style={{
            borderRadius: 16,
            padding: 16,
            alignItems: "center",
            backgroundColor: theme.colors.backgroundElevated,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              color: theme.colors.textTertiary,
            }}
          >
            No notes yet.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
