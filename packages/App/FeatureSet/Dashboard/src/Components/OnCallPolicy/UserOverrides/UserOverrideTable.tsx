import ProjectUserElement from "../../../Components/User/ProjectUserElement";
import { USER_OVERRIDE_ROTATION_COVERS_TEXT } from "./UserOverrideForm";
import UserOverrideFormModal, {
  UserOverrideEditTarget,
  toUserOverrideEditTarget,
} from "./UserOverrideFormModal";
import {
  OVERLAP_SELECT,
  ReadUserOverride,
  toReadUserOverride,
} from "./UserOverrideOverlapNotice";
import UserOverrideOverlapsMark, {
  getUserOverrideOverlapsText,
} from "./UserOverrideOverlapsMark";
import { getGlobalUserOverrideLock } from "./GlobalUserOverrideLock";
import {
  UserOverrideTeamLimit,
  getUserOverrideTeamLimit,
  getUserOverrideTeamLock,
} from "./UserOverrideTeamLimit";
import useUserOverrideTeamPeople, {
  UserOverrideTeamPeople,
} from "./UseUserOverrideTeamPeople";
import {
  USER_OVERRIDE_END_NOW_ACTION,
  UserOverrideEndNowTarget,
  canEndUserOverrideNow,
  endUserOverrideNow,
  getUserOverrideEndNowQuestion,
  sayUserOverrideEnded,
  toUserOverrideEndNowTarget,
} from "./UserOverrideEndNow";
import { formatHandOffInstant } from "../OnCallScheduleLayer/LayerSummary";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  USER_OVERRIDE_COVER_ENDS_AT_PARAM,
  USER_OVERRIDE_COVER_STARTS_AT_PARAM,
  UserOverrideCoverWindow,
  hasUserOverrideCoverParams,
  readUserOverrideCoverRequest,
} from "Common/Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import UserOverrideEdit, {
  USER_OVERRIDE_ENDED_REFUSAL,
} from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import UserOverrideOverlap, {
  UserOverrideOverlapNote,
} from "Common/Types/OnCallDutyPolicy/UserOverrideOverlap";
import ActionButtonSchema, {
  RowActionConfirmation,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import Columns from "Common/UI/Components/ModelTable/Columns";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import User from "Common/Models/DatabaseModels/User";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The user overrides of one on-call policy (its User Overrides page), or the
 * project's global ones (On-Call > Schedules > User Overrides), which
 * apply to every policy.
 *
 * Each row reads as the override does: who is away, who covers, from when,
 * until when. Adding one asks the same four things, with you as the person
 * away and now as the start (UserOverrideForm.ts). An override with nobody
 * named to cover is a skip, and its row says the rotation covers: "Next
 * person in the rotation".
 *
 * Each row's Edit opens the same four rows on the override as saved (issue
 * #7631, UserOverrideFormModal): who covers, and its times as far as they
 * may still change. One that has ended keeps its Edit, locked, saying why.
 * One under way has End Now first (issue #7899, UserOverrideEndNow): one
 * short question, then it ends at once.
 * Add and Edit both say under Ends what the times picked overlap, with a way
 * to edit that override instead (issue #7630). Overlaps saved before that
 * rule are marked "Overlaps" on both rows, saying which one is used there
 * (UserOverrideOverlapsMark).
 *
 * "Get cover" on an upcoming shift (User Settings > Calendar > Calendar
 * Feed) opens this page with the shift's window in its address: Add User
 * Override opens on that window, with you away, so all that is left is who
 * covers (UserOverrideCoverRequest.ts).
 *
 * Each card's description says where the other one is. Both pages sit in a
 * folded Advanced section - the global one in the On-Call Duty menu, a
 * policy's own in the policy's menu - so the way there names Advanced
 * (OnCallDutyMenuPathsInProductText holds such paths to the menu).
 *
 * A global override applies to every policy, so adding, editing or deleting
 * one takes a permission over the whole project (issue #5617). For someone
 * whose permission covers only some policies, the global page locks Add and
 * each row's Edit and Delete, saying why (GlobalUserOverrideLock). "Get
 * cover" is locked on the shift itself for them; a link that still brings
 * them here - followed before the browser had that project's permissions -
 * says so instead of opening a form they cannot save.
 */

export interface ComponentProps {
  onCallDutyPolicyId?: ObjectID | undefined; // if this is undefined. then it'll show logs for all policies.
}

// The dialog open on the page: Add, or Edit of one override.
type UserOverrideDialog =
  | {
      kind: "add";
      // A Get cover link's window, which Add opens on.
      initialTimes?: { startsAt: Date; endsAt: Date } | undefined;
    }
  | { kind: "edit"; target: UserOverrideEditTarget };

export const USER_OVERRIDE_NO_USER_TEXT: string = translationKey("No user.");

const UserOverrideTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const query: Query<OnCallDutyPolicyUserOverride> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (props.onCallDutyPolicyId) {
    query.onCallDutyPolicyId = props.onCallDutyPolicyId.toString();
  } else {
    query.onCallDutyPolicyId = new IsNull();
  }

  const [dialog, setDialog] = useState<UserOverrideDialog | null>(null);

  // Counted up after a save: the table reads its rows again.
  const [saveCount, setSaveCount] = useState<number>(0);

  /*
   * The overlaps of this list saved before the rule, by override id, where
   * they still overlap now or later: read with the rows, over every one of
   * the list that has not ended, whichever page is on screen.
   */
  const [overlapNotes, setOverlapNotes] = useState<
    Map<string, UserOverrideOverlapNote<ReadUserOverride>>
  >(new Map());

  const loadOverlapNotes: () => Promise<void> = async (): Promise<void> => {
    const now: Date = OneUptimeDate.getCurrentDate();

    try {
      const result: ListResult<OnCallDutyPolicyUserOverride> =
        await ModelAPI.getList<OnCallDutyPolicyUserOverride>({
          modelType: OnCallDutyPolicyUserOverride,
          query: {
            ...query,
            endsAt: new GreaterThan<Date>(now),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: OVERLAP_SELECT,
          sort: {
            startsAt: SortOrder.Ascending,
          },
        });

      setOverlapNotes(
        UserOverrideOverlap.getOverlapNotes(
          result.data
            .filter((override: OnCallDutyPolicyUserOverride): boolean => {
              return Boolean(override.startsAt && override.endsAt);
            })
            .map(toReadUserOverride),
          now,
        ),
      );
    } catch {
      // Not known: no row is marked.
      setOverlapNotes(new Map());
    }
  };

  const nameOf: (user: User | undefined) => string = (
    user: User | undefined,
  ): string => {
    return user?.name?.toString() || user?.email?.toString() || "";
  };

  /*
   * Every row of the table belongs to the one policy the page is about, or
   * to none, so there is no policy column or filter: it would say the same
   * thing on every row.
   */
  const filters: Array<Filter<OnCallDutyPolicyUserOverride>> = [
    {
      title: "Starts",
      type: FieldType.Date,
      field: {
        startsAt: true,
      },
    },
    {
      title: "Ends",
      type: FieldType.Date,
      field: {
        endsAt: true,
      },
    },
  ];

  const columns: Columns<OnCallDutyPolicyUserOverride> = [
    {
      field: {
        overrideUser: {
          _id: true,
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Away",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        const person: ReactElement = item["overrideUser"] ? (
          <ProjectUserElement user={item["overrideUser"] as User} />
        ) : (
          <p>{translator.translateText(USER_OVERRIDE_NO_USER_TEXT)}</p>
        );

        const note: UserOverrideOverlapNote<ReadUserOverride> | undefined =
          item._id
            ? overlapNotes.get(item._id.toString().toLowerCase())
            : undefined;

        if (!note) {
          return person;
        }

        // Saved before the rule: it overlaps another, and says which is used.
        return (
          <div className="flex flex-wrap items-center gap-2">
            {person}
            <UserOverrideOverlapsMark
              text={getUserOverrideOverlapsText({
                translator: translator,
                note: note,
                awayName: nameOf(item.overrideUser),
                otherCoverName: nameOf(note.other.override.routeAlertsToUser),
                // In the reader's zone, as the Starts and Ends columns.
                from: formatHandOffInstant(
                  note.other.startsAt,
                  undefined,
                  OneUptimeDate.getCurrentDate(),
                ),
                until: formatHandOffInstant(
                  note.other.endsAt,
                  undefined,
                  OneUptimeDate.getCurrentDate(),
                ),
              })}
            />
          </div>
        );
      },
    },
    {
      field: {
        routeAlertsToUser: {
          _id: true,
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "Covered by",
      type: FieldType.Element,
      getElement: (item: OnCallDutyPolicyUserOverride): ReactElement => {
        if (item["routeAlertsToUser"]) {
          // Nobody who has left the project is paged in someone's place.
          return (
            <ProjectUserElement user={item["routeAlertsToUser"] as User} />
          );
        }

        /*
         * Nobody named: the person away is skipped, and the next person in
         * each of their rotations takes the turn. Drawn the way a person is
         * in the cell beside it (UserElement): a round mark where the avatar
         * would be - the rotation's icon - and the words where the name is.
         */
        return (
          <div
            data-testid="user-override-rotation-covers"
            className="flex items-center"
          >
            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200">
              <Icon icon={IconProp.Refresh} className="h-4 w-4" />
            </span>
            <span className="ml-3">
              {translator.translateText(USER_OVERRIDE_ROTATION_COVERS_TEXT)}
            </span>
          </div>
        );
      },
    },
    {
      field: {
        startsAt: true,
      },
      title: "Starts",
      type: FieldType.DateTime,
    },
    {
      field: {
        endsAt: true,
      },
      title: "Ends",
      type: FieldType.DateTime,
    },
  ];

  /*
   * The window a "Get cover" link asks to cover, read once as the page
   * opens. Add User Override opens on it once, and is closed for good -
   * saved or cancelled - the next one starts afresh, from now. The address
   * is cleaned at once, so a reload does not open the dialog again.
   */
  const [coverRequest, setCoverRequest] =
    useState<UserOverrideCoverWindow | null>(() => {
      return readUserOverrideCoverRequest({
        getParam: (name: string): string | null => {
          return Navigation.getQueryStringByName(name);
        },
        now: OneUptimeDate.getCurrentDate(),
      });
    });

  /*
   * On the global page: why Add, Edit and Delete are locked for a reader
   * whose permission covers only some policies, or null.
   */
  const isGlobal: boolean = !props.onCallDutyPolicyId;
  const addLock: string | null = isGlobal
    ? getGlobalUserOverrideLock(ModelAction.Create)
    : null;
  const editLock: string | null = isGlobal
    ? getGlobalUserOverrideLock(ModelAction.Update)
    : null;
  const deleteLock: string | null = isGlobal
    ? getGlobalUserOverrideLock(ModelAction.Delete)
    : null;

  /*
   * For a reader who manages the user overrides of their own team's people
   * only (issue #9733): each row naming somebody outside those teams locks
   * its Edit, End Now and Delete, saying why (UserOverrideTeamLimit). Until
   * the teams' members are read, nothing is locked for it: the server
   * decides.
   */
  const updateTeamLimit: UserOverrideTeamLimit | null =
    getUserOverrideTeamLimit({
      action: ModelAction.Update,
      isGlobal: isGlobal,
    });
  const deleteTeamLimit: UserOverrideTeamLimit | null =
    getUserOverrideTeamLimit({
      action: ModelAction.Delete,
      isGlobal: isGlobal,
    });

  const teamPeople: UserOverrideTeamPeople = useUserOverrideTeamPeople({
    teamIds:
      updateTeamLimit || deleteTeamLimit
        ? Array.from(
            new Set<string>([
              ...(updateTeamLimit?.teamIds || []),
              ...(deleteTeamLimit?.teamIds || []),
            ]),
          ).sort()
        : null,
    withMembers: true,
  });

  // Why a row's Edit and End Now (update) or Delete is locked by the team rule, or null.
  const getTeamLock: (
    item: OnCallDutyPolicyUserOverride,
    action: ModelAction.Update | ModelAction.Delete,
  ) => string | null = (
    item: OnCallDutyPolicyUserOverride,
    action: ModelAction.Update | ModelAction.Delete,
  ): string | null => {
    return getUserOverrideTeamLock({
      action: action,
      limit: action === ModelAction.Update ? updateTeamLimit : deleteTeamLimit,
      memberIds: teamPeople.memberIds,
      people: {
        awayUserId:
          item.overrideUser?._id?.toString() ||
          item.overrideUserId?.toString() ||
          null,
        coverUserId:
          item.routeAlertsToUser?._id?.toString() ||
          item.routeAlertsToUserId?.toString() ||
          null,
      },
    });
  };

  useEffect(() => {
    if (coverRequest && !addLock) {
      setDialog({
        kind: "add",
        initialTimes: {
          startsAt: coverRequest.startsAt,
          endsAt: coverRequest.endsAt,
        },
      });
    }

    if (
      hasUserOverrideCoverParams((name: string): string | null => {
        return Navigation.getQueryStringByName(name);
      })
    ) {
      Navigation.setQueryString({
        [USER_OVERRIDE_COVER_STARTS_AT_PARAM]: null,
        [USER_OVERRIDE_COVER_ENDS_AT_PARAM]: null,
      });
    }
  }, []);

  const closeDialog: () => void = (): void => {
    setDialog(null);
    // The cover dialog was saved or cancelled: the next starts afresh.
    setCoverRequest(null);
  };

  // Counted up: the table reads its rows again.
  const readRowsAgain: () => void = (): void => {
    setSaveCount((count: number): number => {
      return count + 1;
    });
  };

  /*
   * Edit, on each row, gated the way the table gates its own actions: shown
   * locked, naming the permission, to a reader who may not edit overrides.
   * A row the reader may not change says why: it has ended, or - on the
   * global page - their permission covers only some policies.
   */
  const editGate: PermissionGateResult = PermissionGate.check(
    new OnCallDutyPolicyUserOverride(),
    ModelAction.Update,
  );

  const actionButtons: Array<ActionButtonSchema<OnCallDutyPolicyUserOverride>> =
    [];

  if (editGate.isAllowed || editGate.disabledReason) {
    actionButtons.push({
      title: "Edit",
      icon: IconProp.Edit,
      buttonStyleType: ButtonStyleType.OUTLINE,
      disabled: !editGate.isAllowed,
      tooltip: editGate.isAllowed ? undefined : editGate.disabledReason,
      getDisabledReason: (
        item: OnCallDutyPolicyUserOverride,
      ): string | undefined => {
        if (editLock) {
          return editLock;
        }

        const teamLock: string | null = getTeamLock(item, ModelAction.Update);

        if (teamLock) {
          return teamLock;
        }

        if (
          item.startsAt &&
          item.endsAt &&
          UserOverrideEdit.hasEnded(
            {
              startsAt: OneUptimeDate.fromString(item.startsAt),
              endsAt: OneUptimeDate.fromString(item.endsAt),
            },
            OneUptimeDate.getCurrentDate(),
          )
        ) {
          return USER_OVERRIDE_ENDED_REFUSAL;
        }

        return undefined;
      },
      onClick: (
        item: OnCallDutyPolicyUserOverride,
        onCompleteAction: VoidFunction,
      ): void => {
        const target: UserOverrideEditTarget | null =
          toUserOverrideEditTarget(item);

        if (target) {
          setDialog({ kind: "edit", target: target });
        }

        onCompleteAction();
      },
    });
  }

  /*
   * End Now (issue #7899), on an override under way only, in the row's
   * menu beside Edit, which stays the row's button as on every other row:
   * coming back early is the change people make most, and the Edit dialog
   * has it too, under Ends. It edits the override's end, so it is gated as
   * Edit is, and asks first, saying what happens to the time left and who
   * is paged from then on.
   */
  if (editGate.isAllowed || editGate.disabledReason) {
    actionButtons.push({
      title: USER_OVERRIDE_END_NOW_ACTION,
      icon: IconProp.StopCircle,
      buttonStyleType: ButtonStyleType.OUTLINE,
      disabled: !editGate.isAllowed,
      tooltip: editGate.isAllowed ? undefined : editGate.disabledReason,
      isVisible: (item: OnCallDutyPolicyUserOverride): boolean => {
        const target: UserOverrideEndNowTarget | null =
          toUserOverrideEndNowTarget(item);

        return Boolean(target && canEndUserOverrideNow(target));
      },
      getDisabledReason: (
        item: OnCallDutyPolicyUserOverride,
      ): string | undefined => {
        return editLock || getTeamLock(item, ModelAction.Update) || undefined;
      },
      getConfirmation: (
        item: OnCallDutyPolicyUserOverride,
      ): RowActionConfirmation | undefined => {
        const target: UserOverrideEndNowTarget | null =
          toUserOverrideEndNowTarget(item);

        if (!target) {
          return undefined;
        }

        const question: { title: string; description: string } =
          getUserOverrideEndNowQuestion({
            translator: translator,
            target: target,
          });

        return {
          title: question.title,
          description: question.description,
          submitButtonText: USER_OVERRIDE_END_NOW_ACTION,
          submitButtonType: ButtonStyleType.DANGER,
        };
      },
      onClick: async (
        item: OnCallDutyPolicyUserOverride,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): Promise<void> => {
        const target: UserOverrideEndNowTarget | null =
          toUserOverrideEndNowTarget(item);

        if (!target) {
          onCompleteAction();
          return;
        }

        try {
          await endUserOverrideNow(target.id);
          sayUserOverrideEnded({ translator: translator, target: target });
          onCompleteAction();
          readRowsAgain();
        } catch (err) {
          onError(err as Error);
        }
      },
    });
  }

  return (
    <>
      {coverRequest && addLock ? (
        <Alert
          type={AlertType.INFO}
          dataTestId="global-user-override-cover-locked"
          title={addLock}
        />
      ) : (
        <></>
      )}
      <ModelTable<OnCallDutyPolicyUserOverride>
        modelType={OnCallDutyPolicyUserOverride}
        query={query}
        id="on-call-user-override-table"
        name="On-Call Policy > User Overrides"
        userPreferencesKey="on-call-user-override-table"
        isDeleteable={true}
        getDeleteDisabledReason={
          deleteLock || deleteTeamLimit
            ? (item: OnCallDutyPolicyUserOverride): string | undefined => {
                return (
                  deleteLock ||
                  getTeamLock(item, ModelAction.Delete) ||
                  undefined
                );
              }
            : undefined
        }
        isEditable={false}
        actionButtons={actionButtons}
        isCreateable={true}
        // Locked, Add stays on the card with the reason on hover.
        createDisabledReason={addLock || undefined}
        onCreateClick={() => {
          setDialog({ kind: "add" });
        }}
        isViewable={false}
        createVerb="Add"
        refreshToggle={saveCount ? saveCount.toString() : undefined}
        onFetchSuccess={() => {
          void loadOverlapNotes();
        }}
        cardProps={{
          title: props.onCallDutyPolicyId
            ? "On-Call Policy User Overrides"
            : "Global User Overrides",
          description: props.onCallDutyPolicyId
            ? "While someone is away, their pages from this policy go to whoever covers for them, or to the next person in the rotation. For every policy at once, use On-Call > Schedules > User Overrides."
            : "While someone is away, their pages from every on-call policy go to whoever covers for them, or to the next person in the rotation. For one policy only, use that policy's User Overrides page, under Advanced.",
        }}
        noItemsMessage={
          props.onCallDutyPolicyId
            ? "No user overrides have been set for this policy."
            : "No global user overrides have been set."
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        showRefreshButton={true}
        showViewIdButton={true}
        filters={filters}
        columns={columns}
      />
      {dialog ? (
        <UserOverrideFormModal
          key={dialog.kind === "edit" ? `edit-${dialog.target.id}` : "add"}
          overrideToEdit={dialog.kind === "edit" ? dialog.target : undefined}
          onCallDutyPolicyId={props.onCallDutyPolicyId}
          initialTimes={dialog.kind === "add" ? dialog.initialTimes : undefined}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            readRowsAgain();
          }}
          onEditOverride={(target: UserOverrideEditTarget) => {
            setDialog({ kind: "edit", target: target });
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default UserOverrideTable;
