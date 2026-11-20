import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, typography } from "../theme/tokens";
import {
  useRecordOwnersAndLabels,
  type RecordOwnersAndLabels as OwnersAndLabelsResult,
} from "../hooks/useRecordOwnersAndLabels";
import type { RecordLabel, RecordOwner } from "../api/recordPeople";
import type { FilterableList } from "../filters/recordFilters";
import { getCurrentUserIdSync } from "../auth/currentUser";
import { rgbToHex } from "../utils/color";

interface RecordOwnersAndLabelsProps {
  list: FilterableList;
  projectId: string;
  recordId: string;
}

// The person reading is "You", first, as the list's Owner filter calls them.
export function orderOwners(
  owners: Array<RecordOwner>,
  currentUserId: string | null,
): Array<RecordOwner & { isYou: boolean }> {
  return owners
    .map((owner: RecordOwner): RecordOwner & { isYou: boolean } => {
      return {
        ...owner,
        isYou: owner.kind === "user" && owner.id === currentUserId,
      };
    })
    .sort(
      (
        a: RecordOwner & { isYou: boolean },
        b: RecordOwner & { isYou: boolean },
      ): number => {
        return Number(b.isYou) - Number(a.isYou);
      },
    );
}

function RowLabel({ children }: { children: string }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Text
      style={{
        ...typography.subhead,
        width: 96,
        flexShrink: 0,
        color: theme.colors.textSecondary,
      }}
    >
      {children}
    </Text>
  );
}

function Pill({
  label,
  icon,
  dotColor,
  emphasized,
  testID,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  dotColor?: string;
  emphasized?: boolean;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs + 1,
        maxWidth: "100%",
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: emphasized
          ? theme.colors.actionPrimary
          : theme.colors.borderSubtle,
        backgroundColor: emphasized
          ? theme.colors.cardAccent
          : theme.colors.backgroundTertiary,
      }}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={13}
          color={
            emphasized ? theme.colors.actionPrimary : theme.colors.textSecondary
          }
        />
      ) : null}
      {dotColor ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
      <Text
        style={{
          ...typography.footnote,
          fontWeight: "600",
          flexShrink: 1,
          color: emphasized
            ? theme.colors.actionPrimary
            : theme.colors.textPrimary,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Who owns the record, and its labels: the two facts the Dashboard keeps in
 * an Owners card and a Labels column, which a responder asks first ("is
 * this mine? whose is it?"). Drawn as rows of the Details section; owners
 * that could not be read say so, and are never shown as nobody.
 */
export default function RecordOwnersAndLabels({
  list,
  projectId,
  recordId,
}: RecordOwnersAndLabelsProps): React.JSX.Element {
  const { theme } = useTheme();
  const result: OwnersAndLabelsResult = useRecordOwnersAndLabels(
    list,
    projectId,
    recordId,
  );
  const owners: Array<RecordOwner & { isYou: boolean }> = orderOwners(
    result.owners,
    getCurrentUserIdSync(),
  );

  return (
    <View testID="record-owners-and-labels">
      <View
        testID="record-owners"
        accessible={!result.ownersFailed}
        accessibilityLabel={
          result.isLoading
            ? "Owners: loading"
            : result.ownersFailed
              ? undefined
              : owners.length === 0
                ? "Owners: none yet"
                : `Owners: ${owners
                    .map((owner: RecordOwner & { isYou: boolean }): string => {
                      return owner.isYou ? "You" : owner.name;
                    })
                    .join(", ")}`
        }
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: spacing.lg,
          minHeight: 44,
          paddingVertical: spacing.md,
        }}
      >
        <RowLabel>Owners</RowLabel>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: spacing.xs + 2,
          }}
        >
          {result.isLoading ? (
            <Text
              style={{
                ...typography.subhead,
                color: theme.colors.textTertiary,
              }}
            >
              Loading…
            </Text>
          ) : result.ownersFailed ? (
            <>
              <Text
                style={{
                  ...typography.subhead,
                  color: theme.colors.textSecondary,
                }}
              >
                Could not load owners.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading owners"
                hitSlop={8}
                onPress={(): void => {
                  void result.refetch();
                }}
              >
                <Text
                  style={{
                    ...typography.subhead,
                    fontWeight: "600",
                    color: theme.colors.actionPrimary,
                  }}
                >
                  Retry
                </Text>
              </Pressable>
            </>
          ) : owners.length === 0 ? (
            <Text
              style={{
                ...typography.subhead,
                color: theme.colors.textTertiary,
              }}
            >
              No owners yet
            </Text>
          ) : (
            owners.map(
              (owner: RecordOwner & { isYou: boolean }): React.JSX.Element => {
                return (
                  <Pill
                    key={`${owner.kind}-${owner.id}`}
                    testID={`record-owner-${owner.kind}-${owner.id}`}
                    label={owner.isYou ? "You" : owner.name}
                    icon={owner.kind === "team" ? "people" : "person"}
                    emphasized={owner.isYou}
                  />
                );
              },
            )
          )}
        </View>
      </View>
      {result.labels.length > 0 ? (
        <View
          testID="record-labels"
          accessible
          accessibilityLabel={`Labels: ${result.labels
            .map((label: RecordLabel): string => {
              return label.name;
            })
            .join(", ")}`}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: spacing.lg,
            minHeight: 44,
            paddingVertical: spacing.md,
          }}
        >
          <RowLabel>Labels</RowLabel>
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.xs + 2,
            }}
          >
            {result.labels.map((label: RecordLabel): React.JSX.Element => {
              return (
                <Pill
                  key={label.id}
                  testID={`record-label-${label.id}`}
                  label={label.name}
                  dotColor={label.color ? rgbToHex(label.color) : undefined}
                />
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
