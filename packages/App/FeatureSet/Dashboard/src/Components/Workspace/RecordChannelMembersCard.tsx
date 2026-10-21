import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
} from "Common/Types/Workspace/ConnectCallback";
import {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "Common/Types/Workspace/WorkspaceChannelLink";
import {
  WorkspaceChannelAddAnswer,
  WorkspaceChannelPerson,
  WorkspaceChannelState,
  WorkspaceRecordChannel,
} from "Common/Types/Workspace/WorkspaceChannelMembers";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PeopleAvatar from "Common/UI/Components/PeoplePicker/PeopleAvatar";
import { PeopleSearchNotice } from "Common/UI/Components/PeoplePicker/PeopleSearchNotice";
import PeopleSearchPopup, {
  PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
  PEOPLE_SEARCH_POPUP_WIDTH_PX,
} from "Common/UI/Components/PeoplePicker/PeopleSearchPopup";
import {
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import useAnchoredFieldPopup, {
  AnchoredFieldPopup,
} from "Common/UI/Types/UseAnchoredFieldPopup";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ASK_TO_BE_ADDED,
  AddOutcomeSentence,
  CHANNEL_STATE_TEXT,
  ChannelViewerPrompt,
  PEOPLE_COUNT,
  RECORD_CHANNEL_TEXT,
  SHOW_MORE_PEOPLE,
  UNNAMED_PEOPLE,
  canAddPeopleTo,
  getAddOutcomeSentences,
  getCardTitle,
  getChannelLabel,
  getFoldedCount,
  getPeopleInChannelUserIds,
  getPickNotices,
  getShownPeople,
  getUnnamedCount,
  getViewerPrompt,
  splitAtSlackInviteCommand,
} from "./RecordChannelMembers";
import useRecordChannelMembers, {
  RecordChannelMembersState,
  addPeopleToRecordChannel,
} from "./useRecordChannelMembers";

/*
 * THE RECORD'S OWN CHANNELS, AND WHO IS IN THEM.
 *
 * Shown on an incident's, alert's, episode's or scheduled maintenance
 * event's page when a workspace notification rule made it a channel of its
 * own (the page already knows: its Open in Slack button). For each channel:
 * its name, opening it; whether it is private; the people in it, the viewer
 * first; and, for somebody who may edit the record, Join channel and Add
 * people - the OneUptime app invites them, so a private channel everybody
 * left can be entered again without a Slack admin. A Microsoft Teams
 * channel says who can open it instead (RecordChannelMembers).
 */

/*
 * The card's two actions: Join channel leads, Add people beside it. Small
 * buttons of their own - the shared Button is a dialog footer's, full width
 * below md and set off by a margin. They share their row and fill it; in
 * the narrow column beside a page's details (1280px wide) they do not fit
 * side by side, and each takes a row of its own, full width, rather than
 * leaving two ragged ends.
 */
export const CHANNEL_ACTIONS_CLASS_NAME: string = "mt-3 flex flex-wrap gap-2";

export const JOIN_BUTTON_CLASS_NAME: string =
  "inline-flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-70";

export const ADD_PEOPLE_BUTTON_CLASS_NAME: string =
  "inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";

// A quiet box for what a channel - or the card - cannot do, and why.
const STATE_BOX_CLASS_NAME: string =
  "mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5";

// The link-like button or link that offers the next step inside that box.
const STATE_ACTION_CLASS_NAME: string =
  "mt-1.5 inline-flex items-center gap-1.5 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-wait disabled:opacity-70";

/*
 * "Try again" for a read that did not answer: busy, with a spinner, while
 * the next read is on its way.
 */
const TryAgainButton: FunctionComponent<{
  testId: string;
  isBusy: boolean;
  onClick: () => void;
}> = (props: {
  testId: string;
  isBusy: boolean;
  onClick: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <button
      type="button"
      data-testid={props.testId}
      disabled={props.isBusy}
      aria-busy={props.isBusy || undefined}
      onClick={props.onClick}
      className={STATE_ACTION_CLASS_NAME}
    >
      {props.isBusy && (
        <Icon icon={IconProp.Spinner} className="h-3.5 w-3.5 animate-spin" />
      )}
      <span>{translator.translateText("Try again")}</span>
    </button>
  );
};

export interface ComponentProps {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
  // The page's links to the record's channels: no channel, no card.
  links: Array<WorkspaceChannelLink>;
  // Somebody was added: the record's feed has a new entry.
  onChanged?: (() => void) | undefined;
}

// The people of one channel, as a list.
const PersonRow: FunctionComponent<{
  person: WorkspaceChannelPerson;
}> = (props: { person: WorkspaceChannelPerson }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li
      data-testid="record-channel-person"
      className="flex min-w-0 items-center gap-2.5"
    >
      <PeopleAvatar
        item={{
          kind: PeoplePickerKind.User,
          name: props.person.name,
          userId: props.person.userId,
          hasProfilePicture: props.person.hasProfilePicture,
        }}
        size="xs"
      />
      <span
        data-testid="record-channel-person-name"
        className="min-w-0 truncate text-sm text-gray-900"
      >
        {props.person.name}
      </span>
      {props.person.isViewer && (
        <span
          data-testid="record-channel-person-you"
          className="flex-shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-100"
        >
          {translator.translateText(RECORD_CHANNEL_TEXT.you)}
        </span>
      )}
    </li>
  );
};

