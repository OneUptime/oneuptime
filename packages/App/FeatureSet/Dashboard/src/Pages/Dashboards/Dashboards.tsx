import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../PageComponentProps";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";
import { DASHBOARD_ARCHIVE_COPY } from "../../Components/Archive/ResourceArchiveCopy";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardElement from "../../Components/Dashboard/DashboardElement";
import DashboardTemplateCard from "../../Components/Dashboard/DashboardTemplateCard";
import {
  addDashboardTemplateToMiscData,
  fetchDashboardNames,
  getDashboardCreateFormFields,
  getDashboardCreateInitialValues,
  getDashboardViewRoute,
} from "../../Components/Dashboard/DashboardCreateForm";
import OwnersCell from "../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../Components/ResourceOwners/useResourceOwners";
import {
  DashboardTemplateType,
  DashboardTemplate,
  DashboardTemplateCategories,
  DashboardTemplateCategory,
  getDashboardTemplatesByCategory,
} from "Common/Types/Dashboard/DashboardTemplates";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";

/*
 * Create Dashboard opens the template picker; a picked card opens the create
 * form with the dashboard's name filled in, and Create opens the new
 * dashboard (Components/Dashboard/DashboardCreateForm.ts says why).
 */
const Dashboards: FunctionComponent<PageComponentProps> = (): ReactElement => {
  // The card picked, for the create form it opened. Null once that closes.
  const [selectedTemplate, setSelectedTemplate] =
    useState<DashboardTemplateType | null>(null);
  // What the create form starts with: the picked template's unique name.
  const [createInitialValues, setCreateInitialValues] = useState<
    FormValues<Dashboard> | undefined
  >(undefined);
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [showTemplateModal, setShowTemplateModal] = useState<boolean>(false);
  // The card picked while the project's dashboard names are still on the way.
  const [loadingTemplate, setLoadingTemplate] =
    useState<DashboardTemplateType | null>(null);

  /*
   * The names the project's dashboards already have, looked up when the
   * picker opens - while the cards are read - so a picked card opens its
   * form at once, with a name nothing has yet.
   */
  const dashboardNames: MutableRefObject<Promise<Array<string>> | null> =
    useRef<Promise<Array<string>> | null>(null);

  /*
   * Counts picks. A card still waiting for the names opens its form only if
   * nothing happened since: closing the picker, or picking another card,
   * leaves it behind (the last card picked wins).
   */
  const latestPick: MutableRefObject<number> = useRef<number>(0);

  const createFormFields: Array<ModelField<Dashboard>> = useMemo(() => {
    return getDashboardCreateFormFields();
  }, []);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Dashboard>({ modelType: Dashboard });

  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Dashboard>({
      ownerUserModelType: DashboardOwnerUser,
      ownerTeamModelType: DashboardOwnerTeam,
      resourceIdField: "dashboardId",
    });

  // Archived dashboards leave this list; they are on the Archived page.
  const { archiveBulkActions } = useBulkArchiveActions<Dashboard>({
    modelType: Dashboard,
    singularName: DASHBOARD_ARCHIVE_COPY.singularName,
    pluralName: DASHBOARD_ARCHIVE_COPY.pluralName,
    archiveConfirmMessage: DASHBOARD_ARCHIVE_COPY.bulkArchiveConfirmMessage,
    unarchiveConfirmMessage: DASHBOARD_ARCHIVE_COPY.bulkUnarchiveConfirmMessage,
  });

  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Dashboard>({
    persistKey: "all-dashboards-table",
    ownerUserModelType: DashboardOwnerUser,
    ownerTeamModelType: DashboardOwnerTeam,
    resourceIdField: "dashboardId",
    showLabelsFacet: true,
  });

  const openTemplatePicker: () => void = useCallback((): void => {
    latestPick.current += 1;
    dashboardNames.current = fetchDashboardNames();
    setLoadingTemplate(null);
    setShowTemplateModal(true);
  }, []);

  const closeTemplatePicker: () => void = useCallback((): void => {
    latestPick.current += 1;
    setLoadingTemplate(null);
    setShowTemplateModal(false);
  }, []);

  const handleTemplateClick: (type: DashboardTemplateType) => Promise<void> =
    useCallback(async (type: DashboardTemplateType): Promise<void> => {
      latestPick.current += 1;
      const pick: number = latestPick.current;

      setLoadingTemplate(type);

      // A blank dashboard is named by its creator: no names to compare.
      const existingNames: Array<string> =
        type === DashboardTemplateType.Blank
          ? []
          : await (dashboardNames.current || fetchDashboardNames());

      if (pick !== latestPick.current) {
        return;
      }

      setLoadingTemplate(null);
      setSelectedTemplate(type);
      setCreateInitialValues(
        getDashboardCreateInitialValues({
          templateType: type,
          existingNames: existingNames,
        }),
      );
      setShowTemplateModal(false);
      setShowCreateForm(true);
    }, []);

  return (
    <Fragment>
      {showTemplateModal ? (
        <Modal
          title="Create from Template"
          description="Choose a template to quickly get started with a pre-configured dashboard."
          onClose={closeTemplatePicker}
          modalWidth={ModalWidth.Large}
        >
          <div className="space-y-6">
            {DashboardTemplateCategories.map(
              (category: DashboardTemplateCategory): ReactElement => {
                const templates: Array<DashboardTemplate> =
                  getDashboardTemplatesByCategory(category);

                if (templates.length === 0) {
                  return <Fragment key={category}></Fragment>;
                }

                return (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      {category}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {templates.map(
                        (template: DashboardTemplate): ReactElement => {
                          return (
                            <DashboardTemplateCard
                              key={template.type}
                              title={template.name}
                              description={template.description}
                              icon={template.icon}
                              isLoading={loadingTemplate === template.type}
                              onClick={() => {
                                handleTemplateClick(template.type);
                              }}
                            />
                          );
                        },
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </Modal>
      ) : (
        <></>
      )}

      <ModelTable<Dashboard>
        modelType={Dashboard}
        enableJsonImportExport={true}
        id="dashboard-table"
        userPreferencesKey="dashboards-table"
        topContent={filterBar}
        emptyState={facetEmptyState}
        currentFacetState={facetSaveState}
        onFacetStateRestored={restoreFacetState}
        query={mergeFiltersIntoQuery({ isArchived: false })}
        onFetchSuccess={(data: Array<Dashboard>) => {
          onResourcesFetched(data);
        }}
        isDeleteable={false}
        isEditable={false}
        isCreateable={true}
        onCreateClick={openTemplatePicker}
        onCreateEditModalClose={() => {
          /*
           * The picked template is kept until the form closes - not dropped
           * when Create is pressed - so a create the server refuses (a name
           * someone took meanwhile) can be sent again, and still builds it.
           */
          setShowCreateForm(false);
          setSelectedTemplate(null);
          setCreateInitialValues(undefined);
        }}
        bulkActions={{
          buttons: [
            ...labelBulkActions,
            ...ownerBulkActions,
            ...archiveBulkActions,
          ],
        }}
        name="Dashboards"
        isViewable={true}
        showCreateForm={showCreateForm}
        createInitialValues={createInitialValues}
        cardProps={{
          title: "Dashboards",
          description:
            "Your own views of metrics, logs, traces, monitors and incidents, arranged the way your team wants them. Start from a template or an empty dashboard.",
        }}
        showViewIdButton={true}
        formFields={createFormFields}
        onBeforeCreate={async (
          item: Dashboard,
          miscDataProps: JSONObject,
        ): Promise<Dashboard> => {
          addDashboardTemplateToMiscData({
            miscDataProps: miscDataProps,
            templateType: selectedTemplate,
          });
          return item;
        }}
        /*
         * The new dashboard opens: what the template built, or a blank
         * canvas with its Add Widget button - rather than leaving the user
         * on this list to find the new row.
         */
        onCreateSuccess={(
          item: Dashboard,
          modalType?: ModalType,
        ): Promise<Dashboard> => {
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(
              getDashboardViewRoute(new ObjectID(item._id.toString())),
            );
          }

          return Promise.resolve(item);
        }}
        saveFilterProps={{
          tableId: "all-dashboards-table",
        }}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.LongText,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Dashboard): ReactElement => {
              return <DashboardElement dashboard={item} />;
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
            hideOnMobile: true,
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,

            getElement: (item: Dashboard): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Dashboard): ReactElement => {
              return (
                <OwnersCell
                  owners={getOwnersForResource(item)}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />
      {labelBulkActionModals}
      {ownerBulkActionModals}
    </Fragment>
  );
};

export default Dashboards;
