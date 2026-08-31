import React from "react";
import { Alert, StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";
import * as Linking from "expo-linking";
import { useTheme } from "../theme";
import { toPlainText } from "../utils/text";

export interface MarkdownContentProps {
  content: unknown;
  variant?: "primary" | "secondary";
}

export default function MarkdownContent({
  content,
  variant = "primary",
}: MarkdownContentProps): React.JSX.Element {
  const { theme } = useTheme();
  const markdownText: string = toPlainText(content);
  const isSecondary: boolean = variant === "secondary";
  const textColor: string = isSecondary
    ? theme.colors.textSecondary
    : theme.colors.textPrimary;

  const markdownStyles: ReturnType<typeof StyleSheet.create> =
    StyleSheet.create({
      body: {
        color: textColor,
        margin: 0,
        padding: 0,
        fontSize: isSecondary ? 13 : 14,
        lineHeight: 22,
      },
      text: {
        color: textColor,
        fontSize: isSecondary ? 13 : 14,
        lineHeight: 22,
      },
      paragraph: {
        marginTop: 0,
        marginBottom: 8,
        color: textColor,
      },
      strong: {
        color: textColor,
        fontWeight: "700",
      },
      em: {
        color: textColor,
        fontStyle: "italic",
      },
      link: {
        color: theme.colors.actionPrimary,
        textDecorationLine: "underline",
      },
      bullet_list: {
        marginTop: 0,
        marginBottom: 8,
      },
      ordered_list: {
        marginTop: 0,
        marginBottom: 8,
      },
      list_item: {
        color: textColor,
        marginBottom: 4,
      },
      fence: {
        backgroundColor: theme.colors.backgroundSecondary,
        color: textColor,
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
      },
      code_inline: {
        backgroundColor: theme.colors.backgroundSecondary,
        color: textColor,
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
      },
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.borderDefault,
        paddingLeft: 10,
        marginBottom: 8,
      },
    });

  return (
    <Markdown
      style={markdownStyles}
      onLinkPress={(url: string): boolean => {
        /*
         * openURL rejects whenever nothing on the handset claims the scheme -
         * an http link on a device with no browser set, a mailto: with no mail
         * app, a deep link into an app that is not installed. Discarding that
         * rejection makes the tap a silent no-op: the responder taps the
         * runbook link in a feed item, nothing happens, and they are left
         * unsure whether they missed the link or the app is wedged. Say so
         * instead, so they know to open it elsewhere.
         */
        Linking.openURL(url).catch(() => {
          Alert.alert(
            "Could not open link",
            "Nothing on this device could open that link.",
          );
        });

        /*
         * false keeps react-native-markdown-display from opening the URL a
         * second time with its own copy of Linking.
         */
        return false;
      }}
    >
      {markdownText}
    </Markdown>
  );
}
