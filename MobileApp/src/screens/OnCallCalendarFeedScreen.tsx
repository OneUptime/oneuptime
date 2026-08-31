import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  Linking,
  Share,
  Alert,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";
import { useProject } from "../hooks/useProject";
import { useNow } from "../hooks/useNow";
import { useOnCallCalendarFeed } from "../hooks/useOnCallCalendarFeed";
import { getAuthorizedProjects } from "../hooks/authorizedProjects";
import { getServerUrl } from "../storage/serverUrl";
import { copyToClipboard } from "../utils/clipboard";
import { getFriendlyErrorMessage } from "../utils/error";
import GradientButton from "../components/GradientButton";
import SectionHeader from "../components/SectionHeader";
import SkeletonCard from "../components/SkeletonCard";
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
  const { lightImpact, successFeedback, errorFeedback, selectionFeedback } =
    useHaptics();
  const now: number = useNow();
  const { projectList } = useProject();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>("");
  const [notice, setNotice] = useState<FeedNotice>(null);

  /*
   * Which project to open on.
   *
   * Not simply the first one: a project that enforces SSO answers 406 until
   * the handset has completed that login, and picking it by default would
   * greet the user with a failure they did not ask for (and record a fresh
   * SSO denial against the project on the way). `getAuthorizedProjects` is
   * the same filter every other per-project query in the app runs through.
   * If none of them are authorized the first project is still used - the
   * screen then explains the SSO refusal, which beats showing nothing.
   */
  useEffect((): (() => void) => {
    let cancelled: boolean = false;

    if (projectId || projectList.length === 0) {
      return (): void => {
        cancelled = true;
      };
    }

    const fallbackProjectId: string = projectList[0]!._id;

    getAuthorizedProjects(projectList)
      .then((authorized: ProjectItem[]) => {
        if (!cancelled) {
          setProjectId(authorized[0]?._id ?? fallbackProjectId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectId(fallbackProjectId);
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [projectId, projectList]);

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

  const selectedProject: ProjectItem | undefined = projectList.find(
    (project: ProjectItem) => {
      return project._id === projectId;
    },
  );

  const onRefresh: () => Promise<void> = async (): Promise<void> => {
    lightImpact();
    await feed.refetch();
  };

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

  const renderProjectPicker: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (projectList.length <= 1) {
        return null;
      }

      return (
        <View style={{ marginBottom: 24 }}>
          <SectionHeader title="Project" iconName="folder-open-outline" />
          <View style={{ gap: 8 }}>
            {projectList.map((project: ProjectItem) => {
              const isSelected: boolean = project._id === projectId;

              return (
                <Pressable
                  key={project._id}
                  testID={`feed-project-${project._id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Show calendar link for ${project.name}`}
                  onPress={() => {
                    selectionFeedback();
                    setNotice(null);
                    setProjectId(project._id);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 14,
                    paddingHorizontal: 16,
                    borderRadius: 14,
                    backgroundColor: theme.colors.backgroundElevated,
                    borderWidth: 1,
                    borderColor: isSelected
                      ? theme.colors.oncallActive + "55"
                      : theme.colors.borderGlass,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 14,
                      fontWeight: "600",
                      color: theme.colors.textPrimary,
                    }}
                    numberOfLines={1}
                  >
                    {project.name}
                  </Text>
                  {isSelected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={theme.colors.oncallActive}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    };

  const renderNotice: () => React.JSX.Element | null =
    (): React.JSX.Element | null => {
      if (!notice) {
        return null;
      }

      return (
        <View
          testID={`feed-notice-${notice.kind}`}
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 12,
            backgroundColor:
              notice.kind === "error"
                ? theme.colors.statusErrorBg
                : theme.colors.statusSuccessBg,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              lineHeight: 18,
              color:
                notice.kind === "error"
                  ? theme.colors.statusError
                  : theme.colors.statusSuccess,
            }}
          >
            {notice.text}
          </Text>
        </View>
      );
    };

  const renderBody: () => React.JSX.Element = (): React.JSX.Element => {
    if (projectList.length === 0) {
      return (
        <InfoCard testID="feed-no-projects">
          You are not a member of any project yet, so there is nothing to
          subscribe to.
        </InfoCard>
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
        <InfoCard testID="feed-unsupported" tone="warning">
          This OneUptime server does not offer calendar feeds yet. Ask whoever
          runs it to upgrade, then come back here.
        </InfoCard>
      );
    }

    if (feed.isSsoRequired) {
      return (
        <View testID="feed-sso-required">
          <InfoCard tone="warning">
            {`${
              selectedProject ? selectedProject.name : "This project"
            } requires an SSO sign-in before the server will answer for it. Authenticate under Settings → Projects, then come back.`}
          </InfoCard>
          <GradientButton
            testID="retry-feed"
            label="Try again"
            variant="secondary"
            onPress={() => {
              feed.refetch();
            }}
            style={{ marginTop: 12 }}
          />
        </View>
      );
    }

    if (feed.isError || !status) {
      return (
        <View testID="feed-error">
          <InfoCard tone="error">
            {`Could not load your calendar link. ${getFriendlyErrorMessage(
              feed.error,
            )}`}
          </InfoCard>
          <GradientButton
            testID="retry-feed"
            label="Try again"
            variant="secondary"
            onPress={() => {
              feed.refetch();
            }}
            style={{ marginTop: 12 }}
          />
        </View>
      );
    }

    if (!status.exists) {
      return (
        <View testID="feed-empty">
          <InfoCard>
            {`No calendar link yet${
              selectedProject ? ` for ${selectedProject.name}` : ""
            }. Generate one and every on-call shift you hold there - including shifts you cover for others - shows up in your calendar app.`}
          </InfoCard>
          <GradientButton
            testID="generate-feed"
            label="Generate calendar link"
            icon="calendar-outline"
            loading={feed.isRotating}
            onPress={rotate}
            style={{ marginTop: 16 }}
          />
          {renderNotice()}
        </View>
      );
    }

    return (
      <View testID="feed-active">
        {!status.isEnabled ? (
          <View testID="feed-disabled" style={{ marginBottom: 16 }}>
            <InfoCard tone="warning">
              This link is switched off. Calendar apps that have it see an empty
              calendar until it is enabled again.
            </InfoCard>
            <GradientButton
              testID="enable-feed"
              label="Enable link"
              variant="secondary"
              loading={feed.isUpdating}
              onPress={enable}
              style={{ marginTop: 12 }}
            />
          </View>
        ) : null}

        {status.needsRegeneration ? (
          <View testID="feed-needs-regeneration" style={{ marginBottom: 16 }}>
            <InfoCard tone="warning">
              This link can no longer be read by the server (its encryption key
              changed). Regenerate it and subscribe again.
            </InfoCard>
            <GradientButton
              testID="regenerate-feed-now"
              label="Regenerate link"
              icon="refresh-outline"
              loading={feed.isRotating}
              onPress={rotate}
              style={{ marginTop: 12 }}
            />
          </View>
        ) : null}

        {links ? (
          <View
            testID="feed-link-box"
            style={{
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: theme.colors.backgroundTertiary,
              borderWidth: 1,
              borderColor: theme.colors.borderSubtle,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: theme.colors.textTertiary,
              }}
            >
              Your private link
            </Text>
            <Text
              testID="feed-https-url"
              selectable
              style={{
                fontSize: 13,
                marginTop: 6,
                lineHeight: 18,
                color: theme.colors.textPrimary,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            >
              {links.https}
            </Text>
          </View>
        ) : null}

        <Text
          testID="feed-fetch-status"
          style={{
            fontSize: 12,
            marginTop: 10,
            marginLeft: 4,
            color: theme.colors.textTertiary,
          }}
        >
          {describeFetchStatus(status, now)}
        </Text>

        {links ? (
          <View style={{ marginTop: 16, gap: 10 }}>
            {Platform.OS === "ios" ? (
              <>
                <GradientButton
                  testID="open-in-calendar"
                  label="Open in Calendar"
                  icon="calendar-outline"
                  onPress={openInCalendar}
                />
                <Text
                  testID="ios-subscribe-hint"
                  style={{
                    fontSize: 12,
                    lineHeight: 17,
                    marginHorizontal: 4,
                    color: theme.colors.textTertiary,
                  }}
                >
                  {IOS_SUBSCRIBE_HINT}
                </Text>
              </>
            ) : (
              <Text
                testID="android-subscribe-hint"
                style={{
                  fontSize: 13,
                  lineHeight: 19,
                  marginHorizontal: 4,
                  marginBottom: 2,
                  color: theme.colors.textSecondary,
                }}
              >
                {ANDROID_SUBSCRIBE_HINT}
              </Text>
            )}

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
        ) : null}

        {renderNotice()}

        {links?.differsFromServer ? (
          <InfoCard testID="feed-rebuilt-note" style={{ marginTop: 16 }}>
            {`This link uses the address this app connects to. Your server says its public address is ${
              links.serverHost ?? "different"
            } - use whichever your calendar app can reach.`}
          </InfoCard>
        ) : null}

        {status.hostWarning ? (
          <InfoCard
            testID="feed-host-warning"
            tone="warning"
            style={{ marginTop: 16 }}
          >
            {status.hostWarning}
          </InfoCard>
        ) : null}

        {status.protocolWarning ? (
          <InfoCard
            testID="feed-protocol-warning"
            tone="warning"
            style={{ marginTop: 16 }}
          >
            {status.protocolWarning}
          </InfoCard>
        ) : null}

        {status.lastRenderTruncated ? (
          <InfoCard
            testID="feed-truncated-warning"
            tone="warning"
            style={{ marginTop: 16 }}
          >
            The last time a calendar app fetched this link, the server had to
            shorten it: not every shift made it in. Shorten the window on the
            web to fix this.
          </InfoCard>
        ) : null}

        {looksUnreachable(status, now) ? (
          <InfoCard
            testID="feed-unreachable-hint"
            tone="warning"
            style={{ marginTop: 16 }}
          >
            Nothing has fetched this link in two days. Google Calendar and
            Outlook on the web fetch from their own servers, so this OneUptime
            server has to be reachable from the internet for them.
          </InfoCard>
        ) : null}

        <InfoCard testID="feed-refresh-copy" style={{ marginTop: 16 }}>
          {REFRESH_CADENCE_COPY}
        </InfoCard>

        <Text
          style={{
            fontSize: 12,
            lineHeight: 17,
            marginTop: 12,
            marginHorizontal: 4,
            color: theme.colors.textTertiary,
          }}
        >
          {PLANNING_ONLY_COPY}
        </Text>

        <GradientButton
          testID="regenerate-feed"
          label="Regenerate link"
          icon="refresh-outline"
          variant="secondary"
          loading={feed.isRotating}
          onPress={() => {
            lightImpact();
            confirmRegenerate();
          }}
          style={{ marginTop: 20 }}
        />
      </View>
    );
  };

  return (
    <ScrollView
      testID="calendar-feed-scroll"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: theme.colors.backgroundPrimary }}
      contentContainerStyle={{ padding: 20, paddingBottom: 56 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={onRefresh}
          tintColor={theme.colors.actionPrimary}
        />
      }
    >
      <View
        style={{
          borderRadius: 18,
          padding: 18,
          marginBottom: 24,
          backgroundColor: theme.colors.backgroundElevated,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
              backgroundColor: theme.colors.iconBackground,
            }}
          >
            <Ionicons
              name="calendar-outline"
              size={16}
              color={theme.colors.actionPrimary}
            />
          </View>
          <Text
            style={{
              flex: 1,
              fontSize: 16,
              fontWeight: "700",
              color: theme.colors.textPrimary,
            }}
          >
            Your shifts, in your calendar
          </Text>
        </View>
        <Text
          style={{
            fontSize: 13,
            lineHeight: 19,
            marginTop: 10,
            color: theme.colors.textSecondary,
          }}
        >
          Subscribe once from Google Calendar, Outlook or Apple Calendar and
          your on-call shifts stay in step with the schedule. The link is
          private to you - treat it like a password.
        </Text>
      </View>

      {renderProjectPicker()}

      {renderBody()}
    </ScrollView>
  );
}

function InfoCard({
  children,
  tone = "info",
  testID,
  style,
}: {
  children: React.ReactNode;
  tone?: "info" | "warning" | "error";
  testID?: string;
  style?: { marginTop?: number; marginBottom?: number };
}): React.JSX.Element {
  const { theme } = useTheme();

  const color: string =
    tone === "warning"
      ? theme.colors.severityWarning
      : tone === "error"
        ? theme.colors.statusError
        : theme.colors.textSecondary;

  const background: string =
    tone === "warning"
      ? theme.colors.severityWarningBg
      : tone === "error"
        ? theme.colors.statusErrorBg
        : theme.colors.backgroundElevated;

  const border: string =
    tone === "info" ? theme.colors.borderGlass : color + "33";

  return (
    <View
      testID={testID}
      style={{
        borderRadius: 14,
        padding: 14,
        backgroundColor: background,
        borderWidth: 1,
        borderColor: border,
        ...style,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          lineHeight: 19,
          color: tone === "info" ? theme.colors.textSecondary : color,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
