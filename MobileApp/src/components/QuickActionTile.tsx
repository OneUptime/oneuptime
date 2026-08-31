import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";

interface QuickActionTileProps {
  label: string;
  sublabel?: string;
  iconName: keyof typeof Ionicons.glyphMap;
  accentColor?: string;
  onPress: () => void;
  testID?: string;
}

/*
 * A one-tap route out of the on-call tab.
 *
 * These sit above the fold on purpose: the two things a responder does from a
 * phone are "find out who else is on" and "get someone to cover me", and both
 * of them are urgent by definition. Burying either behind a scroll makes the
 * screen a dashboard instead of a tool.
 */
export default function QuickActionTile({
  label,
  sublabel,
  iconName,
  accentColor,
  onPress,
  testID,
}: QuickActionTileProps): React.JSX.Element {
  const { theme } = useTheme();
  const { lightImpact } = useHaptics();

  const accent: string = accentColor ?? theme.colors.actionPrimary;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
      onPress={() => {
        lightImpact();
        onPress();
      }}
      style={({ pressed }: { pressed: boolean }) => {
        return {
          flex: 1,
          opacity: pressed ? 0.8 : 1,
        };
      }}
    >
      <View
        style={{
          borderRadius: 18,
          padding: 14,
          minHeight: 108,
          justifyContent: "space-between",
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: accent + "1F",
          }}
        >
          <Ionicons name={iconName} size={16} color={accent} />
        </View>

        <View style={{ marginTop: 12 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: "700",
              color: theme.colors.textPrimary,
            }}
            numberOfLines={1}
          >
            {label}
          </Text>
          {sublabel ? (
            <Text
              style={{
                fontSize: 11,
                marginTop: 2,
                color: theme.colors.textTertiary,
              }}
              numberOfLines={2}
            >
              {sublabel}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
