import React from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { elevation, radius, spacing, touchTarget } from "../theme/tokens";
import AppText from "./AppText";
import IconBadge from "./IconBadge";

interface ListGroupProps {
  title?: string;
  /** Short help text shown under the group. */
  footer?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * An inset, rounded group of rows with hairline separators - the settings-list
 * pattern people know from both iOS and Android.
 */
export function ListGroup({
  title,
  footer,
  children,
  style,
  testID,
}: ListGroupProps): React.JSX.Element {
  const { theme } = useTheme();
  const rows: React.ReactNode[] =
    React.Children.toArray(children).filter(Boolean);

  return (
    <View testID={testID} style={[{ gap: spacing.sm }, style]}>
      {title ? (
        <AppText
          variant="overline"
          tone="secondary"
          accessibilityRole="header"
          style={{ marginLeft: spacing.xs }}
        >
          {title}
        </AppText>
      ) : null}
      <View
        style={{
          borderRadius: radius.lg,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderSubtle,
          overflow: "hidden",
          ...elevation("card", theme.dark),
        }}
      >
        {rows.map((row: React.ReactNode, index: number) => {
          /*
           * Children.toArray gives every element a key from its original
           * slot, so a row keeps its identity (and its state) when a
           * conditional row before it is hidden. Keying by position instead
           * remounted every row after the one that disappeared.
           */
          const rowKey: React.Key =
            React.isValidElement(row) && row.key !== null ? row.key : index;
          return (
            <View
              key={rowKey}
              style={
                index > 0
                  ? {
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.borderSubtle,
                    }
                  : undefined
              }
            >
              {row}
            </View>
          );
        })}
      </View>
      {footer ? (
        <AppText
          variant="footnote"
          tone="secondary"
          style={{ marginHorizontal: spacing.xs }}
        >
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** A secondary value, e.g. the connected server address. */
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  trailing?: React.ReactNode;
  destructive?: boolean;
  onPress?: () => void;
  showChevron?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  selectableValue?: boolean;
  testID?: string;
}

/** One row inside a ListGroup. */
export function ListItem({
  title,
  subtitle,
  value,
  icon,
  iconColor,
  trailing,
  destructive = false,
  onPress,
  showChevron,
  accessibilityLabel,
  accessibilityHint,
  selectableValue,
  testID,
}: ListItemProps): React.JSX.Element {
  const { theme } = useTheme();
  const tint: string = destructive
    ? theme.colors.actionDestructive
    : iconColor ?? theme.colors.actionPrimary;
  const chevron: boolean = showChevron ?? Boolean(onPress && !trailing);

  const content: React.JSX.Element = (
    <View
      style={{
        minHeight: touchTarget + 12,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      {icon ? <IconBadge name={icon} color={tint} size="sm" /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText
          variant="headline"
          color={destructive ? theme.colors.actionDestructive : undefined}
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="footnote" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
        {value ? (
          <AppText
            variant="subhead"
            tone="secondary"
            selectable={selectableValue}
          >
            {value}
          </AppText>
        ) : null}
      </View>
      {trailing}
      {chevron ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={theme.colors.textTertiary}
        />
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View testID={testID} accessible={false}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint ?? subtitle}
      /*
       * The label replaces the row's text for screen readers, so without this
       * the current setting ("System", a server address) is never read out.
       */
      accessibilityValue={value ? { text: value } : undefined}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return {
          backgroundColor: pressed
            ? theme.colors.backgroundTertiary
            : "transparent",
        };
      }}
    >
      {content}
    </Pressable>
  );
}
