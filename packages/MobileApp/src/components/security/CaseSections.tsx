import React, { useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import { spacing, typography } from "../../theme/tokens";
import { formatRelativeTime } from "../../utils/date";
import { rgbToHex } from "../../utils/color";
import { toPlainText } from "../../utils/text";
import Banner from "../Banner";
import GradientButton from "../GradientButton";
import MarkdownContent from "../MarkdownContent";
import StatusPill, { type StatusTone } from "../StatusPill";
import { ResponseSection } from "../ResponseDetailLayout";
import {
  getAiVerdictTerm,
  getEntityTerm,
  splitTriageReport,
  type SecurityCaseAiVerdictTerm,
  type SecurityEntity,
  type TriageReportParts,
} from "../../security/caseTerms";
import type { SecurityCasePriorityItem } from "../../api/types";

/*
 * The parts of a case's screen that are a case's own: what OneUptime AI made
 * of it, what it is about, and the facts that can be changed from here.
 */

// The most entities the case's screen lists; the rest are counted.
export const CASE_ENTITY_LIMIT: number = 12;

interface CaseAiSectionProps {
  aiVerdict: string | null | undefined;
  report: string | null | undefined;
  triagedAt: string | null | undefined;
  promptInjectionSuspected: boolean;
  // The priority OneUptime AI suggested, when the project has it and the case is at another.
  suggestedPriority?: SecurityCasePriorityItem | null;
  busy: boolean;
  onSetSuggestedPriority: () => void;
}

const AI_TONES: Record<SecurityCaseAiVerdictTerm["tone"], StatusTone> = {
  danger: "danger",
  warning: "warning",
  success: "success",
  neutral: "neutral",
};

/**
 * OneUptime AI's triage, as the analyst reads it before deciding: its read
 * of the case in a word, a warning when the case's data tried to steer it,
 * what it found - the report's own Summary, two sentences written to be read
 * in five seconds, or the read's meaning when the report has none to lift -
 * the priority it suggests as one tap, and the rest of the report folded
 * under it. A suggestion only: a person sets the verdict and the priority.
 */
export function CaseAiSection({
  aiVerdict,
  report,
  triagedAt,
  promptInjectionSuspected,
  suggestedPriority,
  busy,
  onSetSuggestedPriority,
}: CaseAiSectionProps): React.JSX.Element {
  const { theme } = useTheme();
  const [showReport, setShowReport] = useState<boolean>(false);
  const term: SecurityCaseAiVerdictTerm | undefined =
    getAiVerdictTerm(aiVerdict);
  const parts: TriageReportParts = splitTriageReport(report);
  const summary: string = parts.summary;
  // What the fold holds: the rest of the report, or all of it with no summary.
  const folded: string = parts.rest;
  const triaged: boolean = Boolean(term) || Boolean(summary) || Boolean(folded);
  const triagedWhen: string = triagedAt ? formatRelativeTime(triagedAt) : "";

  return (
    <ResponseSection
      title="OneUptime AI"
      iconName="sparkles-outline"
      testID="case-ai-section"
    >
      {!triaged ? (
        <Text
          testID="case-ai-not-triaged"
          style={{
            ...typography.subhead,
            color: theme.colors.textTertiary,
          }}
        >
          OneUptime AI has not triaged this case.
        </Text>
      ) : (
        <View style={{ gap: spacing.md }}>
          {term ? (
            <View style={{ gap: spacing.xs }}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                <StatusPill
                  testID="case-ai-verdict"
                  label={term.verdict}
                  tone={AI_TONES[term.tone]}
                />
                {triagedWhen && triagedWhen !== "—" ? (
                  <Text
                    style={{
                      ...typography.footnote,
                      color: theme.colors.textTertiary,
                    }}
                  >
                    {`Triaged ${triagedWhen}`}
                  </Text>
                ) : null}
              </View>
              {summary ? null : (
                <Text
                  testID="case-ai-verdict-description"
                  style={{
                    ...typography.subhead,
                    color: theme.colors.textSecondary,
                  }}
                >
                  {term.description}
                </Text>
              )}
            </View>
          ) : null}
          {promptInjectionSuspected ? (
            <Banner
              testID="case-ai-injection-warning"
              tone="warning"
              icon="warning-outline"
              title="Text in this case reads like instructions to an AI"
              message="OneUptime AI treated it as data and leaves the call to you."
            />
          ) : null}
          {summary ? (
            <View testID="case-ai-summary">
              <MarkdownContent content={summary} />
            </View>
          ) : null}
          {suggestedPriority ? (
            <View
              testID="case-ai-suggested-priority"
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              <Ionicons
                name="flag"
                size={14}
                color={
                  suggestedPriority.color
                    ? rgbToHex(suggestedPriority.color)
                    : theme.colors.textSecondary
                }
              />
              <Text
                style={{
                  ...typography.subhead,
                  flex: 1,
                  minWidth: 160,
                  color: theme.colors.textPrimary,
                }}
              >
                {`Suggests ${toPlainText(suggestedPriority.name)} priority`}
              </Text>
              <GradientButton
                testID="case-ai-set-priority"
                label={`Set to ${toPlainText(suggestedPriority.name)}`}
                variant="tonal"
                size="sm"
                disabled={busy}
                onPress={onSetSuggestedPriority}
                style={{ minHeight: 44 }}
              />
            </View>
          ) : null}
          {folded ? (
            <View style={{ gap: spacing.sm }}>
              <Pressable
                testID="case-ai-report-toggle"
                accessibilityRole="button"
                accessibilityState={{ expanded: showReport }}
                aria-expanded={showReport}
                onPress={(): void => {
                  setShowReport(!showReport);
                }}
                hitSlop={6}
                style={({ pressed }: { pressed: boolean }): ViewStyle => {
                  return {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.xs,
                    minHeight: 44,
                    alignSelf: "flex-start",
                    opacity: pressed ? 0.7 : 1,
                  };
                }}
              >
                <Text
                  style={{
                    ...typography.subhead,
                    fontWeight: "600",
                    color: theme.colors.actionPrimary,
                  }}
                >
                  {summary
                    ? showReport
                      ? "Hide the full report"
                      : "Read the full report"
                    : showReport
                      ? "Hide the report"
                      : "Read the report"}
                </Text>
                <Ionicons
                  name={showReport ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={theme.colors.actionPrimary}
                />
              </Pressable>
              {showReport ? (
                <View testID="case-ai-report">
                  <MarkdownContent content={folded} />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </ResponseSection>
  );
}

/**
 * What the case is about: the users, hosts, addresses and files its
 * detections name - what a containment step acts on, and what the analyst
 * looks up first. Values are selectable, to copy into another tool.
 */
export function CaseEntitiesSection({
  entities,
}: {
  entities: Array<SecurityEntity>;
}): React.JSX.Element | null {
  const { theme } = useTheme();

  if (entities.length === 0) {
    return null;
  }

  const shown: Array<SecurityEntity> = entities.slice(0, CASE_ENTITY_LIMIT);
  const more: number = entities.length - shown.length;

  return (
    <ResponseSection
      title="Entities"
      iconName="locate-outline"
      count={entities.length}
      testID="case-entities-section"
    >
      {[
        ...shown.map((entity: SecurityEntity): React.JSX.Element => {
          return (
            <View
              key={`${entity.type}-${entity.value}`}
              testID="case-entity"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
                minHeight: 48,
                paddingVertical: spacing.sm,
              }}
            >
              <Ionicons
                name={getEntityTerm(entity.type).icon}
                size={18}
                color={theme.colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text
                  selectable
                  style={{
                    ...typography.subhead,
                    fontWeight: "600",
                    color: theme.colors.textPrimary,
                  }}
                >
                  {entity.value}
                </Text>
                <Text
                  style={{
                    ...typography.caption,
                    color: theme.colors.textSecondary,
                  }}
                >
                  {getEntityTerm(entity.type).label}
                </Text>
              </View>
            </View>
          );
        }),
        ...(more > 0
          ? [
              <Text
                key="more"
                testID="case-entities-more"
                style={{
                  ...typography.footnote,
                  color: theme.colors.textSecondary,
                  paddingVertical: spacing.md,
                }}
              >
                {`And ${more} more.`}
              </Text>,
            ]
          : []),
      ]}
    </ResponseSection>
  );
}

interface CaseFieldRowProps {
  label: string;
  value: string;
  // A colour dot before the value: the status's or the priority's own.
  dotColor?: string;
  // Tapping the row changes the value; without it the row only reads.
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * One fact of the case. A fact that can be changed from the phone - its
 * status, its priority, who has it - is a row that opens its sheet, with a
 * chevron saying so.
 */
export function CaseFieldRow({
  label,
  value,
  dotColor,
  onPress,
  accessibilityHint,
  testID,
}: CaseFieldRowProps): React.JSX.Element {
  const { theme } = useTheme();
  const content: React.JSX.Element = (
    <>
      <Text
        style={{
          ...typography.subhead,
          width: 104,
          flexShrink: 0,
          color: theme.colors.textSecondary,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        {dotColor ? (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: dotColor,
            }}
          />
        ) : null}
        <Text
          selectable={!onPress}
          style={{
            ...typography.subhead,
            flex: 1,
            fontWeight: "500",
            color: theme.colors.textPrimary,
          }}
        >
          {value}
        </Text>
      </View>
      {onPress ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.colors.textTertiary}
        />
      ) : null}
    </>
  );
  const rowStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    minHeight: 48,
    paddingVertical: spacing.md,
  };

  if (!onPress) {
    return (
      <View testID={testID} style={rowStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }): ViewStyle => {
        return { ...rowStyle, opacity: pressed ? 0.6 : 1 };
      }}
    >
      {content}
    </Pressable>
  );
}
