import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Page from "Common/UI/Components/Page/Page";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import PendingProjectInvitations from "Common/UI/Components/ProjectInvitations/PendingProjectInvitations";
import { BILLING_ENABLED } from "Common/UI/Config";
import GlobalConfigUtil from "Common/UI/Utils/GlobalConfig";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps extends PageComponentProps {
  onClickShowProjectModal: () => void;
}

const Welcome: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [canCreateProject, setCanCreateProject] = useState<boolean>(true);

  /*
   * Null until the invitations have been read - not zero. This page is the
   * whole of what someone sees right after signing up, and what belongs on it
   * depends entirely on whether an invitation is waiting: "create your first
   * project" is the wrong headline to put in front of somebody whose team has
   * already invited them. Holding the page on a loader for that one request is
   * worth more than showing the wrong thing and swapping it out underneath
   * them a moment later.
   */
  const [invitationCount, setInvitationCount] = useState<number | null>(null);

  useEffect(() => {
    if (User.isMasterAdmin()) {
      setCanCreateProject(true);
      return;
    }

    GlobalConfigUtil.fetchVars()
      .then((vars: { disableUserProjectCreation: boolean }) => {
        setCanCreateProject(!vars.disableUserProjectCreation);
      })
      .catch(() => {
        setCanCreateProject(true);
      });
  }, []);

  type OnInvitationAcceptedFunction = (projectId: ObjectID) => void;

  const onInvitationAccepted: OnInvitationAcceptedFunction = (
    projectId: ObjectID,
  ): void => {
    ProjectUtil.setLastAccessedProjectId(projectId);

    /*
     * A real page load rather than a client-side route change. The dashboard
     * read this user's projects on boot, before the membership was accepted,
     * and the project the route now names is not in that list - so the shell
     * would find no project to select and bounce straight back to this page.
     * Loading the app again is what puts the new project in front of them.
     */
    Navigation.navigate(
      new Route((RouteMap[PageMap.HOME] as Route).toString()).addRouteParam(
        RouteParams.ProjectID,
        projectId.toString(),
      ),
      {
        forceNavigate: true,
      },
    );
  };

  type GetContentBelowInvitationsFunction = () => ReactElement;

  const getContentBelowInvitations: GetContentBelowInvitationsFunction =
    (): ReactElement => {
      if (invitationCount === null) {
        return <PageLoader isVisible={true} />;
      }

      /*
       * With an invitation on screen, creating a project stops being the point
       * of the page and becomes the alternative to it - so it is offered as a
       * quiet line under the invitations rather than as the full-height empty
       * state, which would otherwise compete with them for the same decision.
       */
      if (invitationCount > 0) {
        if (!canCreateProject) {
          return <></>;
        }

        return (
          <div
            className="mx-auto w-full max-w-3xl text-center"
            id="create-project-alternative"
          >
            <p className="text-sm text-gray-500">
              Or start a project of your own.
            </p>
            <div className="mt-3 flex justify-center">
              {/*
               * NORMAL rather than OUTLINE: OUTLINE is carried by a
               * `btn-outline-secondary` class no stylesheet in this repo
               * defines, and renders as bare text. This has to still read as
               * a button - it is the only way out for a user who wants
               * neither invitation.
               */}
              <Button
                icon={IconProp.Add}
                title={"Create New Project"}
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  props.onClickShowProjectModal();
                }}
                dataTestId="create-new-project-button"
              />
            </div>
          </div>
        );
      }

      if (!canCreateProject) {
        return (
          <EmptyState
            id="empty-state-project-creation-restricted"
            icon={IconProp.Lock}
            title={"Project creation restricted"}
            description={
              <>
                Creating new projects is restricted to admin users on this
                OneUptime Server. Please contact your server admin to be added
                to an existing project.
              </>
            }
          />
        );
      }

      return (
        <EmptyState
          id="empty-state-no-projects"
          icon={IconProp.AddFolder}
          title={"No projects"}
          description={
            <>
              Get started by creating a new project.{" "}
              {BILLING_ENABLED && <span> No credit card required.</span>}
            </>
          }
          footer={
            <Button
              icon={IconProp.Add}
              title={"Create New Project"}
              buttonStyle={ButtonStyleType.PRIMARY}
              onClick={() => {
                props.onClickShowProjectModal();
              }}
              dataTestId="create-new-project-button"
            />
          }
        />
      );
    };

  /*
   * One tree for every state of this page, so the invitations component keeps
   * the same position in it throughout. Returning early per state would give
   * React a different child at that slot each time and remount the component -
   * which would refetch the invitations on the very render its own load
   * triggered, and never settle.
   */
  return (
    <Page title={""} breadcrumbLinks={[]}>
      <PendingProjectInvitations
        className="mt-16 mb-8 mx-auto w-full max-w-3xl"
        onInvitationAccepted={onInvitationAccepted}
        onInvitationsLoaded={(count: number) => {
          setInvitationCount(count);
        }}
      />
      {getContentBelowInvitations()}
    </Page>
  );
};

export default Welcome;
