import React from "react";
import { StyleSheet } from "react-native";
import Markdown from "react-native-markdown-display";
import * as Linking from "expo-linking";
import { useTheme } from "../theme";

export interface MarkdownContentProps {
  content: string;
  variant?: "primary" | "secondary";
}

export default function MarkdownContent({
  content,
  variant = "primary",
}: MarkdownContentProps): React.JSX.Element {
  const { theme } = useTheme();
  const isSecondary: boolean = variant === "secondary";
  const textColor: string = isSecondary
    ? theme.colors.textSecondary
    : theme.colors.textPrimary;

  const markdownStyles = StyleSheet.create({
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
        void Linking.openURL(url);
        return false;
      }}
    >
      {content}
    </Markdown>
  );
}