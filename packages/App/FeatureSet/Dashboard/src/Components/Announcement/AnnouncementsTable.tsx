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
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
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
import ObjectID from "Common/Types/ObjectID";
import StatusPagesElement from "../StatusPage/StatusPagesElement";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getAnnouncementCreateQueryParams } from "./AnnouncementForm";

export interface ComponentProps {
  query?: Query<StatusPageAnnouncement> | undefined;
  /*
   * The status page whose Announcements tab this is. Create (and Create
   * from Template) open the create page with that page already picked, and
   * the create page comes back here afterwards.
   */
  statusPageId?: ObjectID | undefined;
  title?: string;
  description?: string;
  disableCreate?: boolean | undefined;
}

/*
 * The create page's address: the dedicated create page, with the status
 * page this table belongs to and the template picked, when there are any.
 */
const getAnnouncementCreateRoute: (data: {
  statusPageId?: ObjectID | undefined;
  announcementTemplateId?: ObjectID | undefined;
}) => Route = (data: {
  statusPageId?: ObjectID | undefined;
  announcementTemplateId?: ObjectID | undefined;
}): Route => {
  const route: Route = new Route(
    (RouteMap[PageMap.ANNOUNCEMENT_CREATE] as Route).toString(),
  );

  const query: Record<string, string> = getAnnouncementCreateQueryParams({
    statusPageId: data.statusPageId,
    announcementTemplateId: data.announcementTemplateId,
  });

  return RouteUtil.populateRouteParams(
    Object.keys(query).length > 0 ? route.addQueryParams(query) : route,
  );
};

const AnnouncementTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
    /*
     * These route to a dedicated create page instead of the table's built in
     * create modal, so ModelTable's own permission gate never sees them. Gate
     * them here or a viewer walks the whole flow and is refused at the end
     * (issue #3306).
     */
    cardbuttons = [
      PermissionGate.gateCardButton(
        {
          title: "Create from Template",
          icon: IconProp.Template,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: async (): Promise<void> => {
            setShowAnnouncementTemplateModal(true);
            await fetchAnnouncementTemplates();
          },
        },
        new StatusPageAnnouncement(),
        ModelAction.Create,
      ),
      PermissionGate.gateCardButton(
        {
          title: "Create Announcement",
          onClick: () => {
            Navigation.navigate(
              getAnnouncementCreateRoute({
                statusPageId: props.statusPageId,
              }),
            );
          },
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
        },
        new StatusPageAnnouncement(),
        ModelAction.Create,
      ),
    ].filter((button: CardButtonSchema | null): boolean => {
      return button !== null;
    }) as Array<CardButtonSchema>;
  }
  return (
    <Fragment>
      <ModelTable<StatusPageAnnouncement>
        modelType={StatusPageAnnouncement}
        userPreferencesKey="status-page-announcements-table"
        id="table-status-page-note"
        isDeleteable={false}
        isCreateable={false}
        showViewIdButton={true}
        isEditable={false}
        name="Status Page > Announcements"
        isViewable={true}
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
        createEditModalWidth={ModalWidth.Large}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
        )}
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
            hideOnMobile: true,
          },
          {
            field: {
              endAnnouncementAt: true,
            },
            title: "End Announcement At",
            type: FieldType.DateTime,
            noValueMessage: "-",
            hideOnMobile: true,
          },
          {
            field: {
              statusPages: {
                name: true,
              },
            },
            hideOnMobile: true,
            title: "Shown on Status Pages",
            type: FieldType.Element,
            getElement: (item: StatusPageAnnouncement) => {
              if (!item.statusPages || !Array.isArray(item.statusPages)) {
                return (
                  <p>
                    {translator.translateText(
                      "No status pages selected for this announcement.",
                    )}
                  </p>
                );
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

            // The create page, filled in from the template.
            Navigation.navigate(
              getAnnouncementCreateRoute({
                statusPageId: props.statusPageId,
                announcementTemplateId: announcementTemplateId,
              }),
            );
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
