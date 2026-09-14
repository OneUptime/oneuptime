import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import AppText from "./AppText";
import StatusPill, { getToneColors, type StatusTone } from "./StatusPill";

interface ShiftSummaryProps {
  name: string;
  layer?: string | null;
  timing: string;
  window: string | null;

  /* success: on now; info: coming up; neutral: over. */
  tone: StatusTone;
}

/** The shift's timing is easy to scan without squeezing the schedule title. */
export default function ShiftSummary({
  name,
  layer,
  timing,
  window,
  tone,
}: ShiftSummaryProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ gap: spacing.sm + 2 }}>
      <StatusPill
        label={timing}
        tone={tone}
        size="sm"
        dotColor={getToneColors(theme, tone).text}
      />
      <View style={{ gap: spacing.xxs }}>
        <AppText variant="headline" style={{ fontSize: 17, lineHeight: 23 }}>
          {name}
        </AppText>
        {layer ? (
          <AppText variant="subhead" tone="secondary">
            {layer}
          </AppText>
        ) : null}
      </View>
      {window ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: spacing.xs + 2,
          }}
        >
          <Ionicons
            name="time-outline"
            size={15}
            color={theme.colors.textTertiary}
            style={{ marginTop: 3 }}
          />
          <AppText variant="subhead" tone="secondary" style={{ flex: 1 }}>
            {window}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
