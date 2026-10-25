import React, { useContext } from "react";
import { ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import AppText from "./AppText";
import IconBadge from "./IconBadge";

interface EmptyDetailPaneProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  testID?: string;
}

/**
 * The detail pane beside a list, before anything is opened in it.
 *
 * It says what state the pane is in - nothing selected - and how to fill it,
 * and nothing more: the list on the left is the next step, so the pane does
 * not compete with it for attention. The title describes the pane rather
 * than giving an order, so it stays true when the list beside it is empty.
 *
 * It sits under the pane's empty bar, which keeps it clear of the status
 * bar; it keeps clear of the window's other edges itself.
 */
export default function EmptyDetailPane({
  icon,
  title,
  message,
  testID = "detail-pane-empty",
}: EmptyDetailPaneProps): React.JSX.Element {
  const { theme } = useTheme();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);

  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingTop: spacing.xxl,
        paddingBottom: (insets?.bottom ?? 0) + spacing.xxl,
        paddingLeft: spacing.xxl + (insets?.left ?? 0),
        paddingRight: spacing.xxl + (insets?.right ?? 0),
      }}
    >
      <IconBadge
        name={icon}
        color={theme.colors.actionPrimary}
        size="lg"
        shape="circle"
      />
      <AppText
        accessibilityRole="header"
        variant="title3"
        align="center"
        style={{ marginTop: spacing.lg, maxWidth: 360 }}
      >
        {title}
      </AppText>
      <AppText
        variant="subhead"
        tone="secondary"
        align="center"
        style={{ marginTop: spacing.sm, maxWidth: 320 }}
      >
        {message}
      </AppText>
    </ScrollView>
  );
}