interface ChannelSectionProps {
  channel: WorkspaceRecordChannel;
  canAddPeople: boolean;
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
  onAdded: () => void;
  onRetry: () => void;
  // A read asked for again has not answered yet.
  isRetrying: boolean;
}

const ChannelSection: FunctionComponent<ChannelSectionProps> = (
  props: ChannelSectionProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const channel: WorkspaceRecordChannel = props.channel;
  const isSlack: boolean = channel.workspaceType === WorkspaceType.Slack;

  const [isUnfolded, setIsUnfolded] = useState<boolean>(false);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [joinSentences, setJoinSentences] = useState<Array<AddOutcomeSentence>>(
    [],
  );
  const [joinError, setJoinError] = useState<string>("");

  /*
   * After a join, the button pressed goes away (the viewer is in): focus
   * moves to the link to the channel beside the news, the next step, so
   * the keyboard does not fall back to the top of the page.
   */
  const openAfterJoinRef: React.MutableRefObject<HTMLAnchorElement | null> =
    useRef<HTMLAnchorElement | null>(null);
  const [focusAfterJoin, setFocusAfterJoin] = useState<boolean>(false);

  useEffect(() => {
    if (!focusAfterJoin) {
      return;
    }

    // Drawn in the same render as the news; a channel without a link has none.
    openAfterJoinRef.current?.focus();
    setFocusAfterJoin(false);
  }, [focusAfterJoin]);

  const popup: AnchoredFieldPopup = useAnchoredFieldPopup({
    popupMaxHeight: PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX,
    popupWidth: PEOPLE_SEARCH_POPUP_WIDTH_PX,
    repositionKey: channel.people.length,
  });

  const viewerUserId: string | null = useMemo(() => {
    try {
      return UserUtil.getUserId()?.toString() || null;
    } catch {
      return null;
    }
  }, []);

  const prompt: ChannelViewerPrompt = getViewerPrompt({
    channel: channel,
    canAddPeople: props.canAddPeople,
  });
  const mayAdd: boolean = canAddPeopleTo({
    channel: channel,
    canAddPeople: props.canAddPeople,
  });

  // Who the Add people list leaves out: the people in the channel already.
  const takenKeys: Set<string> = useMemo(() => {
    return new Set<string>(
      getPeopleInChannelUserIds(channel).map((userId: string) => {
        return getPeoplePickerOptionKey(PeoplePickerKind.User, userId);
      }),
    );
  }, [channel]);

  const sentenceOf: (sentence: AddOutcomeSentence) => string = (
    sentence: AddOutcomeSentence,
  ): string => {
    return translator.translateTemplate(sentence.template, {
      name: sentence.name,
    });
  };

  const add: (data: {
    userIds?: Array<string>;
    teamIds?: Array<string>;
  }) => Promise<WorkspaceChannelAddAnswer> = async (data: {
    userIds?: Array<string>;
    teamIds?: Array<string>;
  }): Promise<WorkspaceChannelAddAnswer> => {
    const answer: WorkspaceChannelAddAnswer = await addPeopleToRecordChannel({
      recordType: props.recordType,
      recordId: props.recordId,
      channelId: channel.channelId,
      userIds: data.userIds,
      teamIds: data.teamIds,
    });

    props.onAdded();

    return answer;
  };

  const join: () => Promise<void> = async (): Promise<void> => {
    if (!viewerUserId) {
      return;
    }

    setIsJoining(true);
    setJoinError("");
    setJoinSentences([]);

    try {
      const answer: WorkspaceChannelAddAnswer = await add({
        userIds: [viewerUserId],
      });
      const sentences: Array<AddOutcomeSentence> = getAddOutcomeSentences({
        answer: answer,
        viewerUserId: viewerUserId,
      });

      setJoinSentences(sentences);
      setFocusAfterJoin(
        sentences.some((sentence: AddOutcomeSentence): boolean => {
          return !sentence.isProblem;
        }),
      );
    } catch (err) {
      setJoinError(API.getFriendlyMessage(err));
    } finally {
      setIsJoining(false);
    }
  };

  /*
   * A pick from the Add people list adds that person, or everybody in that
   * team, and the list says under it what the pick came to: who was added,
   * who was in the channel already, and what went wrong. The people added
   * also appear in the channel's list above.
   */
  const pick: (
    option: PeoplePickerOption,
  ) => Promise<Array<PeopleSearchNotice>> = async (
    option: PeoplePickerOption,
  ): Promise<Array<PeopleSearchNotice>> => {
    const isTeam: boolean = option.kind === PeoplePickerKind.Team;
    const answer: WorkspaceChannelAddAnswer = await add(
      isTeam ? { teamIds: [option.id] } : { userIds: [option.id] },
    );

    return getPickNotices({
      answer: answer,
      viewerUserId: viewerUserId,
      teamName: isTeam ? option.name : undefined,
      translator: translator,
    });
  };

  const label: string = getChannelLabel(channel);
  const shownPeople: Array<WorkspaceChannelPerson> = getShownPeople({
    people: channel.people,
    isUnfolded: isUnfolded,
  });
  const foldedCount: number = getFoldedCount(channel.people);
  const unnamedCount: number = getUnnamedCount(channel);
  const listsPeople: boolean =
    channel.state === WorkspaceChannelState.Members ||
    channel.state === WorkspaceChannelState.Archived;

  // "Private channel · 3 people", "Archived · 3 people".
  const meta: Array<string> = [];

  if (channel.state === WorkspaceChannelState.Archived) {
    meta.push(translator.translateText(RECORD_CHANNEL_TEXT.archived) || "");
  } else if (channel.isPrivate === true) {
    meta.push(
      translator.translateText(RECORD_CHANNEL_TEXT.privateChannel) || "",
    );
  } else if (channel.isPrivate === false && isSlack) {
    meta.push(
      translator.translateText(RECORD_CHANNEL_TEXT.publicChannel) || "",
    );
  }

  // Nobody in it is said below, once.
  if (listsPeople && channel.peopleCount > 0) {
    meta.push(translator.translatePlural(PEOPLE_COUNT, channel.peopleCount));
  }

  const stateText: string | undefined =
    CHANNEL_STATE_TEXT[channel.state as keyof typeof CHANNEL_STATE_TEXT];

  const teamsText: string =
    channel.isPrivate === true
      ? translator.translateText(RECORD_CHANNEL_TEXT.teamsPrivate) || ""
      : channel.isPrivate === false
        ? channel.teamName
          ? translator.translateTemplate(RECORD_CHANNEL_TEXT.teamsTeam, {
              team: channel.teamName,
            })
          : translator.translateText(RECORD_CHANNEL_TEXT.teamsTeamUnknown) || ""
        : translator.translateText(RECORD_CHANNEL_TEXT.teamsUnknown) || "";

  const connectRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_SLACK_INTEGRATION] as Route,
  ).addQueryParams({
    [CONNECT_ACCOUNT_QUERY_PARAM]: CONNECT_ACCOUNT_QUERY_VALUE,
  });

  // Project Settings > Workspace > Slack, where Slack is connected again.
  const projectSlackRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_SLACK_INTEGRATION] as Route,
  );

  // "... by typing /invite @OneUptime.", with the command shown as one.
  const unreachableHint: { before: string; command: string; after: string } =
    splitAtSlackInviteCommand(
      translator.translateText(RECORD_CHANNEL_TEXT.unreachableHint) || "",
    );

  return (
    <li
      data-testid="record-channel"
      data-channel-state={channel.state}
      className="py-4 first:pt-0 last:pb-0"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 ring-1 ring-inset ring-gray-200">
          <Icon
            icon={isSlack ? IconProp.Slack : IconProp.MicrosoftTeams}
            className="h-5 w-5"
          />
        </span>
        <div className="min-w-0 flex-1">
          {channel.url ? (
            <a
              href={channel.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="record-channel-name"
              title={
                translator.translateText(
                  isSlack ? "Open in Slack" : "Open in Microsoft Teams",
                ) || undefined
              }
              className="inline-flex max-w-full items-start gap-1 rounded text-sm font-semibold text-gray-900 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {/* A channel's name is long: it wraps rather than hide its end. */}
              <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
              <Icon
                icon={IconProp.ExternalLink}
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
              />
            </a>
          ) : (
            <span
              data-testid="record-channel-name"
              className="block text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]"
            >
              {label}
            </span>
          )}
          {meta.length > 0 && (
            <p
              data-testid="record-channel-meta"
              className="mt-0.5 text-xs text-gray-500"
            >
              {meta.join(" · ")}
            </p>
          )}
        </div>
      </div>

      {channel.state === WorkspaceChannelState.ManagedInTeams && (
        <p
          data-testid="record-channel-teams-note"
          className="mt-3 text-sm text-gray-600"
        >
          {teamsText}
        </p>
      )}

      {listsPeople && (
        <div className="mt-3">
          {channel.people.length === 0 && unnamedCount === 0 ? (
            <p
              data-testid="record-channel-nobody"
              className="text-sm text-gray-500"
            >
              {translator.translateText(RECORD_CHANNEL_TEXT.nobody)}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="record-channel-people">
              {shownPeople.map((person: WorkspaceChannelPerson) => {
                return <PersonRow key={person.key} person={person} />;
              })}
            </ul>
          )}

          {foldedCount > 0 && (
            <button
              type="button"
              data-testid="record-channel-show-more"
              aria-expanded={isUnfolded}
              onClick={() => {
                setIsUnfolded(!isUnfolded);
              }}
              className="mt-2 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {isUnfolded
                ? translator.translateText(RECORD_CHANNEL_TEXT.showFewer)
                : translator.translatePlural(SHOW_MORE_PEOPLE, foldedCount)}
            </button>
          )}

          {unnamedCount > 0 && (isUnfolded || foldedCount === 0) && (
            <p
              data-testid="record-channel-unnamed"
              className="mt-2 text-xs text-gray-500"
            >
              {translator.translatePlural(UNNAMED_PEOPLE, unnamedCount)}
            </p>
          )}
        </div>
      )}

      {stateText && (
        <div
          data-testid="record-channel-state"
          className={STATE_BOX_CLASS_NAME}
        >
          <p className="text-sm text-gray-700">
            {translator.translateText(stateText)}
          </p>
          {channel.state === WorkspaceChannelState.Unreachable && (
            <p
              data-testid="record-channel-unreachable-hint"
              className="mt-1 text-xs text-gray-500"
            >
              {unreachableHint.before}
              {unreachableHint.command && (
                <code
                  dir="ltr"
                  translate="no"
                  className="whitespace-nowrap rounded bg-white px-1 py-0.5 font-mono text-[11px] text-gray-700 ring-1 ring-inset ring-gray-200"
                >
                  {unreachableHint.command}
                </code>
              )}
              {unreachableHint.after}
            </p>
          )}
          {channel.state === WorkspaceChannelState.Unavailable && (
            <TryAgainButton
              testId="record-channel-try-again"
              isBusy={props.isRetrying}
              onClick={props.onRetry}
            />
          )}
          {channel.state === WorkspaceChannelState.NotConnected && (
            <div data-testid="record-channel-connect-project">
              <Link to={projectSlackRoute} className={STATE_ACTION_CLASS_NAME}>
                {translator.translateText(
                  RECORD_CHANNEL_TEXT.connectProjectSlack,
                )}
              </Link>
            </div>
          )}
        </div>
      )}

      {prompt === ChannelViewerPrompt.AskToBeAdded && (
        <p
          data-testid="record-channel-ask"
          className="mt-3 text-sm text-gray-600"
        >
          {translator.translateText(ASK_TO_BE_ADDED[props.recordType])}
        </p>
      )}

      {prompt === ChannelViewerPrompt.JoinInSlack && (
        <p
          data-testid="record-channel-join-in-slack"
          className="mt-3 text-sm text-gray-600"
        >
          {translator.translateText(RECORD_CHANNEL_TEXT.publicJoinInSlack)}
        </p>
      )}

      {prompt === ChannelViewerPrompt.ConnectToJoin && (
        <p
          data-testid="record-channel-connect"
          className="mt-3 text-sm text-gray-600"
        >
          {translator.translateText(RECORD_CHANNEL_TEXT.notFound)}{" "}
          <Link
            to={connectRoute}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            {translator.translateText(RECORD_CHANNEL_TEXT.connectSlack)}
          </Link>
        </p>
      )}

      {/* With nobody in the channel, "nobody" says the viewer is not either. */}
      {prompt === ChannelViewerPrompt.Join &&
        channel.peopleCount > 0 &&
        joinSentences.length === 0 &&
        !joinError && (
          <p
            data-testid="record-channel-not-in"
            className="mt-3 text-sm text-gray-600"
          >
            {translator.translateText(RECORD_CHANNEL_TEXT.notIn)}
          </p>
        )}

      {joinSentences.length > 0 && (
        <div data-testid="record-channel-join-result" className="mt-3">
          {joinSentences.map((sentence: AddOutcomeSentence, index: number) => {
            return (
              <p
                key={index}
                role={sentence.isProblem ? "alert" : "status"}
                className={`text-sm ${
                  sentence.isProblem ? "text-red-600" : "text-green-700"
                }`}
              >
                {sentenceOf(sentence)}
                {!sentence.isProblem && isSlack && channel.url && (
                  <>
                    {" "}
                    <a
                      ref={openAfterJoinRef}
                      href={channel.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="record-channel-open-after-join"
                      className="rounded font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {translator.translateText(
                        RECORD_CHANNEL_TEXT.openInSlack,
                      )}
                    </a>
                  </>
                )}
              </p>
            );
          })}
        </div>
      )}

      {joinError && (
        <p
          role="alert"
          data-testid="record-channel-join-error"
          className="mt-3 text-sm text-red-600"
        >
          {joinError}
        </p>
      )}

      {(prompt === ChannelViewerPrompt.Join || mayAdd) && (
        <div
          data-testid="record-channel-actions"
          className={CHANNEL_ACTIONS_CLASS_NAME}
        >
          {prompt === ChannelViewerPrompt.Join && (
            <button
              type="button"
              data-testid="record-channel-join"
              disabled={isJoining}
              aria-busy={isJoining || undefined}
              onClick={() => {
                void join();
              }}
              className={JOIN_BUTTON_CLASS_NAME}
            >
              {isJoining && (
                <Icon
                  icon={IconProp.Spinner}
                  className="h-4 w-4 animate-spin"
                />
              )}
              <span>
                {translator.translateText(RECORD_CHANNEL_TEXT.joinChannel)}
              </span>
            </button>
          )}

          {mayAdd && (
            <div ref={popup.anchorRef} className="flex flex-auto">
              <button
                type="button"
                data-testid="record-channel-add-people"
                onClick={popup.togglePopup}
                onKeyDown={popup.onTriggerKeyDown}
                aria-haspopup="dialog"
                aria-expanded={popup.isPopupOpen}
                aria-controls={popup.isPopupOpen ? popup.popupId : undefined}
                className={ADD_PEOPLE_BUTTON_CLASS_NAME}
              >
                <Icon icon={IconProp.UserPlus} className="h-4 w-4" />
                <span>
                  {translator.translateText(RECORD_CHANNEL_TEXT.addPeople)}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {mayAdd && (
        <PeopleSearchPopup
          popup={popup}
          kinds={[PeoplePickerKind.User, PeoplePickerKind.Team]}
          selectedKeys={takenKeys}
          selectionMode="add"
          onPick={(
            option: PeoplePickerOption,
          ): Promise<Array<PeopleSearchNotice>> => {
            return pick(option);
          }}
          searchPlaceholder={RECORD_CHANNEL_TEXT.addPeopleSearch}
          emptyText={RECORD_CHANNEL_TEXT.addPeopleEmpty}
          ariaLabel={RECORD_CHANNEL_TEXT.addPeople}
        />
      )}
    </li>
  );
};

const RecordChannelMembersCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  // A new channel - created a moment after the record - is read again.
  const readKey: string = props.links
    .map((link: WorkspaceChannelLink) => {
      return link.url;
    })
    .join(" ");

  const members: RecordChannelMembersState = useRecordChannelMembers({
    recordType: props.recordType,
    recordId: props.recordId,
    readKey: readKey,
    isEnabled: props.links.length > 0,
  });

  if (props.links.length === 0) {
    return null;
  }

  const channels: Array<WorkspaceRecordChannel> =
    members.answer?.channels || [];

  // The record turned out to have no channel after all: no card.
  if (members.answer && channels.length === 0) {
    return null;
  }

  let body: ReactElement;

  if (members.isLoading) {
    body = <ComponentLoader />;
  } else if (members.error || !members.answer) {
    // Said the way the card says what a channel cannot do: quietly, in a box.
    body = (
      <div
        data-testid="record-channel-read-error"
        className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"
      >
        <p role="alert" className="text-sm text-gray-700">
          {translator.translateTemplate(RECORD_CHANNEL_TEXT.couldNotRead, {
            error: members.error,
          })}
        </p>
        <TryAgainButton
          testId="record-channel-read-try-again"
          isBusy={members.isRefreshing}
          onClick={members.refresh}
        />
      </div>
    );
  } else {
    body = (
      <ul className="divide-y divide-gray-100">
        {channels.map((channel: WorkspaceRecordChannel) => {
          return (
            <ChannelSection
              key={`${channel.workspaceType}:${channel.channelId}`}
              channel={channel}
              canAddPeople={members.answer!.canAddPeople}
              recordType={props.recordType}
              recordId={props.recordId}
              onAdded={() => {
                members.refresh();
                props.onChanged?.();
              }}
              onRetry={members.refresh}
              isRetrying={members.isRefreshing}
            />
          );
        })}
      </ul>
    );
  }

  // While the channels load, the page's links say what they are.
  const shownChannels: Array<{ workspaceType: WorkspaceType }> =
    channels.length > 0 ? channels : props.links;

  return (
    <Card title={getCardTitle(shownChannels)} headerLayout="stacked">
      <div data-testid="record-channel-members-card">{body}</div>
    </Card>
  );
};

export default RecordChannelMembersCard;
