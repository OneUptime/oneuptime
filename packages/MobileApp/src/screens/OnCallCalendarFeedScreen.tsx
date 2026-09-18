import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  ScrollView,
  Platform,
  Linking,
  Share,
  Alert,
  RefreshControl,
  Pressable,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { radius, spacing, touchTarget } from "../theme/tokens";
import { useScreenPadding } from "../hooks/useScreenPadding";
import { useRefresh } from "../hooks/useRefresh";
import ScreenIntro from "../components/ScreenIntro";
import { useHaptics } from "../hooks/useHaptics";
import { useActiveProject } from "../hooks/useProject";
import { useNow } from "../hooks/useNow";
import { useOnCallCalendarFeed } from "../hooks/useOnCallCalendarFeed";
import { getServerUrl } from "../storage/serverUrl";
import { copyToClipboard } from "../utils/clipboard";
import { getFriendlyErrorMessage } from "../utils/error";
import GradientButton from "../components/GradientButton";
import SectionHeader from "../components/SectionHeader";
import SkeletonCard from "../components/SkeletonCard";
import AppText from "../components/AppText";
import Banner from "../components/Banner";
import Card from "../components/Card";
import EmptyState from "../components/EmptyState";
import IconBadge from "../components/IconBadge";
import StatusPill, {
  getToneColors,
  type StatusTone,
} from "../components/StatusPill";
import {
  ANDROID_SUBSCRIBE_HINT,
  IOS_SUBSCRIBE_HINT,
  PLANNING_ONLY_COPY,
  REFRESH_CADENCE_COPY,
  REGENERATE_WARNING_COPY,
  buildFeedLinks,
  describeFetchStatus,
  looksUnreachable,
  type FeedLinks,
} from "../oncall/calendarFeedLinks";
import type { OnCallCalendarFeedStatus, ProjectItem } from "../api/types";

/*
 * "Put my shifts in my calendar."
 *
 * One link per project: the server mints a secret URL, the calendar app polls
 * it. This screen never sees the secret itself - only the URLs the server has
 * already built around it - and the only things it can DO are generate,
 * regenerate, enable and hand the link somewhere.
 *
 * The two platforms get different primary actions because they can do
 * different things with a webcal link. iOS has a native "Subscribe" sheet
 * behind `Linking.openURL("webcals://...")`; Android has nothing - the
 * Google Calendar app cannot add a calendar by URL, so the honest action is
 * to get the link onto a computer, and the copy says so.
 */

type FeedNotice = { kind: "success" | "error"; text: string } | null;

