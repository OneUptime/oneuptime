import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type ListRenderItemInfo,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing, typography } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useContentGutters } from "../layout/WindowLayout";
import type { ContentGutters } from "../layout/windowLayout";
import {
  useListPane,
  usePaneScrollRestoration,
  usePaneState,
  type ListPaneState,
  type PaneScrollRestoration,
} from "../navigation/paneState";
import { useOpenSecurityCases } from "../hooks/useSecurityCases";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import { useRefresh } from "../hooks/useRefresh";
import { useHaptics } from "../hooks/useHaptics";
import ListFilters from "../components/ListFilters";
import SearchField from "../components/SearchField";
import SkeletonCard from "../components/SkeletonCard";
import EmptyState from "../components/EmptyState";
import SecurityCaseCard from "../components/SecurityCaseCard";
import {
  CASE_LIST_FILTERS,
  filterCases,
  isCaseAwaitingApproval,
  isCaseListFilter,
  sortCasesForTriage,
  type CaseListFilter,
} from "../security/caseList";
import { isCaseAssignedTo } from "../security/caseChanges";
import { SECURITY_CASE_LIST_LIMIT } from "../api/securityCases";
import type { InboxStackParamList } from "../navigation/types";
import type { ProjectSecurityCaseItem } from "../api/types";

const PAGE_SIZE: number = 20;

type NavProp = NativeStackNavigationProp<InboxStackParamList, "InboxList">;

// What an empty list says, for each filter: an empty Open list is good news.
const EMPTY_STATES: Record<
  CaseListFilter,
  { title: string; subtitle: string; isGoodNews: boolean }
> = {
  open: {
    title: "No open cases",
    subtitle: "New cases appear here as detections fire.",
    isGoodNews: true,
  },
  mine: {
    title: "No open cases are assigned to you",
    subtitle: "Pick up one that nobody has taken yet.",
    isGoodNews: false,
  },
  unassigned: {
    title: "Every open case has someone on it",
    subtitle: "Cases nobody has picked up appear here.",
    isGoodNews: true,
  },
};

/**
 * The selected project's open security cases, inside the Inbox: what is
 * waiting for an approval first, then the most urgent, then the latest. A
 * row opens the case, where it is taken on, moved along and closed.
 */
