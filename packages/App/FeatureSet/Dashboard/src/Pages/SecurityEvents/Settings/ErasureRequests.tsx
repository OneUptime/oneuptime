import PageComponentProps from "../../PageComponentProps";
import {
  ErasureChangesCell,
  ErasureRequestCell,
  ErasureStatusCell,
  ErasureTokensCell,
} from "../../../Components/SecurityEvents/ErasureRequests/ErasureRequestCells";
import {
  CHANGES_COLUMN,
  ERASE_A_PERSON,
  ERASE_DIALOG_DESCRIPTION,
  ERASE_NOUN,
  ERASE_PERSON,
  ERASE_VERB,
  ERASURE_HELP_DESCRIPTION,
  ERASURE_HELP_MARKDOWN,
  ERASURE_REQUESTED,
  ERASURE_REQUESTS_DESCRIPTION,
  ERASURE_REQUESTS_TITLE,
  NO_ERASURE_REQUESTS,
  REFERENCE_FIELD_DESCRIPTION,
  REFERENCE_FIELD_TITLE,
  REQUEST_COLUMN,
  STATUS_COLUMN,
  TOKENS_COLUMN,
  USER_FIELD_DESCRIPTION,
  USER_FIELD_TITLE,
} from "../../../Components/SecurityEvents/ErasureRequests/ErasureRequestCopy";
import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH,
  SECURITY_USER_ERASURE_MAX_USER_LENGTH,
  getErasureUserProblem,
} from "Common/Types/SecurityEvent/SecurityUserErasure";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * SECURITY EVENTS > SETTINGS > ERASURE REQUESTS (#10908).
 *
 * Where a person is erased from Security Events' user vault when they ask -
 * a right-to-erasure request, GDPR Article 17 - and where the request says
 * when it is done. One button, Erase Person: one field (the user ID, email
 * address or token, as the logs held it) and an optional reference, in a
 * dialog that says what happens and that it cannot be undone, its button in
 * the danger style. Each request's row says where it stands - Queued,
 * Erasing, Erased or Failed - and what it changed, and lists the tokens the
 * vault refuses for it. Nothing here ever shows who was erased.
 *
 * Nobody changes or deletes a request: it is the record that the erasure
 * happened (Models/DatabaseModels/SecurityUserErasureRequest).
 */
const SecurityErasureRequestsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<SecurityUserErasureRequest>
      modelType={SecurityUserErasureRequest}
      id="security-erasure-requests-table"
      name="Security Events > Erasure Requests"
      userPreferencesKey="security-erasure-requests-table"
      query={{ projectId: ProjectUtil.getCurrentProjectId()! }}
      isDeleteable={false}
      isEditable={false}
      isCreateable={true}
      isViewable={false}
      sortBy="requestedAt"
      sortOrder={SortOrder.Descending}
      cardProps={{
        title: ERASURE_REQUESTS_TITLE,
        description: ERASURE_REQUESTS_DESCRIPTION,
      }}
      helpContent={{
        title: ERASURE_REQUESTS_TITLE,
        description: ERASURE_HELP_DESCRIPTION,
        markdown: ERASURE_HELP_MARKDOWN,
      }}
      documentationLink={Route.fromString(
        "/docs/telemetry/security-events#erase-a-person",
      )}
      noItemsMessage={NO_ERASURE_REQUESTS}
      // "Erase Person": what the button does, to whom.
      createVerb={ERASE_VERB}
      singularName={ERASE_NOUN}
      pluralName={ERASURE_REQUESTS_TITLE}
      createFormTitle={ERASE_A_PERSON}
      createFormSubmitButtonText={ERASE_PERSON}
      createFormDescription={ERASE_DIALOG_DESCRIPTION}
      createFormSubmitButtonStyle={ButtonStyleType.DANGER}
      // Says what happens next, rather than "Person created".
      hideChangeToasts={true}
      onCreateSuccess={async (
        item: SecurityUserErasureRequest,
      ): Promise<SecurityUserErasureRequest> => {
        Toast.success(
          translator.translateText(ERASURE_REQUESTED) || ERASURE_REQUESTED,
        );

        return item;
      }}
      formFields={[
        {
          field: { userToErase: true },
          title: USER_FIELD_TITLE,
          description: USER_FIELD_DESCRIPTION,
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "alice@example.com",
          disableSpellCheck: true,
          customValidation: (
            values: FormValues<SecurityUserErasureRequest>,
          ): string | null => {
            const problem: string | null = getErasureUserProblem(
              String(
                (values as Record<string, unknown>)["userToErase"] || "",
              ),
            );

            return problem
              ? translator.translateText(problem) || problem
              : null;
          },
          validation: {
            maxLength: SECURITY_USER_ERASURE_MAX_USER_LENGTH,
          },
        },
        {
          field: { reference: true },
          title: REFERENCE_FIELD_TITLE,
          // The field says (Optional) itself.
          description: REFERENCE_FIELD_DESCRIPTION,
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "DSR-1042",
          disableSpellCheck: true,
          validation: {
            maxLength: SECURITY_USER_ERASURE_MAX_REFERENCE_LENGTH,
          },
        },
      ]}
      showRefreshButton={true}
      filters={[]}
      selectMoreFields={{
        reference: true,
        status: true,
        requestedAt: true,
        completedAt: true,
        failureReason: true,
        tokens: true,
        vaultEntriesDeleted: true,
        eventsUnnamed: true,
        casesUnnamed: true,
        proposalsWithdrawn: true,
      }}
      columns={[
        {
          field: {
            reference: true,
            requestedByUser: { name: true, email: true },
          },
          title: REQUEST_COLUMN,
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[16rem]",
          getElement: (item: SecurityUserErasureRequest): ReactElement => {
            return <ErasureRequestCell request={item} />;
          },
        },
        {
          field: { status: true },
          title: STATUS_COLUMN,
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[18rem]",
          contentClassName: "min-w-[8rem]",
          getElement: (item: SecurityUserErasureRequest): ReactElement => {
            return <ErasureStatusCell request={item} />;
          },
        },
        {
          field: { eventsUnnamed: true },
          title: CHANGES_COLUMN,
          type: FieldType.Element,
          disableSort: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[16rem]",
          getElement: (item: SecurityUserErasureRequest): ReactElement => {
            return <ErasureChangesCell request={item} />;
          },
        },
        {
          field: { tokens: true },
          title: TOKENS_COLUMN,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (item: SecurityUserErasureRequest): ReactElement => {
            return <ErasureTokensCell request={item} />;
          },
        },
      ]}
    />
  );
};

export default SecurityErasureRequestsPage;
