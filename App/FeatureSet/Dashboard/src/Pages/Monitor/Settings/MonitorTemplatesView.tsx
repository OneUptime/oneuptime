import LabelsElement from "Common/UI/Components/Label/Labels";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import MonitorsTable from "../../../Components/Monitor/MonitorTable";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import MonitorStepsType from "Common/Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MonitorTypeUtil from "../../../Utils/MonitorType";
import MonitorStepsForm from "../../../Components/Form/Monitor/MonitorSteps";
import MonitorStepsViewer from "../../../Components/Monitor/MonitorSteps/MonitorSteps";
import MonitoringInterval from "../../../Utils/MonitorIntervalDropdownOptions";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

const MonitorTemplatesView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Memoize modelId so child components (CardModelDetail / ModelDetail) get a
   * stable reference. Without this, Navigation.getLastParamAsObjectID() returns
   * a new ObjectID every render, ModelDetail's useEffect dep changes, and the
   * page re-fetches in a loop — that's the flicker.
   */
  const modelId: ObjectID = useMemo(() => {
    return Navigation.getLastParamAsObjectID();
  }, []);

  /*
   * Memoized so MonitorsTable's underlying ModelTable doesn't see a new query
   * reference every render — that would cancel the in-flight fetch and refetch
   * each time, contributing to the flicker.
   */
  const linkedMonitorsQuery: Query<Monitor> = useMemo(() => {
    return {
      projectId: ProjectUtil.getCurrentProjectId()!,
      monitorTemplateId: modelId,
    };
  }, [modelId]);

  /*
   * monitorType is loaded once at the top so the Criteria and Interval cards
   * can decide whether to render. Each card otherwise fetches its own slice of
   * the template independently.
   */
  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  const [linkedMonitorCount, setLinkedMonitorCount] = useState<number | null>(
    null,
  );
  const [syncResultMessage, setSyncResultMessage] = useState<string>("");

  const [showCriteriaSyncModal, setShowCriteriaSyncModal] =
    useState<boolean>(false);
  const [isSyncingCriteria, setIsSyncingCriteria] = useState<boolean>(false);
  const [criteriaSyncError, setCriteriaSyncError] = useState<string>("");

  const [showIntervalSyncModal, setShowIntervalSyncModal] =
    useState<boolean>(false);
  const [isSyncingInterval, setIsSyncingInterval] = useState<boolean>(false);
  const [intervalSyncError, setIntervalSyncError] = useState<string>("");

  const [showLabelsSyncModal, setShowLabelsSyncModal] =
    useState<boolean>(false);
  const [isSyncingLabels, setIsSyncingLabels] = useState<boolean>(false);
  const [labelsSyncError, setLabelsSyncError] = useState<string>("");

  const [singleSyncMonitor, setSingleSyncMonitor] = useState<Monitor | null>(
    null,
  );
  const [isSyncingSingle, setIsSyncingSingle] = useState<boolean>(false);
  const [singleSyncError, setSingleSyncError] = useState<string>("");

  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
  const [eligibleMonitors, setEligibleMonitors] = useState<Array<Monitor>>([]);
  const [isLoadingEligibleMonitors, setIsLoadingEligibleMonitors] =
    useState<boolean>(false);
  const [isLinking, setIsLinking] = useState<boolean>(false);
  const [linkError, setLinkError] = useState<string>("");

  const [unlinkTarget, setUnlinkTarget] = useState<Monitor | null>(null);
  const [isUnlinking, setIsUnlinking] = useState<boolean>(false);
  const [unlinkError, setUnlinkError] = useState<string>("");

  // Bumping this triggers a refetch in the linked-monitors MonitorTable.
  const [tableRefreshToggle, setTableRefreshToggle] = useState<string>(
    Math.random().toString(),
  );

  const fetchLinkedMonitorCount: () => Promise<void> =
    async (): Promise<void> => {
      try {
        const count: number = await ModelAPI.count<Monitor>({
          modelType: Monitor,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            monitorTemplateId: modelId,
          },
        });
        setLinkedMonitorCount(count);
      } catch {
        /*
         * Surface as 0 — the table is the source of truth and will still
         * render whatever monitors actually match.
         */
        setLinkedMonitorCount(0);
      }
    };

  useEffect(() => {
    fetchLinkedMonitorCount();

    const fetchMonitorType: () => Promise<void> = async (): Promise<void> => {
      try {
        const item: MonitorTemplate | null =
          await ModelAPI.getItem<MonitorTemplate>({
            modelType: MonitorTemplate,
            id: modelId,
            select: {
              monitorType: true,
            },
          });
        setMonitorType(item?.monitorType);
      } catch {
        // Leave undefined — the dependent cards will simply not render.
      }
    };

    fetchMonitorType();
  }, []);

  const onSyncCriteriaSubmit: () => Promise<void> = async (): Promise<void> => {
    setIsSyncingCriteria(true);
    setCriteriaSyncError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/monitor-template/${modelId.toString()}/sync-to-linked-monitors`,
          ),
          data: {
            fields: ["monitorSteps"],
          },
        });

      if (response.isFailure()) {
        setCriteriaSyncError(API.getFriendlyMessage(response));
        setIsSyncingCriteria(false);
        return;
      }

      const synced: number = (response.data["syncedMonitors"] as number) || 0;
      const total: number =
        (response.data["totalLinkedMonitors"] as number) || 0;

      setSyncResultMessage(
        `Synced criteria onto ${synced} monitor${synced === 1 ? "" : "s"} (${total} linked to this template).`,
      );
      setShowCriteriaSyncModal(false);
      setIsSyncingCriteria(false);
      fetchLinkedMonitorCount();
      setTableRefreshToggle(Math.random().toString());
    } catch (e) {
      setCriteriaSyncError(API.getFriendlyMessage(e));
      setIsSyncingCriteria(false);
    }
  };

  const onSyncIntervalSubmit: () => Promise<void> = async (): Promise<void> => {
    setIsSyncingInterval(true);
    setIntervalSyncError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/monitor-template/${modelId.toString()}/sync-to-linked-monitors`,
          ),
          data: {
            fields: ["monitoringInterval", "minimumProbeAgreement"],
          },
        });

      if (response.isFailure()) {
        setIntervalSyncError(API.getFriendlyMessage(response));
        setIsSyncingInterval(false);
        return;
      }

      const synced: number = (response.data["syncedMonitors"] as number) || 0;
      const total: number =
        (response.data["totalLinkedMonitors"] as number) || 0;

      setSyncResultMessage(
        `Synced monitoring interval onto ${synced} monitor${synced === 1 ? "" : "s"} (${total} linked to this template).`,
      );
      setShowIntervalSyncModal(false);
      setIsSyncingInterval(false);
      fetchLinkedMonitorCount();
      setTableRefreshToggle(Math.random().toString());
    } catch (e) {
      setIntervalSyncError(API.getFriendlyMessage(e));
      setIsSyncingInterval(false);
    }
  };

  const onSyncLabelsSubmit: () => Promise<void> = async (): Promise<void> => {
    setIsSyncingLabels(true);
    setLabelsSyncError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/monitor-template/${modelId.toString()}/sync-to-linked-monitors`,
          ),
          data: {
            fields: ["labels"],
          },
        });

      if (response.isFailure()) {
        setLabelsSyncError(API.getFriendlyMessage(response));
        setIsSyncingLabels(false);
        return;
      }

      const synced: number = (response.data["syncedMonitors"] as number) || 0;
      const total: number =
        (response.data["totalLinkedMonitors"] as number) || 0;

      setSyncResultMessage(
        `Synced labels onto ${synced} monitor${synced === 1 ? "" : "s"} (${total} linked to this template).`,
      );
      setShowLabelsSyncModal(false);
      setIsSyncingLabels(false);
      fetchLinkedMonitorCount();
      setTableRefreshToggle(Math.random().toString());
    } catch (e) {
      setLabelsSyncError(API.getFriendlyMessage(e));
      setIsSyncingLabels(false);
    }
  };

  const onSingleSyncSubmit: () => Promise<void> = async (): Promise<void> => {
    if (!singleSyncMonitor || !singleSyncMonitor.id) {
      return;
    }

    setIsSyncingSingle(true);
    setSingleSyncError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/monitor-template/${modelId.toString()}/sync-to-monitor/${singleSyncMonitor.id.toString()}`,
          ),
        });

      if (response.isFailure()) {
        setSingleSyncError(API.getFriendlyMessage(response));
        setIsSyncingSingle(false);
        return;
      }

      const monitorName: string = singleSyncMonitor.name || "monitor";
      setSingleSyncMonitor(null);
      setIsSyncingSingle(false);
      setSyncResultMessage(`Synced "${monitorName}" from this template.`);
      setTableRefreshToggle(Math.random().toString());
    } catch (e) {
      setSingleSyncError(API.getFriendlyMessage(e));
      setIsSyncingSingle(false);
    }
  };

  /*
   * Pull monitors eligible to be linked when the Link modal opens. We fetch
   * all monitors in this project of the matching type and filter out the ones
   * already linked here on the client — there's no clean cross-project
   * null-or-not-equal filter at the query-DSL level.
   */
  useEffect(() => {
    if (!showLinkModal || !monitorType) {
      return;
    }

    const loadEligible: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingEligibleMonitors(true);
      setLinkError("");
      try {
        const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            monitorType: monitorType,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            monitorTemplateId: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

        const templateIdString: string = modelId.toString();
        const eligible: Array<Monitor> = result.data.filter(
          (monitor: Monitor) => {
            return (
              !monitor.monitorTemplateId ||
              monitor.monitorTemplateId.toString() !== templateIdString
            );
          },
        );

        setEligibleMonitors(eligible);
      } catch (e) {
        setLinkError(API.getFriendlyMessage(e));
        setEligibleMonitors([]);
      }
      setIsLoadingEligibleMonitors(false);
    };

    loadEligible();
  }, [showLinkModal, monitorType, modelId]);

  const onLinkSubmit: (formData: {
    monitorIds: Array<string>;
  }) => Promise<void> = async (formData: {
    monitorIds: Array<string>;
  }): Promise<void> => {
    const monitorIds: Array<string> = formData.monitorIds || [];
    if (monitorIds.length === 0) {
      setLinkError("Select at least one monitor to link.");
      return;
    }

    setIsLinking(true);
    setLinkError("");

    const errors: Array<string> = [];
    for (const monitorId of monitorIds) {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/monitor-template/${modelId.toString()}/link-monitor/${monitorId}`,
            ),
          });
        if (response.isFailure()) {
          errors.push(API.getFriendlyMessage(response));
        }
      } catch (e) {
        errors.push(API.getFriendlyMessage(e));
      }
    }

    setIsLinking(false);

    if (errors.length > 0) {
      setLinkError(
        errors.length === 1
          ? errors[0]!
          : `${errors.length} of ${monitorIds.length} link operations failed: ${errors.join("; ")}`,
      );
      return;
    }

    setShowLinkModal(false);
    setEligibleMonitors([]);
    setSyncResultMessage(
      `Linked ${monitorIds.length} monitor${monitorIds.length === 1 ? "" : "s"} to this template.`,
    );
    fetchLinkedMonitorCount();
    setTableRefreshToggle(Math.random().toString());
  };

  const onUnlinkSubmit: () => Promise<void> = async (): Promise<void> => {
    if (!unlinkTarget || !unlinkTarget.id) {
      return;
    }

    setIsUnlinking(true);
    setUnlinkError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/monitor-template/${modelId.toString()}/unlink-monitor/${unlinkTarget.id.toString()}`,
          ),
        });

      if (response.isFailure()) {
        setUnlinkError(API.getFriendlyMessage(response));
        setIsUnlinking(false);
        return;
      }

      const monitorName: string = unlinkTarget.name || "monitor";
      setUnlinkTarget(null);
      setIsUnlinking(false);
      setSyncResultMessage(`Unlinked "${monitorName}" from this template.`);
      fetchLinkedMonitorCount();
      setTableRefreshToggle(Math.random().toString());
    } catch (e) {
      setUnlinkError(API.getFriendlyMessage(e));
      setIsUnlinking(false);
    }
  };

  const syncCriteriaButtonTitle: string =
    linkedMonitorCount === null
      ? "Sync Criteria to Linked Monitors"
      : `Sync Criteria to ${linkedMonitorCount} Linked Monitor${linkedMonitorCount === 1 ? "" : "s"}`;

  const syncIntervalButtonTitle: string =
    linkedMonitorCount === null
      ? "Sync Interval to Linked Monitors"
      : `Sync Interval to ${linkedMonitorCount} Linked Monitor${linkedMonitorCount === 1 ? "" : "s"}`;

  const syncLabelsButtonTitle: string =
    linkedMonitorCount === null
      ? "Sync Labels to Linked Monitors"
      : `Sync Labels to ${linkedMonitorCount} Linked Monitor${linkedMonitorCount === 1 ? "" : "s"}`;

  return (
    <Fragment>
      {/* Template Info — identity of the template itself. */}
      <CardModelDetail<MonitorTemplate>
        name="Template Info"
        cardProps={{
          title: "Template Info",
          description: "Identity for this monitor template.",
          buttons: [
            {
              title: "Create Monitor from Template",
              icon: IconProp.Add,
              buttonStyle: ButtonStyleType.PRIMARY,
              onClick: () => {
                const createRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_CREATE] as Route,
                );
                Navigation.navigate(
                  createRoute.addQueryParams({
                    monitorTemplateId: modelId.toString(),
                  }),
                );
              },
            },
          ],
        }}
        isEditable={true}
        editButtonText="Edit Template Info"
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Production API Health",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "What is this template for?",
            validation: {
              minLength: 2,
            },
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: MonitorTemplate,
          id: "model-detail-monitor-template-info",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Monitor Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.LongText,
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              fieldType: FieldType.DateTime,
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Monitor Defaults — what new monitors created from this template start with. */}
      <CardModelDetail<MonitorTemplate>
        name="Monitor Defaults"
        cardProps={{
          title: "Monitor Defaults",
          description:
            "Default name, description, and type applied to monitors created from this template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        editButtonText="Edit Monitor Defaults"
        formFields={[
          {
            field: {
              monitorName: true,
            },
            title: "Default Monitor Name",
            description:
              "Default name applied to monitors created from this template.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Monitor Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              monitorDescription: true,
            },
            title: "Default Monitor Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            description: "What kind of monitor will this template produce?",
            fieldType: FormFieldSchemaType.CardSelect,
            required: true,
            cardSelectOptions:
              MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions(),
          },
        ]}
        onSaveSuccess={(item: MonitorTemplate) => {
          if (item.monitorType) {
            setMonitorType(item.monitorType as MonitorType);
          }
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: MonitorTemplate,
          id: "model-detail-monitor-template-defaults",
          onItemLoaded: (item: MonitorTemplate) => {
            if (item.monitorType && !monitorType) {
              setMonitorType(item.monitorType as MonitorType);
            }
          },
          fields: [
            {
              field: {
                monitorName: true,
              },
              title: "Default Monitor Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitorType: true,
              },
              title: "Monitor Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitorDescription: true,
              },
              title: "Default Monitor Description",
              fieldType: FieldType.LongText,
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Monitoring Criteria — only meaningful for non-Manual monitor types. */}
      {monitorType && monitorType !== MonitorType.Manual && (
        <CardModelDetail<MonitorTemplate>
          name="Monitoring Criteria"
          cardProps={{
            title: "Monitoring Criteria",
            description:
              "What this template watches for and when it should fire.",
            buttons: [
              {
                title: syncCriteriaButtonTitle,
                icon: IconProp.Refresh,
                buttonStyle: ButtonStyleType.NORMAL,
                disabled: linkedMonitorCount === 0,
                onClick: () => {
                  setSyncResultMessage("");
                  setCriteriaSyncError("");
                  setShowCriteriaSyncModal(true);
                },
              },
            ],
          }}
          createEditModalWidth={ModalWidth.Large}
          isEditable={true}
          editButtonText="Edit Criteria"
          formFields={[
            {
              field: {
                monitorSteps: true,
              },
              title: "Monitor Details",
              fieldType: FormFieldSchemaType.CustomComponent,
              required: true,
              customValidation: (values: FormValues<MonitorTemplate>) => {
                return MonitorStepsType.getValidationError(
                  values.monitorSteps as MonitorStepsType,
                  monitorType,
                );
              },
              getCustomElement: (
                _value: FormValues<MonitorTemplate>,
                fieldProps: CustomElementProps,
              ) => {
                return (
                  <MonitorStepsForm
                    {...fieldProps}
                    monitorType={monitorType}
                    monitorName={""}
                  />
                );
              },
            },
          ]}
          modelDetailProps={{
            showDetailsInNumberOfColumns: 1,
            modelType: MonitorTemplate,
            id: "model-detail-monitor-template-criteria",
            fields: [
              {
                field: {
                  monitorSteps: true,
                },
                title: "",
                fieldType: FieldType.Element,
                getElement: (item: MonitorTemplate): ReactElement => {
                  if (!item.monitorSteps) {
                    return <p>No criteria configured.</p>;
                  }
                  return (
                    <MonitorStepsViewer
                      monitorSteps={item.monitorSteps as MonitorStepsType}
                      monitorType={monitorType}
                    />
                  );
                },
              },
            ],
            modelId: modelId,
          }}
        />
      )}

      {/* Monitoring Interval — only for monitor types that have an interval. */}
      {monitorType &&
        MonitorTypeHelper.doesMonitorTypeHaveInterval(monitorType) && (
          <CardModelDetail<MonitorTemplate>
            name="Monitoring Interval"
            cardProps={{
              title: "Monitoring Interval",
              description:
                "How often monitors created from this template will be evaluated, and how many probes must agree before the status changes.",
              buttons: [
                {
                  title: syncIntervalButtonTitle,
                  icon: IconProp.Refresh,
                  buttonStyle: ButtonStyleType.NORMAL,
                  disabled: linkedMonitorCount === 0,
                  onClick: () => {
                    setSyncResultMessage("");
                    setIntervalSyncError("");
                    setShowIntervalSyncModal(true);
                  },
                },
              ],
            }}
            isEditable={true}
            editButtonText="Edit Interval"
            formFields={[
              {
                field: {
                  monitoringInterval: true,
                },
                title: "Monitoring Interval",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                fetchDropdownOptions: () => {
                  let interval: Array<DropdownOption> = [...MonitoringInterval];

                  if (
                    monitorType === MonitorType.SyntheticMonitor ||
                    monitorType === MonitorType.CustomJavaScriptCode ||
                    monitorType === MonitorType.SSLCertificate
                  ) {
                    interval = interval.filter((option: DropdownOption) => {
                      return (
                        option.value !== "* * * * *" &&
                        option.value !== "*/2 * * * *"
                      );
                    });
                  }

                  return Promise.resolve(interval);
                },
                placeholder: "Select Monitoring Interval",
              },
              {
                field: {
                  minimumProbeAgreement: true,
                },
                title: "Minimum Probe Agreement",
                description:
                  "Minimum number of probes that must agree before a status change. Leave blank to require all enabled probes to agree.",
                fieldType: FormFieldSchemaType.Number,
                required: false,
                placeholder: "e.g. 2",
              },
            ]}
            modelDetailProps={{
              showDetailsInNumberOfColumns: 2,
              modelType: MonitorTemplate,
              id: "model-detail-monitor-template-interval",
              fields: [
                {
                  field: {
                    monitoringInterval: true,
                  },
                  title: "Monitoring Interval",
                  fieldType: FieldType.Text,
                },
                {
                  field: {
                    minimumProbeAgreement: true,
                  },
                  title: "Minimum Probe Agreement",
                  fieldType: FieldType.Number,
                },
              ],
              modelId: modelId,
            }}
          />
        )}

      {/* Labels — applied to monitors created from this template. */}
      <CardModelDetail<MonitorTemplate>
        name="Labels"
        cardProps={{
          title: "Labels",
          description:
            "Default labels applied to monitors created from this template.",
          buttons: [
            {
              title: syncLabelsButtonTitle,
              icon: IconProp.Refresh,
              buttonStyle: ButtonStyleType.NORMAL,
              disabled: linkedMonitorCount === 0,
              onClick: () => {
                setSyncResultMessage("");
                setLabelsSyncError("");
                setShowLabelsSyncModal(true);
              },
            },
          ],
        }}
        isEditable={true}
        editButtonText="Edit Labels"
        formFields={[
          {
            field: {
              labels: true,
            },
            title: "Labels",
            description:
              "Default labels applied to monitors created from this template.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: MonitorTemplate,
          id: "model-detail-monitor-template-labels",
          fields: [
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: MonitorTemplate): ReactElement => {
                return <LabelsElement labels={item.labels || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <MonitorsTable
        title="Linked Monitors"
        description="Monitors created from or linked to this template. Use the sync buttons on the cards above to push the template's criteria, monitoring interval, or labels onto every linked monitor."
        noItemsMessage="No monitors are linked to this template yet."
        disableCreate={true}
        query={linkedMonitorsQuery}
        cardButtons={[
          {
            title: "Link Existing Monitors",
            icon: IconProp.Add,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !monitorType,
            onClick: () => {
              setSyncResultMessage("");
              setLinkError("");
              setShowLinkModal(true);
            },
          },
        ]}
        actionButtons={[
          {
            title: "Sync from Template",
            icon: IconProp.Refresh,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (
              monitor: Monitor,
              onCompleteAction: VoidFunction,
              _onError: ErrorFunction,
            ) => {
              setSyncResultMessage("");
              setSingleSyncError("");
              setSingleSyncMonitor(monitor);
              onCompleteAction();
            },
          },
          {
            title: "Unlink from Template",
            icon: IconProp.Close,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (
              monitor: Monitor,
              onCompleteAction: VoidFunction,
              _onError: ErrorFunction,
            ) => {
              setSyncResultMessage("");
              setUnlinkError("");
              setUnlinkTarget(monitor);
              onCompleteAction();
            },
          },
        ]}
        refreshToggle={tableRefreshToggle}
      />

      <ModelDelete
        modelType={MonitorTemplate}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES] as Route,
              { modelId },
            ),
          );
        }}
      />

      {showCriteriaSyncModal && (
        <ConfirmModal
          title="Sync Criteria to Linked Monitors"
          description={
            <span>
              {`This will overwrite ONLY the monitor criteria on ${linkedMonitorCount} monitor${linkedMonitorCount === 1 ? "" : "s"} created from this template. Monitoring interval, minimum probe agreement, name, description, and labels will be left alone. This cannot be undone.`}
            </span>
          }
          submitButtonText="Sync Criteria"
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSyncingCriteria}
          error={criteriaSyncError}
          onSubmit={onSyncCriteriaSubmit}
          onClose={() => {
            setShowCriteriaSyncModal(false);
            setCriteriaSyncError("");
          }}
        />
      )}

      {showIntervalSyncModal && (
        <ConfirmModal
          title="Sync Interval to Linked Monitors"
          description={
            <span>
              {`This will overwrite the monitoring interval and minimum probe agreement on ${linkedMonitorCount} monitor${linkedMonitorCount === 1 ? "" : "s"} created from this template. Criteria, name, description, and labels will be left alone. This cannot be undone.`}
            </span>
          }
          submitButtonText="Sync Interval"
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSyncingInterval}
          error={intervalSyncError}
          onSubmit={onSyncIntervalSubmit}
          onClose={() => {
            setShowIntervalSyncModal(false);
            setIntervalSyncError("");
          }}
        />
      )}

      {showLabelsSyncModal && (
        <ConfirmModal
          title="Sync Labels to Linked Monitors"
          description={
            <span>
              {`This will overwrite ONLY the labels on ${linkedMonitorCount} monitor${linkedMonitorCount === 1 ? "" : "s"} created from this template. Criteria, monitoring interval, minimum probe agreement, name, and description will be left alone. This cannot be undone.`}
            </span>
          }
          submitButtonText="Sync Labels"
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSyncingLabels}
          error={labelsSyncError}
          onSubmit={onSyncLabelsSubmit}
          onClose={() => {
            setShowLabelsSyncModal(false);
            setLabelsSyncError("");
          }}
        />
      )}

      {singleSyncMonitor && (
        <ConfirmModal
          title="Sync Monitor from Template"
          description={
            <span>
              {`This will overwrite the criteria, monitoring interval, minimum probe agreement, and labels on "${singleSyncMonitor.name || "this monitor"}" with the template's current values. Name and description will be left alone. This cannot be undone.`}
            </span>
          }
          submitButtonText="Sync Now"
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSyncingSingle}
          error={singleSyncError}
          onSubmit={onSingleSyncSubmit}
          onClose={() => {
            setSingleSyncMonitor(null);
            setSingleSyncError("");
          }}
        />
      )}

      {showLinkModal && (
        <BasicFormModal<{ monitorIds: Array<string> }>
          title="Link Existing Monitors"
          description={
            isLoadingEligibleMonitors
              ? "Loading monitors that can be linked…"
              : `Select ${monitorType ? monitorType : ""} monitors in this project to link to this template. Monitors already linked here are hidden; monitors linked to a different template will be moved to this one.`
          }
          submitButtonText="Link"
          isLoading={isLinking}
          error={linkError}
          onClose={() => {
            setShowLinkModal(false);
            setLinkError("");
            setEligibleMonitors([]);
          }}
          onSubmit={onLinkSubmit}
          formProps={{
            fields: [
              {
                field: {
                  monitorIds: true,
                },
                title: "Monitors",
                description:
                  eligibleMonitors.length === 0 && !isLoadingEligibleMonitors
                    ? "No eligible monitors found in this project for this monitor type."
                    : "",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: true,
                dropdownOptions: eligibleMonitors.map((monitor: Monitor) => {
                  return {
                    label: monitor.name || "(unnamed monitor)",
                    value: monitor._id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}

      {unlinkTarget && (
        <ConfirmModal
          title="Unlink Monitor from Template"
          description={
            <span>
              {`This will detach "${unlinkTarget.name || "this monitor"}" from this template. The monitor keeps its current criteria, interval, and other settings — but it will no longer receive sync updates from this template.`}
            </span>
          }
          submitButtonText="Unlink"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isUnlinking}
          error={unlinkError}
          onSubmit={onUnlinkSubmit}
          onClose={() => {
            setUnlinkTarget(null);
            setUnlinkError("");
          }}
        />
      )}

      {syncResultMessage && (
        <ConfirmModal
          title="Done"
          description={syncResultMessage}
          submitButtonText="OK"
          submitButtonType={ButtonStyleType.PRIMARY}
          onSubmit={() => {
            setSyncResultMessage("");
          }}
        />
      )}
    </Fragment>
  );
};

export default MonitorTemplatesView;
