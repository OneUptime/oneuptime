import Project from "Common/Models/DatabaseModels/Project";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { useProjectCanSend } from "Common/UI/Utils/ServerSending";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProjectCanSendAnswer } from "Common/Types/ServerSending/ProjectCanSend";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { getProjectChannelSwitchTestId } from "./NotificationChannelOffPanel";
import ProjectNotificationChannelsStore, {
  fetchProjectNotificationChannels,
  isKnownNotToChangeProjectNotificationChannels,
} from "./ProjectNotificationChannels";
import ProjectNotificationChannelsCopy, {
  EnabledProjectChannels,
  PROJECT_NOTIFICATION_CHANNELS,
  ProjectNotificationChannel,
  ProjectNotificationChannelDefinition,
} from "./ProjectNotificationChannelsCopy";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";

/*
 * Project Settings -> Notifications -> Notification Settings: the project's
 * four channel switches (SMS, calls, WhatsApp, Telegram), one row each - its
 * name, what it sends, and the switch, which saves the moment it is flipped
 * (ModelSwitchRow).
 *
 * It replaced an "Enable Notifications" card whose Edit button opened a
 * two-step dialog (Calls & SMS | Messaging Apps) for four yes-or-no
 * answers. That Edit button was gated on the Project table's update list
 * (Project Admin, Edit Project, ...), which is wider than these columns'
 * own (Project Owner, Manage Billing), so it was handed to people whose
 * save the server then refused. A row locks, with the permission it needs,
 * for everyone the server would refuse, and the card says in so many words
 * who can change them - a tooltip is not there on a phone.
 *
 * A save is announced (ModelSwitchEvents), so a person's method lists on
 * screen follow at once (ProjectNotificationChannels).
 */

export const PROJECT_NOTIFICATION_CHANNELS_CARD_TEST_ID: string =
  "project-notification-channels";

export const PROJECT_NOTIFICATION_CHANNELS_WHO_CAN_CHANGE_TEST_ID: string =
  "project-notification-channels-who-can-change";

/*
 * Under the SMS and Phone Calls switches while no SMS or call can go
 * anywhere - neither this project nor the server has an account or gateway
 * for it (#7151): turned on, the switch would say "Saved" and nobody would
 * get one. On or off, it says so before anyone flips it.
 */
export const SERVER_CANNOT_SEND_CHANNEL_WARNINGS: {
  sms: string;
  call: string;
} = {
  sms: translationKey(
    "This server can't send SMS right now, so nobody gets one until your server's admin sets up SMS and calls, or this project adds its own Twilio config.",
  ),
  call: translationKey(
    "This server can't make calls right now, so nobody gets one until your server's admin sets up SMS and calls, or this project adds its own Twilio config.",
  ),
};

export const getServerCannotSendChannelWarning: (
  channel: ProjectNotificationChannel,
  canSend: ProjectCanSendAnswer | null,
) => string | null = (
  channel: ProjectNotificationChannel,
  canSend: ProjectCanSendAnswer | null,
): string | null => {
  if (channel === ProjectNotificationChannel.SMS && canSend?.sms === false) {
    return SERVER_CANNOT_SEND_CHANNEL_WARNINGS.sms;
  }

  if (channel === ProjectNotificationChannel.Call && canSend?.call === false) {
    return SERVER_CANNOT_SEND_CHANNEL_WARNINGS.call;
  }

  return null;
};

const ProjectNotificationChannelsCard: FunctionComponent = (): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();
  // Whether SMS and calls can go anywhere at all (#7151).
  const canSend: ProjectCanSendAnswer | null = useProjectCanSend();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectIdString: string = projectId?.toString() || "";

  const [enabled, setEnabled] = useState<EnabledProjectChannels | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Bumped by every read: an answer for a read the card has moved on from
   * is dropped.
   */
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const fetchChannels: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    if (!projectIdString) {
      setIsLoading(false);
      setError("Project not found");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const answer: EnabledProjectChannels =
        await fetchProjectNotificationChannels(new ObjectID(projectIdString));

      if (read !== readRef.current) {
        return;
      }

      setEnabled(answer);

      // What this page read is what every list on screen should show.
      ProjectNotificationChannelsStore.record(projectIdString, answer);
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setEnabled(null);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    void fetchChannels();

    return () => {
      readRef.current += 1;
    };
  }, [projectIdString]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <DetailListSkeleton fields={3} columns={1} />;
    }

    if (error || !enabled || !projectId) {
      return (
        <ErrorMessage
          message={error || "Project not found"}
          onRefreshClick={() => {
            void fetchChannels();
          }}
        />
      );
    }

    return (
      <>
        {isKnownNotToChangeProjectNotificationChannels() ? (
          <p
            className="mb-4 text-sm text-gray-600"
            data-testid={PROJECT_NOTIFICATION_CHANNELS_WHO_CAN_CHANGE_TEST_ID}
          >
            {translator.translateText(
              ProjectNotificationChannelsCopy.whoCanChange,
            )}
          </p>
        ) : (
          <></>
        )}
        {/*
         * Full-bleed rows, ruled like the card's own header rule, as on the
         * status page's Channels card.
         */}
        <div className={ruledListClassName}>
          {PROJECT_NOTIFICATION_CHANNELS.map(
            (
              definition: ProjectNotificationChannelDefinition,
            ): ReactElement => {
              return (
                <div className="px-5 py-4 md:px-6" key={definition.column}>
                  <ModelSwitchRow<Project>
                    modelType={Project}
                    modelId={projectId}
                    column={definition.column}
                    initialValue={enabled[definition.channel]}
                    title={definition.title}
                    getDescription={(): string => {
                      return definition.description;
                    }}
                    note={BILLING_ENABLED ? definition.balanceNote : undefined}
                    getWarning={(): ReactNode => {
                      const warning: string | null =
                        getServerCannotSendChannelWarning(
                          definition.channel,
                          canSend,
                        );

                      return warning
                        ? translator.translateText(warning)
                        : undefined;
                    }}
                    dataTestId={getProjectChannelSwitchTestId(
                      definition.column,
                    )}
                  />
                </div>
              );
            },
          )}
        </div>
      </>
    );
  };

  return (
    <Card
      title={ProjectNotificationChannelsCopy.cardTitle}
      description={ProjectNotificationChannelsCopy.cardDescription}
    >
      <div data-testid={PROJECT_NOTIFICATION_CHANNELS_CARD_TEST_ID}>
        {getBody()}
      </div>
    </Card>
  );
};

export default ProjectNotificationChannelsCard;
