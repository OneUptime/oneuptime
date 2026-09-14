import React, { useRef, useState, type RefObject } from "react";
import { View, TextInput, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  testID?: string;
}

export default function SearchField({
  value,
  onChangeText,
  placeholder = "Search",
  accessibilityLabel,
  testID,
}: SearchFieldProps): React.JSX.Element {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const inputRef: RefObject<TextInput | null> = useRef<TextInput>(null);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 52,
        borderRadius: 12,
        backgroundColor: theme.colors.backgroundSecondary,
        borderWidth: 1,
        borderColor: focused
          ? theme.colors.actionPrimary
          : theme.colors.borderSubtle,
      }}
    >
      <Ionicons
        name="search-outline"
        size={20}
        color={theme.colors.textSecondary}
        style={{ marginLeft: 16 }}
      />
      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          color: theme.colors.textPrimary,
          paddingHorizontal: 12,
          paddingVertical: 14,
        }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => {
            onChangeText("");
            inputRef.current?.focus();
          }}
          hitSlop={4}
          style={{
            minWidth: 48,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="close-circle"
            size={20}
            color={theme.colors.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
