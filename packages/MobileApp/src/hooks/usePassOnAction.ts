import { useCallback, useState } from "react";
import { Alert } from "react-native";
import {
  QueryClient,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  fetchOnCallPassOnPages,
  passOnOnCallPages,
  type OnCallPageRecordType,
  type OnCallPassOnAnswer,
  type OnCallPassOnPage,
} from "../api/onCallPassOn";
import {
  PASS_ON_TEXT,
  getPassOnAnswer,
  getPassOnQuestion,
} from "../oncall/passOn";
import { useHaptics } from "./useHaptics";
import type { ResponseAction } from "../components/ResponseDetailLayout";

/*
 * "Pass it on" on a detail screen, for the person being paged about it.
 *
 * A push notification about a page opens the detail screen of what it is
 * about. Somebody who cannot take it - asleep at the wheel, on a plane, ill -
 * passes it on from there: the screen asks first, saying what passing on
 * will do, and then says what it did. The policy pages its next escalation
 * rule at once instead of waiting the rule out, and they are not paged about
 * it again.
 *
 * Anybody the policy is not paging gets no button: the screen is as it was.
 * So does anybody whose server cannot be asked (an older server, no
 * signal) - it is a shortcut, and acknowledging works as it always did.
 */

export interface PassOnControls {
  // The screen's "Pass it on" button, or null when there is nothing to pass on.
  action: ResponseAction | null;
  passingOn: boolean;
  // Reads again whether the person is being paged about it.
  refetch: () => Promise<void>;
}

export function usePassOnAction(data: {
  projectId: string;
  recordType: OnCallPageRecordType;
  recordId: string;
  // What the record is, for a screen reader: "incident", "alert episode".
  recordLabel: string;
  // After a page was passed on: the record's feed and timeline have news.
  onPassedOn?: (() => Promise<unknown> | void) | undefined;
}): PassOnControls {
  const { projectId, recordType, recordId, recordLabel, onPassedOn } = data;
  const queryClient: QueryClient = useQueryClient();
  const { successFeedback, errorFeedback } = useHaptics();
  const [passingOn, setPassingOn] = useState<boolean>(false);

  const query: UseQueryResult<OnCallPassOnPage[], Error> = useQuery({
    queryKey: ["on-call-pass-on", projectId, recordType, recordId],
    queryFn: () => {
      return fetchOnCallPassOnPages(projectId, recordType, recordId);
    },
    enabled: Boolean(projectId) && Boolean(recordId),
    // A shortcut: when the server cannot say, there is no button.
    retry: false,
  });

  const pages: OnCallPassOnPage[] = query.data ?? [];

  const passOn: () => Promise<void> = useCallback(async (): Promise<void> => {
    setPassingOn(true);

    try {
      const answers: OnCallPassOnAnswer[] = await passOnOnCallPages(
        projectId,
        recordType,
        recordId,
      );
      const answer: { title: string; message: string; passedOn: boolean } =
        getPassOnAnswer(answers);

      if (answer.passedOn) {
        await successFeedback();
      }

      Alert.alert(answer.title, answer.message);

      await Promise.allSettled([
        // Now they are not paged about it: the button goes.
        query.refetch(),
        // My Pages shows the page as passed on.
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

  const action: ResponseAction | null =
    pages.length > 0
      ? {
          label: PASS_ON_TEXT.button,
          accessibilityLabel: `Pass this ${recordLabel} page on`,
          busyAccessibilityLabel: "Passing the page on",
          icon: "play-skip-forward-outline",
          onPress: (): void => {
            const question: { title: string; message: string } =
              getPassOnQuestion(pages);

            Alert.alert(question.title, question.message, [
              { text: "Cancel", style: "cancel" },
              {
                text: PASS_ON_TEXT.button,
                onPress: (): void => {
                  void passOn();
                },
              },
            ]);
          },
        }
      : null;

  return {
    action,
    passingOn,
    refetch: async (): Promise<void> => {
      await query.refetch();
    },
  };
}
