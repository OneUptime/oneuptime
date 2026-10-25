import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTheme } from "../../theme";
import { radius, spacing, typography } from "../../theme/tokens";
import { rgbToHex } from "../../utils/color";
import { toPlainText } from "../../utils/text";
import GradientButton from "../GradientButton";
import CaseSheet, {
  CaseSheetOption,
  type CaseSheetOptionTag,
} from "./CaseSheet";
import type { CaseValueChoice } from "../../security/caseValues";
import {
  SECURITY_CASE_VERDICTS,
  type SecurityCaseVerdict,
  type SecurityCaseVerdictTerm,
} from "../../security/caseTerms";
import type {
  SecurityCasePriorityItem,
  SecurityCaseStatusItem,
} from "../../api/types";

type CaseValue = SecurityCaseStatusItem | SecurityCasePriorityItem;

interface CaseValueSheetProps {
  visible: boolean;
  kind: "status" | "priority";
  caseNumber: string;
  choices: Array<CaseValueChoice<CaseValue>>;
  // The priority OneUptime AI suggested, marked among the choices.
  suggestedId?: string | null;
  onPick: (value: CaseValue) => void;
  onClose: () => void;
}

const SUGGESTED_TAG: CaseSheetOptionTag = {
  label: "Suggested by OneUptime AI",
  tone: "accent",
};
const CURRENT_TAG: CaseSheetOptionTag = { label: "Current", tone: "neutral" };

/**
 * Change Status and Change Priority: the project's own statuses or
 * priorities, in its order, the one the case has marked Current. Picking one
 * changes the case at once - a status that closes it asks how it closes
 * first. Archived ones are left out, unless the case has one now.
 */
export function CaseValueSheet({
  visible,
  kind,
  caseNumber,
  choices,
  suggestedId,
  onPick,
  onClose,
}: CaseValueSheetProps): React.JSX.Element {
  const suggestedKey: string = (suggestedId || "").toLowerCase();

  return (
    <CaseSheet
      visible={visible}
      testID={`case-${kind}-sheet`}
      icon={kind === "status" ? "git-commit-outline" : "flag-outline"}
      title={kind === "status" ? "Change status" : "Change priority"}
      description={
        kind === "status"
          ? `Pick the new status for ${caseNumber}.`
          : `Pick the new priority for ${caseNumber}.`
      }
      onClose={onClose}
      footer={
        <GradientButton
          label="Cancel"
          variant="secondary"
          onPress={onClose}
          style={{ flex: 1, minHeight: 52 }}
        />
      }
    >
      {choices.map((choice: CaseValueChoice<CaseValue>): React.JSX.Element => {
        const tags: Array<CaseSheetOptionTag> = [];

        if (choice.isCurrent) {
          tags.push(CURRENT_TAG);
        }

        if (
          suggestedKey &&
          String(choice.value._id).toLowerCase() === suggestedKey &&
          !choice.isCurrent
        ) {
          tags.push(SUGGESTED_TAG);
        }

        if (choice.isArchived) {
          tags.push({ label: "Archived", tone: "neutral" });
        }

        return (
          <CaseSheetOption
            key={choice.value._id}
            testID={`case-${kind}-option-${choice.value._id}`}
            label={toPlainText(choice.value.name)}
            dotColor={
              choice.value.color ? rgbToHex(choice.value.color) : undefined
            }
            tags={tags}
            selected={choice.isCurrent}
            onPress={(): void => {
              if (!choice.isCurrent) {
                onPick(choice.value);
              }
            }}
          />
        );
      })}
    </CaseSheet>
  );
}

interface CloseCaseSheetProps {
  visible: boolean;
  caseNumber: string;
  // The status the case moves to: the project's closed one, or another that closes.
  statusName: string;
  // The verdict OneUptime AI's read suggests, picked to start with.
  suggestedVerdict?: SecurityCaseVerdict | undefined;
  submitting: boolean;
  onSubmit: (pick: {
    verdict: SecurityCaseVerdict;
    closingNote: string;
  }) => void;
  onClose: () => void;
}

