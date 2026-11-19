import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme";
import {
  elevation,
  radius,
  spacing,
  touchTarget,
  typography,
} from "../../theme/tokens";
import { SHEET_MAX_WIDTH } from "../../layout/windowLayout";
import {
  getSheetBackdropLayout,
  getSheetCorners,
  type SheetPlacement,
} from "../../layout/sheetPlacement";
import { useSheetPlacement } from "../../layout/useSheetPlacement";
import {
  clearFacet,
  countActiveFacets,
  emptyFilters,
  filtersForList,
  getFacetTitle,
  getFilterFacets,
  isFacetActive,
  toggleValue,
  type FilterFacet,
  type FilterableList,
  type RecordFilters,
} from "../../filters/recordFilters";
import {
  getVisibleOptions,
  type FilterOption,
  type FilterOptionList,
  type FilterSheetOptions,
  type VisibleOptions,
} from "../../filters/filterOptions";
import FilterChip from "./FilterChip";
import SearchField from "../SearchField";
import GradientButton from "../GradientButton";

interface FilterSheetProps {
  visible: boolean;
  list: FilterableList;
  // What the list holds, plural and lower case: "incidents".
  noun: string;
  // The filters in force: the sheet starts from them and hands back new ones.
  value: RecordFilters;
  options: FilterSheetOptions;
  // Whether "You" can be offered: the reader's own id is known.
  canFilterByMe: boolean;
  // The section to open at: the one a chip under the search was pressed for.
  focusFacet?: FilterFacet | null;
  onApply: (filters: RecordFilters) => void;
  onClose: () => void;
}

