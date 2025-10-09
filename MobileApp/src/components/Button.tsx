import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from "react-native";

interface ButtonProps {
  title: string;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  variant?: "primary" | "secondary";
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  disabled = false,
  loading = false,
  style,
  variant = "primary",
}: ButtonProps) => {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={() => {
        void onPress();
      }}
  style={({ pressed }: { pressed: boolean }) => [
        styles.base,
        variant === "secondary" ? styles.secondary : styles.primary,
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={styles.label}>{title}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  primary: {
    backgroundColor: "#2D63F7",
  },
  secondary: {
    backgroundColor: "#42526E",
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
