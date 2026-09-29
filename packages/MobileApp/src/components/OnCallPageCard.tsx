import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { formatRelativeTime } from "../utils/date";
import type { OnCallPageItem } from "../api/types";
import AppText from "./AppText";
import Card from "./Card";
import IconBadge from "./IconBadge";
import StatusPill, { getToneColors, type StatusTone } from "./StatusPill";

interface OnCallPageCardProps {
  page: OnCallPageItem;
  onPress?: (page: OnCallPageItem) => void;
}

export interface PageSubject {
  title: string;
  kind: "incident" | "alert" | "incident-episode" | "alert-episode" | "unknown";
  id: string | null;
}

const subjectIcons: Record<
  PageSubject["kind"],
  keyof typeof Ionicons.glyphMap
> = {
  incident: "warning-outline",
  alert: "notifications-outline",
  "incident-episode": "layers-outline",
  "alert-episode": "layers-outline",
  unknown: "call-outline",
};

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
  const tone: StatusTone = isAcknowledged
    ? "success"
    : isError
      ? "danger"
      : "warning";
  const toneColor: string = getToneColors(theme, tone).text;
  const statusLabel: string = isAcknowledged
    ? "Acknowledged"
    : isError
      ? "Failed to notify"
      : "Not acknowledged";
  const isPressable: boolean = Boolean(onPress && subject.id);

  return (
    <Card
      testID={`page-card-${page._id}`}
      onPress={
        isPressable && onPress
          ? (): void => {
              onPress(page);
            }
          : undefined
      }
      accessibilityLabel={
        isPressable ? `${subject.title}. ${statusLabel}.` : undefined
      }
      accessibilityHint={
        isPressable
          ? `Open ${subject.kind.replace("-", " ")} details`
          : undefined
      }
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.md,
        }}
      >
        <IconBadge name={subjectIcons[subject.kind]} color={toneColor} />
        <View style={{ flex: 1, gap: spacing.xs + 2 }}>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.sm,
            }}
          >
            <StatusPill
              testID={`page-status-${page._id}`}
              label={statusLabel}
              tone={tone}
              size="sm"
              dotColor={toneColor}
            />
            {page.createdAt ? (
              <AppText
                variant="caption"
                tone="tertiary"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {formatRelativeTime(page.createdAt)}
              </AppText>
            ) : null}
          </View>
          <AppText variant="headline" style={{ fontSize: 17, lineHeight: 23 }}>
            {subject.title}
          </AppText>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.xs + 2,
            }}
          >
            <Ionicons
              name="git-branch-outline"
              size={14}
              color={theme.colors.textTertiary}
              style={{ marginTop: 2 }}
            />
            <AppText variant="footnote" tone="secondary" style={{ flex: 1 }}>
              {page.policyName || "On-call policy unavailable"}
            </AppText>
          </View>
        </View>
        {isPressable ? (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={theme.colors.textTertiary}
            style={{ alignSelf: "center" }}
          />
        ) : null}
      </View>
    </Card>
  );
}
