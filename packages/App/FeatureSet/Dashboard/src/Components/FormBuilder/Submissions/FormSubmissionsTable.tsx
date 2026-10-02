import FormsCopy from "../FormsCopy";
import {
  getFormSubmissionCreatedLink,
  getFormSubmissionSubmitter,
  FormSubmissionCreatedLink,
} from "./FormSubmissionPresentation";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import FormSubmission from "Common/Models/DatabaseModels/FormSubmission";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  FormSubmissionAnswer,
  readFormSubmissionAnswers,
} from "Common/Types/Form/FormSubmissionAnswer";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The submissions made through one form (on the form's Submissions page) or
 * through every form (Forms > Submissions): when, who as far as they said,
 * and what each one created - linked, while it still exists. View Answers
 * shows every answer, worded as the form asked it when it was submitted.
 */

export interface ComponentProps {
  // One form's submissions; every form's when left out.
  formId?: ObjectID | undefined;
}

const FormSubmissionsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [answersOf, setAnswersOf] = useState<FormSubmission | null>(null);

  const isAllForms: boolean = !props.formId;

  const columns: Columns<FormSubmission> = [
    {
      field: {
        createdAt: true,
      },
      title: FormsCopy.submittedAt,
      type: FieldType.DateTime,
    },
  ];

  if (isAllForms) {
    columns.push({
      field: {
        form: {
          _id: true,
          name: true,
        },
      },
      title: "Form",
      type: FieldType.Element,
      getElement: (item: FormSubmission): ReactElement => {
        const formId: string | undefined =
          item.form?._id?.toString() || item.formId?.toString();

        if (!formId) {
          return <>-</>;
        }

        return (
          <Link
            className="font-medium text-indigo-600 hover:text-indigo-500"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.FORM_VIEW] as Route,
              { modelId: new ObjectID(formId) },
            )}
          >
            {item.form?.name || formId}
          </Link>
        );
      },
      getExportValue: (item: FormSubmission): string => {
        return item.form?.name || "";
      },
    });
  }

  columns.push(
    {
      field: {
        submitterName: true,
      },
      title: FormsCopy.submittedBy,
      type: FieldType.Element,
      getElement: (item: FormSubmission): ReactElement => {
        const submitter: { name: string; email: string } =
          getFormSubmissionSubmitter(item);

        if (!submitter.name && !submitter.email) {
          return (
            <span className="text-sm text-gray-500">
              {tx(FormsCopy.anonymous)}
            </span>
          );
        }

        return (
          <div className="min-w-0 text-sm">
            {submitter.name ? (
              <p className="font-medium text-gray-900 [overflow-wrap:anywhere]">
                {submitter.name}
              </p>
            ) : (
              <></>
            )}
            {submitter.email ? (
              <p className="text-gray-500 [overflow-wrap:anywhere]">
                {submitter.email}
              </p>
            ) : (
              <></>
            )}
          </div>
        );
      },
      getExportValue: (item: FormSubmission): string => {
        const submitter: { name: string; email: string } =
          getFormSubmissionSubmitter(item);

        return [submitter.name, submitter.email].filter(Boolean).join(" ");
      },
    },
    {
      field: {
        incident: {
          _id: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        scheduledMaintenance: {
          _id: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        },
      },
      title: FormsCopy.created,
      type: FieldType.Element,
      getElement: (item: FormSubmission): ReactElement => {
        const created: FormSubmissionCreatedLink | null =
          getFormSubmissionCreatedLink(item);

        if (!created) {
          return (
            <span className="text-sm text-gray-500">
              {tx(FormsCopy.createdDeleted)}
            </span>
          );
        }

        return (
          <Link
            className="font-medium text-indigo-600 hover:text-indigo-500"
            to={RouteUtil.populateRouteParams(RouteMap[created.pageMap] as Route, {
              modelId: created.id,
            })}
          >
            {tx(created.kindTitle)} {created.reference}
          </Link>
        );
      },
      getExportValue: (item: FormSubmission): string => {
        const created: FormSubmissionCreatedLink | null =
          getFormSubmissionCreatedLink(item);

        return created ? created.reference : "";
      },
    },
  );

  return (
    <>
      <ModelTable<FormSubmission>
        modelType={FormSubmission}
        id={isAllForms ? "all-form-submissions-table" : "form-submissions-table"}
        userPreferencesKey={
          isAllForms ? "all-form-submissions-table" : "form-submissions-table"
        }
        name={isAllForms ? "Forms > Submissions" : "Form > Submissions"}
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName={FormsCopy.submission}
        pluralName={FormsCopy.submissionsTitle}
        query={
          props.formId
            ? {
                formId: props.formId,
                projectId: ProjectUtil.getCurrentProjectId()!,
              }
            : {
                projectId: ProjectUtil.getCurrentProjectId()!,
              }
        }
        selectMoreFields={{
          formId: true,
          answers: true,
          submitterEmail: true,
          targetType: true,
          incidentId: true,
          scheduledMaintenanceId: true,
        }}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: FormsCopy.submissionsTitle,
          description: isAllForms
            ? FormsCopy.allSubmissionsDescription
            : FormsCopy.submissionsDescription,
        }}
        noItemsMessage={FormsCopy.submissionsEmpty}
        showRefreshButton={true}
        getDeleteConfirmation={async (): Promise<DeleteConfirmation> => {
          return {
            title: FormsCopy.deleteSubmissionTitle,
            description: FormsCopy.deleteSubmissionDescription,
            submitButtonText: "Delete",
          };
        }}
        actionButtons={[
          {
            title: FormsCopy.viewAnswers,
            icon: IconProp.Eye,
            buttonStyleType: ButtonStyleType.OUTLINE,
            placement: ActionButtonPlacement.Primary,
            onClick: (item: FormSubmission, onCompleteAction: () => void) => {
              setAnswersOf(item);
              onCompleteAction();
            },
          } as ActionButtonSchema<FormSubmission>,
        ]}
        filters={[
          {
            field: {
              createdAt: true,
            },
            title: FormsCopy.submittedAt,
            type: FieldType.Date,
          },
          {
            field: {
              submitterName: true,
            },
            title: FormsCopy.submitterName,
            type: FieldType.Text,
          },
          {
            field: {
              submitterEmail: true,
            },
            title: FormsCopy.submitterEmail,
            type: FieldType.Email,
          },
        ]}
        columns={columns}
      />

      {answersOf ? (
        <Modal
          title={FormsCopy.answersTitle}
          modalWidth={ModalWidth.Large}
          closeButtonText="Close"
          onClose={() => {
            setAnswersOf(null);
          }}
        >
          <FormSubmissionAnswersList submission={answersOf} />
        </Modal>
      ) : (
        <></>
      )}
    </>
  );
};

interface AnswersListProps {
  submission: FormSubmission;
}

// Every answer, under the question it answered.
export const FormSubmissionAnswersList: FunctionComponent<AnswersListProps> = (
  props: AnswersListProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const answers: Array<FormSubmissionAnswer> = readFormSubmissionAnswers(
    props.submission.answers,
  );

  if (answers.length === 0) {
    return (
      <p
        className="text-sm text-gray-500"
        data-testid="form-submission-no-answers"
      >
        {translateString(FormsCopy.noAnswers) || FormsCopy.noAnswers}
      </p>
    );
  }

  return (
    <dl
      className="divide-y divide-gray-100"
      data-testid="form-submission-answers"
    >
      {answers.map(
        (answer: FormSubmissionAnswer, index: number): ReactElement => {
          return (
            <div key={`${answer.fieldId}-${index}`} className="py-3">
              <dt className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                {answer.label}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-700 [overflow-wrap:anywhere]">
                {answer.displayValue || "-"}
              </dd>
            </div>
          );
        },
      )}
    </dl>
  );
};

export default FormSubmissionsTable;
