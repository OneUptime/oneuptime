import MarkdownUtil from "Common/UI/Utils/Markdown";
import UserElement from "../../../Components/User/User";
import ProjectUser from "../../../Utils/ProjectUser";
import PageComponentProps from "../../PageComponentProps";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlignItem from "Common/UI/Types/AlignItem";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import User from "Common/Models/DatabaseModels/User";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import AttachmentList from "../../../Components/Attachment/AttachmentList";
import { getModelIdString } from "../../../Utils/ModelId";
import GenerateFromAIModal, {
  GenerateAIRequestData,
} from "Common/UI/Components/AI/GenerateFromAIModal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";

const AlertDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [alertNoteTemplates, setAlertNoteTemplates] = useState<
    Array<AlertNoteTemplate>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showAlertNoteTemplateModal, setShowAlertNoteTemplateModal] =
    useState<boolean>(false);
  const [initialValuesForAlert, setInitialValuesForAlert] =
    useState<JSONObject>({});
  const [showGenerateFromAIModal, setShowGenerateFromAIModal] =
    useState<boolean>(false);

  const generateNoteFromAI: (
    data: GenerateAIRequestData,
  ) => Promise<string> = async (
    data: GenerateAIRequestData,
  ): Promise<string> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post(
        URL.fromString(APP_API_URL.toString()).addRoute(
          `/alert/generate-note-from-ai/${modelId.toString()}`,
        ),
        {
          template: data.template,
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw new Error(response.message || "Failed to generate note from AI");
    }

    return response.data["note"] as string;
  };

  const handleAIGenerationSuccess: (generatedContent: string) => void = (
    generatedContent: string,
  ): void => {
    setShowGenerateFromAIModal(false);
    setInitialValuesForAlert({
      note: generatedContent,
    });
  };

  const fetchAlertNoteTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch alert template

      const alertNoteTemplate: AlertNoteTemplate | null =
        await ModelAPI.getItem<AlertNoteTemplate>({
          modelType: AlertNoteTemplate,
          id,
          select: {
            note: true,
          },
        });

      if (alertNoteTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(alertNoteTemplate, AlertNoteTemplate),
        };

        setInitialValuesForAlert(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    setShowAlertNoteTemplateModal(false);
  };

  const fetchAlertNoteTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);
      setInitialValuesForAlert({});

      try {
        const listResult: ListResult<AlertNoteTemplate> =
          await ModelAPI.getList<AlertNoteTemplate>({
            modelType: AlertNoteTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              templateName: true,
              _id: true,
            },
            sort: {},
          });

        setAlertNoteTemplates(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  return (
    <Fragment>
      <ModelTable<AlertInternalNote>
        modelType={AlertInternalNote}
        id="table-alert-internal-note"
        userPreferencesKey="alert-internal-note-table"
        showCreateForm={Object.keys(initialValuesForAlert).length > 0}
        createInitialValues={initialValuesForAlert}
        name="Monitor > Internal Note"
        isDeleteable={true}
        showViewIdButton={true}
        isCreateable={true}
        isEditable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        query={{
          alertId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: AlertInternalNote,
        ): Promise<AlertInternalNote> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.alertId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Private Notes",
          description: "Here are private notes for this alert.",
          buttons: [
            {
              title: "Generate from AI",
              icon: IconProp.Bolt,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: async (): Promise<void> => {
                setShowGenerateFromAIModal(true);
              },
            },
            {
              title: "Create from Template",
              icon: IconProp.Template,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: async (): Promise<void> => {
                setShowAlertNoteTemplateModal(true);
                await fetchAlertNoteTemplates();
              },
            },
          ],
        }}
        noItemsMessage={"No private notes created for this alert so far."}
        formFields={[
          {
            field: {
              note: true,
            },
            title: "Private Alert Note",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
            description: MarkdownUtil.getMarkdownCheatsheet(
              "Add a private note to this alert here. This is private to your team and is not visible on Status Page",
            ),
          },
          {
            field: {
              attachments: true,
            },
            title: "Attachments",
            fieldType: FormFieldSchemaType.MultipleFiles,
            required: false,
            description:
              "Attach files that should be visible to the alert response team.",
          },
        ]}
        showAs={ShowAs.List}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        selectMoreFields={{
          attachments: {
            _id: true,
            name: true,
          },
        }}
        filters={[
          {
            field: {
              createdByUser: true,
            },
            type: FieldType.Entity,
            title: "Created By",
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              note: true,
            },
            type: FieldType.Text,
            title: "Note",
          },
          {
            field: {
              createdAt: true,
            },
            type: FieldType.Date,
            title: "Created At",
          },
        ]}
        columns={[
          {
            field: {
              createdByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "",

            type: FieldType.Entity,

            getElement: (item: AlertInternalNote): ReactElement => {
              return (
                <UserElement
                  user={item["createdByUser"]}
                  suffix={"wrote"}
                  usernameClassName={"text-base text-gray-900"}
                  suffixClassName={"text-base text-gray-500 mt-1"}
                />
              );
            },
          },
          {
            field: {
              createdAt: true,
            },

            alignItem: AlignItem.Right,
            title: "",
            type: FieldType.DateTime,
            contentClassName:
              "mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3 text-right",
          },
          {
            field: {
              note: true,
            },

            title: "",
            type: FieldType.Element,
            contentClassName: "-mt-3 space-y-6 text-sm text-gray-800",
            colSpan: 2,
            getElement: (item: AlertInternalNote): ReactElement => {
              return (
                <div className="space-y-4">
                  <MarkdownViewer text={item.note || ""} />
                  <AttachmentList
                    modelId={getModelIdString(item)}
                    attachments={item.attachments}
                    attachmentApiPath="/alert-internal-note/attachment"
                  />
                </div>
              );
            },
          },
        ]}
      />

      {alertNoteTemplates.length === 0 &&
      showAlertNoteTemplateModal &&
      !isLoading ? (
        <ConfirmModal
          title={`No Alert Note Templates`}
          description={`No alert note templates have been created yet. You can create these in Project Settings > Alert > Note Templates.`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setShowAlertNoteTemplateModal(false);
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
            return setError("");
          }}
        />
      ) : (
        <></>
      )}

      {showAlertNoteTemplateModal && alertNoteTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Create Note from Template"
          isLoading={isLoading}
          submitButtonText="Create from Template"
          onClose={() => {
            setShowAlertNoteTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await fetchAlertNoteTemplate(
              data["alertNoteTemplateId"] as ObjectID,
            );
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  alertNoteTemplateId: true,
                },
                title: "Select Note Template",
                description: "Select a template to create a note from.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: alertNoteTemplates,
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
        <> </>
      )}

      {showGenerateFromAIModal && (
        <GenerateFromAIModal
          title="Generate Private Note from AI"
          description="AI will analyze the alert data and generate an internal technical note."
          noteType="internal-note"
          onClose={() => {
            setShowGenerateFromAIModal(false);
          }}
          onGenerate={generateNoteFromAI}
          onSuccess={handleAIGenerationSuccess}
        />
      )}
    </Fragment>
  );
};

export default AlertDelete;
