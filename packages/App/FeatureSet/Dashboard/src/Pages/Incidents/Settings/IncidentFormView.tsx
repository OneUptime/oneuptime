import IncidentCustomFieldSettingsCard from "../../../Components/Incident/IncidentCustomFieldSettingsCard";
import IncidentFormCopy from "../../../Components/IncidentForm/IncidentFormCopy";
import {
  getIncidentFormDescriptionField,
  getIncidentFormDescriptionSettingLabel,
  getIncidentFormNameField,
  getIncidentFormSeverityField,
  getIncidentFormSuccessMessageField,
  getIncidentFormTemplateField,
  INCIDENT_FORM_DESCRIPTION_SETTING_OPTIONS,
} from "../../../Components/IncidentForm/IncidentFormFields";
import { isIncidentFormIpAllowlistEditableOnCurrentPlan } from "../../../Components/IncidentForm/IncidentFormPlan";
import IncidentFormShareLinkCard from "../../../Components/IncidentForm/IncidentFormShareLinkCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import IncidentForm from "Common/Models/DatabaseModels/IncidentForm";
import IncidentFormSubmission from "Common/Models/DatabaseModels/IncidentFormSubmission";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PlaceholderText from "Common/UI/Components/Detail/PlaceholderText";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { DeleteConfirmation } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * One incident form (Incidents > Settings > Forms > a form), one card per
 * thing an admin decides about it, in the order a new form is set up:
 *
 *   - Form Details: its name and description, the top of its public page,
 *     and Enabled, whether its link works at all;
 *   - Share Link: the link to pass around, and Reset Link for when it went
 *     too far;
 *   - Incident Settings: what the incidents it declares start with - its
 *     severity, whether the reporter may pick another, and its template;
 *   - Form Settings: the questions every form has, and the message shown
 *     after a report;
 *   - Questions: which incident custom fields it asks (none until added);
 *   - Access: the networks it can be opened from;
 *   - Submissions: every report made through it, each with its incident.
 *
 * Each card edits only its own columns: a CardModelDetail writes every field
 * it holds when saved, so no column is held by two cards.
 */

// A submission's incident, when it still has one.
const getSubmissionIncidentId: (
  submission: IncidentFormSubmission,
) => ObjectID | null = (
  submission: IncidentFormSubmission,
): ObjectID | null => {
  const incidentId: string | undefined =
    submission.incident?._id?.toString() || submission.incidentId?.toString();

  return incidentId ? new ObjectID(incidentId) : null;
};

// "INC-42", or "#42" in a project without an incident number prefix.
const getSubmissionIncidentNumber: (
  submission: IncidentFormSubmission,
) => string = (submission: IncidentFormSubmission): string => {
  if (submission.incident?.incidentNumberWithPrefix) {
    return submission.incident.incidentNumberWithPrefix;
  }

  if (submission.incident?.incidentNumber) {
    return `#${submission.incident.incidentNumber}`;
  }

  return "";
};

const getIncidentRoute: (incidentId: ObjectID) => Route = (
  incidentId: ObjectID,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.INCIDENT_VIEW] as Route,
    { modelId: incidentId },
  );
};

