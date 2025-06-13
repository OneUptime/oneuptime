import ProjectUtil from "Common/UI/Utils/Project";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Query from "Common/Types/BaseDatabase/Query";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import FetchStatusPages from "../StatusPage/FetchStatusPages";
import StatusPagesElement from "../StatusPage/StatusPagesElement";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";

export interface ComponentProps {
  query?: Query<StatusPageAnnouncement> | undefined;
  initialValues?: FormValues<StatusPageAnnouncement> | undefined;
  title?: string;
  description?: string;
  disableCreate?: boolean | undefined;
}

const AnnouncementTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [announcementTemplates, setAnnouncementTemplates] = useState<
    Array<StatusPageAnnouncementTemplate>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [showAnnouncementTemplateModal, setShowAnnouncementTemplateModal] =
    useState<boolean>(false);

  const fetchAnnouncementTemplates: () => Promise<void> =
    async (): Promise<void> => {
      setError("");
      setIsLoading(true);

      try {
        const listResult: ListResult<StatusPageAnnouncementTemplate> =
          await ModelAPI.getList<StatusPageAnnouncementTemplate>({
            modelType: StatusPageAnnouncementTemplate,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              templateName: true,
              _id: true,
            },
            sort: {},
          });

        setAnnouncementTemplates(listResult.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    };

  let cardbuttons: Array<CardButtonSchema> = [];

  if (!props.disableCreate) {
    // add card buttons for creating announcements
    cardbuttons = [
      {
        title: "Create from Template",
        icon: IconProp.Template,
        buttonStyle: ButtonStyleType.OUTLINE,
        onClick: async (): Promise<void> => {
          setShowAnnouncementTemplateModal(true);
          await fetchAnnouncementTemplates();
        },
      },
      {
        title: "Create Announcement",
        onClick: () => {
          // The ModelTable will handle the create functionality
          // This is a placeholder - the actual implementation would need
          // to work with the ModelTable's internal create mechanism
        },
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
      },
    ];
  }
  return (
    <Fragment>
      <ModelTable<StatusPageAnnouncement>
        modelType={StatusPageAnnouncement}
        userPreferencesKey="status-page-announcements-table"
        id="table-status-page-note"
        isDeleteable={true}
        isCreateable={true}
        showViewIdButton={true}
        isEditable={true}
        name="Status Page > Announcements"
        isViewable={false}
        createInitialValues={props.initialValues}
        query={{
          ...(props.query || {}),
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        cardProps={{
          title: props.title || "Status Page Announcements",
          buttons: cardbuttons,
          description:
            props.description ||
            "Create and manage announcements that will be shown on status pages.",
        }}
        noItemsMessage={"No announcements found."}
        formSummary={{
          enabled: true,
        }}
        formSteps={[
          {
            title: "Basic",
            id: "basic",
          },
          {
            title: "Status Pages",
            id: "status-pages",
          },
          {
            title: "More",
            id: "more",
          },
        ]}
        formFields={[
          {
            field: {
              title: true,
            },
            title: "Announcement Title",
            stepId: "basic",
            description: "Title of announcement",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Title",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            stepId: "basic",
            fieldType: FormFieldSchemaType.Markdown,
            required: false,
            description: "Add an announcement note. This is in Markdown.",
          },
          {
            field: {
              statusPages: true,
            },
            title: "Show announcement on these status pages ",
            stepId: "status-pages",
            description: "Select status pages to show this announcement on",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: StatusPage,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            placeholder: "Select Status Pages",
            getSummaryElement: (item: FormValues<StatusPageAnnouncement>) => {
              if (!item.statusPages || !Array.isArray(item.statusPages)) {
                return <p>No status pages selected for this announcement.</p>;
              }

              const statusPageIds: Array<ObjectID> = [];

              for (const statusPage of item.statusPages) {
                if (typeof statusPage === "string") {
                  statusPageIds.push(new ObjectID(statusPage));
                  continue;
                }

                if (statusPage instanceof ObjectID) {
                  statusPageIds.push(statusPage);
                  continue;
                }

                if (statusPage instanceof StatusPage) {
                  statusPageIds.push(
                    new ObjectID(statusPage._id?.toString() || ""),
                  );
                  continue;
                }
              }

              return (
                <div>
                  <FetchStatusPages statusPageIds={statusPageIds} />
                </div>
              );
            },
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            stepId: "more",
            title: "Start Showing Announcement At",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            stepId: "more",
            title: "End Showing Announcement At",
            fieldType: FormFieldSchemaType.DateTime,
            required: false,
            placeholder: "Pick Date and Time",
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },

            title: "Notify Status Page Subscribers",
            stepId: "more",
            description: "Should status page subscribers be notified?",
            fieldType: FormFieldSchemaType.Checkbox,
            defaultValue: true,
            required: false,
          },
        ]}
        createEditModalWidth={ModalWidth.Large}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            title: "Show Announcement At",
            type: FieldType.Date,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            title: "End Announcement At",
            type: FieldType.Date,
          },
          {
            field: {
              shouldStatusPageSubscribersBeNotified: true,
            },
            title: "Subscribers Notified",
            type: FieldType.Boolean,
          },
          {
            field: {
              statusPages: {
                name: true,
                _id: true,
                projectId: true,
              },
            },
            title: "Shown on Status Pages",
            type: FieldType.EntityArray,

            filterEntityType: StatusPage,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              title: true,
            },
            title: "Title",
            type: FieldType.Text,
          },
          {
            field: {
              showAnnouncementAt: true,
            },
            title: "Show Announcement At",
            type: FieldType.DateTime,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            title: "End Announcement At",
            type: FieldType.DateTime,
            noValueMessage: "-",
          },
          {
            field: {
              statusPages: {
                name: true,
              },
            },
            title: "Shown on Status Pages",
            type: FieldType.Element,
            getElement: (item: StatusPageAnnouncement) => {
              if (!item.statusPages || !Array.isArray(item.statusPages)) {
                return <p>No status pages selected for this announcement.</p>;
              }
              return (
                <div>
                  <StatusPagesElement statusPages={item.statusPages} />
                </div>
              );
            },
          },
        ]}
      />

      {announcementTemplates.length === 0 &&
        showAnnouncementTemplateModal &&
        !isLoading && (
          <ConfirmModal
            title={`No Announcement Templates`}
            description={`No announcement templates have been created yet. You can create these in Project Settings > Announcement Templates.`}
            submitButtonText={"Close"}
            onSubmit={() => {
              return setShowAnnouncementTemplateModal(false);
            }}
          />
        )}

      {error && (
        <ConfirmModal
          title={`Error`}
          description={`${error}`}
          submitButtonText={"Close"}
          onSubmit={() => {
            return setError("");
          }}
        />
      )}

      {showAnnouncementTemplateModal && announcementTemplates.length > 0 ? (
        <BasicFormModal<JSONObject>
          title="Create Announcement from Template"
          isLoading={isLoading}
          submitButtonText="Create from Template"
          onClose={() => {
            setShowAnnouncementTemplateModal(false);
            setIsLoading(false);
          }}
          onSubmit={async (data: JSONObject) => {
            const announcementTemplateId: ObjectID = data[
              "announcementTemplateId"
            ] as ObjectID;

            // Find the selected template
            const selectedTemplate: StatusPageAnnouncementTemplate | undefined =
              announcementTemplates.find(
                (template: StatusPageAnnouncementTemplate) => {
                  return (
                    template._id?.toString() ===
                    announcementTemplateId.toString()
                  );
                },
              );

            if (selectedTemplate) {
              // Close the template modal and trigger the regular create modal with template data
              setShowAnnouncementTemplateModal(false);
              setIsLoading(false);

              // Note: The actual template data population would need to be handled
              // by the ModelTable component's create functionality
              // This is a simplified implementation
            }
          }}
          formProps={{
            initialValues: {},
            fields: [
              {
                field: {
                  announcementTemplateId: true,
                },
                title: "Select Announcement Template",
                description:
                  "Select an announcement template to create an announcement from.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: DropdownUtil.getDropdownOptionsFromEntityArray(
                  {
                    array: announcementTemplates,
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

export default AnnouncementTable;
