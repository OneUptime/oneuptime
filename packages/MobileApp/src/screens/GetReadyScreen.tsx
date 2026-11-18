import React from "react";
import { Platform, ScrollView, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useTheme } from "../theme";
import { radius, spacing } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useContentGutters } from "../layout/WindowLayout";
import type { ContentGutters } from "../layout/windowLayout";
import { useHaptics } from "../hooks/useHaptics";
import { useProject } from "../hooks/useProject";
import { useCurrentUserId } from "../hooks/useCurrentUserId";
import {
  type CriticalAlertsState,
  useCriticalAlerts,
} from "../hooks/useCriticalAlerts";
import {
  type NotificationPermission,
  useNotificationPermission,
} from "../hooks/useNotificationPermission";
import {
  type TestPageFromApp,
  useTestPageFromApp,
} from "../hooks/useTestPageFromApp";
import { getPhoneSettingsActionLabel } from "../notifications/criticalAlerts";
import {
  GET_READY_TEXT,
  GetReadyStep,
  GetReadyStepState,
  type GetReadyStepView,
  type GetReadySteps,
  NotificationPermissionState,
  buildGetReadySteps,
} from "../onboarding/getReady";
import AppText from "../components/AppText";
import Card from "../components/Card";
import GradientButton from "../components/GradientButton";
import { withAlpha } from "../utils/color";

/*
 * GET READY FOR ON-CALL (#7041): the app's first steps, on one screen.
 *
 * Opened by itself once, on a new install's first launch
 * (GetReadyFirstRun), and from Settings whenever the person wants. Three
 * steps, in the order that decides whether a page wakes them
 * (onboarding/getReady.ts): allow notifications, ring through silent mode,
 * and a test page sent to themselves and acknowledged from its
 * notification. The next step to do is marked, and its button is the
 * screen's one primary action. Not Now puts the screen away - nothing
 * nags - and each step keeps its state for the next visit.
 */

type StepTone = "secondary" | "success" | "warning" | "danger";

interface StepAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}

interface StepPresentation {
  view: GetReadyStepView;
  // Where it stands, in a line under its description.
  detail?: string | undefined;
  detailTone?: StepTone | undefined;
  action?: StepAction | undefined;
}

function StepMarker({
  index,
  view,
}: {
  index: number;
  view: GetReadyStepView;
}): React.JSX.Element {
  const { theme } = useTheme();
  const isDone: boolean = view.state === GetReadyStepState.Done;
  const isUnavailable: boolean = view.state === GetReadyStepState.Unavailable;

  const background: string = isDone
    ? theme.colors.statusSuccess
    : view.isNext
      ? theme.colors.actionPrimary
      : theme.colors.backgroundTertiary;

  const foreground: string =
    isDone || view.isNext
      ? theme.colors.textInverse
      : theme.colors.textSecondary;

  return (
    <View
      testID={`get-ready-step-${view.step}-marker`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
      }}
    >
      {isDone ? (
        <Ionicons name="checkmark" size={18} color={foreground} />
      ) : isUnavailable ? (
        <Ionicons name="remove" size={18} color={foreground} />
      ) : (
        <AppText variant="subhead" weight="700" color={foreground}>
          {String(index + 1)}
        </AppText>
      )}
    </View>
  );
}

