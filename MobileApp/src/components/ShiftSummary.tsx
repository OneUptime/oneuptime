import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";

interface ShiftSummaryProps {
  name: string;
  layer?: string | null;
  timing: string;
  window: string | null;
  accent: string;
}

/** The shift's timing is easy to scan without squeezing the schedule title. */
export default function ShiftSummary({
  name,
  layer,
  timing,
  window,
  accent,
}: ShiftSummaryProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: accent,
          }}
        />
        <Text
          style={{
            fontSize: 13,
            lineHeight: 20,
            color: accent,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {timing}
        </Text>
      </View>
      <View style={{ gap: 3 }}>
        <Text
          style={{
            fontSize: 17,
            lineHeight: 24,
            fontWeight: "600",
            color: theme.colors.textPrimary,
            letterSpacing: -0.2,
          }}
        >
          {name}
        </Text>
        {layer ? (
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {layer}
          </Text>
        ) : null}
      </View>
      {window ? (
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}
        >
          <Ionicons
            name="time-outline"
            size={15}
            color={theme.colors.textSecondary}
            style={{ marginTop: 3 }}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {window}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
