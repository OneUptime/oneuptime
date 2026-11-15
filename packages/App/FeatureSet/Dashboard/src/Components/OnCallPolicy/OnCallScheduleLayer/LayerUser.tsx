import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import AddLayerUserModal from "./AddLayerUserModal";
import {
  createAddedLayerUser,
  getLayerUserRowKey,
  isAddedLayerUser,
  moveInList,
} from "./LayersDraft";
import { formatShiftInstant } from "./LayerSummary";
import { LayerUserAway, getLayerUserAway } from "./LayerUserAway";
import { getUserAvatarStyle, getUserInitials } from "./LayerUserColors";
import OneUptimeDate from "Common/Types/Date";
import { UserOverrideRecord } from "Common/Types/OnCallDutyPolicy/UserOverrideUtil";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DropResult,
  Droppable,
  DroppableProvided,
} from "react-beautiful-dnd";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useProjectMembership from "../../../Utils/UseProjectMembership";
import {
  ProjectMembershipAnswer,
  ProjectMembershipStatus,
} from "../../../Utils/ProjectMembershipLoader";
import ObjectID from "Common/Types/ObjectID";
import { ProjectUserResult } from "../../../Utils/ProjectUser";

/*
 * The people who take turns in a layer, on the Layers page: dragged into
 * another turn order, added, taken out. None of it is saved here - each
 * change goes to the page (onChange), which shows it in its previews and
 * saves every change at once with Save (Layers, issue #7575). Someone added
 * is marked New until then, and someone taken out is listed under the
 * layer's people, to be put back with Undo.
 */
export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  /*
   * The people in turn order, as the page has them now: saved, and added
   * (a row with no id yet).
   */
  users: Array<OnCallDutyPolicyScheduleLayerUser>;
  // The people as they are to be: a new turn order, someone added or taken out.
  onChange: (layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>) => void;
  // People saved in the layer whom the page has taken out, until Save.
  removedUsers?: Array<OnCallDutyPolicyScheduleLayerUser> | undefined;
  /*
   * The rows of people the page has put in another place in the turn
   * order, by id, lower-cased (LayersDraft.getMovedLayerUserIds): marked
   * Moved until Save.
   */
  movedUserIds?: Set<string> | undefined;
  /*
   * Whether the rows say what the page changed: New, Moved, and the people
   * Removed when you save. Left out, they do. Not once a save is done but
   * the page could not read it back (Layers): those changes are saved.
   */
  marksUnsavedChanges?: boolean | undefined;
  // Undo on one of them: they go back where they were.
  onRestore?:
    | ((layerUser: OnCallDutyPolicyScheduleLayerUser) => void)
    | undefined;
  // While the page saves, the people stay as they are.
  isDisabled?: boolean | undefined;
  /*
   * The user overrides that apply to this schedule (./ScheduleOverrides): a
   * person away now, or soon, says so on their row.
   */
  overrides?: Array<UserOverrideRecord> | undefined;
  // Names of the people overrides name to cover, by user id.
  coverNameById?: Record<string, string> | undefined;
  // The schedule's timezone: the away times are shown in it.
  timezone?: string | undefined;
  /*
   * "Skip until..." on a person's row: opens time away for them with the
   * rotation covering (SkipLayerUserModal). Left out, it is not offered.
   */
  onSkipUser?: ((person: { userId: string; name: string }) => void) | undefined;
  /*
   * Why "Skip until..." is locked for the reader, or null when it is not.
   * The skip it saves applies to every on-call policy, so a reader whose
   * permission to add overrides covers only some policies would be refused
   * on save (GlobalUserOverrideLock). Locked, the button stays on each row,
   * opens nothing, and says why on hover, focus or a press.
   */
  skipLockedReason?: string | null | undefined;
}

/*
 * "Away until Fri, Mar 6, 12:00 PM" beside a person's name while a user
 * override is in force for them - "Away from ..." when one is booked - so a
 * reader of the rotation knows why somebody else has their turn. Its tooltip
 * says who does: the next person in the rotation, or the person named.
 */
