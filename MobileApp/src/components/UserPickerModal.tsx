import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing, touchTarget } from "../theme/tokens";
import type { ProjectUserItem } from "../api/types";
import SearchField from "./SearchField";
import AppText from "./AppText";
import IconBadge from "./IconBadge";
import { getInitials } from "./RosterScheduleCard";
import { useScreenPadding } from "../hooks/useScreenPadding";
import getToggleAccessibilityProps from "../utils/getToggleAccessibilityProps";

interface UserPickerModalProps {
  visible: boolean;
  title: string;
  users: ProjectUserItem[];
  isLoading: boolean;
  selectedUserId: string | null;

  /*
   * Hidden from the list rather than shown-and-rejected. The server refuses an
   * override that routes a user's pages to themselves, and an option that only
   * ever produces an error is not an option.
   */
  excludeUserId?: string | null;

  onSelect: (user: ProjectUserItem) => void;
  onClose: () => void;
}

export function filterUsers(
  users: ProjectUserItem[],
  searchTerm: string,
  excludeUserId?: string | null,
): ProjectUserItem[] {
  const term: string = searchTerm.trim().toLowerCase();

  return users.filter((user: ProjectUserItem) => {
    if (excludeUserId && user.userId === excludeUserId) {
      return false;
    }

    if (!term) {
      return true;
    }

    return (
      user.name.toLowerCase().includes(term) ||
      user.email.toLowerCase().includes(term)
    );
  });
}

/*
 * Picking the colleague who takes your pages.
 *
 * Search is client-side over a list the app already holds: a responder handing
 * off at 2am should not be waiting on a round trip per keystroke, and a
 * project's member list is small enough that they never will.
 */
export default function UserPickerModal({
  visible,
  title,
  users,
  isLoading,
  selectedUserId,
  excludeUserId,
  onSelect,
  onClose,
}: UserPickerModalProps): React.JSX.Element {
  const { theme } = useTheme();
  const { colors } = theme;
  const paddingBottom: number = useScreenPadding({ tabBar: false });
  const [searchTerm, setSearchTerm] = useState<string>("");
  useEffect(() => {
    if (!visible) {
      setSearchTerm("");
    }
  }, [visible]);

  const visibleUsers: ProjectUserItem[] = useMemo(() => {
    return filterUsers(users, searchTerm, excludeUserId);
  }, [users, searchTerm, excludeUserId]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        testID="user-picker-overlay"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: colors.overlay,
        }}
      >
        <View
          testID="user-picker-sheet"
          style={{
            maxHeight: "85%",
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingTop: spacing.sm,
            paddingBottom,
            backgroundColor: colors.backgroundSecondary,
            borderTopWidth: 1,
            borderColor: colors.borderSubtle,
            ...elevation("overlay", theme.dark),
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 36,
              height: 5,
              borderRadius: radius.pill,
              backgroundColor: colors.borderDefault,
              marginBottom: spacing.sm,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: spacing.xl,
              marginBottom: spacing.sm,
            }}
          >
            <AppText
              accessibilityRole="header"
              variant="title3"
              style={{ flex: 1, minWidth: 0, marginRight: spacing.md }}
            >
              {title}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close user picker"
              onPress={onClose}
              style={{
                minWidth: touchTarget,
                minHeight: touchTarget,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.backgroundTertiary,
                }}
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </View>
            </Pressable>
          </View>

          <View
            style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.md }}
          >
            <SearchField
              testID="user-picker-search"
              placeholder="Search by name or email"
              value={searchTerm}
              onChangeText={setSearchTerm}
            />
          </View>

          {isLoading ? (
            <View
              testID="user-picker-loading"
              style={{
                paddingVertical: spacing.xxxl,
                alignItems: "center",
                gap: spacing.md,
              }}
            >
              <ActivityIndicator color={colors.actionPrimary} />
              <AppText variant="subhead" tone="secondary">
                Loading teammates…
              </AppText>
            </View>
          ) : visibleUsers.length === 0 ? (
            <View
              testID="user-picker-empty"
              style={{
                paddingVertical: spacing.xxxl,
                paddingHorizontal: spacing.xl,
                alignItems: "center",
                gap: spacing.md,
              }}
            >
              <IconBadge
                name={users.length === 0 ? "people-outline" : "search-outline"}
                color={colors.textSecondary}
                size="lg"
                shape="circle"
              />
              <AppText variant="subhead" tone="secondary" align="center">
                {users.length === 0
                  ? "No teammates found in this project."
                  : "No teammates match that search."}
              </AppText>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: spacing.xl,
                paddingBottom: spacing.lg,
              }}
            >
              <View
                testID="user-picker-list"
                style={{
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.borderSubtle,
                  backgroundColor: colors.backgroundElevated,
                  overflow: "hidden",
                }}
              >
                {visibleUsers.map((user: ProjectUserItem, index: number) => {
                  const isSelected: boolean = user.userId === selectedUserId;
                  const displayName: string = user.name || user.email;

                  return (
                    <Pressable
                      key={user.userId}
                      testID={`user-option-${user.userId}`}
                      accessibilityRole="button"
                      {...getToggleAccessibilityProps(isSelected)}
                      accessibilityLabel={`Select ${displayName}`}
                      accessibilityHint={
                        user.name && user.email ? user.email : undefined
                      }
                      onPress={() => {
                        onSelect(user);
                      }}
                      style={({ pressed }: { pressed: boolean }): ViewStyle => {
                        return {
                          flexDirection: "row",
                          alignItems: "center",
                          gap: spacing.md,
                          minHeight: 60,
                          paddingVertical: spacing.md,
                          paddingHorizontal: spacing.lg,
                          borderTopWidth: index > 0 ? 1 : 0,
                          borderTopColor: colors.borderSubtle,
                          backgroundColor: pressed
                            ? colors.backgroundTertiary
                            : isSelected
                              ? colors.cardAccent
                              : "transparent",
                        };
                      }}
                    >
                      <View
                        testID={`user-avatar-${user.userId}`}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: isSelected
                            ? colors.actionPrimary
                            : colors.cardAccent,
                        }}
                      >
                        <AppText
                          variant="subhead"
                          weight="700"
                          color={
                            isSelected
                              ? colors.textInverse
                              : colors.actionPrimary
                          }
                        >
                          {getInitials(displayName)}
                        </AppText>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <AppText
                          variant="callout"
                          weight="600"
                          numberOfLines={2}
                        >
                          {displayName}
                        </AppText>
                        {user.name && user.email ? (
                          <AppText
                            variant="footnote"
                            tone="secondary"
                            numberOfLines={2}
                            style={{ marginTop: spacing.xxs }}
                          >
                            {user.email}
                          </AppText>
                        ) : null}
                      </View>

                      {isSelected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={22}
                          color={colors.actionPrimary}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
