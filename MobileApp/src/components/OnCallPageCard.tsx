import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { formatRelativeTime } from "../utils/date";
import type { OnCallPageItem } from "../api/types";

interface OnCallPageCardProps {
  page: OnCallPageItem;
  onPress?: (page: OnCallPageItem) => void;
}

export interface PageSubject {
  title: string;
  kind: "incident" | "alert" | "incident-episode" | "alert-episode" | "unknown";
  id: string | null;
}

/**
 * What a page was about. A log row points at exactly one of four kinds of
 * resource, so this picks the one that is set rather than rendering four
 * mostly-empty fields.
 */
export function getPageSubject(page: OnCallPageItem): PageSubject {
  if (page.triggeredByIncident) {
    return {
      title: page.triggeredByIncident.title || "Incident",
      kind: "incident",
      id: page.triggeredByIncident._id ?? null,
    };
  }

  if (page.triggeredByAlert) {
    return {
      title: page.triggeredByAlert.title || "Alert",
      kind: "alert",
      id: page.triggeredByAlert._id ?? null,
    };
  }

  if (page.triggeredByIncidentEpisode) {
    return {
      title: page.triggeredByIncidentEpisode.title || "Incident episode",
      kind: "incident-episode",
      id: page.triggeredByIncidentEpisode._id ?? null,
    };
  }

  if (page.triggeredByAlertEpisode) {
    return {
      title: page.triggeredByAlertEpisode.title || "Alert episode",
      kind: "alert-episode",
      id: page.triggeredByAlertEpisode._id ?? null,
    };
  }

  return { title: "On-call notification", kind: "unknown", id: null };
}

/*
 * One page, and whether anything came of it.
 *
 * Acknowledgement is the headline, not the delivery status: "Completed" only
 * means the server finished running the notification rules, and a responder
 * reading "Completed" on a page nobody answered would draw exactly the wrong
 * conclusion. So an acknowledged page says Acknowledged, and an unacknowledged
 * one says so plainly whatever the execution status was.
 */
export default function OnCallPageCard({
  page,
  onPress,
}: OnCallPageCardProps): React.JSX.Element {
  const { theme } = useTheme();

  const subject: PageSubject = getPageSubject(page);
  const isAcknowledged: boolean = Boolean(page.acknowledgedAt);
  const isError: boolean = page.status === "Error";

  const accent: string = isAcknowledged
    ? theme.colors.oncallActive
    : isError
      ? theme.colors.severityCritical
      : theme.colors.severityWarning;

  const accentBackground: string = isAcknowledged
    ? theme.colors.oncallActiveBg
    : isError
      ? theme.colors.severityCriticalBg
      : theme.colors.severityWarningBg;

  const statusLabel: string = isAcknowledged
    ? "Acknowledged"
    : isError
      ? "Failed to notify"
      : "Not acknowledged";

  const iconName: keyof typeof Ionicons.glyphMap =
    subject.kind === "incident" || subject.kind === "incident-episode"
      ? "warning-outline"
      : subject.kind === "unknown"
        ? "notifications-outline"
        : "alert-circle-outline";

  const body: React.JSX.Element = (
    <View
      testID={`page-card-${page._id}`}
      style={{
        borderRadius: 18,
        padding: 16,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 10,
            backgroundColor: accentBackground,
          }}
        >
          <Ionicons name={iconName} size={15} color={accent} />
        </View>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "600",
              color: theme.colors.textPrimary,
            }}
            numberOfLines={2}
          >
            {subject.title}
          </Text>
          <Text
            style={{
              fontSize: 12,
              marginTop: 2,
              color: theme.colors.textTertiary,
            }}
            numberOfLines={1}
          >
            {page.policyName
              ? `${page.projectName} · ${page.policyName}`
              : page.projectName}
          </Text>
        </View>

        {onPress && subject.id ? (
          <Ionicons
            name="chevron-forward"
            size={14}
            color={theme.colors.textTertiary}
            style={{ marginLeft: 8 }}
          />
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 14,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: theme.colors.borderSubtle,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 9,
            paddingVertical: 4,
            borderRadius: 9999,
            backgroundColor: accentBackground,
          }}
        >
          <Ionicons
            name={
              isAcknowledged
                ? "checkmark-circle"
                : isError
                  ? "close-circle"
                  : "ellipse-outline"
            }
            size={11}
            color={accent}
          />
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              marginLeft: 5,
              color: accent,
            }}
          >
            {statusLabel}
          </Text>
        </View>

        <Text
          style={{
            fontSize: 12,
            color: theme.colors.textTertiary,
          }}
        >
          {page.createdAt ? formatRelativeTime(page.createdAt) : ""}
        </Text>
      </View>
    </View>
  );

  if (!onPress || !subject.id) {
    return body;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${subject.title}. ${statusLabel}.`}
      onPress={() => {
        onPress(page);
      }}
      style={({ pressed }: { pressed: boolean }) => {
        return { opacity: pressed ? 0.8 : 1 };
      }}
    >
      {body}
    </Pressable>
  );
}
