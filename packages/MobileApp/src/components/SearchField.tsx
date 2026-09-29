import React, { useRef, useState, type RefObject } from "react";
import { View, TextInput, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";

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
        minHeight: 48,
        borderRadius: radius.md,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: focused ? 2 : 1,
        borderColor: focused
          ? theme.colors.actionPrimary
          : theme.colors.borderDefault,
        paddingLeft: focused ? spacing.md - 1 : spacing.md,
      }}
    >
      <Ionicons
        name="search"
        size={18}
        color={focused ? theme.colors.actionPrimary : theme.colors.textTertiary}
      />
      <TextInput
        ref={inputRef}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        keyboardAppearance={theme.dark ? "dark" : "light"}
        selectionColor={theme.colors.actionPrimary}
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
          ...typography.callout,
          flex: 1,
          minWidth: 0,
          color: theme.colors.textPrimary,
          paddingHorizontal: spacing.sm + 2,
          paddingVertical: spacing.md,
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
            minWidth: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="close-circle"
            size={18}
            color={theme.colors.textTertiary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
