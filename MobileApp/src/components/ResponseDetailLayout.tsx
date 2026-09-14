import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTheme } from "../theme";
import SectionHeader from "./SectionHeader";

interface ResponseDetailHeaderProps {
  title: string;
  kind: string;
  number?: string;
  state?: string;
  stateColor: string;
  severity?: string;
}

export function ResponseDetailHeader({
  title,
  kind,
  number,
  state,
  stateColor,
  severity,
}: ResponseDetailHeaderProps): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ paddingTop: 4, marginBottom: 22, gap: 16 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Text
          style={{
            fontSize: 14,
            lineHeight: 21,
            fontWeight: "600",
            color: theme.colors.textSecondary,
          }}
        >
          {kind}
        </Text>
        {number ? (
          <Text
            style={{
              fontSize: 14,
              lineHeight: 21,
              color: theme.colors.textSecondary,
            }}
          >
            {number}
          </Text>
        ) : null}
      </View>
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 32,
          lineHeight: 39,
          letterSpacing: -1,
          fontWeight: "700",
          color: theme.colors.textPrimary,
        }}
      >
        {title}
      </Text>
      {state || severity ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
          }}
        >
          {state ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 7 }}
            >
              <View
                style={{
                  height: 8,
                  width: 8,
                  borderRadius: 4,
                  backgroundColor: stateColor,
                }}
              />
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 22,
                  fontWeight: "600",
                  color: theme.colors.textPrimary,
                }}
              >
                {state}
              </Text>
            </View>
          ) : null}
          {severity ? (
            <Text
              style={{
                fontSize: 15,
                lineHeight: 22,
                color: theme.colors.textSecondary,
              }}
            >
              {severity}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface ResponseAction {
  label: string;
  accessibilityLabel: string;
  busyAccessibilityLabel?: string;
  onPress: () => void | Promise<void>;
  primary?: boolean;
}

export function ResponseActions({
  actions,
  busy,
}: {
  actions: ResponseAction[];
  busy: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 28,
      }}
    >
      {actions.map((action: ResponseAction) => {
        return (
          <Pressable
            key={action.accessibilityLabel}
            onPress={action.onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={
              busy
                ? action.busyAccessibilityLabel ?? action.accessibilityLabel
                : action.accessibilityLabel
            }
            accessibilityState={{ disabled: busy, busy }}
            aria-disabled={busy}
            aria-busy={busy}
            style={({ pressed }: { pressed: boolean }) => {
              return {
                flex: 1,
                minWidth: 116,
                minHeight: 54,
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: 14,
                justifyContent: "center",
                alignItems: "center",
                borderWidth: action.primary ? 0 : 1,
                borderColor: theme.colors.borderDefault,
                backgroundColor: action.primary
                  ? pressed
                    ? theme.colors.actionPrimaryPressed
                    : theme.colors.actionPrimary
                  : theme.colors.backgroundElevated,
                opacity: busy ? 0.65 : 1,
              };
            }}
          >
            {busy ? (
              <ActivityIndicator
                size="small"
                color={
                  action.primary
                    ? theme.colors.textInverse
                    : theme.colors.textPrimary
                }
              />
            ) : (
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 22,
                  fontWeight: "600",
                  color: action.primary
                    ? theme.colors.textInverse
                    : theme.colors.textPrimary,
                }}
              >
                {action.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ResponseSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.borderSubtle,
        paddingTop: 24,
        marginBottom: 26,
      }}
    >
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

export function ResponseInfoRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.borderSubtle,
      }}
    >
      <Text
        style={{
          width: 82,
          flexShrink: 0,
          fontSize: 14,
          lineHeight: 22,
          color: theme.colors.textSecondary,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          fontSize: 14,
          lineHeight: 22,
          color: theme.colors.textPrimary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
