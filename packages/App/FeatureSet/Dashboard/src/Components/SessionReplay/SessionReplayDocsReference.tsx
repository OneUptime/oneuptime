import React, { FunctionComponent, ReactElement } from "react";
import { DOCS_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import { SETUP_GUIDE_DOCS_PATH } from "./SessionReplaySetupGuide";
import { TROUBLESHOOTING_DOCS_PATH } from "./RecordingHealthCard";

/*
 * The rest of the session replay docs, one tile per section, below the setup
 * guide on the Session Replay > Documentation page. The guide covers getting
 * the first recording in; these are the questions that come after it.
 *
 * Each anchor is a heading slug on the docs page, pinned against the markdown
 * by App/Tests/Dashboard/SessionReplayDocumentationPage.test.ts so a renamed
 * heading fails a test instead of landing people at the top of the page.
 */

export interface SessionReplayDocsTopic {
  title: string;
  description: string;
  icon: IconProp;
  docsPath: string;
  anchor?: string | undefined;
}

export const SESSION_REPLAY_DOCS_TOPICS: Array<SessionReplayDocsTopic> = [
  {
    title: "Install",
    description:
      "Script tag attributes, the init global, and what a healthy install looks like in the Network tab.",
    icon: IconProp.Code,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "install",
  },
  {
    title: "Identify your users",
    description:
      "Group sessions by person with identify(), and how anonymous visitors are grouped without it.",
    icon: IconProp.User,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "identify-your-users",
  },
  {
    title: "JavaScript API",
    description:
      "track, setTags, captureSession, consent, onSessionChange and getDiagnostics.",
    icon: IconProp.Terminal,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "javascript-api",
  },
  {
    title: "Privacy",
    description:
      "Masking modes, what is always masked, allowed origins, consent and Do Not Track.",
    icon: IconProp.Lock,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "privacy",
  },
  {
    title: "Content Security Policy",
    description:
      "The script-src and connect-src entries the recorder needs to load and upload.",
    icon: IconProp.ShieldCheck,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "content-security-policy",
  },
  {
    title: "Correlating with your other telemetry",
    description:
      "How your own origin's requests link backend traces and logs automatically, the step for APIs on another origin, sampling and the off switch.",
    icon: IconProp.Workflow,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "correlating-with-your-other-telemetry",
  },
  {
    title: "Watching a session",
    description:
      "The session list and its search tokens, the Users page, the player and keyboard shortcuts.",
    icon: IconProp.Play,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "watching-a-session",
  },
  {
    title: "Recording health",
    description: "Every health state, what it means and what to do about it.",
    icon: IconProp.Heartbeat,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "recording-health",
  },
  {
    title: "Recording a specific user's next session",
    description:
      "Arm a one-shot target for a customer whose problem you cannot reproduce.",
    icon: IconProp.Film,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "recording-a-specific-users-next-session",
  },
  {
    title: "Retention and deletion",
    description: "How long recordings are kept and how to erase sessions.",
    icon: IconProp.Archive,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "retention-and-deletion",
  },
  {
    title: "Who can watch a recording",
    description:
      "The permissions for listing, playing back and auditing recordings.",
    icon: IconProp.Eye,
    docsPath: SETUP_GUIDE_DOCS_PATH,
    anchor: "who-can-watch-a-recording",
  },
  {
    title: "Troubleshooting",
    description:
      "Every recorder diagnostics code and what to do when nothing is recorded.",
    icon: IconProp.Wrench,
    docsPath: TROUBLESHOOTING_DOCS_PATH,
  },
];

export function buildSessionReplayDocsUrl(topic: SessionReplayDocsTopic): URL {
  return URL.fromString(
    `${DOCS_URL.toString()}${topic.docsPath}${
      topic.anchor ? `#${topic.anchor}` : ""
    }`,
  );
}

const SessionReplayDocsReference: FunctionComponent = (): ReactElement => {
  return (
    <Card
      title="Session Replay Reference"
      description="Everything beyond the first recording. Each topic opens the full documentation in a new tab."
    >
      <div
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        data-testid="session-replay-docs-reference"
      >
        {SESSION_REPLAY_DOCS_TOPICS.map(
          (topic: SessionReplayDocsTopic): ReactElement => {
            return (
              <Link
                key={topic.title}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/40"
                openInNewTab={true}
                to={buildSessionReplayDocsUrl(topic)}
              >
                <>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-50">
                    <Icon
                      icon={topic.icon}
                      className="h-4 w-4 text-indigo-600"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {topic.title}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {topic.description}
                    </div>
                  </div>
                </>
              </Link>
            );
          },
        )}
      </div>
    </Card>
  );
};

export default SessionReplayDocsReference;
