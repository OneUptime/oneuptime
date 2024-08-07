import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "CommonUI/src/Components/ComponentLoader/ComponentLoader";
import DuplicateModel from "CommonUI/src/Components/DuplicateModel/DuplicateModel";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import InlineCode from "CommonUI/src/Components/InlineCode/InlineCode";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import ResetObjectID from "CommonUI/src/Components/ResetObjectID/ResetObjectID";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import { GetReactElementFunction } from "CommonUI/src/Types/FunctionTypes";
import API from "CommonUI/src/Utils/API/API";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import Navigation from "CommonUI/src/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

const MonitorCriteria: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [alertRefreshToggle, setAlertRefreshToggle] = useState<boolean>(false);

  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");

  const [monitor, setMonitor] = useState<Monitor | null>(null);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    // get item.
    setIsLoading(true);

    setError("");
    try {
      const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
        modelType: Monitor,
        id: modelId,
        select: {
          monitorType: true,
          incomingRequestSecretKey: true,
          serverMonitorSecretKey: true,
        },
        requestOptions: {},
      });

      if (!monitor) {
        setError(`Monitor not found`);

        return;
      }

      setMonitor(monitor);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    // fetch the model
    await fetchItem();
  }, []);

  const getPageContent: GetReactElementFunction = (): ReactElement => {
    if (!monitor?.monitorType || isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage error={error} />;
    }

    return (
      <div>
        {monitor?.monitorType !== MonitorType.Manual && (
          <CardModelDetail
            name="Monitor Settings"
            editButtonText="Edit Settings"
            cardProps={{
              title: "Monitor Settings",
              description: "Here are some advanced settings for this monitor.",
            }}
            onSaveSuccess={() => {
              setAlertRefreshToggle(!alertRefreshToggle);
            }}
            isEditable={true}
            formFields={[
              {
                field: {
                  disableActiveMonitoring: true,
                },

                title: "Disable Active Monitoring",
                fieldType: FormFieldSchemaType.Toggle,
                required: false,
              },
            ]}
            modelDetailProps={{
              showDetailsInNumberOfColumns: 1,
              modelType: Monitor,
              id: "model-detail-monitors",
              fields: [
                {
                  field: {
                    disableActiveMonitoring: true,
                  },
                  title: "Disable Active Monitoring",
                  fieldType: FieldType.Boolean,
                },
              ],
              modelId: modelId,
            }}
          />
        )}

        {monitor?.monitorType === MonitorType.IncomingRequest ? (
          <div className="mt-5">
            <ResetObjectID<Monitor>
              modelType={Monitor}
              onUpdateComplete={async () => {
                await fetchItem();
              }}
              fieldName={"incomingRequestSecretKey"}
              title={"Reset Incoming Request Secret Key"}
              description={
                <p className="mt-2">
                  Your current incoming request secret key is {"  "}
                  <InlineCode
                    text={
                      monitor.incomingRequestSecretKey?.toString() ||
                      "No key generated"
                    }
                  />{" "}
                  Resetting the secret key will generate a new key. Secret is
                  used to authenticate incoming requests.
                </p>
              }
              modelId={modelId}
            />
          </div>
        ) : (
          <></>
        )}

        {monitor?.monitorType === MonitorType.Server ? (
          <div className="mt-5">
            <ResetObjectID<Monitor>
              modelType={Monitor}
              onUpdateComplete={async () => {
                await fetchItem();
              }}
              fieldName={"serverMonitorSecretKey"}
              title={"Reset Server Monitor Secret Key"}
              description={
                <p className="mt-2">
                  Your current server monitor secret key is {"  "}
                  <InlineCode
                    text={
                      monitor.serverMonitorSecretKey?.toString() ||
                      "No key generated"
                    }
                  />{" "}
                  Resetting the secret key will generate a new key. Secret is
                  used to authenticate monitoring agents deployed on the.
                </p>
              }
              modelId={modelId}
            />
          </div>
        ) : (
          <></>
        )}

        <div className="mt-5">
          <DuplicateModel
            modelId={modelId}
            modelType={Monitor}
            fieldsToDuplicate={{
              description: true,
              monitorType: true,
              monitorSteps: true,
              monitoringInterval: true,
              labels: true,
              customFields: true,
            }}
            navigateToOnSuccess={RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS] as Route,
            )}
            fieldsToChange={[
              {
                field: {
                  name: true,
                },
                title: "New Monitor Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "New Monitor Name",
                validation: {
                  minLength: 2,
                },
              },
              {
                field: {
                  disableActiveMonitoring: true,
                },
                title: "Disable Monitor",
                description:
                  "Should the new monitor be disabled when its duplicated?",
                fieldType: FormFieldSchemaType.Toggle,
                defaultValue: true,
                required: false,
              },
            ]}
          />
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} refreshToggle={alertRefreshToggle} />
      {getPageContent()}
    </Fragment>
  );
};

export default MonitorCriteria;
