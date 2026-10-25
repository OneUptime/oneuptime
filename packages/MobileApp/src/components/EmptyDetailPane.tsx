import React, { useContext } from "react";
import { ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import AppText from "./AppText";
import GradientButton from "./GradientButton";
import IconBadge from "./IconBadge";

export interface EmptyDetailShortcut {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  testID?: string;
}

interface EmptyDetailPaneProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  /** A few places to go next, when the list beside it is a menu rather than records. */
  shortcuts?: Array<EmptyDetailShortcut>;
  testID?: string;
}

/**
 * The detail pane beside a list, before anything is opened in it.
 *
 * It says what will appear here and nothing more: the list on the left is
 * the next step, so the pane does not compete with it for attention.
 */
export default function EmptyDetailPane({
  icon,
  title,
  message,
  shortcuts,
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
        paddingTop: (insets?.top ?? 0) + spacing.xxl,
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
      {shortcuts && shortcuts.length > 0 ? (
        <View
          style={{
            marginTop: spacing.xl,
            gap: spacing.sm,
            width: "100%",
            maxWidth: 280,
          }}
        >
          {shortcuts.map((shortcut: EmptyDetailShortcut): React.JSX.Element => {
            return (
              <GradientButton
                key={shortcut.label}
                testID={shortcut.testID}
                label={shortcut.label}
                icon={shortcut.icon}
                variant="tonal"
                onPress={shortcut.onPress}
              />
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}
