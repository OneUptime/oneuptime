import { useCallback, useState } from "react";
import { Alert } from "react-native";
import {
  QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  acknowledgeOnCallPagesAgain,
  fetchOnCallPassOnPages,
  passOnOnCallPages,
  type OnCallPageRecordType,
  type OnCallPassOnAnswer,
  type OnCallPassOnPage,
} from "../api/onCallPassOn";
import {
  PAGE_AGAIN_TEXT,
  PASS_ON_TEXT,
  getPassOnAnswer,
  getPassOnQuestion,
} from "../oncall/passOn";
import { useHaptics } from "./useHaptics";
import {
  PAGE_AGAIN_ACTION_MIN_WIDTH,
  responseActionIcons,
  type ResponseAction,
} from "../components/ResponseDetailLayout";

/*
 * "Escalate" on a detail screen, for the person being paged about it.
 *
 * A push notification about a page opens the detail screen of what it is
 * about. Somebody who cannot take it - asleep at the wheel, on a plane, ill -
 * escalates it from there: the screen asks first ("Escalate Incident?"),
 * saying what escalating will do, and then says what it did. The policy
 * pages its next level at once instead of waiting the level out, and they
 * are not paged again for it.
 *
 * And "Acknowledge again", for the person a policy pages AGAIN about a record
 * that stayed acknowledged without being resolved (the policy's
 * acknowledgement timeout): the record was acknowledged all along, so its own
 * Acknowledge is not offered, and this answers their page instead - their
 * notifications stop, and the policy counts its time again from now. In one
 * step, with no question, as every link, call and text of the page does.
 * The same answers a page somebody asked for by hand - a page sent from a
 * chat, a policy started by hand - about a record somebody acknowledged
 * already: the person was paged to help with it, not paged again
 * (isPagedToHelp), and the screen says so.
 *
 * Anybody the policy is not paging gets no button: the screen is as it was.
 * So does anybody whose server cannot be asked (an older server, no
 * signal) - it is a shortcut, and acknowledging works as it always did.
 *
 * A page as an observer (oncall/observerPage.ts) is not one of these: it is
 * answered with "I've seen it" (useObserverPageAction), and there is
 * nothing to escalate.
 */

export interface PassOnControls {
  // The screen's "Escalate" button, or null when there is nothing to escalate.
  action: ResponseAction | null;
  passingOn: boolean;
  // The screen's "Acknowledge again" button, or null when no page again is open.
  acknowledgeAgainAction: ResponseAction | null;
  acknowledgingAgain: boolean;
  // Whether the reader has an open page about the record, and a page again among them.
  hasOpenPages: boolean;
  isPageAgain: boolean;
  /*
   * Whether every page answered with Acknowledge again is one somebody asked
   * for by hand (isAskedFor): the reader is paged to help with a record
   * somebody else is on, not paged again about one they took.
   */
  isPagedToHelp: boolean;
  // Whether the server has answered (or failed to answer) what the open pages are.
  pagesSettled: boolean;
  pagesKnown: boolean;
  // Asks "Escalate Incident?" as the button does - for a push's Escalate.
  askToPassOn: () => void;
  // Answers a page again at once - for a push's Acknowledge.
  acknowledgeAgain: () => Promise<void>;
  // Reads again whether the person is being paged about it.
  refetch: () => Promise<void>;
}

