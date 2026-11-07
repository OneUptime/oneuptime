import { useCallback, useState } from "react";
import { Alert } from "react-native";
import {
  QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  fetchOnCallObserverPages,
  markOnCallObserverPagesSeen,
  type OnCallObserverPage,
} from "../api/onCallObserverPages";
import type { OnCallPageRecordType } from "../api/onCallPassOn";
import { OBSERVER_PAGE_TEXT } from "../oncall/observerPage";
import { useHaptics } from "./useHaptics";
import type { ResponseAction } from "../components/ResponseDetailLayout";

/*
 * "I've seen it" on a detail screen, for the person paged about it as an
 * observer (oncall/observerPage.ts).
 *
 * A push about an observer's page opens the detail screen of what it is
 * about, and so does its row in My Pages. While the page is open the screen
 * offers "I've seen it", first and filled, in place of the record's own
 * Acknowledge (oncall/pagedActions.ts): it says the reader has seen their
 * page, in one step, as its email's link, a call's 1 or a text does. The
 * record is not acknowledged, and nobody else's page stops.
 *
 * Anybody not paged about it as an observer gets no button, and neither
 * does anybody whose server cannot be asked (an older server, no signal):
 * the screen is as it was.
 */

export interface ObserverPageControls {
  // The screen's "I've seen it", or null when no observer's page is open for the reader.
  action: ResponseAction | null;
  markingSeen: boolean;
  // Whether the reader has an observer's page about the record they can still answer.
  hasOpenPages: boolean;
  // Whether the server has answered (or failed to answer) what those pages are.
  pagesSettled: boolean;
  pagesKnown: boolean;
  // Says the reader has seen their pages - for the push's "I've seen it".
  markSeen: () => Promise<void>;
  // Reads again whether the reader is paged about it as an observer.
  refetch: () => Promise<void>;
}

export function useObserverPageAction(data: {
  projectId: string;
  recordType: OnCallPageRecordType;
  recordId: string;
  // What the record is, for a screen reader: "incident", "alert episode".
  recordLabel: string;
  // After the reader said they have seen it: the record's feed has news.
  onSeen?: (() => Promise<unknown> | void) | undefined;
}): ObserverPageControls {
  const { projectId, recordType, recordId, recordLabel, onSeen } = data;
  const queryClient: QueryClient = useQueryClient();
  const { successFeedback, errorFeedback } = useHaptics();
  const [markingSeen, setMarkingSeen] = useState<boolean>(false);

  const query: UseQueryResult<OnCallObserverPage[], Error> = useQuery({
    queryKey: ["on-call-observer-pages", projectId, recordType, recordId],
    queryFn: () => {
      return fetchOnCallObserverPages(projectId, recordType, recordId);
    },
    enabled: Boolean(projectId) && Boolean(recordId),
    // When the server cannot say, there is no button.
    retry: false,
  });

  const pages: OnCallObserverPage[] = query.data ?? [];

  const markSeen: () => Promise<void> = useCallback(async (): Promise<void> => {
    setMarkingSeen(true);

    try {
      const seen: number = await markOnCallObserverPagesSeen(
        projectId,
        recordType,
        recordId,
      );

      if (seen > 0) {
        await successFeedback();
      } else {
        // Somebody the page reached said so first, or the record was resolved.
        Alert.alert(
          OBSERVER_PAGE_TEXT.alreadySeenTitle,
          OBSERVER_PAGE_TEXT.alreadySeen,
        );
      }

      await Promise.allSettled([
        // Their page is answered: the button goes.
        query.refetch(),
        // My Pages shows the page as seen.
        queryClient.invalidateQueries({ queryKey: ["oncall", "my-pages"] }),
        seen > 0 && onSeen ? onSeen() : undefined,
      ]);
    } catch {
      await errorFeedback();
      // Said once, under a title that says what went wrong: the page goes on.
      Alert.alert(OBSERVER_PAGE_TEXT.failedTitle, OBSERVER_PAGE_TEXT.failed);
    } finally {
      setMarkingSeen(false);
    }
  }, [
    projectId,
    recordType,
    recordId,
    onSeen,
    query,
    queryClient,
    successFeedback,
    errorFeedback,
  ]);

  const action: ResponseAction | null =
    pages.length > 0
      ? {
          label: OBSERVER_PAGE_TEXT.seenButton,
          accessibilityLabel: `I've seen this ${recordLabel}`,
          busyAccessibilityLabel: "Marking as seen",
          icon: "checkmark-done-outline",
          primary: true,
          onPress: markSeen,
        }
      : null;

  return {
    action,
    markingSeen,
    hasOpenPages: pages.length > 0,
    pagesSettled: query.isFetched || query.isError || !query.isEnabled,
    pagesKnown: query.isSuccess,
    markSeen,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
  };
}
