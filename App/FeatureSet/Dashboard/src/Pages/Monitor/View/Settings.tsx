import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import InlineCode from "Common/UI/Components/InlineCode/InlineCode";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import useAsyncEffect from "use-async-effect";
import OneUptimeDate from "Common/Types/Date";

const MonitorCriteria: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [alertRefreshToggle, setAlertRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );

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
          incomingEmailSecretKey: true,
          serverMonitorSecretKey: true,
        },
        requestOptions: {},
      });

      if (!monitor) {
        setError(ExceptionMessages.MonitorNotFound);

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
      return <ErrorMessage message={error} />;
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
              setAlertRefreshToggle(OneUptimeDate.getCurrentDate().toString());
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

        {monitor?.monitorType &&
        MonitorTypeHelper.isProbableMonitor(monitor.monitorType) ? (
          <div className="mt-5">
            <CardModelDetail
              name="Probe Agreement Settings"
              editButtonText="Edit Probe Agreement"
              cardProps={{
                title: "Probe Agreement Settings",
                description:
                  "Configure how many probes must agree on a status before the monitor status changes.",
              }}
              onSaveSuccess={() => {
                setAlertRefreshToggle(
                  OneUptimeDate.getCurrentDate().toString(),
                );
              }}
              isEditable={true}
              formFields={[
                {
                  field: {
                    minimumProbeAgreement: true,
                  },
                  title: "Minimum Probe Agreement",
                  description:
                    "The minimum number of probes that must agree on a condition before the monitor status changes. Leave empty to require all enabled and connected probes to agree.",
                  fieldType: FormFieldSchemaType.Number,
                  required: false,
                  placeholder: "Leave empty for all probes",
                  validation: {
                    minValue: 1,
                  },
                },
              ]}
              modelDetailProps={{
                showDetailsInNumberOfColumns: 1,
                modelType: Monitor,
                id: "model-detail-probe-agreement",
                fields: [
                  {
                    field: {
                      minimumProbeAgreement: true,
                    },
                    title: "Minimum Probe Agreement",
                    description:
                      "Number of probes that must agree on a condition. Empty means all probes.",
                    fieldType: FieldType.Number,
                    placeholder: "All probes must agree",
                  },
                ],
                modelId: modelId,
              }}
            />
          </div>
        ) : (
          <></>
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

        {monitor?.monitorType === MonitorType.IncomingEmail ? (
          <div className="mt-5">
            <ResetObjectID<Monitor>
              modelType={Monitor}
              onUpdateComplete={async () => {
                await fetchItem();
              }}
              fieldName={"incomingEmailSecretKey"}
              title={"Reset Incoming Email Secret Key"}
              description={
                <p className="mt-2">
                  Your current incoming email secret key is {"  "}
                  <InlineCode
                    text={
                      monitor.incomingEmailSecretKey?.toString() ||
                      "No key generated"
                    }
                  />{" "}
                  Resetting the secret key will generate a new key and change
                  the email address for this monitor. You will need to update
                  any systems sending emails to the old address.
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
