import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import Page from "Common/UI/Components/Page/Page";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a new project costs, on OneUptime Cloud, said where it is true: a
 * project needs no card on any plan, but on the Free plan checking a
 * website does - the first thing most people do (#8246). It said "No
 * credit card required." after "A project holds your monitors...", which
 * read as monitors being free. Short, beside the sentence before it: the
 * empty state's description holds 150 characters.
 */
export const WELCOME_CARD_LINE: string = translationKey(
  "A project needs no card. On the Free plan, checking a website needs a payment method.",
);

// The page's heading and its one-step trail.
export const WELCOME_PAGE_TITLE: string = translationKey(
  "Welcome to OneUptime",
);

export interface ComponentProps extends PageComponentProps {
  onClickShowProjectModal: () => void;
}

const Welcome: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
        return <PageSkeleton />;
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
              {translator.translateText("Or start a project of your own.")}
            </p>
            <div className="mt-3 flex justify-center">
              {/*
               * A bordered button, centred under the sentence: it is the
               * only way out for a user who wants neither invitation, so it
               * has to read as a button.
               */}
              <Button
                icon={IconProp.Add}
                title={"Create Project"}
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
            size={EmptyStateSize.Page}
            id="empty-state-project-creation-restricted"
            icon={IconProp.Lock}
            title={"Ask to join a project"}
            description={
              <>
                {translator.translateText(
                  "Only admins can create projects on this server. Ask your server admin to add you to one.",
                )}
              </>
            }
          />
        );
      }

      /*
       * Someone who has just signed up does not know what a project is, and
       * this page is all they see. Say it - in the words the create project
       * dialog uses - rather than only that they have none.
       */
      return (
        <EmptyState
          size={EmptyStateSize.Page}
          id="empty-state-no-projects"
          icon={IconProp.AddFolder}
          title={"No projects yet"}
          description={
            <>
              {translator.translateText(
                "A project holds your monitors, incidents, status pages and team.",
              )}{" "}
              {/*
               * OneUptime Cloud only: a self-hosted server never asks for a
               * card. A project needs none, on any plan; checking a website
               * does on the Free plan, so the line says where "no card"
               * stops being true (#8246).
               */}
              {BILLING_ENABLED && (
                <span>{translator.translateText(WELCOME_CARD_LINE)}</span>
              )}
            </>
          }
          footer={
            <Button
              icon={IconProp.Add}
              title={"Create Project"}
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
  /*
   * The first page after sign-up has a heading and a trail like every other
   * page (#9121): it opened on a bare "No projects", which read as a failed
   * load. Creating a project is its one primary action. The server setup
   * checklist a new server's admin needs is not drawn here: it sat above the
   * empty state as a second next step, and Home draws it above the new
   * project's quickstart, which is where Create Project leads.
   */
  return (
    <Page
      title={WELCOME_PAGE_TITLE}
      breadcrumbLinks={[
        {
          title: WELCOME_PAGE_TITLE,
          to: RouteMap[PageMap.WELCOME] as Route,
        },
      ]}
    >
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
