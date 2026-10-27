import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import {
  VideoCallProviderCatalog,
  VideoCallProviderDefinition,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  WorkspaceConnections,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import {
  VIDEO_CALL_ONE_CLICK_DOCS_PATH,
  isVideoCallOAuthAvailable,
  videoCallDocsUrl,
} from "./VideoCallApi";
import VideoCallProviderLogo from "./VideoCallProviderLogo";

/*
 * Every way a project can hold an incident call, side by side: the Slack
 * huddle that needs no setup, and the providers it connects once. A tile
 * says what the provider does and how many connections it already has, and
 * starts a connection in one click - a sign-in to the provider, where this
 * server has the provider's own app (isVideoCallOAuthAvailable).
 *
 * Colour classes are literal and limited to ones Theme.css re-colours for
 * the dark theme.
 *
 * The columns follow the gallery's own width, not the window's: beside the
 * Settings side menu a 1280px window leaves the gallery some 880px, where
 * five tiles side by side were 160px each and pushed their Connect buttons
 * out of the tile. A tile is at least some 15rem wide: two across from
 * 34rem, three from 51rem, all five from 78rem. A tile's footer wraps - its
 * guide link over its button - rather than run out of the tile in a
 * language with longer words.
 */

// The size container the gallery reads its width from: its own wrapper.
export const VIDEO_CALL_GALLERY_CONTAINER_CLASS_NAME: string =
  "w-full min-w-0 [container-type:inline-size]";

// Literal class names, so whatever reads the source for Tailwind finds them.
export const VIDEO_CALL_GALLERY_CLASS_NAME: string =
  "grid grid-cols-1 gap-4 [@container(min-width:34rem)]:grid-cols-2 [@container(min-width:51rem)]:grid-cols-3 [@container(min-width:78rem)]:grid-cols-5";

export const VIDEO_CALL_TILE_FOOTER_CLASS_NAME: string =
  "mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2";

export interface ComponentProps {
  connectionCounts: Partial<Record<VideoCallProvider, number>>;
  canConnect: boolean;
  connectDisabledReason?: string | undefined;
  onConnect: (provider: VideoCallProvider) => void;
}

const ProviderTile: FunctionComponent<{
  definition: VideoCallProviderDefinition;
  count: number;
  canConnect: boolean;
  connectDisabledReason?: string | undefined;
  onConnect: () => void;
}> = (props: {
  definition: VideoCallProviderDefinition;
  count: number;
  canConnect: boolean;
  connectDisabledReason?: string | undefined;
  onConnect: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const definition: VideoCallProviderDefinition = props.definition;

  const button: ReactElement = (
    <button
      type="button"
      data-testid={`video-call-connect-${definition.provider}`}
      disabled={!props.canConnect}
      onClick={props.onConnect}
      className={
        props.canConnect
          ? "inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          : "inline-flex cursor-not-allowed items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-400 ring-1 ring-inset ring-gray-200"
      }
    >
      <Icon icon={IconProp.Add} className="h-4 w-4" />
      {props.count > 0
        ? translator.translateText("Add another")
        : translator.translateText("Connect")}
    </button>
  );

  return (
    <li
      data-testid={`video-call-provider-${definition.provider}`}
      className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <VideoCallProviderLogo provider={definition.provider} size="lg" />
        {props.count > 0 && (
          <span
            data-testid={`video-call-provider-count-${definition.provider}`}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
          >
            <Icon icon={IconProp.Check} className="h-3 w-3" />
            {translator.translatePlural(
              { one: "{{count}} connected", other: "{{count}} connected" },
              props.count,
            )}
          </span>
        )}
      </div>

      {/* A product name is a brand, never translated; a meeting link is not one. */}
      <p className="mt-3 text-sm font-semibold text-gray-900">
        {definition.provider === VideoCallProvider.CustomLink
          ? translator.translateText(definition.title)
          : definition.title}
      </p>
      <p className="mt-1 flex-1 text-sm text-gray-500">
        {translator.translateText(definition.description)}
      </p>

      <div
        className={VIDEO_CALL_TILE_FOOTER_CLASS_NAME}
        data-testid={`video-call-provider-footer-${definition.provider}`}
      >
        <Link
          to={videoCallDocsUrl(
            isVideoCallOAuthAvailable(definition.provider)
              ? VIDEO_CALL_ONE_CLICK_DOCS_PATH
              : definition.docsPath,
          )}
          openInNewTab={true}
          className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-gray-500 hover:text-indigo-600"
        >
          {isVideoCallOAuthAvailable(definition.provider)
            ? translator.translateText("How it works")
            : translator.translateText("Setup guide")}
          <Icon icon={IconProp.ExternalLink} className="h-3 w-3" />
        </Link>
        {props.canConnect || !props.connectDisabledReason ? (
          button
        ) : (
          <Tooltip text={props.connectDisabledReason}>{button}</Tooltip>
        )}
      </div>
    </li>
  );
};

/*
 * The Slack huddle needs no connection of its own: it is the huddle of the
 * incident's Slack channel. Its tile says whether Slack is connected, which
 * is all it needs.
 */
const SlackHuddleTile: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const connections: WorkspaceConnections = useWorkspaceConnections();
  const isSlackConnected: boolean = Boolean(
    connections.connected?.includes(WorkspaceType.Slack),
  );

  return (
    <li
      data-testid={`video-call-provider-${VideoCallProvider.SlackHuddle}`}
      className="flex flex-col rounded-xl border border-gray-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <VideoCallProviderLogo
          provider={VideoCallProvider.SlackHuddle}
          size="lg"
        />
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
          {translator.translateText("Built in")}
        </span>
      </div>

      <p className="mt-3 text-sm font-semibold text-gray-900">
        {translator.translateText("Slack huddle")}
      </p>
      <p className="mt-1 flex-1 text-sm text-gray-500">
        {translator.translateText(
          "The huddle of the incident's own Slack channel. No setup: pick Slack huddle in a Slack notification rule, and the Join button starts it.",
        )}
      </p>

      <div className="mt-4 flex items-center gap-2 text-xs font-medium">
        {connections.connected === null ? (
          <span className="text-gray-400">
            {translator.translateText("Checking Slack…")}
          </span>
        ) : isSlackConnected ? (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
            {translator.translateText("Ready: Slack is connected")}
          </span>
        ) : (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_SLACK_INTEGRATION] as Route,
            )}
            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700"
          >
            {translator.translateText("Connect Slack first")}
            <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
          </Link>
        )}
      </div>
    </li>
  );
};

const VideoCallProviderGallery: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className={VIDEO_CALL_GALLERY_CONTAINER_CLASS_NAME}
      data-testid="video-call-provider-gallery-container"
    >
      <ul
        data-testid="video-call-provider-gallery"
        className={VIDEO_CALL_GALLERY_CLASS_NAME}
      >
        <SlackHuddleTile />
        {VideoCallProviderCatalog.map(
          (definition: VideoCallProviderDefinition): ReactElement => {
            return (
              <ProviderTile
                key={definition.provider}
                definition={definition}
                count={props.connectionCounts[definition.provider] || 0}
                canConnect={props.canConnect}
                connectDisabledReason={props.connectDisabledReason}
                onConnect={() => {
                  props.onConnect(definition.provider);
                }}
              />
            );
          },
        )}
      </ul>
    </div>
  );
};

export default VideoCallProviderGallery;
