import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { formatRelativeTime } from "../utils/date";
import type { OnCallPageItem } from "../api/types";
import { PASS_ON_TEXT } from "../oncall/passOn";
import { OBSERVER_PAGE_TEXT } from "../oncall/observerPage";
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

/*
 * What a page's badge says. Delivery completion never substitutes for a
 * responder's acknowledgement.
 *
 * An observer's page (oncall/observerPage.ts) was answered by saying they
 * had seen it - its record was not acknowledged by that - so it says Seen,
 * or Not seen yet, and never Acknowledged. Nothing is required of an
 * observer, so not seen yet is no warning.
 */
export function getPageStatus(page: OnCallPageItem): {
  label: string;
  tone: StatusTone;
} {
  const isAnswered: boolean = Boolean(page.acknowledgedAt);
  const isError: boolean = page.status === "Error";
  /*
   * They could not take it and escalated it: the policy paged its next
   * level, and nothing is waiting on them - not "Not acknowledged". The
   * server stores it as "Passed On"; it reads "Escalated".
   */
  const isPassedOn: boolean = page.status === PASS_ON_TEXT.passedOnStatus;

  if (isAnswered) {
    return {
      label: page.isObserverPage
        ? OBSERVER_PAGE_TEXT.seenStatus
        : "Acknowledged",
      tone: "success",
    };
  }

  if (isError) {
    return { label: "Failed to notify", tone: "danger" };
  }

  if (isPassedOn) {
    return { label: PASS_ON_TEXT.passedOnLabel, tone: "neutral" };
  }

  return page.isObserverPage
    ? { label: OBSERVER_PAGE_TEXT.notSeenStatus, tone: "info" }
    : { label: "Not acknowledged", tone: "warning" };
}

export default function OnCallPageCard({
  page,
  onPress,
}: OnCallPageCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const subject: PageSubject = getPageSubject(page);
  const status: { label: string; tone: StatusTone } = getPageStatus(page);
  const tone: StatusTone = status.tone;
  const toneColor: string = getToneColors(theme, tone).text;
  const statusLabel: string = status.label;
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
        isPressable
          ? `${subject.title}. ${
              page.isObserverPage ? `${OBSERVER_PAGE_TEXT.label}. ` : ""
            }${statusLabel}.`
          : undefined
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
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: spacing.xs + 2,
              }}
            >
              {page.isObserverPage ? (
                /*
                 * Kept informed while others respond: said first, in the
                 * server's words, before what came of it.
                 */
                <StatusPill
                  testID={`page-observer-${page._id}`}
                  label={OBSERVER_PAGE_TEXT.label}
                  tone="info"
                  size="sm"
                />
              ) : null}
              <StatusPill
                testID={`page-status-${page._id}`}
                label={statusLabel}
                tone={tone}
                size="sm"
                dotColor={toneColor}
              />
            </View>
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
              {page.policyName ||
                (page.isDirectPage
                  ? "Direct page"
                  : "On-call policy unavailable")}
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