/**
 * Close Case: what the case turned out to be, and why. The verdict is what
 * makes the closed queue worth reading back - the share of false positives
 * per rule is the tuning list - so it is asked every time a case closes.
 * OneUptime AI's read, when it has one, picks its verdict to start with; the
 * person decides.
 */
export function CloseCaseSheet({
  visible,
  caseNumber,
  statusName,
  suggestedVerdict,
  submitting,
  onSubmit,
  onClose,
}: CloseCaseSheetProps): React.JSX.Element {
  const { theme } = useTheme();
  const [verdict, setVerdict] = useState<SecurityCaseVerdict | null>(
    suggestedVerdict ?? null,
  );
  const [closingNote, setClosingNote] = useState<string>("");
  const [focused, setFocused] = useState<boolean>(false);

  // Every opening starts from the suggestion and an empty note.
  useEffect((): void => {
    if (visible) {
      setVerdict(suggestedVerdict ?? null);
      setClosingNote("");
    }
  }, [visible, suggestedVerdict]);

  const close: () => void = (): void => {
    if (!submitting) {
      onClose();
    }
  };

  return (
    <CaseSheet
      visible={visible}
      testID="close-case-sheet"
      icon="checkmark-circle-outline"
      iconColor={theme.colors.statusSuccess}
      title={`Close ${caseNumber}`}
      description={`It moves to ${statusName}. Pick what it turned out to be.`}
      dismissible={!closingNote.trim() && !submitting}
      onClose={close}
      footer={
        <>
          <GradientButton
            testID="close-case-cancel"
            label="Cancel"
            variant="secondary"
            onPress={close}
            disabled={submitting}
            style={{ flex: 1, minHeight: 52 }}
          />
          <GradientButton
            testID="close-case-submit"
            label="Close case"
            icon="checkmark-circle-outline"
            onPress={(): void => {
              if (verdict && !submitting) {
                onSubmit({ verdict, closingNote: closingNote.trim() });
              }
            }}
            loading={submitting}
            disabled={!verdict}
            style={{ flex: 1, minHeight: 52 }}
          />
        </>
      }
    >
      <Text
        accessibilityRole="header"
        style={{
          ...typography.subhead,
          fontWeight: "700",
          color: theme.colors.textPrimary,
          marginBottom: spacing.sm,
        }}
      >
        Verdict
      </Text>
      <View accessibilityRole="radiogroup">
        {SECURITY_CASE_VERDICTS.map(
          (term: SecurityCaseVerdictTerm): React.JSX.Element => {
            return (
              <CaseSheetOption
                key={term.verdict}
                testID={`close-case-verdict-${term.verdict}`}
                label={term.verdict}
                description={term.description}
                tags={term.verdict === suggestedVerdict ? [SUGGESTED_TAG] : []}
                selected={verdict === term.verdict}
                disabled={submitting}
                onPress={(): void => {
                  setVerdict(term.verdict);
                }}
              />
            );
          },
        )}
      </View>
      <Text
        style={{
          ...typography.subhead,
          fontWeight: "700",
          color: theme.colors.textPrimary,
          marginTop: spacing.md,
          marginBottom: spacing.sm,
        }}
      >
        Closing note (optional)
      </Text>
      <TextInput
        testID="close-case-note"
        accessibilityLabel="Closing note"
        value={closingNote}
        onChangeText={setClosingNote}
        placeholder="What was found and what was done."
        placeholderTextColor={theme.colors.textTertiary}
        selectionColor={theme.colors.actionPrimary}
        cursorColor={theme.colors.actionPrimary}
        keyboardAppearance={theme.dark ? "dark" : "light"}
        multiline
        textAlignVertical="top"
        editable={!submitting}
        onFocus={(): void => {
          setFocused(true);
        }}
        onBlur={(): void => {
          setFocused(false);
        }}
        style={{
          fontSize: typography.body.fontSize,
          minHeight: 88,
          maxHeight: 180,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg - (focused ? 1 : 0),
          paddingVertical: spacing.md - (focused ? 1 : 0),
          backgroundColor: theme.colors.backgroundPrimary,
          borderWidth: focused ? 2 : 1,
          borderColor: focused
            ? theme.colors.actionPrimary
            : theme.colors.borderDefault,
          color: theme.colors.textPrimary,
        }}
      />
    </CaseSheet>
  );
}
