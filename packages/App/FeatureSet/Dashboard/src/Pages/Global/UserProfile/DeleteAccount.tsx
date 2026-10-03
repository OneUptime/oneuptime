import PageComponentProps from "../../PageComponentProps";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "Common/UI/Utils/User";
import NamedSentence from "Common/UI/Components/DeleteConfirmation/NamedSentence";
import User from "Common/Models/DatabaseModels/User";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement, useState } from "react";
import useAsyncEffect from "use-async-effect";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

// The Delete Account confirmation, naming the account by its email.
export const DELETE_ACCOUNT_TEMPLATE: string =
  "Are you sure you want to delete your account ({{email}})? This action is permanent and cannot be undone. All your personal data will be removed.";

// The same, when the email is not known.
export const DELETE_UNNAMED_ACCOUNT_SENTENCE: string =
  "Are you sure you want to delete your account? This action is permanent and cannot be undone. All your personal data will be removed.";

const DeleteAccount: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [projects, setProjects] = useState<Array<Project>>([]);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [showDeleteErrorModal, setShowDeleteErrorModal] =
    useState<boolean>(false);

  const userId: ObjectID = UserUtil.getUserId();

  const fetchUserProjects: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const teamMembers: ListResult<TeamMember> =
        await ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            userId: userId,
          },
          limit: 100,
          skip: 0,
          select: {
            projectId: true,
            project: {
              name: true,
            },
          },
          sort: {},
          requestOptions: {
            isMultiTenantRequest: true,
          },
        });

      // Extract unique projects
      const uniqueProjects: Array<Project> = [];
      const seenProjectIds: Set<string> = new Set();

      for (const teamMember of teamMembers.data) {
        const projectId: string | undefined = teamMember.projectId?.toString();
        if (projectId && !seenProjectIds.has(projectId)) {
          seenProjectIds.add(projectId);
          if (teamMember.project) {
            uniqueProjects.push(teamMember.project);
          }
        }
      }

      setProjects(uniqueProjects);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    await fetchUserProjects();
  }, []);

  const deleteAccount: PromiseVoidFunction = async (): Promise<void> => {
    setIsDeleting(true);
    setDeleteError("");

    try {
      await ModelAPI.deleteItem<User>({
        modelType: User,
        id: userId,
        requestOptions: {},
      });

      // Clear user session and force redirect to login page
      UserUtil.logout();
      window.location.href = "/accounts/login";
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
      setShowDeleteErrorModal(true);
    }

    setIsDeleting(false);
  };

  const canDeleteAccount: boolean = projects.length === 0;

  const accountEmail: string = UserUtil.getEmail()?.toString().trim() || "";

  return (
    <div>
      <Alert
        type={AlertType.DANGER}
        strongTitle="DANGER ZONE"
        title="Deleting your account is permanent and cannot be undone. All your personal data will be removed."
        className="mb-5"
      />

      {isLoading && <ComponentLoader />}

      {error && <ErrorMessage message={error} />}

      {!isLoading && !error && !canDeleteAccount && (
        <Card
          title="Cannot Delete Account"
          description="You must leave all projects before deleting your account."
        >
          <div className="mt-4">
            <p className="text-sm text-gray-600 mb-4">
              {translator.translateText(
                "You are currently a member of the following projects. Please leave or be removed from these projects before deleting your account:",
              )}
            </p>
            <ul className="list-disc list-inside space-y-2">
              {projects.map((project: Project, index: number) => {
                return (
                  <li key={index} className="text-sm text-gray-700">
                    {project.name ||
                      translator.translateText("Unnamed Project")}
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-gray-600 mt-4">
              {translator.translateText(
                "To leave a project, go to the project settings and remove yourself from all teams, or ask a project admin to remove you.",
              )}
            </p>
          </div>
        </Card>
      )}

      {!isLoading && !error && canDeleteAccount && (
        <Card
          title="Delete Account"
          description="Are you sure you want to delete your account? This action is permanent and cannot be undone."
          buttons={[
            {
              title: "Delete Account",
              buttonStyle: ButtonStyleType.DANGER,
              onClick: () => {
                setShowDeleteModal(true);
              },
              isLoading: isDeleting,
              icon: IconProp.Trash,
            },
          ]}
        />
      )}

      {showDeleteModal && (
        <ConfirmModal
          /*
           * Named by the email it signs in with: someone with a work and a
           * personal account is sure, here, which one they are signed in as.
           */
          description={
            accountEmail ? (
              <span data-testid="delete-account-description">
                <NamedSentence
                  template={DELETE_ACCOUNT_TEMPLATE}
                  slot="email"
                  name={accountEmail}
                />
              </span>
            ) : (
              DELETE_UNNAMED_ACCOUNT_SENTENCE
            )
          }
          title="Delete Account"
          onSubmit={async () => {
            setShowDeleteModal(false);
            await deleteAccount();
          }}
          onClose={() => {
            setShowDeleteModal(false);
          }}
          submitButtonText="Delete Account"
          submitButtonType={ButtonStyleType.DANGER}
        />
      )}

      {showDeleteErrorModal && (
        <ConfirmModal
          description={deleteError}
          title="Delete Error"
          onSubmit={() => {
            setShowDeleteErrorModal(false);
            setDeleteError("");
          }}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}
    </div>
  );
};

export default DeleteAccount;
