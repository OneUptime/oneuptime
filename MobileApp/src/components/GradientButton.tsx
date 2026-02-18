import React from "react";
import {
  Text,
  ActivityIndicator,
  Pressable,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

interface GradientButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary";
  style?: ViewStyle;
}

export default function GradientButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon,
  variant = "primary",
  style,
}: GradientButtonProps): React.JSX.Element {
  const { theme } = useTheme();
  const primaryContentColor: string = theme.colors.backgroundPrimary;

  const isDisabled: boolean = disabled || loading;

  if (variant === "secondary") {
    return (
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        style={[
          {
            height: 50,
            borderRadius: 12,
            alignItems: "center" as const,
            justifyContent: "center" as const,
            overflow: "hidden" as const,
            backgroundColor: "transparent",
            borderWidth: 1,
            borderColor: theme.colors.borderDefault,
            opacity: isDisabled ? 0.5 : 1,
          },
          style,
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {loading ? (
            <ActivityIndicator color={theme.colors.textSecondary} />
          ) : (
            <>
              {icon ? (
                <Ionicons
                  name={icon}
                  size={18}
                  color={theme.colors.textSecondary}
                  style={{ marginRight: 8 }}
                />
              ) : null}
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: theme.colors.textSecondary,
                }}
              >
                {label}
              </Text>
            </>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={[
        {
          height: 50,
          borderRadius: 12,
          overflow: "hidden" as const,
          alignItems: "center" as const,
          justifyContent: "center" as const,
          flexDirection: "row" as const,
          backgroundColor: theme.colors.actionPrimary,
          opacity: isDisabled ? 0.5 : 1,
          shadowColor: theme.colors.actionPrimary,
          shadowOpacity: 0.3,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 12,
          elevation: 4,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primaryContentColor} />
      ) : (
        <>
          {icon ? (
            <Ionicons
              name={icon}
              size={18}
              color={primaryContentColor}
              style={{ marginRight: 8 }}
            />
          ) : null}
          <Text
            style={{
              fontSize: 15,
              fontWeight: "bold",
              color: primaryContentColor,
              letterSpacing: 0.2,
            }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
