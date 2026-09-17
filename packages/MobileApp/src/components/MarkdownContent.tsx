import React, { useMemo, type ReactNode } from "react";
import {
  Alert,
  type ImageStyle,
  Platform,
  StyleSheet,
  Text,
  type TextStyle,
  TouchableHighlight,
} from "react-native";
import Markdown, {
  MarkedStyles,
  Renderer,
  RendererInterface,
  type MarkdownProps,
} from "react-native-marked";
import * as Linking from "expo-linking";
import { useTheme, type ColorTokens } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import { toPlainText } from "../utils/text";

type MarkedTheme = NonNullable<MarkdownProps["theme"]>;

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

  /*
   * Styles, theme and renderer are memoised: react-native-marked re-parses the
   * whole document whenever any of them changes identity, and a feed or a list
   * of notes renders one of these per entry.
   */
  const markdownStyles: MarkedStyles = useMemo((): MarkedStyles => {
    return createMarkdownStyles(theme.colors, isSecondary);
  }, [theme.colors, isSecondary]);

  /*
   * The library colours its own defaults (heading rules, code backgrounds,
   * table borders) from the DEVICE appearance. Handing it the app palette
   * keeps those in step with an explicit Light or Dark choice in Settings.
   */
  const markedTheme: MarkedTheme = useMemo((): MarkedTheme => {
    return {
      colors: {
        code: theme.colors.backgroundTertiary,
        link: theme.colors.actionPrimary,
        text: isSecondary
          ? theme.colors.textSecondary
          : theme.colors.textPrimary,
        border: theme.colors.borderSubtle,
      },
    };
  }, [theme.colors, isSecondary]);

  const renderer: OneUptimeMarkdownRenderer =
    useMemo((): OneUptimeMarkdownRenderer => {
      return new OneUptimeMarkdownRenderer({ selectable: true });
    }, []);

  return (
    <Markdown
      value={markdownText}
      styles={markdownStyles}
      theme={markedTheme}
      renderer={renderer}
      flatListProps={{
        scrollEnabled: false,
        style: { backgroundColor: "transparent" },
        contentContainerStyle: { margin: 0, padding: 0 },
      }}
    />
  );
}

const monospace: string =
  Platform.select({ ios: "Menlo", android: "monospace" }) ?? "monospace";

/**
 * Every text style the library knows about, from the shared type scale.
 *
 * The library's own defaults are 16/24 for bold, italic, links and list items
 * regardless of the paragraph around them, so each inline style restates the
 * body size; otherwise "**Acknowledged** by Ada" renders its first word a size
 * larger than the rest of the line.
 */
export function createMarkdownStyles(
  colors: ColorTokens,
  isSecondary: boolean,
): MarkedStyles {
  const textColor: string = isSecondary
    ? colors.textSecondary
    : colors.textPrimary;
  const body: TextStyle = isSecondary
    ? { ...typography.subhead, lineHeight: 21 }
    : { ...typography.callout, lineHeight: 22 };
  const heading: TextStyle = {
    color: colors.textPrimary,
    borderBottomWidth: 0,
    paddingBottom: 0,
    letterSpacing: 0,
  };

  return StyleSheet.create({
    text: {
      ...body,
      color: textColor,
    },
    paragraph: {
      paddingVertical: 0,
      marginVertical: spacing.xs,
    },
    /*
     * Without these, headings fell back to the renderer's defaults and a
     * "## Impact" line rendered as ordinary body text.
     */
    h1: {
      ...typography.title2,
      ...heading,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    h2: {
      ...typography.title3,
      ...heading,
      fontWeight: "700",
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    h3: {
      ...typography.headline,
      ...heading,
      marginTop: spacing.xs,
      marginBottom: spacing.xs,
    },
    h4: {
      ...typography.callout,
      ...heading,
      fontWeight: "600",
      marginTop: spacing.xs,
      marginBottom: spacing.xxs,
    },
    h5: {
      ...typography.subhead,
      ...heading,
      fontWeight: "600",
      marginTop: spacing.xs,
      marginBottom: spacing.xxs,
    },
    h6: {
      ...typography.footnote,
      ...heading,
      color: colors.textSecondary,
      fontWeight: "600",
      marginTop: spacing.xs,
      marginBottom: spacing.xxs,
    },
    hr: {
      borderBottomWidth: 0,
      backgroundColor: colors.borderSubtle,
      height: 1,
      marginVertical: spacing.md,
    },
    strong: {
      ...body,
      color: textColor,
      fontWeight: "700",
    },
    em: {
      ...body,
      color: textColor,
      fontStyle: "italic",
    },
    strikethrough: {
      ...body,
      color: textColor,
    },
    link: {
      ...body,
      color: colors.actionPrimary,
      fontStyle: "normal",
      fontWeight: "600",
      textDecorationLine: "underline",
    },
    /*
     * react-native-marked applies `list` only to each bullet's marker box, not
     * to the list. Any vertical margin here drops the "•" below the first line
     * of its item, where it reads as a full stop.
     */
    list: {
      paddingRight: spacing.xs,
    },
    li: {
      ...body,
      color: textColor,
      marginBottom: spacing.xs,
    },
    code: {
      backgroundColor: colors.backgroundTertiary,
      borderRadius: radius.sm,
      padding: spacing.md,
      marginVertical: spacing.xs,
    },
    codeText: {
      ...typography.footnote,
      fontFamily: monospace,
      color: textColor,
    },
    codespan: {
      ...body,
      fontFamily: monospace,
      fontSize: (body.fontSize ?? 15) - 1,
      fontStyle: "normal",
      fontWeight: "400",
      backgroundColor: colors.backgroundTertiary,
      color: textColor,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.borderDefault,
      paddingLeft: spacing.md,
      marginVertical: spacing.xs,
      opacity: 1,
    },
    table: {
      borderColor: colors.borderSubtle,
      borderRadius: radius.sm,
      marginVertical: spacing.xs,
    },
    tableCell: {
      padding: spacing.sm,
    },
  });
}
