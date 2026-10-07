import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import {
  SLACK_HUDDLE_VIDEO_CALL_SOURCE,
  isSlackHuddleVideoCallSource,
} from "Common/Types/Workspace/NotificationRules/VideoCallNotificationRule";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  TranslatableTerm,
  Translator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import VideoCallProviderLogo from "../../VideoCall/VideoCallProviderLogo";

/*
 * The rule's video call step: whether the rule starts a call for the
 * incident or alert it fires for, and where the call is held - the huddle
 * of the rule's Slack channel, or one of the project's video call
 * connections. The call's Join button goes wherever the rule posts.
 *
 * The rule's conditions (the step before) decide which events get a call,
 * so "a bridge for Sev1 only" is a rule with a Severity condition.
 */

export interface ComponentProps {
  value: IncidentNotificationRule | undefined;
  onChange: (value: IncidentNotificationRule) => void;
  workspaceType: WorkspaceType;
  eventType: NotificationRuleEventType;
  connections: Array<VideoCallConnection>;
  error?: string | undefined;
}

interface SourceOption {
  value: string;
  provider: VideoCallProvider;
  joinUrl?: string | undefined;
  title: string;
  subtitle: string;
}

const NotificationRuleVideoCallForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rule: IncidentNotificationRule | undefined = props.value;
  const isOn: boolean = rule?.shouldStartVideoCall === true;
  const selected: string = rule?.videoCallSource || "";
  // Filled into the sentences below in the reader's language.
  const eventNoun: TranslatableTerm = translatableTerm(
    props.eventType === NotificationRuleEventType.Alert ? "alert" : "incident",
    { inSentence: true },
  );

  const update: (changes: Partial<IncidentNotificationRule>) => void = (
    changes: Partial<IncidentNotificationRule>,
  ): void => {
    props.onChange({
      ...(rule || ({} as IncidentNotificationRule)),
      ...changes,
    } as IncidentNotificationRule);
  };

  const options: Array<SourceOption> = [];

  if (props.workspaceType === WorkspaceType.Slack) {
    options.push({
      value: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
      provider: VideoCallProvider.SlackHuddle,
      title: translator.translateText("Slack huddle") || "Slack huddle",
      subtitle:
        translator.translateTemplate(
          "The huddle of the {{eventNoun}}'s Slack channel. Nothing to set up.",
          { eventNoun },
        ) || "",
    });
  }

  for (const connection of props.connections) {
    if (!connection.id || !connection.provider) {
      continue;
    }

    options.push({
      value: connection.id.toString(),
      provider: connection.provider,
      joinUrl:
        connection.provider === VideoCallProvider.CustomLink
          ? (connection.config?.["joinUrl"] as string | undefined)
          : undefined,
      title:
        connection.name || getVideoCallProviderDisplayName(connection.provider),
      subtitle:
        connection.provider === VideoCallProvider.CustomLink
          ? translator.translateText(
              "A standing link: every event shares this room.",
            ) || ""
          : translator.translateTemplate(
              "A new {{provider}} meeting for every {{eventNoun}}.",
              {
                provider: getVideoCallProviderDisplayName(connection.provider),
                eventNoun,
              },
            ) || "",
    });
  }

  /*
   * A rule saved with a connection that has since been deleted still names
   * it; say so rather than showing nothing selected.
   */
  const selectedIsMissing: boolean =
    isOn &&
    Boolean(selected) &&
    !options.some((option: SourceOption): boolean => {
      return option.value === selected;
    });

  const postsToAChannel: boolean = Boolean(
    rule?.shouldCreateNewChannel || rule?.shouldPostToExistingChannel,
  );

  return (
    <div data-testid="notification-rule-video-call-form" className="space-y-5">
      <Toggle
        dataTestId="notification-rule-video-call-toggle"
        title={translator.translateTemplate(
          "Start a video call for the {{eventNoun}}",
          { eventNoun },
        )}
        description={translator.translateTemplate(
          "When this rule fires, start one call for the {{eventNoun}} and post its Join button wherever this rule posts, in the {{eventNoun}}'s feed and on its page.",
          { eventNoun },
        )}
        value={isOn}
        onChange={(value: boolean) => {
          update({
            shouldStartVideoCall: value,
            // A single option is the obvious choice; preselect it.
            ...(value && !selected && options.length === 1
              ? { videoCallSource: options[0]!.value }
              : {}),
          });
        }}
      />

      {isOn && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText("Where is the call held?")}
          </p>

          {options.length > 0 && (
            <div
              role="radiogroup"
              aria-label={translator.translateText("Where is the call held?")}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {options.map((option: SourceOption): ReactElement => {
                const isSelected: boolean = option.value === selected;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-testid={`notification-rule-video-call-source-${option.value}`}
                    onClick={() => {
                      update({ videoCallSource: option.value });
                    }}
                    className={
                      isSelected
                        ? "flex items-start gap-3 rounded-lg border border-indigo-500 bg-indigo-50 p-3 text-left ring-1 ring-indigo-500 focus:outline-none focus-visible:ring-2"
                        : "flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    }
                  >
                    <VideoCallProviderLogo
                      provider={option.provider}
                      joinUrl={option.joinUrl}
                      size="md"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {option.subtitle}
                      </span>
                    </span>
                    {isSelected && (
                      <Icon
                        icon={IconProp.CheckCircle}
                        className="h-5 w-5 flex-shrink-0 text-indigo-600"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {props.connections.length === 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">
                {props.workspaceType === WorkspaceType.Slack
                  ? translator.translateText(
                      "Connect Zoom, Google Meet or Microsoft Teams to start a meeting there instead of a huddle.",
                    )
                  : translator.translateText(
                      "Connect Zoom, Google Meet or Microsoft Teams first: a Microsoft Teams rule starts its calls with one of the project's video call connections.",
                    )}
              </p>
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SETTINGS_VIDEO_CALLS] as Route,
                )}
                openInNewTab={true}
                className="inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                {translator.translateText("Connect a provider")}
                <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {selectedIsMissing && (
            <p
              role="alert"
              className="rounded-md bg-amber-50 p-3 text-sm text-gray-700 ring-1 ring-inset ring-gray-200"
            >
              {translator.translateText(
                "The connection this rule used was deleted. Pick another one.",
              )}
            </p>
          )}

          {isSlackHuddleVideoCallSource(selected) && !postsToAChannel && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-gray-700 ring-1 ring-inset ring-gray-200">
              <Icon
                icon={IconProp.Info}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
              />
              <span>
                {translator.translateText(
                  "A huddle is held in a Slack channel. Turn on Create Slack Channel or Post to Existing Slack Channel on the Destination step.",
                )}
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-gray-500">
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
            />
            <span>
              {translator.translateTemplate(
                "Rules that pick the same connection share one call per {{eventNoun}}. A call that cannot start is listed in the {{eventNoun}}'s feed and in the notification logs, and never holds up the {{eventNoun}}.",
                { eventNoun },
              )}
            </span>
          </div>
        </div>
      )}

      {props.error && (
        <p role="alert" className="text-sm text-red-600">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default NotificationRuleVideoCallForm;