// What each section says under its title, for the facets that need it.
function getFacetHint(facet: FilterFacet, noun: string): string | null {
  switch (facet) {
    case "owner":
      return `${capitalize(noun)} you, one of your teams, or the people and teams you pick own.`;
    case "monitor":
      return `${capitalize(noun)} about any of these monitors.`;
    default:
      return null;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * A list's filters: who owns a record, its state, its severity, its labels,
 * its monitors - the Dashboard table's filters, one section each, in the
 * order people reach for them. Several values in one section match any of
 * them; sections combine, so a record shows when it matches every section
 * that is set. Nothing applies until Show results, so the sheet can be
 * closed to leave the list as it was.
 */
export default function FilterSheet({
  visible,
  list,
  noun,
  value,
  options,
  canFilterByMe,
  focusFacet,
  onApply,
  onClose,
}: FilterSheetProps): React.JSX.Element {
  const { theme } = useTheme();
  const placement: SheetPlacement = useSheetPlacement();
  const [draft, setDraft] = useState<RecordFilters>(
    filtersForList(value, list),
  );
  const scrollRef: React.RefObject<ScrollView | null> =
    useRef<ScrollView>(null);
  const sectionTops: React.MutableRefObject<
    Partial<Record<FilterFacet, number>>
  > = useRef<Partial<Record<FilterFacet, number>>>({});

  // Every opening starts from the filters in force, not from an abandoned draft.
  useEffect((): void => {
    if (visible) {
      setDraft(filtersForList(value, list));
    }
  }, [visible]);

  const facets: Array<FilterFacet> = getFilterFacets(list);
  const draftCount: number = countActiveFacets(draft, list);

  const scrollToFocus: (facet: FilterFacet, top: number) => void = (
    facet: FilterFacet,
    top: number,
  ): void => {
    if (visible && focusFacet === facet && top > 0) {
      scrollRef.current?.scrollTo({ y: top - spacing.sm, animated: false });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        testID="filter-sheet-backdrop"
        style={{
          flex: 1,
          ...getSheetBackdropLayout(placement),
          backgroundColor: theme.colors.overlay,
        }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        enabled={placement.avoidsKeyboard}
      >
        <Pressable
          testID="filter-sheet-dismiss-area"
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="filter-sheet"
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: SHEET_MAX_WIDTH,
            alignSelf: "center",
            maxHeight: placement.maxHeight ?? "92%",
            ...getSheetCorners(placement, radius.xl),
            backgroundColor: theme.colors.backgroundSecondary,
            borderWidth: theme.dark ? 1 : 0,
            borderColor: theme.colors.borderSubtle,
            ...elevation("overlay", theme.dark),
          }}
        >
          <View
            style={{
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.sm,
            }}
          >
            <View style={{ alignItems: "center", paddingBottom: spacing.md }}>
              <View
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: radius.pill,
                  backgroundColor: theme.colors.borderDefault,
                }}
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{
                  ...typography.title3,
                  flex: 1,
                  color: theme.colors.textPrimary,
                }}
              >
                Filter {noun}
              </Text>
              <Pressable
                testID="filter-sheet-close"
                accessibilityRole="button"
                accessibilityLabel="Close filters"
                onPress={onClose}
                style={{
                  minWidth: touchTarget,
                  minHeight: touchTarget,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.backgroundTertiary,
                  }}
                >
                  <Ionicons
                    name="close"
                    size={18}
                    color={theme.colors.textSecondary}
                  />
                </View>
              </Pressable>
            </View>
            <Text
              style={{
                ...typography.footnote,
                color: theme.colors.textSecondary,
                marginBottom: spacing.md,
              }}
            >
              Shows {noun} that match every section you set. Pick several values
              in a section to match any of them.
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            testID="filter-sheet-scroll"
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{
              paddingHorizontal: spacing.xl,
              paddingBottom: spacing.lg,
              gap: spacing.xl,
            }}
          >
            {facets.map((facet: FilterFacet): React.JSX.Element => {
              return (
                <View
                  key={facet}
                  testID={`filter-section-${facet}`}
                  onLayout={(event: LayoutChangeEvent): void => {
                    const top: number = event.nativeEvent.layout.y;
                    sectionTops.current[facet] = top;
                    scrollToFocus(facet, top);
                  }}
                >
                  <FacetSection
                    facet={facet}
                    list={list}
                    noun={noun}
                    draft={draft}
                    options={options}
                    canFilterByMe={canFilterByMe}
                    onChange={setDraft}
                  />
                </View>
              );
            })}
          </ScrollView>

          <View
            style={{
              flexDirection: "row",
              gap: spacing.md,
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.md,
              paddingBottom: Math.max(placement.paddingBottom, spacing.xl),
              borderTopWidth: 1,
              borderTopColor: theme.colors.borderSubtle,
            }}
          >
            <GradientButton
              testID="filter-sheet-clear"
              label="Clear all"
              variant="secondary"
              disabled={draftCount === 0}
              onPress={(): void => {
                setDraft(emptyFilters());
              }}
              style={{ flex: 1 }}
            />
            <GradientButton
              testID="filter-sheet-apply"
              label="Show results"
              onPress={(): void => {
                onApply(draft);
              }}
              style={{ flex: 1.4 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface FacetSectionProps {
  facet: FilterFacet;
  list: FilterableList;
  noun: string;
  draft: RecordFilters;
  options: FilterSheetOptions;
  canFilterByMe: boolean;
  onChange: (next: RecordFilters) => void;
}

// One section of the sheet: its title, how many are picked, and its values.
function FacetSection({
  facet,
  list,
  noun,
  draft,
  options,
  canFilterByMe,
  onChange,
}: FacetSectionProps): React.JSX.Element {
  const { theme } = useTheme();
  const title: string = getFacetTitle(facet, list);
  const hint: string | null = getFacetHint(facet, noun);
  const active: boolean = isFacetActive(draft, facet);

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.md,
          minHeight: 32,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ ...typography.headline, color: theme.colors.textPrimary }}
        >
          {title}
        </Text>
        {active ? (
          <Pressable
            testID={`filter-section-${facet}-clear`}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${title} filter`}
            hitSlop={8}
            onPress={(): void => {
              onChange(clearFacet(draft, facet));
            }}
            style={{ minHeight: 32, justifyContent: "center" }}
          >
            <Text
              style={{
                ...typography.footnote,
                fontWeight: "600",
                color: theme.colors.actionPrimary,
              }}
            >
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <Text
          style={{
            ...typography.footnote,
            color: theme.colors.textSecondary,
            marginTop: -spacing.xs,
          }}
        >
          {hint}
        </Text>
      ) : null}
      {facet === "owner" ? (
        <OwnerValues
          draft={draft}
          options={options}
          canFilterByMe={canFilterByMe}
          onChange={onChange}
        />
      ) : (
        <ValueChips
          facet={facet}
          title={title}
          optionList={getFacetOptions(options, facet)}
          selected={getFacetValues(draft, facet)}
          onToggle={(id: string): void => {
            onChange(setFacetValues(draft, facet, id));
          }}
        />
      )}
    </View>
  );
}

function getFacetOptions(
  options: FilterSheetOptions,
  facet: FilterFacet,
): FilterOptionList {
  switch (facet) {
    case "state":
      return options.states;
    case "severity":
      return options.severities;
    case "label":
      return options.labels;
    case "monitor":
      return options.monitors;
    case "monitorType":
      return options.monitorTypes;
    case "owner":
      return options.people;
  }
}

function getFacetValues(
  filters: RecordFilters,
  facet: FilterFacet,
): Array<string> {
  switch (facet) {
    case "state":
      return filters.stateIds;
    case "severity":
      return filters.severityIds;
    case "label":
      return filters.labelIds;
    case "monitor":
      return filters.monitorIds;
    case "monitorType":
      return filters.monitorTypes;
    case "owner":
      return filters.ownerUserIds;
  }
}

function setFacetValues(
  filters: RecordFilters,
  facet: FilterFacet,
  id: string,
): RecordFilters {
  switch (facet) {
    case "state":
      return { ...filters, stateIds: toggleValue(filters.stateIds, id) };
    case "severity":
      return { ...filters, severityIds: toggleValue(filters.severityIds, id) };
    case "label":
      return { ...filters, labelIds: toggleValue(filters.labelIds, id) };
    case "monitor":
      return { ...filters, monitorIds: toggleValue(filters.monitorIds, id) };
    case "monitorType":
      return {
        ...filters,
        monitorTypes: toggleValue(filters.monitorTypes, id),
      };
    case "owner":
      return {
        ...filters,
        ownerUserIds: toggleValue(filters.ownerUserIds, id),
      };
  }
}

// What a section shows while its values load, fail or are missing.
function OptionsStatus({
  optionList,
  title,
}: {
  optionList: FilterOptionList;
  title: string;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  if (optionList.isLoading) {
    return (
      <View
        testID={`filter-options-loading-${title}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: touchTarget,
        }}
      >
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        <Text
          style={{ ...typography.footnote, color: theme.colors.textSecondary }}
        >
          Loading {title.toLowerCase()}…
        </Text>
      </View>
    );
  }
  if (optionList.isError) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: spacing.sm,
          minHeight: touchTarget,
        }}
      >
        <Text
          style={{ ...typography.footnote, color: theme.colors.statusError }}
        >
          Could not load {title.toLowerCase()}.
        </Text>
        {optionList.onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry loading ${title.toLowerCase()}`}
            onPress={optionList.onRetry}
            hitSlop={8}
            style={{ minHeight: 32, justifyContent: "center" }}
          >
            <Text
              style={{
                ...typography.footnote,
                fontWeight: "600",
                color: theme.colors.actionPrimary,
              }}
            >
              Retry
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (optionList.options.length === 0) {
    return (
      <Text
        style={{ ...typography.footnote, color: theme.colors.textTertiary }}
      >
        {optionList.emptyMessage ??
          `No ${title.toLowerCase()} in this project yet.`}
      </Text>
    );
  }
  return null;
}

/*
 * A section's values as chips. A long list (labels, monitors) gets a search
 * and shows the picked values first, then the first matches, so the sheet
 * never becomes a wall of chips.
 */
function ValueChips({
  facet,
  title,
  optionList,
  selected,
  onToggle,
}: {
  facet: FilterFacet;
  title: string;
  optionList: FilterOptionList;
  selected: Array<string>;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [search, setSearch] = useState<string>("");
  const visible: VisibleOptions = useMemo((): VisibleOptions => {
    return getVisibleOptions(optionList.options, selected, search);
  }, [optionList.options, selected, search]);

  const status: React.JSX.Element | null = (
    <OptionsStatus optionList={optionList} title={title} />
  );
  if (
    optionList.isLoading ||
    optionList.isError ||
    optionList.options.length === 0
  ) {
    return status as React.JSX.Element;
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {visible.searchable ? (
        <SearchField
          testID={`filter-search-${facet}`}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${title.toLowerCase()}`}
        />
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {visible.options.map((option: FilterOption): React.JSX.Element => {
          const isSelected: boolean = selected.includes(option.id);
          return (
            <FilterChip
              key={option.id}
              testID={`filter-option-${facet}-${option.id}`}
              label={option.label}
              dotColor={option.dotColor}
              selected={isSelected}
              accessibilityLabel={`${title}: ${option.label}`}
              onPress={(): void => {
                onToggle(option.id);
              }}
            />
          );
        })}
      </View>
      {visible.hiddenCount > 0 ? (
        <Text
          style={{ ...typography.footnote, color: theme.colors.textTertiary }}
        >
          {search.trim()
            ? `${visible.hiddenCount} more ${visible.hiddenCount === 1 ? "match" : "match"}. Keep typing to narrow it down.`
            : `${visible.hiddenCount} more. Search to find one.`}
        </Text>
      ) : null}
      {search.trim() && visible.options.length === 0 ? (
        <Text
          style={{ ...typography.footnote, color: theme.colors.textTertiary }}
        >
          Nothing matches “{search.trim()}”.
        </Text>
      ) : null}
    </View>
  );
}

