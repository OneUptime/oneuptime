import UserElement from "../../../Components/User/User";
import DashboardNavigation from "../../../Utils/Navigation";
import ProjectUser from "../../../Utils/ProjectUser";
import PageComponentProps from "../../PageComponentProps";
import BaseModel from "Common/Models/BaseModel";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import BasicFormModal from "CommonUI/src/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "CommonUI/src/Components/Modal/ConfirmModal";
import { ModalWidth } from "CommonUI/src/Components/Modal/Modal";
import { ShowAs } from "CommonUI/src/Components/ModelTable/BaseModelTable";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import AlignItem from "CommonUI/src/Types/AlignItem";
import API from "CommonUI/src/Utils/API/API";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import ModelAPI, { ListResult } from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import Navigation from "CommonUI/src/Utils/Navigation";
import IncidentInternalNote from "Model/Models/IncidentInternalNote";
import IncidentNoteTemplate from "Model/Models/IncidentNoteTemplate";
import User from "Model/Models/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const IncidentDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [incidentNoteTemplates, setIncidentNoteTemplates] = useState<
    Array<IncidentNoteTemplate>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showIncidentNoteTemplateModal, setShowIncidentNoteTemplateModal] =
    useState<boolean>(false);
  const [initialValuesForIncident, setInitialValuesForIncident] =
    useState<JSONObject>({});

  const fetchIncidentNoteTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch incident template

      const incidentNoteTemplate: IncidentNoteTemplate | null =
        await ModelAPI.getItem<IncidentNoteTemplate>({
          modelType: IncidentNoteTemplate,
          id,
          select: {
            note: true,
          },
        });

      if (incidentNoteTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(incidentNoteTemplate, IncidentNoteTemplate),
        };

        setInitialValuesForIncident(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    setShowIncidentNoteTemplateModal(false);
  };

  const fetchIncidentNoteTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);
      setInitialValuesForIncident({});

      try {
        const listResult: ListResult<IncidentNoteTemplate> =
          await ModelAPI.getList<IncidentNoteTemplate>({
            modelType: IncidentNoteTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              templateName: true,
              _id: true,
            },
            sort: {},
          });

        setIncidentNoteTemplates(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  return (
    <Fragment>
      <ModelTable<IncidentInternalNote>
        modelType={IncidentInternalNote}
        id="table-incident-internal-note"
        showCreateForm={Object.keys(initialValuesForIncident).length > 0}
        createInitialValues={initialValuesForIncident}
        name="Monitor > Internal Note"
        isDeleteable={true}
        showViewIdButton={true}
        isCreateable={true}
        isEditable={true}
        isViewable={false}
        createEditModalWidth={ModalWidth.Large}
        query={{
          incidentId: modelId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        onBeforeCreate={(
          item: IncidentInternalNote,
        ): Promise<IncidentInternalNote> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.incidentId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Private Notes",
          description: "Here are private notes for this incident.",
          buttons: [
            {
              title: "Create from Template",
              icon: IconProp.Template,
              buttonStyle: ButtonStyleType.OUTLINE,
              onClick: async (): Promise<void> => {
                setShowIncidentNoteTemplateModal(true);
                await fetchIncidentNoteTemplates();
              },
            },
          ],
        }}
        noItemsMessage={"No private notes created for this incident so far."}
        formFields={[
          {
            field: {
              note: true,
            },
            title: "Private Incident Note",
            fieldType: FormFieldSchemaType.Markdown,
            required: true,
            description:
              "Add a private note to this incident here. This is private to your team and is not visible on Status Page. This is in Markdown.",
          },
        ]}
        showAs={ShowAs.List}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
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
                DashboardNavigation.getProjectId()!,
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

            getElement: (item: IncidentInternalNote): ReactElement => {
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
            type: FieldType.Markdown,
            contentClassName: "-mt-3 space-y-6 text-sm text-gray-800",
            colSpan: 2,
          },
        ]}
      />

      {incidentNoteTemplates.length === 0 &&
      showIncidentNoteTemplateModal &&
      !isLoading ? (
        <ConfirmModal
          title={`No Incident Note Templates`}
          description={`No incident note templates have been created yet. You can create these in Project Settings > Incident > Note Templates.`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setShowIncidentNoteTemplateModal(false);
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

      {showIncidentNoteTemplateModal && incidentNoteTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Create Note from Template"
          isLoading={isLoading}
          submitButtonText="Create from Template"
          onClose={() => {
            setShowIncidentNoteTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            await fetchIncidentNoteTemplate(
              data["incidentNoteTemplateId"] as ObjectID,
            );
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  incidentNoteTemplateId: true,
                },
                title: "Select Note Template",
                description: "Select a template to create a note from.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: incidentNoteTemplates,
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
    </Fragment>
  );
};

export default IncidentDelete;
