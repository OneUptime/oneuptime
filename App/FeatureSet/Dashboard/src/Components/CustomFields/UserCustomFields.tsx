import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import CustomFieldsDetail from "Common/UI/Components/CustomFields/CustomFieldsDetail";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ProjectUserProfile from "Common/Models/DatabaseModels/ProjectUserProfile";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A team member's custom field values.
 *
 * Users are the one resource whose custom field values do NOT live on the
 * record being viewed: User is global, so the per-project answers are stored
 * on the ProjectUserProfile row for (project, user). That row has to be
 * looked up before the shared card can be pointed at anything, which is why
 * this wrapper exists rather than the overview page calling
 * CustomFieldsDetail directly the way every other resource does.
 *
 * Read-only on purpose - a project admin looking at someone else's profile
 * should not be editing their answers from here.
 */

export interface ComponentProps {
  userId: ObjectID;
  /*
   * Set on the user overview page, where this card is one block among many
   * and should simply not appear unless there is something to show. Left off
   * on the dedicated Custom Fields page, which is the place that explains
   * WHY there is nothing - see the empty states below.
   */
  hideIfEmpty?: boolean | undefined;
}

const UserCustomFields: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [projectUserProfileId, setProjectUserProfileId] =
    useState<ObjectID | null>(null);
  const [hasCustomFields, setHasCustomFields] = useState<boolean>(false);

  const loadPage: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        setHasCustomFields(false);
        return;
      }

      const customFieldsResult: ListResult<TeamMemberCustomField> =
        await ModelAPI.getList<TeamMemberCustomField>({
          modelType: TeamMemberCustomField,
          query: {
            projectId: projectId,
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
          },
          sort: {},
        });

      setHasCustomFields(customFieldsResult.data.length > 0);

      /*
       * Skip the profile lookup when the project defined no fields: the card
       * would render nothing either way, and this is on the critical path of
       * a page most projects open without ever using custom fields.
       */
      if (customFieldsResult.data.length > 0) {
        const profileResult: ListResult<ProjectUserProfile> =
          await ModelAPI.getList<ProjectUserProfile>({
            modelType: ProjectUserProfile,
            query: {
              projectId: projectId,
              userId: props.userId,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {},
          });

        if (profileResult.data.length > 0 && profileResult.data[0]!.id) {
          setProjectUserProfileId(profileResult.data[0]!.id);
        }
      }
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Exception));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPage().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err as Exception));
    });
  }, [props.userId.toString()]);

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const hasSomethingToShow: boolean = Boolean(
    !isLoading &&
      !error &&
      hasCustomFields &&
      projectUserProfileId &&
      projectId,
  );

  if (props.hideIfEmpty) {
    /*
     * Nothing to say and nothing to apologise for: on the overview the card
     * either shows values or is not there at all. A read failure is silent
     * here for the same reason it is in CustomFieldsDetail - reading the
     * schema is plan-gated, and the dedicated page still reports it.
     */
    if (!hasSomethingToShow) {
      return <></>;
    }
  } else {
    if (isLoading) {
      return <PageLoader isVisible={true} />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!hasCustomFields) {
      return (
        <EmptyState
          id="empty-state-user-custom-fields"
          icon={IconProp.TableCells}
          title="No custom fields defined"
          description="There are no custom fields defined for team members in this project. Define custom fields in Project Settings to capture additional information about each user."
        />
      );
    }

    if (!projectUserProfileId || !projectId) {
      return (
        <EmptyState
          id="empty-state-user-custom-fields-no-profile"
          icon={IconProp.TableCells}
          title="No custom field values"
          description="This user does not have any custom field values yet."
        />
      );
    }
  }

  return (
    <Fragment>
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom field values for this user."
        modelType={ProjectUserProfile}
        customFieldType={TeamMemberCustomField}
        name="User Custom Fields"
        projectId={projectId!}
        modelId={projectUserProfileId!}
        isEditable={false}
        /*
         * Forwarded, not just consulted above: the inner card runs its own
         * pair of requests after it mounts, and until those land it would
         * paint "no custom fields have been added" onto an overview that is
         * about to show several. Its own read failure has to be as silent
         * here as this wrapper's is.
         */
        hideIfEmpty={props.hideIfEmpty}
      />
    </Fragment>
  );
};

export default UserCustomFields;