export default function OnCallCalendarFeedScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const bottomPadding: number = useScreenPadding();
  const { lightImpact, successFeedback, errorFeedback, selectionFeedback } =
    useHaptics();
  const now: number = useNow();
  const { projectList } = useActiveProject();

  const projectId: string | null = projectList[0]?._id ?? null;
  const [serverUrl, setServerUrl] = useState<string>("");
  const [notice, setNotice] = useState<FeedNotice>(null);
  const [revealedLink, setRevealedLink] = useState<string | null>(null);

  useEffect((): void => {
    getServerUrl().then(setServerUrl);
  }, []);

  const feed: ReturnType<typeof useOnCallCalendarFeed> =
    useOnCallCalendarFeed(projectId);

  const status: OnCallCalendarFeedStatus | null = feed.status;

  const links: FeedLinks | null = useMemo((): FeedLinks | null => {
    if (!status || !serverUrl) {
      return null;
    }

    return buildFeedLinks(serverUrl, status);
  }, [status, serverUrl]);

  const privateLinkIdentity: string | null = links
    ? `${projectId}:${links.https}`
    : null;
  const isPrivateLinkVisible: boolean = Boolean(
    privateLinkIdentity && revealedLink === privateLinkIdentity,
  );
  useEffect((): void => {
    setRevealedLink(null);
    setNotice(null);
  }, [projectId, links?.https]);

  const selectedProject: ProjectItem | undefined = projectList.find(
    (project: ProjectItem) => {
      return project._id === projectId;
    },
  );

  const { refreshing, onRefresh } = useRefresh(async (): Promise<void> => {
    lightImpact();
    await feed.refetch();
  });

  const rotate: () => Promise<void> = async (): Promise<void> => {
    setNotice(null);

    try {
      await feed.rotate();
      successFeedback();
    } catch (err: unknown) {
      errorFeedback();
      setNotice({ kind: "error", text: getFriendlyErrorMessage(err) });
    }
  };

  const confirmRegenerate: () => void = (): void => {
    Alert.alert("Regenerate this link?", REGENERATE_WARNING_COPY, [
      { text: "Keep current link", style: "cancel" },
      {
        text: "Regenerate",
        style: "destructive",
        onPress: () => {
          rotate();
        },
      },
    ]);
  };

  const enable: () => Promise<void> = async (): Promise<void> => {
    setNotice(null);

    try {
      await feed.setEnabled(true);
      successFeedback();
    } catch (err: unknown) {
      errorFeedback();
      setNotice({ kind: "error", text: getFriendlyErrorMessage(err) });
    }
  };

  const openInCalendar: () => Promise<void> = async (): Promise<void> => {
    if (!links) {
      return;
    }

    setNotice(null);
    lightImpact();

    try {
      await Linking.openURL(links.webcal);
    } catch {
      /*
       * No handler for webcal(s):// on this device, or the Calendar app
       * refused. The link is still on screen; Settings can add it by hand.
       */
      setNotice({
        kind: "error",
        text: "Could not open the Calendar app. Copy the link instead and add it under Settings → Calendar → Accounts → Add Subscribed Calendar.",
      });
    }
  };

  const shareLink: () => Promise<void> = async (): Promise<void> => {
    if (!links) {
      return;
    }

    setNotice(null);
    lightImpact();

    try {
      await Share.share({
        title: "OneUptime on-call calendar",
        message: [
          `Your OneUptime on-call shifts${
            selectedProject ? ` for ${selectedProject.name}` : ""
          }:`,
          links.https,
          "",
          "This link is private - anyone who has it can see your shifts.",
        ].join("\n"),
      });
    } catch (err: unknown) {
      setNotice({ kind: "error", text: getFriendlyErrorMessage(err) });
    }
  };

  const copyLink: () => Promise<void> = async (): Promise<void> => {
    if (!links) {
      return;
    }

    lightImpact();

    if (copyToClipboard(links.https)) {
      selectionFeedback();
      setNotice({ kind: "success", text: "Link copied." });
      return;
    }

    /*
     * The clipboard module is not on this build. The share sheet has a Copy
     * action of its own on both platforms, so hand over to it.
     */
    await shareLink();
  };

  const renderNotice: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (!notice) {
        return null;
      }

      return (
        <Banner
          testID={`feed-notice-${notice.kind}`}
          tone={notice.kind === "error" ? "danger" : "success"}
          message={notice.text}
        />
      );
    };

  const renderRetry: () => React.JSX.Element = (): React.JSX.Element => {
    return (
      <GradientButton
        testID="retry-feed"
        label="Try again"
        icon="refresh-outline"
        variant="secondary"
        loading={refreshing}
        onPress={onRefresh}
      />
    );
  };

  const renderBody: () => React.JSX.Element = (): React.JSX.Element => {
    if (projectList.length === 0) {
      return (
        <Card testID="feed-no-projects" variant="outlined">
          <EmptyState
            compact
            icon="default"
            title="No projects yet"
            subtitle="You are not a member of any project yet, so there is nothing to subscribe to."
          />
        </Card>
      );
    }

    /*
     * `!projectId` is a loading state, not an error one: the project to ask
     * about is chosen in an effect, so the first commit of this screen always
     * has none. Without this the render below fell through to "Could not load
     * your calendar link - an unknown error occurred" for one frame, on a
     * screen that had not asked the server anything yet.
     */
    if (!projectId || feed.isLoading) {
      return (
        <View testID="feed-loading">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
        </View>
      );
    }

    if (feed.isUnsupported) {
      return (
        <Banner
          testID="feed-unsupported"
          tone="warning"
          icon="cloud-offline-outline"
          title="Not available on this server"
          message="This OneUptime server does not offer calendar feeds yet. Ask whoever runs it to upgrade, then come back here."
        />
      );
    }

    if (feed.isSsoRequired) {
      return (
        <View testID="feed-sso-required" style={{ gap: spacing.md }}>
          <Banner
            tone="warning"
            icon="lock-closed-outline"
            title="Sign-in required"
            message={`${
              selectedProject ? selectedProject.name : "This project"
            } requires an SSO sign-in before the server will answer for it. Authenticate under Settings → Projects, then come back.`}
          />
          {renderRetry()}
        </View>
      );
    }

    if (feed.isError || !status) {
      return (
        <View testID="feed-error" style={{ gap: spacing.md }}>
          <Banner
            tone="danger"
            title="Could not load your calendar link"
            message={getFriendlyErrorMessage(feed.error)}
          />
          {renderRetry()}
        </View>
      );
    }

    if (!status.exists) {
      return (
        <View testID="feed-empty" style={{ gap: spacing.lg }}>
          <Card testID="feed-empty-card">
            <IconBadge name="calendar-outline" size="lg" />
            <AppText
              variant="title3"
              accessibilityRole="header"
              style={{ marginTop: spacing.md }}
            >
              No calendar link yet
            </AppText>
            <AppText
              variant="subhead"
              tone="secondary"
              style={{ marginTop: spacing.xs }}
            >
              {`Generate a private link${
                selectedProject ? ` for ${selectedProject.name}` : ""
              } and every on-call shift you hold there - including shifts you cover for others - shows up in your calendar app.`}
            </AppText>
            <GradientButton
              testID="generate-feed"
              label="Generate calendar link"
              icon="calendar-outline"
              loading={feed.isRotating}
              onPress={rotate}
              style={{ marginTop: spacing.lg }}
            />
          </Card>
          {renderNotice()}
          <Card testID="feed-how-it-works" variant="outlined">
            <AppText variant="headline" accessibilityRole="header">
              How it works
            </AppText>
            <View style={{ marginTop: spacing.md, gap: spacing.md }}>
              <Step number={1}>
                Generate a private link that only you hold.
              </Step>
              <Step number={2}>
                Subscribe to it from Apple Calendar, Google Calendar or Outlook.
              </Step>
              <Step number={3}>
                Your shifts, including cover you take, stay in your calendar.
              </Step>
            </View>
          </Card>
        </View>
      );
    }

    const hasFetched: boolean =
      status.fetchCount > 0 || Boolean(status.lastFetchedAt);
    const statusTone: StatusTone = status.needsRegeneration
      ? "danger"
      : !status.isEnabled
        ? "warning"
        : hasFetched
          ? "success"
          : "info";
    const statusLabel: string = status.needsRegeneration
      ? "Needs regeneration"
      : !status.isEnabled
        ? "Switched off"
        : hasFetched
          ? "Active"
          : "Waiting for first sync";
    const statusColor: string = getToneColors(theme, statusTone).text;

    return (
      <View testID="feed-active" style={{ gap: spacing.lg }}>
        <Card testID="feed-status-card">
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
            }}
          >
            <IconBadge name="calendar" color={statusColor} />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <AppText variant="headline" accessibilityRole="header">
                Your subscription
              </AppText>
              <StatusPill
                testID="feed-status-pill"
                label={statusLabel}
                tone={statusTone}
                size="sm"
                dotColor={statusColor}
              />
            </View>
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.sm,
              marginTop: spacing.md,
              paddingTop: spacing.md,
              borderTopWidth: 1,
              borderTopColor: theme.colors.borderSubtle,
            }}
          >
            <Ionicons
              name="sync-outline"
              size={15}
              color={theme.colors.textTertiary}
              style={{ marginTop: 2 }}
            />
            <AppText
              testID="feed-fetch-status"
              variant="footnote"
              tone="secondary"
              style={{ flex: 1 }}
            >
              {describeFetchStatus(status, now)}
            </AppText>
          </View>
        </Card>

        {!status.isEnabled ? (
          <View testID="feed-disabled" style={{ gap: spacing.md }}>
            <Banner
              tone="warning"
              message="This link is switched off. Calendar apps that have it see an empty calendar until it is enabled again."
            />
            <GradientButton
              testID="enable-feed"
              label="Enable link"
              icon="power-outline"
              variant="secondary"
              loading={feed.isUpdating}
              onPress={enable}
            />
          </View>
        ) : null}

        {status.needsRegeneration ? (
          <View testID="feed-needs-regeneration" style={{ gap: spacing.md }}>
            <Banner
              tone="warning"
              message="This link can no longer be read by the server (its encryption key changed). Regenerate it and subscribe again."
            />
            <GradientButton
              testID="regenerate-feed-now"
              label="Regenerate link"
              icon="refresh-outline"
              loading={feed.isRotating}
              onPress={rotate}
            />
          </View>
        ) : null}

        {status.hostWarning ? (
          <Banner
            testID="feed-host-warning"
            tone="warning"
            message={status.hostWarning}
          />
        ) : null}

        {status.protocolWarning ? (
          <Banner
            testID="feed-protocol-warning"
            tone="warning"
            message={status.protocolWarning}
          />
        ) : null}

        {status.lastRenderTruncated ? (
          <Banner
            testID="feed-truncated-warning"
            tone="warning"
            message="The last time a calendar app fetched this link, the server had to shorten it: not every shift made it in. Shorten the window on the web to fix this."
          />
        ) : null}

        {looksUnreachable(status, now) ? (
          <Banner
            testID="feed-unreachable-hint"
            tone="warning"
            message="Nothing has fetched this link in two days. Google Calendar and Outlook on the web fetch from their own servers, so this OneUptime server has to be reachable from the internet for them."
          />
        ) : null}

        {links ? (
          <Card testID="feed-link-box">
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.md,
              }}
            >
              <IconBadge name="lock-closed-outline" />
              <AppText
                variant="headline"
                accessibilityRole="header"
                style={{ flex: 1 }}
              >
                Your private link
              </AppText>
              <Pressable
                testID="toggle-private-link"
                accessibilityRole="button"
                accessibilityLabel={
                  isPrivateLinkVisible
                    ? "Hide private link"
                    : "Show private link"
                }
                accessibilityState={{ expanded: isPrivateLinkVisible }}
                aria-expanded={isPrivateLinkVisible}
                onPress={() => {
                  setRevealedLink(
                    isPrivateLinkVisible ? null : privateLinkIdentity,
                  );
                }}
                hitSlop={4}
                style={({ pressed }: { pressed: boolean }): ViewStyle => {
                  return {
                    minHeight: touchTarget,
                    minWidth: touchTarget,
                    paddingHorizontal: spacing.md,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: spacing.xs + 2,
                    borderRadius: radius.pill,
                    backgroundColor: pressed
                      ? theme.colors.backgroundTertiary
                      : theme.colors.cardAccent,
                  };
                }}
              >
                <Ionicons
                  name={
                    isPrivateLinkVisible ? "eye-off-outline" : "eye-outline"
                  }
                  size={16}
                  color={theme.colors.actionPrimary}
                />
                <AppText variant="subhead" weight="600" tone="accent">
                  {isPrivateLinkVisible ? "Hide" : "Show"}
                </AppText>
              </Pressable>
            </View>

            <View
              testID="feed-link-field"
              style={{
                marginTop: spacing.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                backgroundColor: theme.colors.backgroundTertiary,
              }}
            >
              {isPrivateLinkVisible ? (
                <AppText
                  testID="feed-https-url"
                  selectable
                  variant="footnote"
                  tone="secondary"
                  style={{ fontFamily: MONOSPACE_FONT }}
                >
                  {links.https}
                </AppText>
              ) : (
                <AppText
                  testID="feed-link-concealed"
                  variant="footnote"
                  tone="tertiary"
                  accessibilityLabel="Link hidden"
                  style={{ fontFamily: MONOSPACE_FONT, letterSpacing: 1 }}
                >
                  https://•••••••••••••••••••••
                </AppText>
              )}
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.sm,
                marginTop: spacing.md,
              }}
            >
              <Ionicons
                name="shield-checkmark-outline"
                size={16}
                color={theme.colors.textTertiary}
                style={{ marginTop: 1 }}
              />
              <AppText
                testID="feed-privacy-warning"
                variant="footnote"
                tone="secondary"
                style={{ flex: 1 }}
              >
                This link is private to you — treat it like a password. Anyone
                who has it can see your shifts.
              </AppText>
            </View>

            <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
              {Platform.OS === "ios" ? (
                <GradientButton
                  testID="open-in-calendar"
                  label="Open in Calendar"
                  icon="calendar-outline"
                  onPress={openInCalendar}
                />
              ) : null}
              <GradientButton
                testID="share-feed"
                label="Share link"
                icon="share-outline"
                variant={Platform.OS === "ios" ? "secondary" : "primary"}
                onPress={shareLink}
              />
              <GradientButton
                testID="copy-feed"
                label="Copy https link"
                icon="copy-outline"
                variant="secondary"
                onPress={copyLink}
              />
            </View>

            {links.differsFromServer ? (
              <Banner
                testID="feed-rebuilt-note"
                tone="info"
                message={`This link uses the address this app connects to. Your server says its public address is ${
                  links.serverHost ?? "different"
                } - use whichever your calendar app can reach.`}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
          </Card>
        ) : null}

        {renderNotice()}

        {links ? (
          <Card testID="feed-how-to-subscribe">
            <AppText variant="headline" accessibilityRole="header">
              How to subscribe
            </AppText>
            <View style={{ marginTop: spacing.md, gap: spacing.md }}>
              {Platform.OS === "ios" ? (
                <>
                  <Step number={1}>
                    Tap Open in Calendar to subscribe, or copy the link into
                    another calendar app.
                  </Step>
                  <Step number={2} testID="ios-subscribe-hint">
                    {IOS_SUBSCRIBE_HINT}
                  </Step>
                </>
              ) : (
                <>
                  <Step number={1}>
                    Share the link with yourself, then add it to Google Calendar
                    or Outlook on a computer.
                  </Step>
                  <Step number={2} testID="android-subscribe-hint">
                    {ANDROID_SUBSCRIBE_HINT}
                  </Step>
                </>
              )}
            </View>
          </Card>
        ) : null}

        <Card testID="feed-refresh-card" variant="outlined">
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
            }}
          >
            <IconBadge
              name="time-outline"
              color={theme.colors.textSecondary}
              size="sm"
            />
            <AppText
              variant="headline"
              accessibilityRole="header"
              style={{ flex: 1 }}
            >
              How often it updates
            </AppText>
          </View>
          <AppText
            testID="feed-refresh-copy"
            variant="subhead"
            tone="secondary"
            style={{ marginTop: spacing.md }}
          >
            {REFRESH_CADENCE_COPY}
          </AppText>
          <AppText
            variant="footnote"
            tone="tertiary"
            style={{ marginTop: spacing.sm }}
          >
            {PLANNING_ONLY_COPY}
          </AppText>
        </Card>

        <View style={{ marginTop: spacing.md }}>
          <SectionHeader title="Manage your link" iconName="key-outline" />
          <Card testID="feed-manage-card">
            <AppText variant="subhead" tone="secondary">
              Generate a replacement if this private link was shared by mistake.
              You will need to subscribe again.
            </AppText>
            <GradientButton
              testID="regenerate-feed"
              label="Regenerate link"
              icon="refresh-outline"
              variant="destructive"
              loading={feed.isRotating}
              onPress={() => {
                lightImpact();
                confirmRegenerate();
              }}
              style={{ marginTop: spacing.lg }}
            />
          </Card>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      testID="calendar-feed-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingBottom: bottomPadding,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <ScreenIntro
        title="Calendar sync"
        description="Your on-call schedule, alongside the rest of your day."
        style={{ marginBottom: spacing.md }}
      />
      {projectList[0] ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "flex-start",
            gap: spacing.xs + 2,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs + 2,
            marginBottom: spacing.xl,
            borderRadius: radius.pill,
            backgroundColor: theme.colors.backgroundTertiary,
          }}
        >
          <Ionicons
            name="folder-open-outline"
            size={14}
            color={theme.colors.textSecondary}
          />
          <AppText
            testID="calendar-project-name"
            variant="footnote"
            weight="600"
            tone="secondary"
          >
            {`Project: ${projectList[0].name}`}
          </AppText>
        </View>
      ) : (
        <View style={{ height: spacing.sm }} />
      )}

      {renderBody()}
    </ScrollView>
  );
}

const MONOSPACE_FONT: string = Platform.OS === "ios" ? "Menlo" : "monospace";

function Step({
  number,
  children,
  testID,
}: {
  number: number;
  children: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.md,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.cardAccent,
        }}
      >
        <AppText variant="caption" weight="700" tone="accent">
          {String(number)}
        </AppText>
      </View>
      <AppText
        testID={testID}
        variant="subhead"
        tone="secondary"
        style={{ flex: 1 }}
      >
        {children}
      </AppText>
    </View>
  );
}
