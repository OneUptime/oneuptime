import API from "../../Utils/API/API";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import ProjectInvitationDisplay from "../../Utils/ProjectInvitationDisplay";
import User from "../../Utils/User";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamMembersByProject, {
  UserProjectMembership,
} from "../../../Utils/TeamMembersByProject";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";

export interface ComponentProps {
  /**
   * Called after every membership of the accepted project has been accepted,
   * with the project the user has just joined. The caller decides what happens
   * next - the dashboard reloads into that project - because navigating from in
   * here would make this component unusable anywhere but the welcome page.
   */
  onInvitationAccepted?: ((projectId: ObjectID) => void) | undefined;
  /**
   * How many invitations are pending, reported after every load - including the
   * first one, including zero, and including a load that failed (as zero).
   *
   * This is the only signal a caller gets that the fetch has finished, and the
   * welcome page needs it: until it knows, it cannot tell whether to offer
   * "create your first project" or to step out of the way of an invitation.
   * That is also why a failed load reports zero rather than staying silent - a
   * user whose invitations cannot be read must still be offered the way
   * forward that does not depend on them.
   */
  onInvitationsLoaded?: ((invitationCount: number) => void) | undefined;
  className?: string | undefined;
}

/*
 * Every project the signed-in user has been invited to and has not accepted
 * yet, offered for acceptance in place.
 *
 * The list is memberships grouped into projects, not memberships: a person
 * invited to three teams of one project is invited to ONE project, and asking
 * them to press Accept three times to get in reads as three separate invites
 * from the same company. Accepting a card therefore accepts every membership
 * behind it, and declining deletes every one of them.
 *
 * Nothing is rendered until the first load finishes (and nothing at all when
 * there is nothing pending), so a page can mount this unconditionally without
 * a loader flashing at the majority of users, who have no invitations.
 */