const LayerUserAwayBadge: FunctionComponent<{
  away: LayerUserAway;
  coverName: string | null;
  timezone?: string | undefined;
}> = (props: {
  away: LayerUserAway;
  coverName: string | null;
  timezone?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  const label: string = props.away.isNow
    ? translator.translateTemplate("Away until {{time}}", {
        time: formatShiftInstant(props.away.endsAt, props.timezone),
      })
    : translator.translateTemplate("Away from {{time}}", {
        time: formatShiftInstant(props.away.startsAt, props.timezone),
      });

  const who: string = props.away.isSkip
    ? translator.translateTemplate(
        "Each of their turns goes to the next person in the rotation who is not away.",
      )
    : translator.translateTemplate("{{name}} covers for them.", {
        name: props.coverName || translator.translateTemplate("Someone else"),
      });

  return (
    <Tooltip text={who}>
      <span
        data-testid={
          props.away.isNow ? "layer-user-away-now" : "layer-user-away-soon"
        }
        className={`inline-flex max-w-full flex-shrink-0 items-start gap-1 rounded-xl px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset ${
          props.away.isNow
            ? "bg-amber-50 text-amber-800 ring-amber-200"
            : "bg-gray-50 text-gray-600 ring-gray-200"
        }`}
      >
        <Icon
          icon={props.away.isSkip ? IconProp.Forward : IconProp.ArrowUturnRight}
          className="mt-0.5 h-3 w-3 flex-shrink-0"
        />
        {/* Wraps rather than cut off: the date is the point of it. */}
        <span className="min-w-0">{label}</span>
        {/*
         * The tooltip shows on hover only: a screen reader hears who has
         * their turns with the date.
         */}
        <span className="sr-only">{who}</span>
      </span>
    </Tooltip>
  );
};

/*
 * The line under a layer user's name: their email - or, once they have left
 * the project, "No longer a member", and before they have accepted their
 * invitation, "Invitation not accepted yet". Nobody who is not a member is
 * paged when the rotation reaches them, so the layer needs somebody else in
 * their place, or them to accept.
 */
const LayerUserDetailLine: FunctionComponent<{
  userId: ObjectID | null | undefined;
  name: string;
  email: string;
}> = (props: {
  userId: ObjectID | null | undefined;
  name: string;
  email: string;
}): ReactElement | null => {
  const translator: Translator = useTranslator();
  const membership: ProjectMembershipAnswer = useProjectMembership(
    props.userId,
  );

  if (membership === ProjectMembershipStatus.NotMember) {
    return (
      <div
        data-testid="layer-user-not-project-member"
        className="truncate text-xs font-medium text-amber-700"
      >
        {translator.translateText("No longer a member")}
      </div>
    );
  }

  if (membership === ProjectMembershipStatus.Invited) {
    return (
      <div
        data-testid="layer-user-invitation-pending"
        className="truncate text-xs font-medium text-amber-700"
      >
        {translator.translateText("Invitation not accepted yet")}
      </div>
    );
  }

  if (props.name && props.email) {
    return <div className="truncate text-xs text-gray-500">{props.email}</div>;
  }

  return null;
};

const LayerUser: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const users: Array<OnCallDutyPolicyScheduleLayerUser> = props.users;
  const marksChanges: boolean = props.marksUnsavedChanges !== false;
  const removedUsers: Array<OnCallDutyPolicyScheduleLayerUser> = marksChanges
    ? props.removedUsers || []
    : [];
  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);

  // Every row's locked "Skip until..." is described by the one reason.
  const skipLockedReasonId: string = useId();
  const skipLockedReason: string | null = props.skipLockedReason || null;

  const isBusy: boolean = Boolean(props.isDisabled);

  // A person taken out of the layer on the page: Undo puts them back.
  const removeUser: (layerUser: OnCallDutyPolicyScheduleLayerUser) => void = (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
  ): void => {
    props.onChange(
      users.filter((candidate: OnCallDutyPolicyScheduleLayerUser): boolean => {
        return candidate !== layerUser;
      }),
    );
  };

  // A drop: the new turn order, on the page until Save.
  const onDragEnd: (result: DropResult) => void = (
    result: DropResult,
  ): void => {
    if (!result.destination) {
      return;
    }

    const fromIndex: number = result.source.index;
    const toIndex: number = result.destination.index;

    if (fromIndex === toIndex) {
      return;
    }

    props.onChange(moveInList(users, fromIndex, toIndex));
  };

  // Someone picked in Add user: at the end of the rotation, New until Save.
  const addUser: (person: ProjectUserResult) => void = (
    person: ProjectUserResult,
  ): void => {
    setShowAddUserModal(false);
    props.onChange([
      ...users,
      createAddedLayerUser({
        layer: props.layer,
        userId: person.userId,
        name: person.name,
        email: person.email,
      }),
    ]);
  };

  /*
   * "Skip until..." on a person's row. Locked (skipLockedReason), it stays
   * a button - reached with Tab, named as before - that opens nothing: it
   * says why on hover, focus or a press, and a screen reader hears the
   * reason as its description. While the page saves it is disabled for
   * that moment.
   */
  const getSkipButton: (
    userId: ObjectID,
    displayName: string,
  ) => ReactElement = (userId: ObjectID, displayName: string): ReactElement => {
    const isLocked: boolean = Boolean(skipLockedReason);

    const button: ReactElement = (
      <button
        type="button"
        data-testid="layer-user-skip-button"
        aria-label={translator.translateTemplate("Skip {{name}} until a date", {
          name: displayName,
        })}
        aria-disabled={isLocked ? true : undefined}
        aria-describedby={isLocked ? skipLockedReasonId : undefined}
        disabled={isBusy && !isLocked}
        onClick={() => {
          if (isLocked) {
            return;
          }

          props.onSkipUser?.({
            userId: userId.toString(),
            name: displayName,
          });
        }}
        className={`flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
          {
            isLocked: isBusy || isLocked,
            hoverClassName: "hover:bg-gray-100 hover:text-gray-900",
          },
        )}`}
      >
        <Icon icon={IconProp.Forward} className="h-4 w-4" />
        <span className="max-sm:hidden sm:inline">
          {translator.translateText("Skip until…")}
        </span>
      </button>
    );

    if (!skipLockedReason) {
      return button;
    }

    return (
      <Tooltip
        text={skipLockedReason}
        isShownOnPress={true}
        isTriggerAlreadyDescribed={true}
      >
        {button}
      </Tooltip>
    );
  };

  const getUserRow: (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
    index: number,
    dragProvided: DraggableProvided,
    canReorder: boolean,
  ) => ReactElement = (
    layerUser: OnCallDutyPolicyScheduleLayerUser,
    index: number,
    dragProvided: DraggableProvided,
    canReorder: boolean,
  ): ReactElement => {
    const user: User | undefined = layerUser.user;
    const userId: string = user?.id?.toString() || `unknown-${index}`;
    const name: string = user?.name?.toString() || "";
    const email: string = user?.email?.toString() || "";
    // Someone added on the page: no row of theirs is saved yet.
    const isAdded: boolean = isAddedLayerUser(layerUser);
    const isMarkedNew: boolean = isAdded && marksChanges;
    const isMoved: boolean =
      !isAdded &&
      marksChanges &&
      Boolean(
        props.movedUserIds?.has(layerUser.id?.toString().toLowerCase() || ""),
      );
    const displayName: string =
      name || email || translator.translateTemplate("Unknown user");

    const away: LayerUserAway | null = user?.id
      ? getLayerUserAway({
          userId: user.id.toString(),
          overrides: props.overrides || [],
          now: OneUptimeDate.getCurrentDate(),
        })
      : null;

    return (
      <div
        ref={dragProvided.innerRef}
        {...dragProvided.draggableProps}
        data-testid={isMarkedNew ? "layer-user-added-row" : "layer-user-row"}
        className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${
          isMarkedNew
            ? "bg-emerald-50/40 hover:bg-emerald-50/70"
            : isMoved
              ? "bg-indigo-50/40 hover:bg-indigo-50/70"
              : "bg-white hover:bg-gray-50"
        }`}
      >
        {canReorder ? (
          <span
            {...dragProvided.dragHandleProps}
            aria-label={translator.translateText("Drag to reorder")}
            className="flex h-8 w-5 flex-shrink-0 cursor-grab items-center justify-center text-gray-300 transition-colors hover:text-gray-500 active:cursor-grabbing"
          >
            <Icon icon={IconProp.GripVertical} className="h-5 w-5" />
          </span>
        ) : (
          <span className="w-1 flex-shrink-0" />
        )}

        <span
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm ring-2 ring-white"
          style={getUserAvatarStyle(userId)}
        >
          {getUserInitials(name, email)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="min-w-0 truncate text-sm font-medium text-gray-900">
              {displayName}
            </span>
            {isMarkedNew && (
              /*
               * Someone added on the page: in the previews already, in the
               * rotation once the page is saved.
               */
              <Tooltip
                text={translator.translateText(
                  "Not saved yet. They join the rotation when you save.",
                )}
              >
                <span
                  data-testid="layer-user-new"
                  className="inline-flex flex-shrink-0 items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium leading-4 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                >
                  {translator.translateText("New")}
                </span>
              </Tooltip>
            )}
            {isMoved && (
              /*
               * Someone the page has put in another place in the turn
               * order: their turns change once the page is saved.
               */
              <Tooltip
                text={translator.translateText(
                  "Not saved yet. They take this place in the rotation when you save.",
                )}
              >
                <span
                  data-testid="layer-user-moved"
                  className="inline-flex flex-shrink-0 items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium leading-4 text-indigo-700 ring-1 ring-inset ring-indigo-200"
                >
                  {translator.translateText("Moved")}
                </span>
              </Tooltip>
            )}
            {away && (
              <LayerUserAwayBadge
                away={away}
                coverName={
                  away.coverUserId
                    ? props.coverNameById?.[away.coverUserId] || null
                    : null
                }
                timezone={props.timezone}
              />
            )}
          </div>
          <LayerUserDetailLine userId={user?.id} name={name} email={email} />
        </div>

        {/*
         * Time away is for someone in the rotation: someone added on the
         * page is offered it once they are saved.
         */}
        {props.onSkipUser &&
          user?.id &&
          !isAdded &&
          getSkipButton(user.id, displayName)}

        <button
          type="button"
          aria-label={translator.translateText("Remove user from layer")}
          disabled={isBusy}
          onClick={() => {
            removeUser(layerUser);
          }}
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors ${getHandDrawnButtonStateClassName(
            {
              isLocked: isBusy,
              hoverClassName: "hover:bg-red-50 hover:text-red-600",
            },
          )}`}
        >
          <Icon icon={IconProp.Trash} className="h-4 w-4" />
        </button>
      </div>
    );
  };

  const getAddUserButton: () => ReactElement = (): ReactElement => {
    return (
      <div className="mt-3">
        <Button
          title="Add User"
          icon={IconProp.Add}
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          disabled={isBusy}
          onClick={() => {
            setShowAddUserModal(true);
          }}
        />
      </div>
    );
  };

  const getContent: () => ReactElement = (): ReactElement => {
    if (users.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-6 text-center">
          <span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-400 ring-1 ring-inset ring-gray-100">
            <Icon icon={IconProp.UserGroup} className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-gray-900">
            {translator.translateText("No users yet")}
          </p>
          <p className="mt-0.5 text-sm text-gray-500">
            {translator.translateText(
              "Add users to put them into this layer's on-call rotation.",
            )}
          </p>
        </div>
      );
    }

    const canReorder: boolean = users.length > 1 && !isBusy;

    return (
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId={`layer-users-${props.layer.id?.toString()}`}>
            {(dropProvided: DroppableProvided) => {
              return (
                <div
                  ref={dropProvided.innerRef}
                  {...dropProvided.droppableProps}
                  className="divide-y divide-gray-100"
                >
                  {users.map(
                    (
                      layerUser: OnCallDutyPolicyScheduleLayerUser,
                      i: number,
                    ) => {
                      const rowId: string = getLayerUserRowKey(layerUser, i);
                      return (
                        <Draggable
                          key={rowId}
                          draggableId={rowId}
                          index={i}
                          isDragDisabled={!canReorder}
                        >
                          {(dragProvided: DraggableProvided) => {
                            return getUserRow(
                              layerUser,
                              i,
                              dragProvided,
                              users.length > 1,
                            );
                          }}
                        </Draggable>
                      );
                    },
                  )}
                  {dropProvided.placeholder}
                </div>
              );
            }}
          </Droppable>
        </DragDropContext>
      </div>
    );
  };

  /*
   * The people saved in the layer that the page has taken out: still in the
   * rotation until Save, and put back with Undo, where they were.
   */
  const getRemovedUsers: () => ReactElement | null =
    (): ReactElement | null => {
      if (removedUsers.length === 0) {
        return null;
      }

      return (
        <div
          data-testid="layer-users-removed"
          className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2"
        >
          <p className="text-xs font-medium text-gray-500">
            {translator.translateText("Removed when you save")}
          </p>
          <ul className="mt-1 divide-y divide-gray-100">
            {removedUsers.map(
              (layerUser: OnCallDutyPolicyScheduleLayerUser, i: number) => {
                const user: User | undefined = layerUser.user;
                const userId: string = user?.id?.toString() || `unknown-${i}`;
                const name: string = user?.name?.toString() || "";
                const email: string = user?.email?.toString() || "";
                const displayName: string =
                  name || email || translator.translateTemplate("Unknown user");

                return (
                  <li
                    key={getLayerUserRowKey(layerUser, i)}
                    data-testid="layer-user-removed-row"
                    className="flex items-center gap-2.5 py-1.5"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold opacity-60"
                      style={getUserAvatarStyle(userId)}
                    >
                      {getUserInitials(name, email)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-500 line-through decoration-gray-400">
                      {displayName}
                    </span>
                    {props.onRestore && (
                      <button
                        type="button"
                        aria-label={translator.translateTemplate(
                          "Undo removing {{name}}",
                          { name: displayName },
                        )}
                        disabled={isBusy}
                        onClick={() => {
                          props.onRestore?.(layerUser);
                        }}
                        className={`flex-shrink-0 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
                          {
                            isLocked: isBusy,
                            hoverClassName:
                              "hover:bg-indigo-50 hover:text-indigo-700",
                          },
                        )}`}
                      >
                        {translator.translateText("Undo")}
                      </button>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        </div>
      );
    };

  return (
    <div>
      {getContent()}
      {getRemovedUsers()}
      {getAddUserButton()}

      {skipLockedReason && (
        <span id={skipLockedReasonId} hidden={true}>
          {translator.translateText(skipLockedReason)}
        </span>
      )}

      {showAddUserModal && (
        <AddLayerUserModal
          onClose={() => {
            setShowAddUserModal(false);
          }}
          onAdd={addUser}
        />
      )}
    </div>
  );
};

export default LayerUser;
