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
        className="h-[52px] rounded-xl items-center justify-center overflow-hidden"
        style={[
          {
            backgroundColor: theme.colors.backgroundGlass,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
            opacity: disabled || loading ? 0.6 : 1,
          },
          style,
        ]}
        onPress={onPress}
        disabled={disabled || loading}
        activeOpacity={0.7}
      >
        <View className="flex-row items-center">
          {loading ? (
            <ActivityIndicator color={theme.colors.accentGradientStart} />
          ) : (
            <>
              {icon ? (
                <Ionicons
                  name={icon}
                  size={18}
                  color={theme.colors.accentGradientStart}
                  style={{ marginRight: 8 }}
                />
              ) : null}
              <Text
                className="text-[16px] font-bold"
                style={{ color: theme.colors.accentGradientStart }}
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
      className="h-[52px] rounded-xl overflow-hidden"
      style={[
        {
          opacity: disabled || loading ? 0.6 : 1,
          shadowColor: theme.colors.accentGradientStart,
          shadowOpacity: 0.4,
          shadowOffset: { width: 0, height: 6 },
          shadowRadius: 16,
          elevation: 6,
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
            <Text className="text-[16px] font-bold text-white">{label}</Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}
