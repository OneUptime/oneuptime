import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import type { ProjectUserItem } from "../api/types";

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
  const [searchTerm, setSearchTerm] = useState<string>("");

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
      <View
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
            paddingBottom: 32,
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
              style={{ padding: 4 }}
            >
              <Ionicons
                name="close"
                size={20}
                color={theme.colors.textSecondary}
              />
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <TextInput
              testID="user-picker-search"
              placeholder="Search by name or email"
              placeholderTextColor={theme.colors.textTertiary}
              value={searchTerm}
              onChangeText={setSearchTerm}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                height: 44,
                borderRadius: 12,
                paddingHorizontal: 14,
                fontSize: 14,
                color: theme.colors.textPrimary,
                backgroundColor: theme.colors.backgroundTertiary,
                borderWidth: 1,
                borderColor: theme.colors.borderSubtle,
              }}
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
            <ScrollView style={{ paddingHorizontal: 20 }}>
              {visibleUsers.map((user: ProjectUserItem) => {
                const isSelected: boolean = user.userId === selectedUserId;

                return (
                  <Pressable
                    key={user.userId}
                    testID={`user-option-${user.userId}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${user.name || user.email}`}
                    onPress={() => {
                      onSelect(user);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
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
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: "600",
                          color: theme.colors.textPrimary,
                        }}
                        numberOfLines={1}
                      >
                        {user.name || user.email}
                      </Text>
                      {user.name && user.email ? (
                        <Text
                          style={{
                            fontSize: 12,
                            marginTop: 2,
                            color: theme.colors.textTertiary,
                          }}
                          numberOfLines={1}
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
      </View>
    </Modal>
  );
}
