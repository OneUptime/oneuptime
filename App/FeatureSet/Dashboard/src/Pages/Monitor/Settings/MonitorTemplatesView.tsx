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
import ProjectUtil from "Common/UI/Utils/Project";
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
import {
  CustomElementProps,
  FormFieldStyleType,
} from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const MonitorTemplatesView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [linkedMonitorCount, setLinkedMonitorCount] = useState<number | null>(
    null,
  );
  const [showSyncAllModal, setShowSyncAllModal] = useState<boolean>(false);
  const [isSyncingAll, setIsSyncingAll] = useState<boolean>(false);
  const [syncAllError, setSyncAllError] = useState<string>("");
  const [syncResultMessage, setSyncResultMessage] = useState<string>("");

  const [singleSyncMonitor, setSingleSyncMonitor] = useState<Monitor | null>(
    null,
  );
  const [isSyncingSingle, setIsSyncingSingle] = useState<boolean>(false);
  const [singleSyncError, setSingleSyncError] = useState<string>("");

  // Bumping this triggers a refetch in the linked-monitors MonitorTable.
  const [tableRefreshToggle, setTableRefreshToggle] = useState<string>(
    Math.random().toString(),
  );

  const fetchLinkedMonitorCount: () => Promise<void> =
    async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/monitor-template/${modelId.toString()}/linked-monitor-count`,
            ),
          });

        if (response.isFailure()) {
          setLinkedMonitorCount(0);
          return;
        }

        setLinkedMonitorCount((response.data["count"] as number) || 0);
      } catch {
        setLinkedMonitorCount(0);
      }
    };

  useEffect(() => {
    fetchLinkedMonitorCount();
  }, []);

  const onSyncAllSubmit: () => Promise<void> = async (): Promise<void> => {
    setIsSyncingAll(true);
    setSyncAllError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/monitor-template/${modelId.toString()}/sync-to-linked-monitors`,
          ),
        });

      if (response.isFailure()) {
        setSyncAllError(API.getFriendlyMessage(response));
        setIsSyncingAll(false);
        return;
      }

      const synced: number = (response.data["syncedMonitors"] as number) || 0;
      const total: number =
        (response.data["totalLinkedMonitors"] as number) || 0;

      setSyncResultMessage(
        `Synced ${synced} monitor${synced === 1 ? "" : "s"} (${total} linked to this template).`,
      );
      setShowSyncAllModal(false);
      setIsSyncingAll(false);
      fetchLinkedMonitorCount();
      setTableRefreshToggle(Math.random().toString());
    } catch (e) {
      setSyncAllError(API.getFriendlyMessage(e));
      setIsSyncingAll(false);
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

  const syncAllButtonTitle: string =
    linkedMonitorCount === null
      ? "Sync All Linked Monitors"
      : `Sync All ${linkedMonitorCount} Linked Monitor${linkedMonitorCount === 1 ? "" : "s"}`;

  return (
    <Fragment>
      <CardModelDetail<MonitorTemplate>
        name="Monitor Template Details"
        cardProps={{
          title: "Monitor Template Details",
          description: "Here are the details for this monitor template.",
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
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Monitor Defaults",
            id: "monitor-defaults",
          },
          {
            title: "Criteria",
            id: "criteria",
            showIf: (values: FormValues<MonitorTemplate>) => {
              return values.monitorType !== MonitorType.Manual;
            },
          },
          {
            title: "Interval",
            id: "monitoring-interval",
            showIf: (values: FormValues<MonitorTemplate>) => {
              return MonitorTypeHelper.doesMonitorTypeHaveInterval(
                values.monitorType as MonitorType,
              );
            },
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            stepId: "template-info",
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
            stepId: "template-info",
            required: true,
            placeholder: "What is this template for?",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              monitorName: true,
            },
            title: "Default Monitor Name",
            description:
              "Default name applied to monitors created from this template.",
            fieldType: FormFieldSchemaType.Text,
            stepId: "monitor-defaults",
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
            stepId: "monitor-defaults",
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            description: "What kind of monitor will this template produce?",
            stepId: "monitor-defaults",
            fieldType: FormFieldSchemaType.CardSelect,
            required: true,
            cardSelectOptions:
              MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions(),
          },
          {
            field: {
              monitorSteps: true,
            },
            stepId: "criteria",
            styleType: FormFieldStyleType.Heading,
            title: "Monitor Details",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            customValidation: (values: FormValues<MonitorTemplate>) => {
              return MonitorStepsType.getValidationError(
                values.monitorSteps as MonitorStepsType,
                values.monitorType as MonitorType,
              );
            },
            getCustomElement: (
              value: FormValues<MonitorTemplate>,
              fieldProps: CustomElementProps,
            ) => {
              return (
                <MonitorStepsForm
                  {...fieldProps}
                  monitorType={value.monitorType || MonitorType.Manual}
                  monitorName={value.monitorName || ""}
                />
              );
            },
          },
          {
            field: {
              monitoringInterval: true,
            },
            stepId: "monitoring-interval",
            title: "Monitoring Interval",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            fetchDropdownOptions: (item: FormValues<MonitorTemplate>) => {
              let interval: Array<DropdownOption> = [...MonitoringInterval];

              if (
                item &&
                (item.monitorType === MonitorType.SyntheticMonitor ||
                  item.monitorType === MonitorType.CustomJavaScriptCode ||
                  item.monitorType === MonitorType.SSLCertificate)
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
              labels: true,
            },
            title: "Labels",
            stepId: "labels",
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
          showDetailsInNumberOfColumns: 2,
          modelType: MonitorTemplate,
          id: "model-detail-monitor-template",
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
                monitoringInterval: true,
              },
              title: "Monitoring Interval",
              fieldType: FieldType.Text,
            },
            {
              field: {
                monitorSteps: true,
              },
              title: "Criteria",
              fieldType: FieldType.Element,
              getElement: (item: MonitorTemplate): ReactElement => {
                if (!item.monitorSteps) {
                  return <p>No criteria configured.</p>;
                }
                return (
                  <MonitorStepsViewer
                    monitorSteps={item.monitorSteps as MonitorStepsType}
                    monitorType={item.monitorType as MonitorType}
                  />
                );
              },
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created At",
              fieldType: FieldType.DateTime,
            },
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
        description="Monitors created from this template. Sync to push the template's current criteria, monitoring interval, and minimum probe agreement onto a monitor."
        noItemsMessage="No monitors have been created from this template yet."
        disableCreate={true}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          monitorTemplateId: modelId,
        }}
        cardButtons={[
          {
            title: syncAllButtonTitle,
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !linkedMonitorCount,
            onClick: () => {
              setSyncResultMessage("");
              setSyncAllError("");
              setShowSyncAllModal(true);
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

      {showSyncAllModal && (
        <ConfirmModal
          title="Sync All Linked Monitors"
          description={
            <span>
              {`This will overwrite the criteria, monitoring interval, and minimum probe agreement on ${linkedMonitorCount} monitor${linkedMonitorCount === 1 ? "" : "s"} created from this template. Per-monitor name, description, and labels will be left alone. This cannot be undone.`}
            </span>
          }
          submitButtonText="Sync All"
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isSyncingAll}
          error={syncAllError}
          onSubmit={onSyncAllSubmit}
          onClose={() => {
            setShowSyncAllModal(false);
            setSyncAllError("");
          }}
        />
      )}

      {singleSyncMonitor && (
        <ConfirmModal
          title="Sync Monitor from Template"
          description={
            <span>
              {`This will overwrite the criteria, monitoring interval, and minimum probe agreement on "${singleSyncMonitor.name || "this monitor"}" with the template's current values. Name, description, and labels will be left alone. This cannot be undone.`}
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

      {syncResultMessage && (
        <ConfirmModal
          title="Sync Complete"
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