/*
 * Who owns a record: You first - the filter most people want - then the
 * project's teams and people, searched together as the Dashboard's one
 * Owners field is.
 */
function OwnerValues({
  draft,
  options,
  canFilterByMe,
  onChange,
}: {
  draft: RecordFilters;
  options: FilterSheetOptions;
  canFilterByMe: boolean;
  onChange: (next: RecordFilters) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const [search, setSearch] = useState<string>("");
  const teams: VisibleOptions = useMemo((): VisibleOptions => {
    return getVisibleOptions(
      options.teams.options,
      draft.ownerTeamIds,
      search,
      8,
    );
  }, [options.teams.options, draft.ownerTeamIds, search]);
  const people: VisibleOptions = useMemo((): VisibleOptions => {
    return getVisibleOptions(
      options.people.options,
      draft.ownerUserIds,
      search,
      12,
    );
  }, [options.people.options, draft.ownerUserIds, search]);
  const total: number =
    options.teams.options.length + options.people.options.length;
  const searchable: boolean = total > 12;
  const loading: boolean = options.teams.isLoading || options.people.isLoading;

  return (
    <View style={{ gap: spacing.md }}>
      {canFilterByMe ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <FilterChip
            testID="filter-option-owner-me"
            label="You"
            icon="person-circle-outline"
            selected={draft.ownedByMe}
            accessibilityLabel="Owner: You"
            accessibilityHint="Includes anything one of your teams owns"
            onPress={(): void => {
              onChange({ ...draft, ownedByMe: !draft.ownedByMe });
            }}
          />
        </View>
      ) : null}
      {searchable ? (
        <SearchField
          testID="filter-search-owner"
          value={search}
          onChangeText={setSearch}
          placeholder="Search people and teams"
        />
      ) : null}
      {loading ? (
        <OptionsStatus
          optionList={{ ...options.people, isLoading: true }}
          title="People and teams"
        />
      ) : null}
      {!loading && (options.teams.isError || options.people.isError) ? (
        <OptionsStatus
          optionList={options.teams.isError ? options.teams : options.people}
          title="People and teams"
        />
      ) : null}
      {teams.options.length > 0 ? (
        <OwnerGroup
          title="Teams"
          icon="people-outline"
          visible={teams}
          selected={draft.ownerTeamIds}
          testPrefix="filter-option-owner-team"
          onToggle={(id: string): void => {
            onChange({
              ...draft,
              ownerTeamIds: toggleValue(draft.ownerTeamIds, id),
            });
          }}
        />
      ) : null}
      {people.options.length > 0 ? (
        <OwnerGroup
          title="People"
          icon="person-outline"
          visible={people}
          selected={draft.ownerUserIds}
          testPrefix="filter-option-owner-user"
          onToggle={(id: string): void => {
            onChange({
              ...draft,
              ownerUserIds: toggleValue(draft.ownerUserIds, id),
            });
          }}
        />
      ) : null}
      {search.trim() &&
      teams.options.length === 0 &&
      people.options.length === 0 ? (
        <Text
          style={{ ...typography.footnote, color: theme.colors.textTertiary }}
        >
          No person or team matches “{search.trim()}”.
        </Text>
      ) : null}
    </View>
  );
}

function OwnerGroup({
  title,
  icon,
  visible,
  selected,
  testPrefix,
  onToggle,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  visible: VisibleOptions;
  selected: Array<string>;
  testPrefix: string;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <Text
        style={{
          ...typography.caption,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          color: theme.colors.textSecondary,
        }}
      >
        {title}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {visible.options.map((option: FilterOption): React.JSX.Element => {
          return (
            <FilterChip
              key={option.id}
              testID={`${testPrefix}-${option.id}`}
              label={option.label}
              icon={icon}
              selected={selected.includes(option.id)}
              accessibilityLabel={`Owner: ${option.label}`}
              accessibilityHint={option.detail}
              onPress={(): void => {
                onToggle(option.id);
              }}
            />
          );
        })}
      </View>
      {visible.hiddenCount > 0 ? (
        <Text
          style={{ ...typography.footnote, color: theme.colors.textTertiary }}
        >
          {visible.hiddenCount} more. Search to find one.
        </Text>
      ) : null}
    </View>
  );
}
