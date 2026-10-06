import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import IncomingEmailAddressSettings from "../../../Components/Monitor/IncomingEmailMonitor/IncomingEmailAddressSettings";
import MonitoringCard from "../../../Components/Monitor/MonitoringCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import DuplicateModel from "Common/UI/Components/DuplicateModel/DuplicateModel";
import ExportModelCard from "Common/UI/Components/ImportExport/ExportModelCard";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import InlineCode from "Common/UI/Components/InlineCode/InlineCode";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import { MONITOR_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import useAsyncEffect from "use-async-effect";
import { getReadableMonitorSecretKeySelect } from "../../../Utils/MonitorSecretKeySelect";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

const MonitorCriteria: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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
          ...getReadableMonitorSecretKeySelect(),
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
    /*
     * The error first: a monitor that could not be read has no type, and
     * waiting for one kept the loader up for good.
     */
    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!monitor?.monitorType || isLoading) {
      return <ComponentLoader />;
    }

    return (
      <div>
        {/*
         * Whether the monitor is checked: one switch that saves when it is
         * flipped. The banner above the page follows it (and its own "Turn
         * monitoring on" button moves it) through ModelSwitchEvents. A
         * manual monitor runs no checks, so it has no switch.
         */}
        {monitor?.monitorType !== MonitorType.Manual && (
          <MonitoringCard monitorId={modelId} />
        )}

        {/*
         * How many probes must agree before the status changes is on the
         * Probes & Interval page now, under the probes it counts.
         */}

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
                  <TranslatedSentence
                    template="Your current incoming request secret key is {{key}} Resetting the secret key will generate a new key. Secret is used to authenticate incoming requests."
                    slots={{
                      key: (
                        <InlineCode
                          text={
                            monitor.incomingRequestSecretKey?.toString() ||
                            "No key generated"
                          }
                        />
                      ),
                    }}
                  />
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
            <IncomingEmailAddressSettings
              monitorId={modelId}
              secretKey={monitor.incomingEmailSecretKey}
              customLocalPart={monitor.incomingEmailCustomLocalPart}
              onAddressChanged={async () => {
                await fetchItem();
              }}
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
                  <TranslatedSentence
                    template="Your current server monitor secret key is {{key}} Resetting the secret key will generate a new key. Secret is used to authenticate monitoring agents deployed on the server."
                    slots={{
                      key: (
                        <InlineCode
                          text={
                            monitor.serverMonitorSecretKey?.toString() ||
                            "No key generated"
                          }
                        />
                      ),
                    }}
                  />
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
                  "Should the new monitor be disabled when it is duplicated?",
                fieldType: FormFieldSchemaType.Toggle,
                defaultValue: true,
                required: false,
              },
            ]}
          />
        </div>

        <div className="mt-5">
          <ExportModelCard modelId={modelId} modelType={Monitor} />
        </div>

        <div className="mt-5">
          <ArchiveResourceCard<Monitor>
            modelType={Monitor}
            modelId={modelId}
            singularName={MONITOR_ARCHIVE_COPY.singularName}
            listRoute={RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS] as Route,
            )}
            archiveCardDescription={MONITOR_ARCHIVE_COPY.archiveCardDescription}
            unarchiveCardDescription={
              MONITOR_ARCHIVE_COPY.unarchiveCardDescription
            }
            archiveConfirmMessage={MONITOR_ARCHIVE_COPY.archiveConfirmMessage}
            unarchiveConfirmMessage={
              MONITOR_ARCHIVE_COPY.unarchiveConfirmMessage
            }
          />
        </div>
      </div>
    );
  };

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      {getPageContent()}
    </Fragment>
  );
};

export default MonitorCriteria;
