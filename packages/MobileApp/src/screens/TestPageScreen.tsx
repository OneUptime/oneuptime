import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useContentGutters } from "../layout/WindowLayoutProvider";
import type { ContentGutters } from "../layout/windowLayout";
import { useHaptics } from "../hooks/useHaptics";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import GradientButton from "../components/GradientButton";
import IconBadge from "../components/IconBadge";
import {
  acknowledgeTestPage,
  fetchIsTestPageAcknowledged,
} from "../api/onCallTestPage";
import {
  TEST_PAGE_TEXT,
  isTestPageAcknowledged,
  type TestPageAnswer,
} from "../oncall/testPage";
import { getFriendlyErrorMessage } from "../utils/error";
import type { OnCallStackParamList } from "../navigation/types";

type TestPageRouteProp = RouteProp<OnCallStackParamList, "TestPage">;

type TestPageNavProp = NativeStackNavigationProp<
  OnCallStackParamList,
  "TestPage"
>;

/*
 * Where the screen stands:
 *
 *   checking       opened by a tap: asking whether it is acknowledged already
 *   open           waiting for the reader: Acknowledge test page
 *   acknowledging  asked: the button spins, and is not pressed twice
 *   acknowledged   it works - acknowledged now, or already
 *   failed         not acknowledged: why, and the button again
 */
type TestPageState =
  | { kind: "checking" }
  | { kind: "open" }
  | { kind: "acknowledging" }
  | { kind: "acknowledged" }
  | { kind: "failed"; message: string };

/*
 * A TEST PAGE'S OWN SCREEN (oncall/testPage.ts), opened from its push.
 *
 * It says what a test is - TEST, and nothing is wrong - and acknowledges it
 * from the push's own message, signed in as the reader, by the rule every
 * message of a test answers by: the Dashboard's result then says they
 * acknowledged it by push notification, and how fast. Opened by the push's
 * "Acknowledge test page", it does that once (`acknowledgeRequestId`): Back,
 * a fold or a re-render never does it again. Opened by a tap, it first asks
 * whether the reader acknowledged it already - from another of its messages,
 * say - and otherwise offers the button. It never says a test works that the
 * server did not confirm.
 */
export default function TestPageScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const { successFeedback, errorFeedback } = useHaptics();
  const route: TestPageRouteProp = useRoute<TestPageRouteProp>();
  const navigation: TestPageNavProp = useNavigation<TestPageNavProp>();
  const { messageId, projectId, acknowledgeRequestId } = route.params;

  const [state, setState] = useState<TestPageState>(
    acknowledgeRequestId ? { kind: "acknowledging" } : { kind: "checking" },
  );
  // The taps answered already, by their ids: each is answered once.
  const handledRequests: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set());
  /*
   * Opened by the push's action: once its request is taken out of the
   * params, there is nothing to ask - the answer is on its way, and a read
   * landing before it would offer the button meanwhile.
   */
  const wasAskedToAcknowledge: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  const acknowledge: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setState({ kind: "acknowledging" });

      try {
        const answer: TestPageAnswer = await acknowledgeTestPage(
          projectId,
          messageId,
        );

        if (!isMounted.current) {
          return;
        }

        if (isTestPageAcknowledged(answer)) {
          successFeedback();
          setState({ kind: "acknowledged" });
          return;
        }

        errorFeedback();
        setState({ kind: "failed", message: TEST_PAGE_TEXT.notAcknowledged });
      } catch (error: unknown) {
        if (!isMounted.current) {
          return;
        }

        errorFeedback();
        setState({
          kind: "failed",
          message: getFriendlyErrorMessage(error) || TEST_PAGE_TEXT.failed,
        });
      }
    }, [projectId, messageId, successFeedback, errorFeedback]);

  useEffect(() => {
    // "Acknowledge test page" under the push: once for each tap.
    if (acknowledgeRequestId) {
      if (handledRequests.current.has(acknowledgeRequestId)) {
        return;
      }

      handledRequests.current.add(acknowledgeRequestId);
      wasAskedToAcknowledge.current = true;
      navigation.setParams({ acknowledgeRequestId: undefined });
      void acknowledge();
      return;
    }

    if (wasAskedToAcknowledge.current) {
      return;
    }

    // A tap: is it acknowledged already?
    let isActive: boolean = true;

    fetchIsTestPageAcknowledged(projectId, messageId)
      .then((isAcknowledged: boolean) => {
        if (isActive) {
          setState(
            isAcknowledged ? { kind: "acknowledged" } : { kind: "open" },
          );
        }
      })
      .catch(() => {
        // Whether it is answered can't be read: the button still answers it.
        if (isActive) {
          setState({ kind: "open" });
        }
      });

    return () => {
      isActive = false;
    };
    // A new tap, or another test page, is asked about again.
  }, [acknowledgeRequestId, messageId, projectId]);

  const isAcknowledged: boolean = state.kind === "acknowledged";

  return (
    <ScrollView
      testID="test-page-screen"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        ...gutters,
        paddingBottom: bottomPadding,
      }}
    >
      <Card>
        <View style={{ alignItems: "center", gap: spacing.md }}>
          <IconBadge
            name={isAcknowledged ? "checkmark-circle" : "notifications"}
            color={
              isAcknowledged
                ? theme.colors.statusSuccess
                : theme.colors.actionPrimary
            }
            size="lg"
            shape="circle"
            testID="test-page-icon"
          />
          <AppText
            accessibilityRole="header"
            variant="title3"
            weight="700"
            align="center"
            testID="test-page-title"
          >
            {isAcknowledged
              ? TEST_PAGE_TEXT.answeredTitle
              : TEST_PAGE_TEXT.heading}
          </AppText>
          <AppText
            variant="body"
            tone="secondary"
            align="center"
            testID="test-page-message"
          >
            {isAcknowledged ? TEST_PAGE_TEXT.answered : TEST_PAGE_TEXT.message}
          </AppText>
        </View>
      </Card>

      {state.kind === "failed" ? (
        <Banner
          tone="danger"
          title={TEST_PAGE_TEXT.failedTitle}
          message={state.message}
          style={{ marginTop: spacing.lg }}
          testID="test-page-failed"
        />
      ) : null}

      <View style={{ marginTop: spacing.xl }}>
        {isAcknowledged ? (
          <GradientButton
            label="Done"
            variant="secondary"
            onPress={() => {
              navigation.goBack();
            }}
            testID="test-page-done"
          />
        ) : (
          <GradientButton
            label={
              state.kind === "acknowledging"
                ? TEST_PAGE_TEXT.acknowledging
                : state.kind === "checking"
                  ? TEST_PAGE_TEXT.checking
                  : TEST_PAGE_TEXT.acknowledgeButton
            }
            loading={state.kind === "acknowledging"}
            disabled={
              state.kind === "acknowledging" || state.kind === "checking"
            }
            onPress={() => {
              void acknowledge();
            }}
            testID="test-page-acknowledge"
          />
        )}
      </View>
    </ScrollView>
  );
}