function StepCard({
  index,
  presentation,
}: {
  index: number;
  presentation: StepPresentation;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { view, detail, detailTone, action } = presentation;
  const isDone: boolean = view.state === GetReadyStepState.Done;

  const highlighted: ViewStyle | undefined = view.isNext
    ? {
        borderWidth: 1.5,
        borderColor: withAlpha(theme.colors.actionPrimary, 0.55),
      }
    : undefined;

  const spokenState: string = isDone
    ? "Done"
    : view.state === GetReadyStepState.Unavailable
      ? GET_READY_TEXT.unavailable
      : view.isNext
        ? "Next step"
        : "To do";

  return (
    <Card testID={`get-ready-step-${view.step}`} style={highlighted}>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <StepMarker index={index} view={view} />
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
          <AppText
            variant="headline"
            accessibilityLabel={`Step ${index + 1}: ${view.title}. ${spokenState}.`}
            testID={`get-ready-step-${view.step}-title`}
          >
            {view.title}
          </AppText>
          <AppText variant="subhead" tone="secondary">
            {view.description}
          </AppText>
          {detail ? (
            <AppText
              variant="footnote"
              tone={detailTone || "secondary"}
              weight={
                detailTone && detailTone !== "secondary" ? "600" : undefined
              }
              testID={`get-ready-step-${view.step}-detail`}
              selectable
            >
              {detail}
            </AppText>
          ) : null}
          {action ? (
            <View style={{ marginTop: spacing.sm, alignSelf: "stretch" }}>
              <GradientButton
                label={action.label}
                onPress={action.onPress}
                loading={action.loading}
                disabled={action.disabled}
                size="sm"
                variant={view.isNext ? "primary" : "secondary"}
                testID={`get-ready-step-${view.step}-action`}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function ProgressLine({ steps }: { steps: GetReadySteps }): React.JSX.Element {
  const { theme } = useTheme();
  const share: number =
    steps.totalCount > 0 ? steps.doneCount / steps.totalCount : 0;

  return (
    <View style={{ gap: spacing.xs }} testID="get-ready-progress">
      <AppText variant="footnote" tone="secondary" weight="600">
        {`${steps.doneCount} of ${steps.totalCount} done`}
      </AppText>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: steps.totalCount,
          now: steps.doneCount,
        }}
        style={{
          height: 6,
          borderRadius: radius.pill,
          backgroundColor: theme.colors.backgroundTertiary,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${Math.round(share * 100)}%`,
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: steps.isFinished
              ? theme.colors.statusSuccess
              : theme.colors.actionPrimary,
          }}
        />
      </View>
    </View>
  );
}

export default function GetReadyScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const gutters: ContentGutters = useContentGutters();
  const navigation: { goBack: () => void; canGoBack?: () => boolean } =
    useNavigation();
  const { selectionFeedback, successFeedback } = useHaptics();
  const { activeProject } = useProject();
  const userId: string | null = useCurrentUserId();

  const notifications: NotificationPermission = useNotificationPermission();
  const criticalAlerts: CriticalAlertsState = useCriticalAlerts();
  const testPage: TestPageFromApp = useTestPageFromApp({
    projectId: activeProject?._id || null,
    userId: userId,
  });

  const steps: GetReadySteps = buildGetReadySteps({
    platform:
      Platform.OS === "ios"
        ? "ios"
        : Platform.OS === "android"
          ? "android"
          : "other",
    notifications: notifications.state,
    criticalAlerts: {
      // Read once the OS has answered: the hook says why it stands as it does.
      isChecking: !criticalAlerts.statusMessage,
      isSupported: criticalAlerts.isSupported,
      isEnabled: criticalAlerts.isEnabled,
      isOffInPhoneSettings: Boolean(criticalAlerts.offInPhoneSettings),
    },
    testPage: {
      isAcknowledged: testPage.state.kind === "acknowledged",
    },
  });

  const present: (view: GetReadyStepView) => StepPresentation = (
    view: GetReadyStepView,
  ): StepPresentation => {
    if (view.state === GetReadyStepState.Unavailable) {
      return { view, detail: GET_READY_TEXT.unavailable };
    }

    if (view.step === GetReadyStep.Notifications) {
      if (view.state === GetReadyStepState.OffInPhoneSettings) {
        return {
          view,
          detail: GET_READY_TEXT.notificationsOff,
          detailTone: "warning",
          action: {
            label: GET_READY_TEXT.openSettings,
            onPress: () => {
              void notifications.allow();
            },
          },
        };
      }

      if (view.state === GetReadyStepState.ToDo) {
        return {
          view,
          action: {
            label: GET_READY_TEXT.allowNotifications,
            loading: notifications.isAsking,
            onPress: () => {
              selectionFeedback();
              void notifications.allow();
            },
          },
        };
      }

      return { view };
    }

    if (view.step === GetReadyStep.CriticalAlerts) {
      if (
        view.state === GetReadyStepState.OffInPhoneSettings &&
        criticalAlerts.offInPhoneSettings
      ) {
        const label: string | undefined = getPhoneSettingsActionLabel(
          criticalAlerts.offInPhoneSettings.place,
        );

        return {
          view,
          detail: `${criticalAlerts.offInPhoneSettings.title} ${criticalAlerts.offInPhoneSettings.message}`,
          detailTone:
            criticalAlerts.offInPhoneSettings.tone === "danger"
              ? "danger"
              : "warning",
          action: label
            ? {
                label: label,
                onPress: () => {
                  void criticalAlerts.openPhoneSettings();
                },
              }
            : undefined,
        };
      }

      if (view.state === GetReadyStepState.ToDo) {
        const needsNotifications: boolean =
          notifications.state !== NotificationPermissionState.Granted &&
          notifications.state !== NotificationPermissionState.Unavailable;

        return {
          view,
          detail:
            criticalAlerts.error ||
            (needsNotifications
              ? GET_READY_TEXT.criticalNeedsNotifications
              : undefined),
          detailTone: criticalAlerts.error ? "warning" : "secondary",
          action: {
            label: GET_READY_TEXT.turnOnCriticalAlerts,
            loading: criticalAlerts.isBusy,
            onPress: () => {
              selectionFeedback();
              void criticalAlerts.setEnabled(true);
            },
          },
        };
      }

      return { view };
    }

    // The test page.
    switch (testPage.state.kind) {
      case "acknowledged":
        return {
          view,
          detail: testPage.state.statusMessage,
          detailTone: "success",
        };
      case "sending":
        return {
          view,
          action: {
            label: GET_READY_TEXT.sending,
            loading: true,
            disabled: true,
            onPress: () => {},
          },
        };
      case "paging":
        return {
          view,
          detail: testPage.state.statusMessage
            ? `${GET_READY_TEXT.waiting} ${testPage.state.statusMessage}`
            : GET_READY_TEXT.waiting,
          detailTone: "secondary",
        };
      case "ended":
        return {
          view,
          detail: testPage.state.statusMessage,
          detailTone: "warning",
          action: {
            label: GET_READY_TEXT.sendAnother,
            onPress: () => {
              selectionFeedback();
              void testPage.send();
            },
          },
        };
      case "failed":
        return {
          view,
          detail: testPage.state.message,
          detailTone: "danger",
          action: {
            label: GET_READY_TEXT.sendTestPage,
            onPress: () => {
              selectionFeedback();
              void testPage.send();
            },
          },
        };
      case "checking":
        return { view };
      default:
        return {
          view,
          action: {
            label: GET_READY_TEXT.sendTestPage,
            onPress: () => {
              selectionFeedback();
              void testPage.send();
            },
          },
        };
    }
  };

  const close: () => void = (): void => {
    if (steps.isFinished) {
      successFeedback();
    }

    navigation.goBack();
  };

  return (
    <ScrollView
      testID="get-ready-screen"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        ...gutters,
        paddingBottom: bottomPadding,
        gap: spacing.lg,
      }}
    >
      <View style={{ gap: spacing.sm }}>
        <AppText
          accessibilityRole="header"
          variant="title2"
          weight="700"
          testID="get-ready-heading"
        >
          {steps.isFinished
            ? GET_READY_TEXT.readyTitle
            : GET_READY_TEXT.heading}
        </AppText>
        <AppText variant="body" tone="secondary" testID="get-ready-intro">
          {steps.isFinished
            ? GET_READY_TEXT.readyMessage
            : GET_READY_TEXT.intro}
        </AppText>
        <ProgressLine steps={steps} />
      </View>

      {steps.steps.map(
        (view: GetReadyStepView, index: number): React.JSX.Element => {
          return (
            <StepCard
              key={view.step}
              index={index}
              presentation={present(view)}
            />
          );
        },
      )}

      <GradientButton
        label={steps.isFinished ? GET_READY_TEXT.done : GET_READY_TEXT.notNow}
        variant={steps.isFinished ? "primary" : "ghost"}
        onPress={close}
        testID="get-ready-close"
      />
    </ScrollView>
  );
}
