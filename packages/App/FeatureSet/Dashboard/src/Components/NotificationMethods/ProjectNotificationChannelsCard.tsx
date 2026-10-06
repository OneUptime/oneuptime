import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { getProjectChannelSwitchTestId } from "./NotificationChannelOffPanel";
import ProjectNotificationChannelsStore, {
  fetchProjectNotificationChannels,
} from "./ProjectNotificationChannels";
import ProjectNotificationChannelsCopy, {
  EnabledProjectChannels,
  PROJECT_NOTIFICATION_CHANNELS,
  ProjectNotificationChannelDefinition,
} from "./ProjectNotificationChannelsCopy";

/*
 * Project Settings -> Notification Settings: the project's four channel
 * switches (SMS, calls, WhatsApp, Telegram), one row each - its name, what
 * it sends, and the switch, which saves the moment it is flipped
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
 * Whether the signed-in person is known not to be allowed to change the
 * switches: refused by the gate, with a reason. Not while the permission
 * snapshot is on its way - an owner is never told to ask someone else.
 */
const isKnownNotToChangeChannels: () => boolean = (): boolean => {
  const gate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new Project(),
    PROJECT_NOTIFICATION_CHANNELS[0]!.column,
  );

  return !gate.isAllowed && Boolean(gate.disabledReason);
};

const ProjectNotificationChannelsCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
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
      return <ComponentLoader />;
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
        {isKnownNotToChangeChannels() ? (
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
        <div className="-mx-5 -mb-6 divide-y divide-gray-200 border-t border-gray-200 md:-mx-6">
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
