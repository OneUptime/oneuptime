import React from "react";
import { ActivityIndicator, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing, typography } from "../theme/tokens";
import { withAlpha } from "../utils/color";
import type { NoteItem } from "../api/types";
import QueryErrorNotice from "./QueryErrorNotice";
import MarkdownContent from "./MarkdownContent";
import GradientButton from "./GradientButton";
import { formatResponseTimestamp } from "./ResponseDetailLayout";
import { getInitials, toPlainText } from "../utils/text";

interface NotesSectionProps {
  notes: NoteItem[] | undefined;
  setNoteModalVisible: (visible: boolean) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => unknown;
}

const AVATAR_SIZE: number = 34;

export default function NotesSection({
  notes,
  setNoteModalVisible,
  isLoading = false,
  isError = false,
  onRetry,
}: NotesSectionProps): React.JSX.Element {
  const { theme } = useTheme();
  const surface: {
    borderRadius: number;
    backgroundColor: string;
    borderWidth: number;
    borderColor: string;
  } = {
    borderRadius: radius.lg,
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  };

  return (
    <View testID="notes-section" style={{ marginBottom: spacing.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <Ionicons
          name="chatbubbles-outline"
          size={18}
          color={theme.colors.textTertiary}
          style={{ width: 20, textAlign: "center" }}
        />
        <Text
          accessibilityRole="header"
          style={{
            ...typography.title3,
            flexShrink: 1,
            color: theme.colors.textPrimary,
          }}
        >
          Internal Notes
        </Text>
        {notes && notes.length > 0 ? (
          <View
            testID="notes-count"
            style={{
              minWidth: 24,
              paddingHorizontal: spacing.sm - 1,
              paddingVertical: 1,
              borderRadius: radius.pill,
              backgroundColor: theme.colors.backgroundTertiary,
              alignItems: "center",
            }}
          >
            <Text
              accessibilityLabel={`${notes.length} ${
                notes.length === 1 ? "note" : "notes"
              }`}
              style={{
                ...typography.caption,
                fontWeight: "700",
                color: theme.colors.textSecondary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {notes.length}
            </Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <GradientButton
          testID="add-note-button"
          label="Add Note"
          icon="add"
          variant="tonal"
          size="sm"
          style={{ minHeight: 44 }}
          onPress={() => {
            return setNoteModalVisible(true);
          }}
        />
      </View>

      {isLoading ? (
        <View
          testID="notes-loading"
          style={{
            ...surface,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            padding: spacing.lg,
            marginBottom: spacing.md,
          }}
        >
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
          <Text
            accessibilityLiveRegion="polite"
            style={{
              ...typography.subhead,
              color: theme.colors.textSecondary,
            }}
          >
            Loading notes…
          </Text>
        </View>
      ) : null}
      {isError && onRetry ? (
        <QueryErrorNotice
          message="Unable to load the latest notes. Your team's updates may be missing."
          retryLabel="Retry notes"
          onRetry={onRetry}
        />
      ) : null}

      {notes && notes.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          {notes.map((note: NoteItem, index: number) => {
            const noteText: string = toPlainText(note.note);
            const authorName: string = toPlainText(note.createdByUser?.name);
            const initials: string = note.createdByUser
              ? getInitials(authorName)
              : "";

            return (
              <View
                key={note._id || `${note.createdAt}-${index}`}
                testID="note-card"
                style={{
                  ...surface,
                  ...elevation("card", theme.dark),
                  padding: spacing.lg,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    marginBottom: spacing.sm,
                  }}
                >
                  <View
                    testID="note-avatar"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      width: AVATAR_SIZE,
                      height: AVATAR_SIZE,
                      borderRadius: AVATAR_SIZE / 2,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: initials
                        ? withAlpha(
                            theme.colors.actionPrimary,
                            theme.dark ? 0.22 : 0.12,
                          )
                        : theme.colors.backgroundTertiary,
                    }}
                  >
                    {initials ? (
                      <Text
                        testID="note-avatar-initials"
                        style={{
                          ...typography.footnote,
                          fontWeight: "700",
                          color: theme.colors.actionPrimary,
                        }}
                      >
                        {initials}
                      </Text>
                    ) : (
                      <Ionicons
                        name={
                          note.createdByUser
                            ? "person-outline"
                            : "sparkles-outline"
                        }
                        size={16}
                        color={theme.colors.textSecondary}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    {note.createdByUser ? (
                      <Text
                        numberOfLines={1}
                        style={{
                          ...typography.subhead,
                          fontWeight: "600",
                          color: theme.colors.textPrimary,
                        }}
                      >
                        {authorName}
                      </Text>
                    ) : null}
                    <Text
                      testID="note-time"
                      style={{
                        ...typography.footnote,
                        color: theme.colors.textTertiary,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {formatResponseTimestamp(note.createdAt)}
                    </Text>
                  </View>
                </View>
                <MarkdownContent content={noteText} />
              </View>
            );
          })}
        </View>
      ) : null}

      {notes && notes.length === 0 && !isLoading && !isError ? (
        <View
          testID="notes-empty"
          style={{
            ...surface,
            alignItems: "center",
            gap: spacing.xs,
            paddingVertical: spacing.xl,
            paddingHorizontal: spacing.lg,
          }}
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={24}
            color={theme.colors.textTertiary}
          />
          <Text
            style={{
              ...typography.subhead,
              fontWeight: "600",
              marginTop: spacing.xs,
              color: theme.colors.textSecondary,
            }}
          >
            No notes yet.
          </Text>
          <Text
            style={{
              ...typography.footnote,
              textAlign: "center",
              color: theme.colors.textTertiary,
            }}
          >
            Record what you tried so the next responder can pick up from here.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
