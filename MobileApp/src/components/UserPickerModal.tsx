import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import type { ProjectUserItem } from "../api/types";
import SearchField from "./SearchField";
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
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
        }}
      >
        <View
          style={{
            maxHeight: "80%",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 20,
            paddingBottom,
            backgroundColor: theme.colors.backgroundElevated,
            borderTopWidth: 1,
            borderColor: theme.colors.borderGlass,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              marginBottom: 14,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                flex: 1,
                minWidth: 0,
                marginRight: 12,
                fontSize: 18,
                fontWeight: "bold",
                letterSpacing: -0.4,
                color: theme.colors.textPrimary,
              }}
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close user picker"
              onPress={onClose}
              style={{
                minWidth: 48,
                minHeight: 48,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="close"
                size={20}
                color={theme.colors.textSecondary}
              />
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <SearchField
              testID="user-picker-search"
              placeholder="Search by name or email"
              value={searchTerm}
              onChangeText={setSearchTerm}
            />
          </View>

          {isLoading ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator color={theme.colors.actionPrimary} />
            </View>
          ) : visibleUsers.length === 0 ? (
            <View style={{ paddingVertical: 40, paddingHorizontal: 20 }}>
              <Text
                style={{
                  fontSize: 14,
                  textAlign: "center",
                  color: theme.colors.textSecondary,
                }}
              >
                {users.length === 0
                  ? "No teammates found in this project."
                  : "No teammates match that search."}
              </Text>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ paddingHorizontal: 20 }}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {visibleUsers.map((user: ProjectUserItem) => {
                const isSelected: boolean = user.userId === selectedUserId;

                return (
                  <Pressable
                    key={user.userId}
                    testID={`user-option-${user.userId}`}
                    accessibilityRole="button"
                    {...getToggleAccessibilityProps(isSelected)}
                    accessibilityLabel={`Select ${user.name || user.email}`}
                    accessibilityHint={
                      user.name && user.email ? user.email : undefined
                    }
                    onPress={() => {
                      onSelect(user);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      minHeight: 56,
                      paddingVertical: 14,
                      paddingHorizontal: 14,
                      borderRadius: 14,
                      marginBottom: 8,
                      backgroundColor: isSelected
                        ? theme.colors.oncallActiveBg
                        : theme.colors.backgroundTertiary,
                      borderWidth: 1,
                      borderColor: isSelected
                        ? theme.colors.oncallActive + "55"
                        : theme.colors.borderSubtle,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={{
                          fontSize: 15,
                          lineHeight: 22,
                          fontWeight: "600",
                          color: theme.colors.textPrimary,
                        }}
                        numberOfLines={2}
                      >
                        {user.name || user.email}
                      </Text>
                      {user.name && user.email ? (
                        <Text
                          style={{
                            fontSize: 13,
                            lineHeight: 20,
                            marginTop: 2,
                            color: theme.colors.textTertiary,
                          }}
                          numberOfLines={2}
                        >
                          {user.email}
                        </Text>
                      ) : null}
                    </View>

                    {isSelected ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color={theme.colors.oncallActive}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
