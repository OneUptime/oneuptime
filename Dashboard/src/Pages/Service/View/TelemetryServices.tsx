import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ServiceTelemetryService from "Common/Models/DatabaseModels/ServiceTelemetryService";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryServicesTable from "../../../Components/TelemetryService/TelemetryServiceTable";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ProjectUtil from "Common/UI/Utils/Project";

const ServiceTelemetryServices: FunctionComponent<
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
        const serviceTelemetryServices: ListResult<ServiceTelemetryService> =
          await ModelAPI.getList<ServiceTelemetryService>({
            modelType: ServiceTelemetryService,
            query: {
              serviceId: modelId,
            },
            select: {
              telemetryServiceId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {},
          });

        const telemetryServiceIds: ObjectID[] =
          serviceTelemetryServices.data.map(
            (
              serviceTelemetryService: ServiceTelemetryService,
            ) => {
              return serviceTelemetryService.telemetryServiceId!;
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
    return <ErrorMessage message={error} />;
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
              // get ServiceTelemetryServiceId
              const serviceTelemetryService: ListResult<ServiceTelemetryService> =
                await ModelAPI.getList<ServiceTelemetryService>({
                  modelType: ServiceTelemetryService,
                  query: {
                    telemetryServiceId: selectedTelemetryService!.id!,
                    serviceId: modelId!,
                  },
                  select: {
                    _id: true,
                  },
                  limit: 1,
                  skip: 0,
                  sort: {},
                });

              if (serviceTelemetryService.data.length === 0) {
                setUnassignError("Service Telemetry Service not found");
                setIsUnassignLoading(false);
                return;
              }

              await ModelAPI.deleteItem<ServiceTelemetryService>({
                modelType: ServiceTelemetryService,
                id: serviceTelemetryService.data[0]!.id!,
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
        <ModelFormModal<ServiceTelemetryService>
          modelType={ServiceTelemetryService}
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
            serviceTelemetryService: ServiceTelemetryService,
          ) => {
            serviceTelemetryService.serviceId = modelId;
            serviceTelemetryService.projectId =
              ProjectUtil.getCurrentProjectId()!;
            return Promise.resolve(serviceTelemetryService);
          }}
          formProps={{
            name: "Assign Telemetry Service",
            modelType: ServiceTelemetryService,
            id: "create-service-telemetryService",
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

export default ServiceTelemetryServices;
