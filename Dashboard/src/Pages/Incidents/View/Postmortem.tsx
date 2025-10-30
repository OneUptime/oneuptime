import MarkdownUtil from "Common/UI/Utils/Markdown";
import PageComponentProps from "../../PageComponentProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const POSTMORTEM_FORM_FIELDS: Fields<Incident> = [
  {
    field: {
      postmortemNote: true,
    },
    title: "Postmortem Note",
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    placeholder: "Postmortem Note",
    description: MarkdownUtil.getMarkdownCheatsheet(
      "Capture what happened, impact, resolution, and follow-up actions.",
    ),
  },
];

const IncidentPostmortem: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [incidentPostmortemTemplates, setIncidentPostmortemTemplates] =
    useState<Array<IncidentPostmortemTemplate>>([]);
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
  const [showTemplateEditModal, setShowTemplateEditModal] =
    useState<boolean>(false);
  const [templateInitialValues, setTemplateInitialValues] =
    useState<FormValues<Incident> | null>(null);

  const fetchTemplates: () => Promise<void> = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const listResult: ListResult<IncidentPostmortemTemplate> =
        await ModelAPI.getList<IncidentPostmortemTemplate>({
          modelType: IncidentPostmortemTemplate,
          query: {},
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            templateName: true,
            _id: true,
          },
          sort: {},
        });

      setIncidentPostmortemTemplates(listResult.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const applyTemplate: (templateId: ObjectID) => Promise<void> = async (
    templateId: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const template: IncidentPostmortemTemplate | null =
        await ModelAPI.getItem<IncidentPostmortemTemplate>({
          modelType: IncidentPostmortemTemplate,
          id: templateId,
          select: {
            postmortemNote: true,
          },
        });

      if (!template || !template.postmortemNote) {
        setError("The selected template does not contain a postmortem note.");
        setShowTemplateModal(false);
        return;
      }

      setTemplateInitialValues({
        postmortemNote: template.postmortemNote,
      });
      setShowTemplateModal(false);
      setShowTemplateEditModal(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!showTemplateModal) {
      return;
    }

    fetchTemplates().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [showTemplateModal]);

  return (
    <>
      <CardModelDetail<Incident>
        name="Postmortem Note"
        cardProps={{
          title: "Postmortem Note",
          description:
            "Document the summary, learnings, and follow-ups for this incident.",
          buttons: [
            {
              title: "Apply Template",
              icon: IconProp.Template,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: () => {
                setShowTemplateModal(true);
              },
            },
          ],
        }}
        refresher={refreshToggle}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        editButtonText="Edit Postmortem Note"
        onSaveSuccess={() => {
          setRefreshToggle((previous: boolean) => !previous);
        }}
        formFields={POSTMORTEM_FORM_FIELDS}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: Incident,
          id: "model-detail-incident-postmortem-note",
          fields: [
            {
              field: {
                postmortemNote: true,
              },
              title: "",
              placeholder: "No postmortem note documented for this incident.",
              fieldType: FieldType.Markdown,
            },
          ],
          modelId: modelId,
        }}
      />

      {showTemplateModal &&
      incidentPostmortemTemplates.length === 0 &&
      !isLoading ? (
        <ConfirmModal
          title={`No Postmortem Templates`}
          description={`No postmortem templates have been created yet. You can create these in Project Settings > Incident > Postmortem Templates.`}
          submitButtonText={"Close"}
          onSubmit={() => {
            setShowTemplateModal(false);
          }}
        />
      ) : (
        <></>
      )}

      {error ? (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            setError("");
          }}
        />
      ) : (
        <></>
      )}

      {showTemplateModal && incidentPostmortemTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Apply Postmortem Template"
          isLoading={isLoading}
          submitButtonText="Apply Template"
          onClose={() => {
            setShowTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await applyTemplate(
              data["incidentPostmortemTemplateId"] as ObjectID,
            );
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  incidentPostmortemTemplateId: true,
                },
                title: "Select Template",
                description:
                  "Choose a postmortem template to populate the note.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: incidentPostmortemTemplates,
                    labelField: "templateName",
                    valueField: "_id",
                  },
                ),
                required: true,
                placeholder: "Select Template",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}

      {showTemplateEditModal ? (
        <ModelFormModal<Incident>
          title="Edit Postmortem Note"
          submitButtonText="Save Changes"
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShowTemplateEditModal(false);
            setTemplateInitialValues(null);
          }}
          onSuccess={() => {
            setShowTemplateEditModal(false);
            setTemplateInitialValues(null);
            setRefreshToggle((previous: boolean) => !previous);
          }}
          name="incident-postmortem-note-from-template"
          modelType={Incident}
          modelIdToEdit={modelId}
          initialValues={templateInitialValues || undefined}
          formProps={{
            id: "incident-postmortem-note-template-form",
            fields: POSTMORTEM_FORM_FIELDS,
            formType: FormType.Update,
            modelType: Incident,
            name: "Postmortem Note",
            doNotFetchExistingModel: true,
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default IncidentPostmortem;