const PendingProjectInvitations: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [invitations, setInvitations] = useState<Array<UserProjectMembership>>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);

  /*
   * The row key of the card currently mid-request, so only that card's buttons
   * go busy. A single boolean would disable every Accept on the page while one
   * of them is in flight.
   */
  const [busyRowKey, setBusyRowKey] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [invitationToDecline, setInvitationToDecline] =
    useState<UserProjectMembership | null>(null);

  const fetchInvitations: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setLoadError("");

    try {
      const listResult: ListResult<TeamMember> =
        await ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: User.getUserId(),
            hasAcceptedInvitation: false,
          },
          select: {
            _id: true,
            createdAt: true,
            projectId: true,
            project: {
              _id: true,
              name: true,
            },
            teamId: true,
            team: {
              _id: true,
              name: true,
            },
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          /*
           * A pending invitation is the one thing a user reads about a project
           * they are not yet a member of, so it cannot be scoped to the project
           * currently selected in the dashboard - on the welcome page there is
           * no selected project at all.
           */
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });

      const rows: Array<UserProjectMembership> =
        TeamMembersByProject.sortByProjectName(
          TeamMembersByProject.groupByProject(listResult.data),
        );

      setInvitations(rows);
      setIsLoading(false);

      if (props.onInvitationsLoaded) {
        props.onInvitationsLoaded(rows.length);
      }
    } catch (err) {
      setInvitations([]);
      setLoadError(API.getFriendlyMessage(err));
      setIsLoading(false);

      if (props.onInvitationsLoaded) {
        props.onInvitationsLoaded(0);
      }
    }
  };

  useAsyncEffect(async () => {
    await fetchInvitations();
  }, [refreshToggle]);

  type InvitationActionFunction = (
    invitation: UserProjectMembership,
  ) => Promise<void>;

  const acceptInvitation: InvitationActionFunction = async (
    invitation: UserProjectMembership,
  ): Promise<void> => {
    setBusyRowKey(ProjectInvitationDisplay.getRowKey(invitation));
    setActionError("");

    try {
      /*
       * One request per membership, in sequence. There is no bulk accept, and
       * a card stands for at most a handful of teams; running them in sequence
       * keeps a failure attributable to the membership that caused it.
       *
       * A failure part-way through leaves the user accepted into the teams
       * already updated - which does put them in the project - so the list is
       * reloaded below rather than left as it was, and what is still pending
       * comes back as a smaller invitation they can accept again.
       */
      for (const teamMemberId of invitation.teamMemberIds) {
        await ModelAPI.updateById({
          modelType: TeamMember,
          id: new ObjectID(teamMemberId),
          data: {
            hasAcceptedInvitation: true,
            invitationAcceptedAt: OneUptimeDate.getCurrentDate(),
          },
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });
      }

      if (props.onInvitationAccepted && invitation.projectId) {
        props.onInvitationAccepted(invitation.projectId);
      }

      /*
       * The caller normally reloads the dashboard into the project it was just
       * handed, and this never runs. It is here for the case where it does not
       * - an invitation with no project id to hand over, or a caller that only
       * wants to be told - so the accepted card leaves the list either way.
       */
      setBusyRowKey("");
      setRefreshToggle((toggle: boolean) => {
        return !toggle;
      });
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
      setBusyRowKey("");
      setRefreshToggle((toggle: boolean) => {
        return !toggle;
      });
    }
  };

  const declineInvitation: InvitationActionFunction = async (
    invitation: UserProjectMembership,
  ): Promise<void> => {
    setBusyRowKey(ProjectInvitationDisplay.getRowKey(invitation));
    setActionError("");
    setInvitationToDecline(null);

    try {
      for (const teamMemberId of invitation.teamMemberIds) {
        await ModelAPI.deleteItem({
          modelType: TeamMember,
          id: new ObjectID(teamMemberId),
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });
      }
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setBusyRowKey("");
    setRefreshToggle((toggle: boolean) => {
      return !toggle;
    });
  };

  type RenderInvitationFunction = (
    invitation: UserProjectMembership,
  ) => ReactElement;

  const renderInvitation: RenderInvitationFunction = (
    invitation: UserProjectMembership,
  ): ReactElement => {
    const rowKey: string = ProjectInvitationDisplay.getRowKey(invitation);
    const projectName: string =
      ProjectInvitationDisplay.getProjectName(invitation);
    const teamNames: Array<string> =
      ProjectInvitationDisplay.getTeamNames(invitation);
    const isBusy: boolean = Boolean(rowKey) && busyRowKey === rowKey;

    return (
      <li
        key={rowKey}
        data-testid="project-invitation"
        className="px-5 py-4 transition-colors duration-200 hover:bg-gray-50 md:px-6"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {/* Decorative: the project name sits right next to it. */}
            <div
              aria-hidden="true"
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold tracking-wide text-white shadow-sm"
            >
              {ProjectInvitationDisplay.getInitials(projectName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">
                {projectName}
              </p>
              {teamNames.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {teamNames.map((teamName: string) => {
                    return (
                      <span
                        key={teamName}
                        className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
                      >
                        {teamName}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  {`You have been invited to ${ProjectInvitationDisplay.getTeamCountLabel(
                    invitation,
                  )} in this project.`}
                </p>
              )}
              {invitation.joinedAt ? (
                <p className="mt-1.5 text-xs text-gray-400">
                  {`Invited ${OneUptimeDate.fromNow(invitation.joinedAt)}`}
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 md:justify-end">
            {/*
             * NORMAL, not OUTLINE: the OUTLINE style is carried by a
             * `btn-outline-secondary` class no stylesheet in this repo
             * defines, so it renders as bare text - and "Decline" reading as
             * a caption rather than a control is how somebody presses it by
             * accident.
             */}
            <Button
              title="Decline"
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              /*
               * Both buttons carry `w-full` below the md breakpoint, so on a
               * phone they share the row and "Accept & Join" breaks across two
               * lines inside its own box. They fit side by side unwrapped at
               * 375px; this is what stops them being wrapped anyway.
               */
              className="whitespace-nowrap"
              disabled={isBusy}
              dataTestId="decline-invitation-button"
              ariaLabel={`Decline invitation to ${projectName}`}
              onClick={() => {
                setInvitationToDecline(invitation);
              }}
            />
            <Button
              title="Accept & Join"
              icon={IconProp.Check}
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              className="whitespace-nowrap"
              isLoading={isBusy}
              disabled={isBusy}
              dataTestId="accept-invitation-button"
              ariaLabel={`Accept invitation to ${projectName}`}
              onClick={() => {
                acceptInvitation(invitation).catch(() => {
                  /*
                   * acceptInvitation reports its own failures into the card;
                   * this only stops an unhandled rejection reaching the console.
                   */
                });
              }}
            />
          </div>
        </div>
      </li>
    );
  };

  /*
   * Nothing at all until the first load lands. Most people who reach the
   * welcome page have no invitation waiting, and a loader that resolves to an
   * empty region is a flash of furniture they never needed.
   */
  if (isLoading) {
    return <></>;
  }

  if (loadError) {
    return (
      <div className={props.className || ""} data-testid="invitations-error">
        <ErrorMessage
          message={loadError}
          onRefreshClick={() => {
            setRefreshToggle((toggle: boolean) => {
              return !toggle;
            });
          }}
        />
      </div>
    );
  }

  if (invitations.length === 0) {
    return <></>;
  }

  return (
    <div className={props.className || ""} data-testid="pending-invitations">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-start gap-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-white px-5 py-5 md:px-6">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 shadow-sm">
            <Icon
              icon={IconProp.Email}
              size={SizeProp.Five}
              className="h-5 w-5 text-white"
            />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-gray-900">
              {invitations.length === 1
                ? "You have been invited to a project"
                : `You have been invited to ${invitations.length} projects`}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              Accept an invitation to join right away. There is nothing to set
              up.
            </p>
          </div>
        </div>

        {actionError ? (
          <div
            data-testid="invitation-action-error"
            role="alert"
            className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 md:px-6"
          >
            {actionError}
          </div>
        ) : (
          <></>
        )}

        <ul role="list" className="divide-y divide-gray-200">
          {invitations.map(renderInvitation)}
        </ul>
      </div>

      {invitationToDecline ? (
        <ConfirmModal
          title={`Decline invitation`}
          description={`Are you sure you want to decline the invitation to ${ProjectInvitationDisplay.getProjectName(
            invitationToDecline,
          )}? You will lose access to ${ProjectInvitationDisplay.getTeamCountLabel(
            invitationToDecline,
          )} in this project, and will need a new invitation to join.`}
          submitButtonText={`Decline`}
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={() => {
            const invitation: UserProjectMembership = invitationToDecline;

            declineInvitation(invitation).catch(() => {
              // declineInvitation reports its own failures into the card.
            });
          }}
          onClose={() => {
            setInvitationToDecline(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default PendingProjectInvitations;
