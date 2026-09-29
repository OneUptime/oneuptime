import ProjectScopedTeamsPicker, {
  resolveProjectIdFromFormValue,
  selectedTeamIdsFromFormValue,
} from "../GlobalProvider/ProjectScopedTeamsPicker";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import Field, {
  CustomElementProps,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * What the admin picked. The modal only collects it - the memberships are
 * created by the caller, so the result lands in the same bulk progress modal
 * as every other bulk action on the Users table.
 */
export interface BulkAddUsersToProjectSelection {
  projectId: ObjectID;
  teamId: ObjectID;
  hasAcceptedInvitation: boolean;
}

export interface ComponentProps {
  users: Array<User>;
  onClose: () => void;
  onSubmit: (selection: BulkAddUsersToProjectSelection) => void;
}

interface BulkAddUsersToProjectFormValues {
  project?: string | undefined;
  team?: string | undefined;
  hasAcceptedInvitation?: boolean | undefined;
}

const BulkAddUsersToProjectModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  const [error, setError] = useState<string>("");
  const [submitButtonText, setSubmitButtonText] = useState<string>(
    t("pages.users.bulkAddToProjectNext"),
  );

  const formRef: MutableRefObject<any> = useRef<any>(null);

  // A ref, not state: a re-render must not reopen the window for a second submit.
  const hasSubmittedRef: MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * Two steps, and the team picker is on the second one, because the teams to
   * offer are the chosen project's. Same shape as the single-user
   * "Add to Project" form on User > Projects, so the flow an admin already
   * knows is the flow they get here.
   */
  const formSteps: Array<FormStep<BulkAddUsersToProjectFormValues>> = [
    {
      id: "project",
      title: t("pages.users.bulkAddToProjectStepProject"),
    },
    {
      id: "team",
      title: t("pages.users.bulkAddToProjectStepTeam"),
    },
  ];

  const onFormSubmit: (
    values: FormValues<BulkAddUsersToProjectFormValues>,
  ) => void = (values: FormValues<BulkAddUsersToProjectFormValues>): void => {
    /*
     * One submit per modal. The footer button is not disabled while the parent
     * tears this component down, and BasicForm.submitForm is re-entrant, so a
     * double press would otherwise start two runs over the same selection -
     * the first one's completion re-enabling the progress modal's Close button
     * while the second is still creating memberships.
     */
    if (hasSubmittedRef.current) {
      return;
    }

    const projectId: ObjectID | undefined = resolveProjectIdFromFormValue(
      (values as { project?: unknown }).project,
    );

    /*
     * BasicForm validates the step's required fields before it calls this, so
     * these two guards are not the usual way an empty pick is caught. They
     * stay because the cost of getting past them is not a validation message:
     * TeamMemberService dereferences `createBy.data.team!._id!` when no teamId
     * is sent, which is a 500 rather than a refusal.
     */
    if (!projectId) {
      setError(t("pages.users.bulkAddToProjectSelectProject"));
      return;
    }

    const teamId: string | undefined = selectedTeamIdsFromFormValue([
      (values as { team?: unknown }).team,
    ])[0];

    if (!teamId) {
      setError(t("pages.users.bulkAddToProjectSelectTeam"));
      return;
    }

    setError("");
    hasSubmittedRef.current = true;

    props.onSubmit({
      projectId: projectId,
      teamId: new ObjectID(teamId),
      hasAcceptedInvitation: Boolean(values.hasAcceptedInvitation),
    });
  };

  const fields: Array<Field<BulkAddUsersToProjectFormValues>> = [
    {
      field: {
        project: true,
      },
      stepId: "project",
      title: t("pages.users.bulkAddToProjectFieldProject"),
      description: t("pages.users.bulkAddToProjectFieldProjectDescription"),
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownModal: {
        type: Project,
        labelField: "name",
        valueField: "_id",
      },
      required: true,
      placeholder: t("pages.users.bulkAddToProjectFieldProjectPlaceholder"),
    },
    {
      field: {
        team: true,
      },
      stepId: "team",
      title: t("pages.users.bulkAddToProjectFieldTeam"),
      description: t("pages.users.bulkAddToProjectFieldTeamDescription"),
      /*
       * A custom element rather than `fetchDropdownOptions`: the teams to offer
       * depend on the project chosen in the previous step, and
       * fetchDropdownOptions only re-runs when the form's fields change, so it
       * would fetch before a project exists.
       */
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      getCustomElement: (
        values: FormValues<BulkAddUsersToProjectFormValues>,
        elementProps: CustomElementProps,
      ): ReactElement => {
        return (
          <ProjectScopedTeamsPicker
            isMultiSelect={false}
            projectId={resolveProjectIdFromFormValue(
              (values as { project?: unknown }).project,
            )}
            selectedTeamIds={selectedTeamIdsFromFormValue([
              (values as { team?: unknown }).team,
            ])}
            placeholder={t("pages.users.bulkAddToProjectFieldTeamPlaceholder")}
            noProjectMessage={t("pages.users.bulkAddToProjectSelectProject")}
            onChange={(teamIds: Array<string>) => {
              elementProps.onChange?.(teamIds[0] || "");
            }}
          />
        );
      },
    },
    {
      field: {
        hasAcceptedInvitation: true,
      },
      stepId: "team",
      title: t("pages.users.bulkAddToProjectFieldAutoAccept"),
      description: t("pages.users.bulkAddToProjectFieldAutoAcceptDescription"),
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      defaultValue: false,
    },
  ];

  return (
    <Modal
      title={t("pages.users.bulkAddToProjectTitle")}
      /*
       * `userCount`, not `count`: i18next treats a `count` option as a request
       * for plural key lookup (`..._one` / `..._other`), which these keys do
       * not define. This locale set spells plurals out as separate keys
       * instead, so the placeholder is kept a plain variable.
       */
      description={t("pages.users.bulkAddToProjectDescription", {
        userCount: props.users.length,
      })}
      modalWidth={ModalWidth.Medium}
      submitButtonText={submitButtonText}
      submitButtonType={ButtonType.Submit}
      onClose={props.onClose}
      onSubmit={() => {
        formRef.current?.submitForm();
      }}
      error={error}
    >
      <BasicForm
        ref={formRef}
        id="bulk-add-users-to-project-form"
        name="Admin > Users > Add to Project"
        hideSubmitButton={true}
        fields={fields}
        steps={formSteps}
        onIsLastFormStep={(isLastFormStep: boolean) => {
          setSubmitButtonText(
            isLastFormStep
              ? t("pages.users.bulkAddToProjectSubmit")
              : t("pages.users.bulkAddToProjectNext"),
          );
        }}
        onSubmit={(values: FormValues<BulkAddUsersToProjectFormValues>) => {
          onFormSubmit(values);
        }}
      />
    </Modal>
  );
};

export default BulkAddUsersToProjectModal;
