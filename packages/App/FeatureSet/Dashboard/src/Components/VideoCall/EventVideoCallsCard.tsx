import AlertVideoCall from "Common/Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  TranslatableTerm,
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import StartVideoCallModal from "./StartVideoCallModal";
import { EventVideoCall, VideoCallEventKind } from "./useEventVideoCalls";
import VideoCallProviderLogo, {
  getDisplayedVideoCallProvider,
} from "./VideoCallProviderLogo";

/*
 * The incident's (or alert's) calls, on its page: the newest first and
 * largest, with a Join button that opens it, then any earlier ones. A
 * responder who may start calls can start one here - a new meeting, the
 * Slack huddle or a link of their own - and remove one that is no longer
 * used.
 */

export interface ComponentProps {
  kind: VideoCallEventKind;
  eventId: ObjectID;
  calls: Array<EventVideoCall>;
  // Whether the calls of this event have been read once.
  hasLoaded: boolean;
  error?: string | undefined;
  // A call was started or removed: refresh the calls and the feed.
  onChanged: () => void;
  onRetry: () => void;
}

/*
 * What a call is called on the page, in English; the card shows it through
 * the translator. A link of one's own is called by its title, a standing
 * link by its connection's name, and a meeting by its provider.
 */
export function getVideoCallHeadline(call: EventVideoCall): string {
  if (call.provider === VideoCallProvider.CustomLink && call.title) {
    return call.title;
  }

  switch (getDisplayedVideoCallProvider(call.provider, call.joinUrl)) {
    case VideoCallProvider.Zoom:
      return translationKey("Zoom meeting");
    case VideoCallProvider.GoogleMeet:
      return translationKey("Google Meet call");
    case VideoCallProvider.MicrosoftTeams:
      return translationKey("Microsoft Teams meeting");
    case VideoCallProvider.SlackHuddle:
      return translationKey("Slack huddle");
    default:
      return (
        call.videoCallConnection?.name ||
        call.title ||
        translationKey("Video call")
      );
  }
}

