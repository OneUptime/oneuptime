import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import IncomingMonitorLink from "../../../Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink";
import IncomingEmailMonitorLink from "../../../Components/Monitor/IncomingEmailMonitor/IncomingEmailMonitorLink";
import ServerMonitorDocumentation from "../../../Components/Monitor/ServerMonitor/Documentation";
import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
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

const MonitorDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  const [monitor, setMonitor] = useState<Monitor | null>(null);

  useAsyncEffect(async () => {
    await fetchItem();
  }, []);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: modelId,
        select: {
          monitorType: true,
          incomingRequestSecretKey: true,
          incomingEmailSecretKey: true,
          serverMonitorSecretKey: true,
        },
      });

      setMonitor(item);

      if (!item) {
        setError(ExceptionMessages.MonitorNotFound);

        return;
      }

      setMonitorType(item.monitorType);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />

      {/* Heartbeat URL */}
      {monitorType === MonitorType.IncomingRequest &&
      monitor?.incomingRequestSecretKey ? (
        <IncomingMonitorLink secretKey={monitor?.incomingRequestSecretKey} />
      ) : (
        <></>
      )}

      {/* Incoming Email Address */}
      {monitorType === MonitorType.IncomingEmail &&
      monitor?.incomingEmailSecretKey ? (
        <IncomingEmailMonitorLink secretKey={monitor?.incomingEmailSecretKey} />
      ) : (
        <></>
      )}

      {monitorType === MonitorType.Server && monitor?.serverMonitorSecretKey ? (
        <ServerMonitorDocumentation
          secretKey={monitor?.serverMonitorSecretKey}
        />
      ) : (
        <></>
      )}

      {/* Network Device (SNMP) guide */}
      {monitorType === MonitorType.NetworkDevice ? (
        <Card
          title={`Network Device Monitoring Guide`}
          description={
            <span>
              Learn how to register devices, run subnet discovery, enable
              interface monitoring and SNMP traps, and use template variables in
              the{" "}
              <Link
                openInNewTab={true}
                to={new URL(HTTP_PROTOCOL, HOST).addRoute(
                  "/docs/monitor/network-device-monitor",
                )}
              >
                <span>Network Device Monitor documentation</span>
              </Link>
              .
            </span>
          }
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default MonitorDocumentation;
