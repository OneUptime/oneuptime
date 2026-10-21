import AlertVideoCall from "Common/Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "Common/Types/VideoCall/VideoCallProvider";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  TranslatableTerm,
  Translator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  WorkspaceConnections,
  useWorkspaceConnections,
} from "../../Utils/Workspace/ConnectedWorkspaces";
import { VideoCallEventKind } from "./useEventVideoCalls";
import VideoCallProviderLogo from "./VideoCallProviderLogo";

/*
 * Start a call for an incident or alert from its page: a new meeting with
 * one of the project's connections, the huddle of its Slack channel, or a
 * link of one's own. The call is posted wherever the event's updates go, as
 * a call a workspace rule starts is.
 */

const SLACK_HUDDLE_OPTION: string = "slack-huddle";
const OWN_LINK_OPTION: string = "own-link";

export interface ComponentProps {
  kind: VideoCallEventKind;
  eventId: ObjectID;
  onClose: () => void;
  onStarted: () => void;
}

interface CallOption {
  value: string;
  provider: VideoCallProvider;
  joinUrl?: string | undefined;
  title: string;
  subtitle: string;
}

const StartVideoCallModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const workspaces: WorkspaceConnections = useWorkspaceConnections();
  const [connections, setConnections] = useState<Array<VideoCallConnection>>(
    [],
  );
  const [isLoadingConnections, setIsLoadingConnections] =
    useState<boolean>(true);
  const [selected, setSelected] = useState<string>("");
  const [ownLink, setOwnLink] = useState<string>("");
  const [ownTitle, setOwnTitle] = useState<string>("");
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Filled into the sentences below in the reader's language.
  const eventNoun: TranslatableTerm = translatableTerm(
    props.kind === VideoCallEventKind.Incident ? "incident" : "alert",
    { inSentence: true },
  );

  useEffect(() => {
    ModelAPI.getList({
      modelType: VideoCallConnection,
      query: { projectId: ProjectUtil.getCurrentProjectId()! },
      select: { _id: true, name: true, provider: true },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    })
      .then((result: ListResult<VideoCallConnection>) => {
        setConnections(result.data);
        setIsLoadingConnections(false);
      })
      .catch(() => {
        // Without them a link of one's own still works.
        setConnections([]);
        setIsLoadingConnections(false);
      });
  }, []);

  const options: Array<CallOption> = connections
    .filter((connection: VideoCallConnection): boolean => {
      return Boolean(connection.id && connection.provider);
    })
    .map((connection: VideoCallConnection): CallOption => {
      return {
        value: connection.id!.toString(),
        provider: connection.provider!,
        title:
          connection.name ||
          getVideoCallProviderDisplayName(connection.provider),
        subtitle:
          connection.provider === VideoCallProvider.CustomLink
            ? translator.translateText("Standing meeting link") || ""
            : translator.translateTemplate("A new {{provider}} meeting", {
                provider: getVideoCallProviderDisplayName(connection.provider),
              }),
      };
    });

  if (workspaces.connected?.includes(WorkspaceType.Slack)) {
    options.push({
      value: SLACK_HUDDLE_OPTION,
      provider: VideoCallProvider.SlackHuddle,
      title: translator.translateText("Slack huddle") || "Slack huddle",
      subtitle: translator.translateTemplate(
        "The huddle of this {{eventNoun}}'s Slack channel",
        { eventNoun },
      ),
    });
  }

  options.push({
    value: OWN_LINK_OPTION,
    provider: VideoCallProvider.CustomLink,
    joinUrl: ownLink,
    title: translator.translateText("A link of your own") || "",
    subtitle:
      translator.translateText("Paste any meeting or bridge link") || "",
  });

  const effectiveSelection: string =
    selected || (options.length === 1 ? OWN_LINK_OPTION : "");

  const start: () => Promise<void> = async (): Promise<void> => {
    setError(undefined);

    if (!effectiveSelection) {
      setError(translator.translateText("Pick where the call is held."));
      return;
    }

    if (effectiveSelection === OWN_LINK_OPTION && !ownLink.trim()) {
      setError(translator.translateText("Paste the meeting link."));
      return;
    }

    setIsStarting(true);

    try {
      const call: IncidentVideoCall | AlertVideoCall =
        props.kind === VideoCallEventKind.Incident
          ? new IncidentVideoCall()
          : new AlertVideoCall();

      call.projectId = ProjectUtil.getCurrentProjectId()!;

      if (call instanceof IncidentVideoCall) {
        call.incidentId = props.eventId;
      } else {
        call.alertId = props.eventId;
      }

      if (effectiveSelection === SLACK_HUDDLE_OPTION) {
        call.provider = VideoCallProvider.SlackHuddle;
      } else if (effectiveSelection === OWN_LINK_OPTION) {
        call.joinUrl = ownLink.trim();

        if (ownTitle.trim()) {
          call.title = ownTitle.trim();
        }
      } else {
        call.videoCallConnectionId = new ObjectID(effectiveSelection);
      }

      if (call instanceof IncidentVideoCall) {
        await ModelAPI.create<IncidentVideoCall>({
          model: call,
          modelType: IncidentVideoCall,
        });
      } else {
        await ModelAPI.create<AlertVideoCall>({
          model: call as AlertVideoCall,
          modelType: AlertVideoCall,
        });
      }

      setIsStarting(false);
      props.onStarted();
    } catch (err) {
      setIsStarting(false);
      setError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  return (
    <Modal
      title={translator.translateTemplate(
        "Start a call for this {{eventNoun}}",
        {
          eventNoun,
        },
      )}
      description={translator.translateTemplate(
        "Its Join button is posted to the {{eventNoun}}'s Slack and Microsoft Teams channels and its feed.",
        { eventNoun },
      )}
      modalWidth={ModalWidth.Medium}
      submitButtonText={
        effectiveSelection === OWN_LINK_OPTION ? "Add call" : "Start call"
      }
      isLoading={isStarting}
      error={error}
      onClose={props.onClose}
      onSubmit={() => {
        void start();
      }}
    >
      <div className="space-y-4">
        {isLoadingConnections ? (
          <ComponentLoader />
        ) : (
          <div
            role="radiogroup"
            aria-label={translator.translateText("Where is the call held?")}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            {options.map((option: CallOption): ReactElement => {
              const isSelected: boolean = option.value === effectiveSelection;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  data-testid={`start-video-call-option-${option.value}`}
                  onClick={() => {
                    setSelected(option.value);
                    setError(undefined);
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

        {effectiveSelection === OWN_LINK_OPTION && (
          <div className="space-y-3 rounded-lg bg-gray-50 p-4 ring-1 ring-inset ring-gray-200">
            <div>
              <label
                htmlFor="start-video-call-link"
                className="block text-sm font-medium text-gray-700"
              >
                {translator.translateText("Meeting link")}
              </label>
              <div className="mt-1">
                <Input
                  id="start-video-call-link"
                  dataTestId="start-video-call-link"
                  value={ownLink}
                  placeholder="https://example.zoom.us/j/1234567890"
                  onChange={(value: string) => {
                    setOwnLink(value);
                    setError(undefined);
                  }}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="start-video-call-title"
                className="block text-sm font-medium text-gray-700"
              >
                {translator.translateText("Title (optional)")}
              </label>
              <div className="mt-1">
                <Input
                  id="start-video-call-title"
                  dataTestId="start-video-call-title"
                  value={ownTitle}
                  placeholder={translator.translateText("War room")}
                  onChange={(value: string) => {
                    setOwnTitle(value);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {!isLoadingConnections && connections.length === 0 && (
          <p className="text-xs text-gray-500">
            {translator.translateText(
              "Want a new Zoom, Google Meet or Microsoft Teams meeting for every incident?",
            )}{" "}
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_VIDEO_CALLS] as Route,
              )}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              {translator.translateText("Connect a provider")}
            </Link>
          </p>
        )}
      </div>
    </Modal>
  );
};

export default StartVideoCallModal;
