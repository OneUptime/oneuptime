import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { formatDateTime } from "../utils/date";
import GlassCard from "./GlassCard";
import type { NoteItem } from "../api/types";

interface NotesSectionProps {
  notes: NoteItem[] | undefined;
  noteModalVisible: boolean;
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
            size={15}
            color={theme.colors.textSecondary}
            style={{ marginRight: 6 }}
          />
          <Text className="text-[13px] font-semibold uppercase tracking-wide text-text-secondary">
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
            className="flex-row items-center px-3.5 py-2"
          >
            <Ionicons
              name="add"
              size={16}
              color="#FFFFFF"
              style={{ marginRight: 4 }}
            />
            <Text className="text-[13px] font-semibold text-white">
              Add Note
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {notes && notes.length > 0
        ? notes.map((note: NoteItem) => {
            return (
              <GlassCard
                key={note._id}
                style={{
                  marginBottom: 10,
                  borderTopWidth: 2,
                  borderTopColor: theme.colors.accentGradientStart + "30",
                }}
              >
                <View className="p-4">
                  <Text className="text-body-md text-text-primary leading-6">
                    {note.note}
                  </Text>
                  <View className="flex-row justify-between mt-2.5">
                    {note.createdByUser ? (
                      <Text className="text-body-sm text-text-tertiary">
                        {note.createdByUser.name}
                      </Text>
                    ) : null}
                    <Text className="text-body-sm text-text-tertiary">
                      {formatDateTime(note.createdAt)}
                    </Text>
                  </View>
                </View>
              </GlassCard>
            );
          })
        : null}

      {notes && notes.length === 0 ? (
        <GlassCard>
          <View className="p-4 items-center">
            <Text className="text-body-sm text-text-tertiary">
              No notes yet.
            </Text>
          </View>
        </GlassCard>
      ) : null}
    </View>
  );
}
