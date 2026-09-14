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

/** Delivery completion never substitutes for a responder's acknowledgement. */
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
  const statusLabel: string = isAcknowledged
    ? "Acknowledged"
    : isError
      ? "Failed to notify"
      : "Not acknowledged";
  const body: React.JSX.Element = (
    <View
      testID={`page-card-${page._id}`}
      style={{
        borderRadius: 18,
        padding: 18,
        backgroundColor: theme.colors.backgroundElevated,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 4,
            minHeight: 42,
            borderRadius: 2,
            backgroundColor: accent,
            marginTop: 3,
          }}
        />
        <View style={{ flex: 1, gap: 8 }}>
          <Text
            style={{
              fontSize: 17,
              lineHeight: 24,
              fontWeight: "600",
              letterSpacing: -0.2,
              color: theme.colors.textPrimary,
            }}
          >
            {subject.title}
          </Text>
          <Text
            style={{
              fontSize: 13,
              lineHeight: 20,
              color: theme.colors.textSecondary,
            }}
          >
            {page.policyName || "On-call policy unavailable"}
          </Text>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 2,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                lineHeight: 20,
                fontWeight: "600",
                color: accent,
              }}
            >
              {statusLabel}
            </Text>
            <Text
              style={{
                fontSize: 13,
                lineHeight: 20,
                color: theme.colors.textSecondary,
              }}
            >
              {page.createdAt ? formatRelativeTime(page.createdAt) : ""}
            </Text>
          </View>
        </View>
        {onPress && subject.id ? (
          <Ionicons
            name="chevron-forward"
            size={17}
            color={theme.colors.textTertiary}
            style={{ marginTop: 4 }}
          />
        ) : null}
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
      accessibilityHint={`Open ${subject.kind.replace("-", " ")} details`}
      onPress={(): void => {
        onPress(page);
      }}
      style={({ pressed }: { pressed: boolean }) => {
        return { opacity: pressed ? 0.75 : 1 };
      }}
    >
      {body}
    </Pressable>
  );
}
