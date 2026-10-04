import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import {
  EmbeddedMetricCardGroupContext,
  EmbeddedMetricCardGroupContextValue,
  useEmbeddedMetricCardGroup,
} from "./EmbeddedMetricCardGroupContext";
import {
  getMetricCardGroupState,
  getNextMetricCardGroupMemberState,
  isMetricCardGroupChecking,
  isMetricCardGroupEmpty,
  MetricCardGroupMemberState,
  MetricResultsState,
} from "./Utils/MetricResultsState";

/*
 * Metric cards whose charts share one reason for being empty, such as a
 * scrape the Kubernetes agent leaves off until a Helm value turns it on.
 *
 * While any card has data, is still loading for the first time, or failed
 * to load, the group draws its cards as they are. Once every card has
 * loaded and found no data points at all, it draws `renderEmptyState` once,
 * in their place, instead of a page of empty charts under a note that says
 * why. The cards stay mounted, hidden: a new time range, or checking again,
 * runs their queries again, and the charts come back the moment any card
 * finds data. Checking again keeps the explanation on screen until the
 * cards have their answer, so it does not flicker.
 *
 * Only cards with queries take part (a card that draws charts of its own
 * always counts as having something to show). Key the group by what it
 * shows - a tab's name, say - so a group reused for other cards starts over.
 *
 * Groups nest. A card with its own reason for being empty (a component the
 * agent never scrapes, next to cards it does) goes in a group of its own
 * inside the outer one: it explains itself while the outer group's cards
 * have data, it counts as one card of the outer group (empty only when it is
 * explaining itself), and checking the outer group again reloads it too.
 */

export interface EmbeddedMetricCardGroupEmptyStateProps {
  // Some card is running its queries again.
  isChecking: boolean;
  // Run every card's queries again, past the result cache.
  checkAgain: () => void;
}

export interface ComponentProps {
  children: ReactNode;
  // What the group draws, once, in place of its cards while they are empty.
  renderEmptyState: (
    props: EmbeddedMetricCardGroupEmptyStateProps,
  ) => ReactElement;
  /*
   * Called when the empty state checks again, after the cards were told to
   * reload. A page that owns the cards' window resolves it again here, so
   * "Past 1 hour" includes the minute just gone.
   */
  onCheckAgain?: (() => void) | undefined;
  dataTestId?: string | undefined;
}

export const EMBEDDED_METRIC_CARD_GROUP_TEST_ID: string =
  "embedded-metric-card-group";

const EmbeddedMetricCardGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [members, setMembers] = useState<
    Record<string, MetricCardGroupMemberState>
  >({});
  const [ownRefreshNonce, setRefreshNonce] = useState<number>(0);

  // The group this one sits in, if any (see "Groups nest" above).
  const parent: EmbeddedMetricCardGroupContextValue | null =
    useEmbeddedMetricCardGroup();
  const refreshNonce: number = ownRefreshNonce + (parent?.refreshNonce || 0);

  const report: (memberId: string, state: MetricResultsState) => void =
    useCallback((memberId: string, state: MetricResultsState): void => {
      setMembers(
        (
          previous: Record<string, MetricCardGroupMemberState>,
        ): Record<string, MetricCardGroupMemberState> => {
          const before: MetricCardGroupMemberState | undefined =
            previous[memberId];
          const next: MetricCardGroupMemberState =
            getNextMetricCardGroupMemberState(before, state);

          if (
            before &&
            before.settled === next.settled &&
            before.isLoading === next.isLoading
          ) {
            return previous;
          }

          return { ...previous, [memberId]: next };
        },
      );
    }, []);

  const remove: (memberId: string) => void = useCallback(
    (memberId: string): void => {
      setMembers(
        (
          previous: Record<string, MetricCardGroupMemberState>,
        ): Record<string, MetricCardGroupMemberState> => {
          if (!(memberId in previous)) {
            return previous;
          }

          const next: Record<string, MetricCardGroupMemberState> = {
            ...previous,
          };
          delete next[memberId];
          return next;
        },
      );
    },
    [],
  );

  const contextValue: EmbeddedMetricCardGroupContextValue = useMemo(() => {
    return { report, remove, refreshNonce };
  }, [report, remove, refreshNonce]);

  const memberStates: Array<MetricCardGroupMemberState> =
    Object.values(members);
  const isEmpty: boolean = isMetricCardGroupEmpty(memberStates);
  const isChecking: boolean = isMetricCardGroupChecking(memberStates);

  // Inside another group, this whole group is one of its cards.
  const groupState: MetricResultsState | null =
    getMetricCardGroupState(memberStates);
  const memberIdInParent: string = useId();
  const reportToParent:
    | ((memberId: string, state: MetricResultsState) => void)
    | undefined = parent?.report;
  const removeFromParent: ((memberId: string) => void) | undefined =
    parent?.remove;

  useEffect(() => {
    if (groupState === null) {
      removeFromParent?.(memberIdInParent);
      return;
    }
    reportToParent?.(memberIdInParent, groupState);
  }, [reportToParent, removeFromParent, memberIdInParent, groupState]);

  useEffect(() => {
    return () => {
      removeFromParent?.(memberIdInParent);
    };
  }, [removeFromParent, memberIdInParent]);

  const onCheckAgain: (() => void) | undefined = props.onCheckAgain;

  const checkAgain: () => void = useCallback((): void => {
    setRefreshNonce((nonce: number): number => {
      return nonce + 1;
    });
    onCheckAgain?.();
  }, [onCheckAgain]);

  const testId: string = props.dataTestId || EMBEDDED_METRIC_CARD_GROUP_TEST_ID;

  return (
    <div data-testid={testId} data-group-empty={isEmpty ? "true" : "false"}>
      {isEmpty ? (
        /*
         * Outside the group's context: a card drawn in the empty state is
         * not one of the group's cards.
         */
        <EmbeddedMetricCardGroupContext.Provider value={null}>
          <div data-testid={`${testId}-empty-state`}>
            {props.renderEmptyState({
              isChecking: isChecking,
              checkAgain: checkAgain,
            })}
          </div>
        </EmbeddedMetricCardGroupContext.Provider>
      ) : (
        <></>
      )}
      <EmbeddedMetricCardGroupContext.Provider value={contextValue}>
        <div data-testid={`${testId}-cards`} hidden={isEmpty}>
          {props.children}
        </div>
      </EmbeddedMetricCardGroupContext.Provider>
    </div>
  );
};

export default EmbeddedMetricCardGroup;
