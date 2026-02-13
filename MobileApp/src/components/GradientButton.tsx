import React from "react";
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  View,
  ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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

  if (variant === "secondary") {
    return (
      <TouchableOpacity
        className="h-[50px] rounded-xl items-center justify-center overflow-hidden"
        style={[
          {
            backgroundColor: "transparent",
            borderWidth: 1,
            borderColor: theme.colors.borderDefault,
            opacity: disabled || loading ? 0.5 : 1,
          },
          style,
        ]}
        onPress={onPress}
        disabled={disabled || loading}
        activeOpacity={0.7}
      >
        <View className="flex-row items-center">
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
                className="text-[15px] font-semibold"
                style={{ color: theme.colors.textSecondary }}
              >
                {label}
              </Text>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      className="h-[50px] rounded-xl overflow-hidden"
      style={[
        {
          opacity: disabled || loading ? 0.5 : 1,
          shadowColor: theme.colors.accentGradientMid,
          shadowOpacity: 0.3,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 12,
          elevation: 4,
        },
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={[
          theme.colors.accentGradientStart,
          theme.colors.accentGradientEnd,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-1 items-center justify-center flex-row"
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            {icon ? (
              <Ionicons
                name={icon}
                size={18}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
            ) : null}
            <Text
              className="text-[15px] font-bold"
              style={{ color: "#FFFFFF", letterSpacing: 0.2 }}
            >
              {label}
            </Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}