export default function SecurityCasesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const listPane: ListPaneState = useListPane();
  const navigation: NavProp = useNavigation<NavProp>();
  const route: RouteProp<InboxStackParamList, "InboxList"> =
    useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const userId: string | null = useCurrentUserId();
  const { lightImpact } = useHaptics();
  /*
   * The view state lives in the navigator (paneState), so a fold or an
   * unfold - which draws this list afresh in another pane - brings back the
   * same search, filter and scroll position.
   */
  const [search, setSearch] = usePaneState<string>("security.search", "");
  const [filter, setFilter] = usePaneState<CaseListFilter>(
    "security.filter",
    "open",
  );
  const [visibleCount, setVisibleCount] = usePaneState<number>(
    "security.visible",
    PAGE_SIZE,
  );
  /*
   * The params this list last applied - a Home shortcut's filter. Drawn
   * afresh after a fold, the list sees the same params again; they were
   * applied already, and applying them twice would wipe the search typed
   * since.
   */
  const [appliedParams, setAppliedParams] = usePaneState<
    InboxStackParamList["InboxList"] | null
  >("security.appliedParams", null);
  const listRef: React.RefObject<FlatList<ProjectSecurityCaseItem> | null> =
    useRef<FlatList<ProjectSecurityCaseItem>>(null);
  const scroll: PaneScrollRestoration = usePaneScrollRestoration(
    "security.scroll",
    (offsetY: number): void => {
      listRef.current?.scrollToOffset({ offset: offsetY, animated: false });
    },
  );

  useEffect((): void => {
    if (route.params === appliedParams || route.params === undefined) {
      return;
    }
    setAppliedParams(route.params);
    const requested: unknown = route.params.initialCaseFilter;
    if (isCaseListFilter(requested)) {
      setSearch("");
      setFilter(requested);
      setVisibleCount(PAGE_SIZE);
    }
  }, [route.params]);

  const {
    items,
    priorities,
    awaitingApprovalCaseIds,
    isTruncated,
    isLoading,
    isError,
    isDenied,
    refetch,
  } = useOpenSecurityCases();

  const sorted: Array<ProjectSecurityCaseItem> = useMemo(() => {
    return sortCasesForTriage(items, priorities, awaitingApprovalCaseIds);
  }, [items, priorities, awaitingApprovalCaseIds]);

  const filtered: Array<ProjectSecurityCaseItem> = useMemo(() => {
    return filterCases(sorted, { filter, userId, search });
  }, [sorted, filter, userId, search]);

  const visible: Array<ProjectSecurityCaseItem> = useMemo(() => {
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount]);

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    lightImpact();
    setVisibleCount(PAGE_SIZE);
    await refetch();
  });

  const openCase: (wrapped: ProjectSecurityCaseItem) => void = useCallback(
    (wrapped: ProjectSecurityCaseItem): void => {
      navigation.navigate("SecurityCaseDetail", {
        caseId: wrapped.item._id,
        projectId: wrapped.projectId,
      });
    },
    [navigation],
  );

  const hasFilters: boolean = search.trim().length > 0 || filter !== "open";
  const resetFilters: () => void = (): void => {
    setSearch("");
    setFilter("open");
    setVisibleCount(PAGE_SIZE);
  };

  const listHeader: React.JSX.Element = (
    <View style={{ marginBottom: spacing.xs }}>
      <Text
        style={{
          ...typography.footnote,
          paddingHorizontal: spacing.xs,
          color: theme.colors.textSecondary,
        }}
      >
        Open cases, the most urgent first.
      </Text>
      <View style={{ marginTop: spacing.md }}>
        <SearchField
          value={search}
          onChangeText={(value: string): void => {
            setSearch(value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder="Search title, number, user or host"
          accessibilityLabel="Search security cases"
          testID="security-case-search"
        />
        {isTruncated ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.xs + 2,
              marginTop: spacing.sm,
              paddingHorizontal: spacing.xs,
            }}
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={theme.colors.textTertiary}
              style={{ marginTop: 1 }}
            />
            <Text
              style={{
                ...typography.footnote,
                flex: 1,
                color: theme.colors.textSecondary,
              }}
            >
              {`Showing the ${SECURITY_CASE_LIST_LIMIT} open cases with the latest detections.`}
            </Text>
          </View>
        ) : null}
      </View>
      <ListFilters<CaseListFilter>
        options={CASE_LIST_FILTERS.map(
          (option: {
            key: CaseListFilter;
            label: string;
            accessibilityLabel: string;
          }) => {
            return option;
          },
        )}
        selected={filter}
        onSelect={(value: CaseListFilter): void => {
          setFilter(value);
          setVisibleCount(PAGE_SIZE);
        }}
        resultCount={
          isLoading || isError || isDenied ? undefined : filtered.length
        }
        onReset={hasFilters ? resetFilters : undefined}
      />
    </View>
  );

  const refreshControl: React.JSX.Element = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={theme.colors.textSecondary}
      colors={[theme.colors.actionPrimary]}
      progressBackgroundColor={theme.colors.backgroundElevated}
    />
  );
  const contentContainerStyle: ViewStyle = {
    padding: spacing.xl,
    paddingBottom: bottomPadding,
    ...gutters,
    flexGrow: 1,
  };

  if (isLoading || isError || isDenied) {
    return (
      <View
        testID="security-cases-screen"
        style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
      >
        <ScrollView
          testID="security-cases-status"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={refreshControl}
          contentContainerStyle={contentContainerStyle}
        >
          {listHeader}
          {isLoading ? (
            <View testID="security-cases-loading" style={{ marginTop: 4 }}>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </View>
          ) : isDenied ? (
            <EmptyState
              title="No access to security cases"
              subtitle="Your role in this project does not include Security Events. A project admin can give you a Security role."
              icon="access"
            />
          ) : (
            <EmptyState
              title="Something went wrong"
              subtitle="Could not load security cases. Pull to refresh or try again."
              icon="error"
              actionLabel="Retry"
              onAction={onRefresh}
            />
          )}
        </ScrollView>
      </View>
    );
  }

  const emptyState: { title: string; subtitle: string; isGoodNews: boolean } =
    EMPTY_STATES[filter];

  return (
    <View
      testID="security-cases-screen"
      style={{ flex: 1, backgroundColor: theme.colors.backgroundPrimary }}
    >
      <FlatList
        ref={listRef}
        testID="security-case-list"
        data={visible}
        style={{ flex: 1 }}
        onScroll={scroll.onScroll}
        onContentSizeChange={scroll.onContentSizeChange}
        scrollEventThrottle={scroll.scrollEventThrottle}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={listHeader}
        keyExtractor={(wrapped: ProjectSecurityCaseItem): string => {
          return `${wrapped.projectId}-${wrapped.item._id}`;
        }}
        contentContainerStyle={contentContainerStyle}
        renderItem={({
          item: wrapped,
        }: ListRenderItemInfo<ProjectSecurityCaseItem>) => {
          return (
            <SecurityCaseCard
              securityCase={wrapped.item}
              awaitingApproval={isCaseAwaitingApproval(
                wrapped.item,
                awaitingApprovalCaseIds,
              )}
              isMine={isCaseAssignedTo(wrapped.item.assignedToUserId, userId)}
              selected={listPane.isOpen("SecurityCaseDetail", {
                caseId: wrapped.item._id,
                projectId: wrapped.projectId,
              })}
              showChevron={!listPane.besideDetail}
              onPress={(): void => {
                openCase(wrapped);
              }}
            />
          );
        }}
        ListEmptyComponent={
          search.trim() ? (
            <EmptyState
              title="No matching cases"
              subtitle="Try another search or clear your filters to see more."
              actionLabel="Clear filters"
              onAction={resetFilters}
              icon="security"
            />
          ) : (
            <EmptyState
              title={emptyState.title}
              subtitle={emptyState.subtitle}
              icon={emptyState.isGoodNews ? "success" : "security"}
              actionLabel={
                filter !== "open" ? "Show every open case" : undefined
              }
              onAction={filter !== "open" ? resetFilters : undefined}
            />
          )
        }
        refreshControl={refreshControl}
        onEndReached={(): void => {
          if (visibleCount < filtered.length) {
            setVisibleCount((previous: number): number => {
              return previous + PAGE_SIZE;
            });
          }
        }}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}
