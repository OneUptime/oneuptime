import React, { type ReactNode } from "react";
import {
  Alert,
  type ImageStyle,
  StyleSheet,
  Text,
  type TextStyle,
  TouchableHighlight,
} from "react-native";
import Markdown, {
  MarkedStyles,
  Renderer,
  RendererInterface,
} from "react-native-marked";
import * as Linking from "expo-linking";
import { useTheme } from "../theme";
import { toPlainText } from "../utils/text";

export interface MarkdownContentProps {
  content: unknown;
  variant?: "primary" | "secondary";
}

class OneUptimeMarkdownRenderer extends Renderer implements RendererInterface {
  private openLink(href: string): void {
    /*
     * openURL rejects whenever nothing on the handset claims the scheme.
     * Surface that failure rather than leaving an incident responder tapping
     * a runbook link that appears to do nothing.
     */
    void Linking.openURL(href).catch((): void => {
      Alert.alert(
        "Could not open link",
        "Nothing on this device could open that link.",
      );
    });
  }

  public link(
    children: string | Array<ReactNode>,
    href: string,
    styles?: TextStyle,
    title?: string,
  ): ReactNode {
    return (
      <Text
        selectable={true}
        accessibilityRole="link"
        accessibilityHint="Opens in a new window"
        accessibilityLabel={title || undefined}
        key={this.getKey()}
        onPress={(): void => {
          this.openLink(href);
        }}
        style={styles}
      >
        {children}
      </Text>
    );
  }

  public linkImage(
    href: string,
    imageUrl: string,
    alt?: string,
    style?: ImageStyle,
    title?: string | null,
  ): ReactNode {
    return (
      <TouchableHighlight
        accessibilityRole="link"
        accessibilityHint="Opens in a new window"
        accessibilityLabel={alt || title || undefined}
        key={this.getKey()}
        onPress={(): void => {
          this.openLink(href);
        }}
      >
        {this.image(imageUrl, alt, style, title || undefined)}
      </TouchableHighlight>
    );
  }
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

  const markdownStyles: MarkedStyles = StyleSheet.create({
    text: {
      color: textColor,
      fontSize: isSecondary ? 13 : 14,
      lineHeight: 22,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
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
    list: {
      marginTop: 0,
      marginBottom: 8,
    },
    li: {
      color: textColor,
      marginBottom: 4,
    },
    code: {
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
    },
    codeText: {
      color: textColor,
    },
    codespan: {
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
      value={markdownText}
      styles={markdownStyles}
      renderer={new OneUptimeMarkdownRenderer({ selectable: true })}
      flatListProps={{
        scrollEnabled: false,
        style: { backgroundColor: "transparent" },
        contentContainerStyle: { margin: 0, padding: 0 },
      }}
    />
  );
}