const IncidentFormView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const { translateString } = useTranslateValue();

  /*
   * Turning the form on or off (Form Details) changes what the Share Link
   * card says, so a save there asks that card to read the form again.
   */
  const [shareLinkRefresher, setShareLinkRefresher] = useState<boolean>(false);

  /*
   * Changing the IP allowlist needs a higher plan than the form itself (as
   * a public dashboard's does). Said up front, before a save the server
   * would refuse; nothing is said when the plan allows it or is unknown.
   */
  const isIpAllowlistEditable: boolean =
    isIncidentFormIpAllowlistEditableOnCurrentPlan();

  const withPlanNote: (text: string) => string | ReactElement = (
    text: string,
  ): string | ReactElement => {
    if (isIpAllowlistEditable) {
      return text;
    }

    return (
      <>
        {translateString(text) || text}{" "}
        <span data-testid="incident-form-ip-allowlist-plan-note">
          {translateString(IncidentFormCopy.accessPlanNote) ||
            IncidentFormCopy.accessPlanNote}
        </span>
      </>
    );
  };

  return (
    <Fragment>
      <CardModelDetail<IncidentForm>
        name="Incident Form > Form Details"
        cardProps={{
          title: IncidentFormCopy.formDetailsTitle,
          description: IncidentFormCopy.formDetailsDescription,
        }}
        isEditable={true}
        editButtonText={IncidentFormCopy.editFormDetails}
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          getIncidentFormNameField(),
          getIncidentFormDescriptionField(),
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            description: IncidentFormCopy.enabledDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        onSaveSuccess={() => {
          setShareLinkRefresher((previous: boolean): boolean => {
            return !previous;
          });
        }}
        modelDetailProps={{
          /*
           * One column, on every card of the page: Detail gives each field
           * 1/n of the card's width whatever its colSpan (and on a phone
           * too), so in two columns the description - the card's longest
           * text - wrapped at half width, and every field was half a phone
           * wide.
           */
          showDetailsInNumberOfColumns: 1,
          modelType: IncidentForm,
          id: "model-detail-incident-form",
          fields: [
            {
              field: {
                _id: true,
              },
              title: IncidentFormCopy.formIdTitle,
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Markdown,
              placeholder: "No description set.",
            },
          ],
          modelId: modelId,
        }}
      />

      <IncidentFormShareLinkCard
        modelId={modelId}
        refresher={shareLinkRefresher}
      />

      <CardModelDetail<IncidentForm>
        name="Incident Form > Incident Settings"
        cardProps={{
          title: "Incident Settings",
          description: IncidentFormCopy.incidentSettingsDescription,
        }}
        isEditable={true}
        editButtonText={IncidentFormCopy.editIncidentSettings}
        createEditModalWidth={ModalWidth.Medium}
        formFields={[
          getIncidentFormSeverityField(),
          {
            field: {
              allowReporterToChooseSeverity: true,
            },
            title: IncidentFormCopy.letReporterChooseSeverityTitle,
            description: IncidentFormCopy.letReporterChooseSeverityDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          getIncidentFormTemplateField(),
        ]}
        modelDetailProps={{
          // One column, like the other cards on the page (see Form Details).
          showDetailsInNumberOfColumns: 1,
          modelType: IncidentForm,
          id: "model-detail-incident-form-incident-settings",
          fields: [
            {
              field: {
                incidentSeverity: {
                  name: true,
                  color: true,
                },
              },
              title: "Severity",
              fieldType: FieldType.Entity,
              getElement: (item: IncidentForm): ReactElement => {
                /*
                 * Only after its severity was deleted (the column is set
                 * null then). A report then takes the reporter's or the
                 * template's severity, or is refused.
                 */
                if (!item.incidentSeverity) {
                  return (
                    <span
                      className="text-sm font-medium text-amber-700"
                      data-testid="incident-form-no-severity"
                    >
                      {translateString("No severity") || "No severity"}
                    </span>
                  );
                }

                return (
                  <Pill
                    color={item.incidentSeverity.color || Black}
                    text={item.incidentSeverity.name || ""}
                  />
                );
              },
            },
            {
              field: {
                allowReporterToChooseSeverity: true,
              },
              title: IncidentFormCopy.letReporterChooseSeverityTitle,
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                incidentTemplate: {
                  templateName: true,
                  _id: true,
                },
              },
              title: "Incident Template",
              fieldType: FieldType.Entity,
              getElement: (item: IncidentForm): ReactElement => {
                const templateId: string | undefined =
                  item.incidentTemplate?._id?.toString();

                if (!item.incidentTemplate || !templateId) {
                  return <PlaceholderText text="None" />;
                }

                return (
                  <Link
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                    to={RouteUtil.populateRouteParams(
                      RouteMap[
                        PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW
                      ] as Route,
                      { modelId: new ObjectID(templateId) },
                    )}
                  >
                    {item.incidentTemplate.templateName || templateId}
                  </Link>
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<IncidentForm>
        name="Incident Form > Form Settings"
        cardProps={{
          title: IncidentFormCopy.formSettingsTitle,
          description: IncidentFormCopy.formSettingsDescription,
        }}
        isEditable={true}
        editButtonText={IncidentFormCopy.editFormSettings}
        createEditModalWidth={ModalWidth.Large}
        formFields={[
          {
            field: {
              descriptionSetting: true,
            },
            title: IncidentFormCopy.descriptionQuestionTitle,
            description: IncidentFormCopy.descriptionQuestionDescription,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: INCIDENT_FORM_DESCRIPTION_SETTING_OPTIONS,
            // The column is NOT NULL: a cleared dropdown would be refused.
            required: true,
          },
          {
            field: {
              isReporterDetailsRequired: true,
            },
            title: IncidentFormCopy.requireReporterDetailsTitle,
            description: IncidentFormCopy.requireReporterDetailsDescription,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          getIncidentFormSuccessMessageField(),
        ]}
        modelDetailProps={{
          // One column, for the success message (see Form Details).
          showDetailsInNumberOfColumns: 1,
          modelType: IncidentForm,
          id: "model-detail-incident-form-form-settings",
          fields: [
            {
              field: {
                descriptionSetting: true,
              },
              title: IncidentFormCopy.descriptionQuestionTitle,
              fieldType: FieldType.Element,
              getElement: (item: IncidentForm): ReactElement => {
                const label: string = getIncidentFormDescriptionSettingLabel(
                  item.descriptionSetting,
                );

                return (
                  <span data-testid="incident-form-description-setting">
                    {translateString(label) || label}
                  </span>
                );
              },
            },
            {
              field: {
                isReporterDetailsRequired: true,
              },
              title: IncidentFormCopy.requireReporterDetailsTitle,
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                successMessage: true,
              },
              title: IncidentFormCopy.successMessageTitle,
              fieldType: FieldType.Markdown,
              placeholder: "Not set",
            },
          ],
          modelId: modelId,
        }}
      />

      <IncidentCustomFieldSettingsCard
        mode="form"
        modelType={IncidentForm}
        modelId={modelId}
      />

      <CardModelDetail<IncidentForm>
        name="Incident Form > Access"
        cardProps={{
          title: "Access",
          description: withPlanNote(IncidentFormCopy.accessDescription),
        }}
        isEditable={true}
        editButtonText={IncidentFormCopy.editIpAllowlist}
        formFields={[
          {
            field: {
              ipWhitelist: true,
            },
            title: IncidentFormCopy.ipAllowlistTitle,
            description: withPlanNote(IncidentFormCopy.ipAllowlistDescription),
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: IncidentForm,
          id: "model-detail-incident-form-access",
          fields: [
            {
              field: {
                ipWhitelist: true,
              },
              title: IncidentFormCopy.ipAllowlistTitle,
              fieldType: FieldType.Element,
              // One address or range per line, as it was written.
              getElement: (item: IncidentForm): ReactElement => {
                const allowlist: string = (item.ipWhitelist || "").trim();

                if (!allowlist) {
                  return (
                    <PlaceholderText text={IncidentFormCopy.ipAllowlistEmpty} />
                  );
                }

                return (
                  <div
                    className="whitespace-pre-line break-all font-mono text-sm text-gray-900"
                    data-testid="incident-form-ip-allowlist"
                  >
                    {allowlist}
                  </div>
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <ModelTable<IncidentFormSubmission>
        modelType={IncidentFormSubmission}
        id="incident-form-submissions-table"
        userPreferencesKey="incident-form-submissions-table"
        name="Incident Form > Submissions"
        isDeleteable={true}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        singularName={IncidentFormCopy.submission}
        pluralName={IncidentFormCopy.submissionsTitle}
        query={{
          incidentFormId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        selectMoreFields={{
          incidentId: true,
        }}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: IncidentFormCopy.submissionsTitle,
          description: IncidentFormCopy.submissionsDescription,
        }}
        noItemsMessage={IncidentFormCopy.submissionsEmpty}
        showRefreshButton={true}
        getDeleteConfirmation={async (): Promise<DeleteConfirmation> => {
          return {
            title: IncidentFormCopy.deleteSubmissionTitle,
            description: IncidentFormCopy.deleteSubmissionDescription,
            submitButtonText: "Delete",
          };
        }}
        actionButtons={[
          {
            title: "View Incident",
            buttonStyleType: ButtonStyleType.OUTLINE,
            // Once its incident is deleted, a submission has none to open.
            isVisible: (item: IncidentFormSubmission): boolean => {
              return Boolean(getSubmissionIncidentId(item));
            },
            onClick: (
              item: IncidentFormSubmission,
              onCompleteAction: () => void,
            ) => {
              const incidentId: ObjectID | null = getSubmissionIncidentId(item);

              if (incidentId) {
                Navigation.navigate(getIncidentRoute(incidentId));
              }

              onCompleteAction();
            },
          } as ActionButtonSchema<IncidentFormSubmission>,
        ]}
        filters={[
          {
            field: {
              createdAt: true,
            },
            title: IncidentFormCopy.submittedAt,
            type: FieldType.Date,
          },
          {
            field: {
              reporterName: true,
            },
            title: IncidentFormCopy.reporterName,
            type: FieldType.Text,
          },
          {
            field: {
              reporterEmail: true,
            },
            title: IncidentFormCopy.reporterEmail,
            type: FieldType.Email,
          },
        ]}
        columns={[
          {
            field: {
              createdAt: true,
            },
            title: IncidentFormCopy.submittedAt,
            type: FieldType.DateTime,
          },
          {
            field: {
              reporterName: true,
            },
            title: IncidentFormCopy.reporterName,
            type: FieldType.Text,
            noValueMessage: "-",
          },
          {
            field: {
              reporterEmail: true,
            },
            title: IncidentFormCopy.reporterEmail,
            type: FieldType.Email,
            noValueMessage: "-",
          },
          {
            field: {
              incident: {
                _id: true,
                incidentNumber: true,
                incidentNumberWithPrefix: true,
              },
            },
            title: "Incident",
            type: FieldType.Element,
            getElement: (item: IncidentFormSubmission): ReactElement => {
              const incidentId: ObjectID | null = getSubmissionIncidentId(item);
              const incidentNumber: string = getSubmissionIncidentNumber(item);

              if (!incidentId || !incidentNumber) {
                return <>-</>;
              }

              return (
                <Link
                  className="font-medium text-indigo-600 hover:text-indigo-500"
                  to={getIncidentRoute(incidentId)}
                >
                  {incidentNumber}
                </Link>
              );
            },
            getExportValue: (item: IncidentFormSubmission): string => {
              return getSubmissionIncidentNumber(item);
            },
          },
        ]}
      />

      <ModelDelete
        modelType={IncidentForm}
        modelId={modelId}
        confirmationContent={
          <p className="text-sm text-gray-600">
            {translateString(IncidentFormCopy.deleteFormNote) ||
              IncidentFormCopy.deleteFormNote}
          </p>
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.INCIDENTS_SETTINGS_FORMS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default IncidentFormView;
