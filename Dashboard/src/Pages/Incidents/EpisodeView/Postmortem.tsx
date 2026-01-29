import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

const POSTMORTEM_FORM_FIELDS: Fields<IncidentEpisode> = [
  {
    field: {
      postmortemNote: true,
    },
    title: "Postmortem",
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    placeholder: "Postmortem analysis and notes",
    description: MarkdownUtil.getMarkdownCheatsheet(
      "Add postmortem notes for this episode here",
    ),
  },
];

const EpisodePostmortem: FunctionComponent<
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
    useState<FormValues<IncidentEpisode> | null>(null);

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
            _id: true,
            templateName: true,
            postmortemNote: true,
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
      <CardModelDetail<IncidentEpisode>
        name="Postmortem"
        cardProps={{
          title: "Postmortem",
          description:
            "Document the postmortem analysis for this episode. Include learnings, action items, and preventive measures.",
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
        editButtonText="Edit Postmortem"
        isEditable={true}
        onSaveSuccess={() => {
          setRefreshToggle((previous: boolean) => {
            return !previous;
          });
        }}
        formFields={POSTMORTEM_FORM_FIELDS}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: IncidentEpisode,
          id: "model-detail-episode-postmortem",
          fields: [
            {
              field: {
                postmortemNote: true,
              },
              title: "Postmortem",
              placeholder: "No postmortem added for this episode.",
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
        <ModelFormModal<IncidentEpisode>
          title="Edit Postmortem"
          submitButtonText="Save Changes"
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShowTemplateEditModal(false);
            setTemplateInitialValues(null);
          }}
          onSuccess={() => {
            setShowTemplateEditModal(false);
            setTemplateInitialValues(null);
            setRefreshToggle((previous: boolean) => {
              return !previous;
            });
          }}
          name="episode-postmortem-from-template"
          modelType={IncidentEpisode}
          modelIdToEdit={modelId}
          initialValues={templateInitialValues || undefined}
          formProps={{
            id: "episode-postmortem-template-form",
            fields: POSTMORTEM_FORM_FIELDS,
            formType: FormType.Update,
            modelType: IncidentEpisode,
            name: "Postmortem",
            doNotFetchExistingModel: true,
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default EpisodePostmortem;
