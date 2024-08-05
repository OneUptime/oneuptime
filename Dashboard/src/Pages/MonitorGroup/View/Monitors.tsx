import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MonitorsTable from "../../../Components/Monitor/MonitorTable";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import ListResult from "CommonUI/src/Utils/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "CommonUI/src/Utils/API/API";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ConfirmModal from "CommonUI/src/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import ModelFormModal from "CommonUI/src/Components/ModelFormModal/ModelFormModal";
import DashboardNavigation from "../../../Utils/Navigation";
import { FormType } from "CommonUI/src/Components/Forms/ModelForm";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";

const ServiceCatalogMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [monitorIds, setMonitorIds] = useState<Array<ObjectID> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnassignModal, setShowUnassignModal] = useState<boolean>(false);
  const [selectedMonitor, setSelectedMonitor] = useState<Monitor | null>(null);
  const [isUnassignLoading, setIsUnassignLoading] = useState<boolean>(false);
  const [unassignError, setUnassignError] = useState<string | null>(null);
  const [showModelForm, setShowModelForm] = useState<boolean>(false);

  const fetchMonitorsInGroup: PromiseVoidFunction = async (): Promise<void> => {
    // Fetch MonitorStatus by ID
    try {
      setIsLoading(true);
      const monitorGroupMonitors: ListResult<MonitorGroupResource> =
        await ModelAPI.getList<MonitorGroupResource>({
          modelType: MonitorGroupResource,
          query: {
            monitorGroupId: modelId,
          },
          select: {
            monitorId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {},
        });

      const monitorIds: ObjectID[] = monitorGroupMonitors.data.map(
        (monitorGroupMonitor: MonitorGroupResource) => {
          return monitorGroupMonitor.monitorId!;
        },
      );

      setMonitorIds(monitorIds);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError(API.getFriendlyMessage(err));
    }
  };

  useEffect(() => {
    fetchMonitorsInGroup().catch((error: Error) => {
      setError(API.getFriendlyMessage(error));
    });
  }, []);

  if (error) {
    return <ErrorMessage error={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <MonitorsTable
        disableCreate={true}
        query={{
          _id: new Includes(monitorIds || []),
        }}
        actionButtons={[
          {
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            title: "Unassign",
            onClick: (monitor: Monitor, onCompleteAction: VoidFunction) => {
              setSelectedMonitor(monitor);
              setShowUnassignModal(true);
              onCompleteAction();
            },
          },
        ]}
        cardButtons={[
          {
            title: "Assign Monitor",
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setShowModelForm(true);
            },
            icon: IconProp.Add,
            isLoading: false,
          },
        ]}
        title={"Monitors in Group"}
        description="List of monitors that are added to this monitor group."
        noItemsMessage={"No monitors added to this monitor group."}
      />

      {showUnassignModal ? (
        <ConfirmModal
          title={`Unassign Monitor from Monitor Group`}
          description={
            <div>
              Are you sure you want to unassign the monitor from this monitor
              group?
            </div>
          }
          error={unassignError || ""}
          isLoading={isUnassignLoading}
          submitButtonType={ButtonStyleType.DANGER}
          submitButtonText={"Unassign"}
          onClose={() => {
            setShowUnassignModal(false);
            setUnassignError(null);
            setSelectedMonitor(null);
          }}
          onSubmit={async () => {
            try {
              setIsUnassignLoading(true);
              // get ServiceCatalogMonitorId
              const monitorGroupMonitor: ListResult<MonitorGroupResource> =
                await ModelAPI.getList<MonitorGroupResource>({
                  modelType: MonitorGroupResource,
                  query: {
                    monitorId: selectedMonitor!.id!,
                    monitorGroupId: modelId!,
                  },
                  select: {
                    _id: true,
                  },
                  limit: 1,
                  skip: 0,
                  sort: {},
                });

              if (monitorGroupMonitor.data.length === 0) {
                setUnassignError("Service monitor not found");
                setIsUnassignLoading(false);
                return;
              }

              await ModelAPI.deleteItem<MonitorGroupResource>({
                modelType: MonitorGroupResource,
                id: monitorGroupMonitor.data[0]!.id!,
              });

              setIsUnassignLoading(false);
              setSelectedMonitor(null);
              setShowUnassignModal(false);
              setUnassignError(null);
              fetchMonitorsInGroup().catch((error: Error) => {
                setError(API.getFriendlyMessage(error));
              });
            } catch (err) {
              setIsUnassignLoading(false);
              setUnassignError(API.getFriendlyMessage(err));
            }
          }}
        />
      ) : (
        <></>
      )}

      {showModelForm ? (
        <ModelFormModal<MonitorGroupResource>
          modelType={MonitorGroupResource}
          name="Assign Monitor to Group"
          title="Assign Monitor to Group"
          description="Assign a monitor to this group. This is helpful for determining the health of the group."
          onClose={() => {
            setShowModelForm(false);
          }}
          submitButtonText="Assign"
          onSuccess={() => {
            setShowModelForm(false);
            fetchMonitorsInGroup().catch((error: Error) => {
              setError(API.getFriendlyMessage(error));
            });
          }}
          onBeforeCreate={(monitorGroupMonitor: MonitorGroupResource) => {
            monitorGroupMonitor.monitorGroupId = modelId;
            monitorGroupMonitor.projectId = DashboardNavigation.getProjectId()!;
            return Promise.resolve(monitorGroupMonitor);
          }}
          formProps={{
            name: "Assign Monitor",
            modelType: MonitorGroupResource,
            id: "create-service-catalog-monitor",
            fields: [
              {
                field: {
                  monitor: true,
                },
                title: "Select Monitor",
                description: "Select monitor to assign to this service.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: Monitor,
                  labelField: "name",
                  valueField: "_id",
                },
                required: true,
                placeholder: "Select Monitor",
              },
            ],
            formType: FormType.Create,
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default ServiceCatalogMonitors;