const CallRow: FunctionComponent<{
  call: EventVideoCall;
  isPrimary: boolean;
  canRemove: boolean;
  onRemove: () => void;
}> = (props: {
  call: EventVideoCall;
  isPrimary: boolean;
  canRemove: boolean;
  onRemove: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const call: EventVideoCall = props.call;
  const joinUrl: string = call.joinUrl || "";

  const startedBy: string = call.workspaceNotificationRuleId
    ? translator.translateText("Started automatically by a workspace rule") ||
      ""
    : call.createdByUser?.name || call.createdByUser?.email
      ? translator.translateTemplate("Started by {{name}}", {
          name:
            call.createdByUser?.name?.toString() ||
            call.createdByUser?.email?.toString() ||
            "",
        })
      : translator.translateText("Started from the API") || "";

  const startedAt: string = call.createdAt
    ? OneUptimeDate.fromNow(OneUptimeDate.fromString(call.createdAt))
    : "";

  const isHuddle: boolean = call.provider === VideoCallProvider.SlackHuddle;

  return (
    <li
      data-testid="event-video-call"
      className={
        props.isPrimary
          ? "rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
          : "flex items-center gap-3 py-3"
      }
    >
      <div className="flex items-start gap-3">
        <VideoCallProviderLogo
          provider={call.provider}
          joinUrl={joinUrl}
          size={props.isPrimary ? "lg" : "md"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">
            {translator.translateText(getVideoCallHeadline(call))}
          </p>
          {props.isPrimary &&
            call.title &&
            call.provider !== VideoCallProvider.CustomLink && (
              <p className="truncate text-sm text-gray-600">{call.title}</p>
            )}
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {startedAt ? `${startedBy} · ${startedAt}` : startedBy}
          </p>
        </div>
        {!props.isPrimary && (
          <a
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="event-video-call-join-secondary"
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
          >
            {translator.translateText(isHuddle ? "Join huddle" : "Join")}
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {props.isPrimary && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a
            href={joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="event-video-call-join"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <Icon icon={IconProp.VideoCamera} className="h-4 w-4" />
            {translator.translateText(isHuddle ? "Join huddle" : "Join call")}
          </a>
          <CopyTextButton
            textToBeCopied={joinUrl}
            label="Copy link"
            size="md"
            variant="soft"
          />
          {props.canRemove && (
            <Button
              title="Remove"
              icon={IconProp.Trash}
              buttonStyle={ButtonStyleType.ICON}
              buttonSize={ButtonSize.Small}
              ariaLabel={translator.translateText("Remove this call")}
              tooltip={translator.translateText(
                "Remove this call from the page. The meeting itself is not deleted.",
              )}
              onClick={props.onRemove}
            />
          )}
        </div>
      )}
    </li>
  );
};

const EventVideoCallsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [callToRemove, setCallToRemove] = useState<EventVideoCall | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);

  const model: IncidentVideoCall | AlertVideoCall =
    props.kind === VideoCallEventKind.Incident
      ? new IncidentVideoCall()
      : new AlertVideoCall();

  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );
  const deleteGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Delete,
  );

  // Filled into the sentences below in the reader's language.
  const eventNoun: TranslatableTerm = translatableTerm(
    props.kind === VideoCallEventKind.Incident ? "incident" : "alert",
    { inSentence: true },
  );

  const [primary, ...earlier] = props.calls;

  let body: ReactElement;

  if (!props.hasLoaded && props.calls.length === 0) {
    body = <ComponentLoader />;
  } else if (props.error) {
    body = (
      <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
    );
  } else if (!primary) {
    /*
     * Most events never get a call, so the empty card is one quiet row
     * rather than a panel that pushes the details down.
     */
    body = (
      <div
        data-testid="event-video-calls-empty"
        className="flex flex-col gap-3 rounded-lg border border-dashed border-gray-300 px-4 py-3 sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Icon icon={IconProp.VideoCamera} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {translator.translateText("No call yet")}
            </p>
            <p className="text-xs text-gray-500">
              {translator.translateTemplate(
                "Start a dedicated call so the {{eventNoun}}'s responders can talk it through.",
                { eventNoun },
              )}
            </p>
          </div>
        </div>
        {createGate.isAllowed && (
          <div className="flex-shrink-0">
            <Button
              title="Start call"
              icon={IconProp.VideoCamera}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              dataTestId="event-video-call-start"
              onClick={() => {
                setIsStarting(true);
              }}
            />
          </div>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-2">
        <ul>
          <CallRow
            call={primary}
            isPrimary={true}
            canRemove={deleteGate.isAllowed}
            onRemove={() => {
              setCallToRemove(primary);
            }}
          />
        </ul>
        {earlier.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText("Earlier calls")}
            </p>
            <ul className="divide-y divide-gray-100">
              {earlier.map((call: EventVideoCall): ReactElement => {
                return (
                  <CallRow
                    key={call.id?.toString()}
                    call={call}
                    isPrimary={false}
                    canRemove={false}
                    onRemove={() => {}}
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title="Video Call"
        description={
          props.kind === VideoCallEventKind.Incident
            ? "Where this incident's responders talk it through."
            : "Where this alert's responders talk it through."
        }
        headerLayout="stacked"
        buttons={
          primary && createGate.isAllowed
            ? [
                {
                  title: "Start another",
                  icon: IconProp.Add,
                  buttonStyle: ButtonStyleType.NORMAL,
                  onClick: () => {
                    setIsStarting(true);
                  },
                },
              ]
            : []
        }
      >
        <div data-testid="event-video-calls-card">{body}</div>
      </Card>

      {isStarting && (
        <StartVideoCallModal
          kind={props.kind}
          eventId={props.eventId}
          onClose={() => {
            setIsStarting(false);
          }}
          onStarted={() => {
            setIsStarting(false);
            props.onChanged();
          }}
        />
      )}

      {callToRemove && (
        <ConfirmModal
          title="Remove this call?"
          description={translator.translateTemplate(
            "“{{call}}” is removed from this {{eventNoun}}'s page. The meeting itself is not deleted, and anyone with the link can still join it.",
            {
              call:
                translator.translateText(getVideoCallHeadline(callToRemove)) ||
                getVideoCallHeadline(callToRemove),
              eventNoun,
            },
          )}
          submitButtonText="Remove"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={removeError}
          onClose={() => {
            setCallToRemove(null);
            setRemoveError(undefined);
          }}
          onSubmit={async () => {
            setIsRemoving(true);
            setRemoveError(undefined);

            try {
              if (props.kind === VideoCallEventKind.Incident) {
                await ModelAPI.deleteItem<IncidentVideoCall>({
                  modelType: IncidentVideoCall,
                  id: callToRemove.id!,
                });
              } else {
                await ModelAPI.deleteItem<AlertVideoCall>({
                  modelType: AlertVideoCall,
                  id: callToRemove.id!,
                });
              }

              setIsRemoving(false);
              setCallToRemove(null);
              props.onChanged();
            } catch (err) {
              setIsRemoving(false);
              setRemoveError(API.getFriendlyErrorMessage(err as Error));
            }
          }}
        />
      )}
    </Fragment>
  );
};

export default EventVideoCallsCard;
