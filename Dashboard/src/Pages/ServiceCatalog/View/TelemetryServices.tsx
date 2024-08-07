import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/src/Utils/Navigation";
import ServiceCatalogTelemetryService from "Common/Models/DatabaseModels/ServiceCatalogTelemetryService";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryServicesTable from "../../../Components/TelemetryService/TelemetryServiceTable";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/src/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/UI/src/Utils/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/src/Utils/API/API";
import ErrorMessage from "Common/UI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/src/Components/Loader/PageLoader";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ButtonStyleType } from "Common/UI/src/Components/Button/Button";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import ConfirmModal from "Common/UI/src/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import ModelFormModal from "Common/UI/src/Components/ModelFormModal/ModelFormModal";
import DashboardNavigation from "../../../Utils/Navigation";
import { FormType } from "Common/UI/src/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/src/Components/Forms/Types/FormFieldSchemaType";

const ServiceCatalogTelemetryServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [telemetryServiceIds, setTelemetryServiceIds] =
    useState<Array<ObjectID> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnassignModal, setShowUnassignModal] = useState<boolean>(false);
  const [selectedTelemetryService, setSelectedTelemetryService] =
    useState<TelemetryService | null>(null);
  const [isUnassignLoading, setIsUnassignLoading] = useState<boolean>(false);
  const [unassignError, setUnassignError] = useState<string | null>(null);
  const [showModelForm, setShowModelForm] = useState<boolean>(false);

  const fetchTelemetryServicesInService: PromiseVoidFunction =
    async (): Promise<void> => {
      // Fetch TelemetryServiceStatus by ID
      try {
        setIsLoading(true);
        const serviceCatalogTelemetryServices: ListResult<ServiceCatalogTelemetryService> =
          await ModelAPI.getList<ServiceCatalogTelemetryService>({
            modelType: ServiceCatalogTelemetryService,
            query: {
              serviceCatalogId: modelId,
            },
            select: {
              telemetryServiceId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {},
          });

        const telemetryServiceIds: ObjectID[] =
          serviceCatalogTelemetryServices.data.map(
            (
              serviceCatalogTelemetryService: ServiceCatalogTelemetryService,
            ) => {
              return serviceCatalogTelemetryService.telemetryServiceId!;
            },
          );

        setTelemetryServiceIds(telemetryServiceIds);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
        setError(API.getFriendlyMessage(err));
      }
    };

  useEffect(() => {
    fetchTelemetryServicesInService().catch((error: Error) => {
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
      <TelemetryServicesTable
        disableCreate={true}
        query={{
          _id: new Includes(telemetryServiceIds || []),
        }}
        actionButtons={[
          {
            buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
            title: "Unassign",
            onClick: (
              telemetryService: TelemetryService,
              onCompleteAction: VoidFunction,
            ) => {
              setSelectedTelemetryService(telemetryService);
              setShowUnassignModal(true);
              onCompleteAction();
            },
          },
        ]}
        cardButtons={[
          {
            title: "Assign Telemetry Service",
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setShowModelForm(true);
            },
            icon: IconProp.Add,
            isLoading: false,
          },
        ]}
        title={"Telemetry Services for this Service"}
        description="List of Telemetry Services that are assigned to this service."
        noItemsMessage={"No Telemetry Services added to this service."}
      />

      {showUnassignModal ? (
        <ConfirmModal
          title={`Unassign TelemetryService from Service`}
          description={
            <div>
              Are you sure you want to unassign the telemetryService from this
              service?
            </div>
          }
          error={unassignError || ""}
          isLoading={isUnassignLoading}
          submitButtonType={ButtonStyleType.DANGER}
          submitButtonText={"Unassign"}
          onClose={() => {
            setShowUnassignModal(false);
            setUnassignError(null);
            setSelectedTelemetryService(null);
          }}
          onSubmit={async () => {
            try {
              setIsUnassignLoading(true);
              // get ServiceCatalogTelemetryServiceId
              const serviceCatalogTelemetryService: ListResult<ServiceCatalogTelemetryService> =
                await ModelAPI.getList<ServiceCatalogTelemetryService>({
                  modelType: ServiceCatalogTelemetryService,
                  query: {
                    telemetryServiceId: selectedTelemetryService!.id!,
                    serviceCatalogId: modelId!,
                  },
                  select: {
                    _id: true,
                  },
                  limit: 1,
                  skip: 0,
                  sort: {},
                });

              if (serviceCatalogTelemetryService.data.length === 0) {
                setUnassignError("Service Telemetry Service not found");
                setIsUnassignLoading(false);
                return;
              }

              await ModelAPI.deleteItem<ServiceCatalogTelemetryService>({
                modelType: ServiceCatalogTelemetryService,
                id: serviceCatalogTelemetryService.data[0]!.id!,
              });

              setIsUnassignLoading(false);
              setSelectedTelemetryService(null);
              setShowUnassignModal(false);
              setUnassignError(null);
              fetchTelemetryServicesInService().catch((error: Error) => {
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
        <ModelFormModal<ServiceCatalogTelemetryService>
          modelType={ServiceCatalogTelemetryService}
          name="Assign Telemetry Service to Service"
          title="Assign Telemetry Service to Service"
          description="Assign a Telemetry Service to this service. This is helpful for determining the health of the service."
          onClose={() => {
            setShowModelForm(false);
          }}
          submitButtonText="Assign"
          onSuccess={() => {
            setShowModelForm(false);
            fetchTelemetryServicesInService().catch((error: Error) => {
              setError(API.getFriendlyMessage(error));
            });
          }}
          onBeforeCreate={(
            serviceCatalogTelemetryService: ServiceCatalogTelemetryService,
          ) => {
            serviceCatalogTelemetryService.serviceCatalogId = modelId;
            serviceCatalogTelemetryService.projectId =
              DashboardNavigation.getProjectId()!;
            return Promise.resolve(serviceCatalogTelemetryService);
          }}
          formProps={{
            name: "Assign Telemetry Service",
            modelType: ServiceCatalogTelemetryService,
            id: "create-service-catalog-telemetryService",
            fields: [
              {
                field: {
                  telemetryService: true,
                },
                title: "Select TelemetryService",
                description:
                  "Select Telemetry Service to assign to this service.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: TelemetryService,
                  labelField: "name",
                  valueField: "_id",
                },
                required: true,
                placeholder: "Select Telemetry Service",
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

export default ServiceCatalogTelemetryServices;