export function usePassOnAction(data: {
  projectId: string;
  recordType: OnCallPageRecordType;
  recordId: string;
  // What the record is, for a screen reader: "incident", "alert episode".
  recordLabel: string;
  /*
   * After a page was escalated or acknowledged again: the record's feed and
   * timeline have news.
   */
  onPassedOn?: (() => Promise<unknown> | void) | undefined;
}): PassOnControls {
  const { projectId, recordType, recordId, recordLabel, onPassedOn } = data;
  const queryClient: QueryClient = useQueryClient();
  const { successFeedback, errorFeedback } = useHaptics();
  const [passingOn, setPassingOn] = useState<boolean>(false);
  const [acknowledgingAgain, setAcknowledgingAgain] = useState<boolean>(false);

  const query: UseQueryResult<OnCallPassOnPage[], Error> = useQuery({
    queryKey: ["on-call-pass-on", projectId, recordType, recordId],
    queryFn: () => {
      return fetchOnCallPassOnPages(projectId, recordType, recordId);
    },
    enabled: Boolean(projectId) && Boolean(recordId),
    // A shortcut: when the server cannot say, there is no button.
    retry: false,
  });

  // A responder's pages: an observer's is answered with "I've seen it".
  const pages: OnCallPassOnPage[] = (query.data ?? []).filter(
    (page: OnCallPassOnPage) => {
      return page.isObserverPage !== true;
    },
  );
  const isPageAgain: boolean = pages.some((page: OnCallPassOnPage) => {
    return page.isPageAgain === true;
  });
  // A page again among them is said as one: the reader took the record before.
  const isPagedToHelp: boolean =
    isPageAgain &&
    pages.every((page: OnCallPassOnPage) => {
      return page.isPageAgain !== true || page.isAskedFor === true;
    });

  const passOn: () => Promise<void> = useCallback(async (): Promise<void> => {
    setPassingOn(true);

    try {
      const answers: OnCallPassOnAnswer[] = await passOnOnCallPages(
        projectId,
        recordType,
        recordId,
      );
      const answer: { title: string; message: string; passedOn: boolean } =
        getPassOnAnswer(answers, recordType);

      if (answer.passedOn) {
        await successFeedback();
      }

      Alert.alert(answer.title, answer.message);

      await Promise.allSettled([
        // Now they are not paged about it: the button goes.
        query.refetch(),
        // My Pages shows the page as escalated.
        queryClient.invalidateQueries({ queryKey: ["oncall", "my-pages"] }),
        answer.passedOn && onPassedOn ? onPassedOn() : undefined,
      ]);
    } catch {
      await errorFeedback();
      Alert.alert("Error", PASS_ON_TEXT.failed);
    } finally {
      setPassingOn(false);
    }
  }, [
    projectId,
    recordType,
    recordId,
    onPassedOn,
    query,
    queryClient,
    successFeedback,
    errorFeedback,
  ]);

  const acknowledgeAgain: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setAcknowledgingAgain(true);

      try {
        const acknowledged: number = await acknowledgeOnCallPagesAgain(
          projectId,
          recordType,
          recordId,
        );

        if (acknowledged > 0) {
          await successFeedback();
        }

        await Promise.allSettled([
          // Their page is answered: the button goes.
          query.refetch(),
          // My Pages shows the page as acknowledged.
          queryClient.invalidateQueries({ queryKey: ["oncall", "my-pages"] }),
          acknowledged > 0 && onPassedOn ? onPassedOn() : undefined,
        ]);
      } catch {
        await errorFeedback();
        // Said once, under a title that says what went wrong: the page goes on.
        Alert.alert(PAGE_AGAIN_TEXT.failedTitle, PAGE_AGAIN_TEXT.failed);
      } finally {
        setAcknowledgingAgain(false);
      }
    }, [
      projectId,
      recordType,
      recordId,
      onPassedOn,
      query,
      queryClient,
      successFeedback,
      errorFeedback,
    ]);

  const askToPassOn: () => void = useCallback((): void => {
    const question: { title: string; message: string } = getPassOnQuestion(
      pages,
      recordType,
    );

    Alert.alert(question.title, question.message, [
      { text: "Cancel", style: "cancel" },
      {
        text: PASS_ON_TEXT.button,
        onPress: (): void => {
          void passOn();
        },
      },
    ]);
  }, [pages, recordType, passOn]);

  const action: ResponseAction | null =
    pages.length > 0
      ? {
          label: PASS_ON_TEXT.button,
          accessibilityLabel: `Escalate this ${recordLabel}`,
          busyAccessibilityLabel: "Escalating",
          // Up the levels: escalating hands the page to the next one.
          icon: "arrow-up-circle-outline",
          onPress: askToPassOn,
        }
      : null;

  const acknowledgeAgainAction: ResponseAction | null = isPageAgain
    ? {
        label: PAGE_AGAIN_TEXT.button,
        accessibilityLabel: `Acknowledge this ${recordLabel} again`,
        busyAccessibilityLabel: "Acknowledging",
        icon: responseActionIcons.acknowledge,
        primary: true,
        // Two words that never break across lines: a row of its own on a phone.
        minWidth: PAGE_AGAIN_ACTION_MIN_WIDTH,
        onPress: acknowledgeAgain,
      }
    : null;

  return {
    action,
    passingOn,
    acknowledgeAgainAction,
    acknowledgingAgain,
    hasOpenPages: pages.length > 0,
    isPageAgain,
    isPagedToHelp,
    pagesSettled: query.isFetched || query.isError || !query.isEnabled,
    pagesKnown: query.isSuccess,
    askToPassOn,
    acknowledgeAgain,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
  };
}
