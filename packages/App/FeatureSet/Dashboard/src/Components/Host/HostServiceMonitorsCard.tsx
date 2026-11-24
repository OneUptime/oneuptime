import Monitor from "Common/Models/DatabaseModels/Monitor";
import { Gray500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  HostServiceKind,
  getHostServiceMonitorRoute,
} from "../../Utils/HostServiceMonitorPrefill";
import {
  CREATE_ANOTHER_MONITOR,
  CREATE_MONITOR,
  HOST_SERVICE_MONITORS_COPY,
  HOST_SERVICE_MONITORS_TITLE,
  HostServiceMonitorMatch,
  HostServiceMonitorsCopy,
  loadMonitorsWatchingHostService,
} from "../../Utils/HostServiceMonitors";
import MonitorElement from "../Monitor/Monitor";

/*
 * "Will I hear about it when this service stops?" on a Windows service's or
 * a systemd unit's page (#10296): the monitors that already watch it, each a
 * link with its status, and Create Monitor, which opens Monitor Create on a
 * monitor of this service on this host (HostServiceMonitorPrefill). With a
 * monitor listed, the action says "Create Another Monitor": a second one is
 * still a click away, and nobody makes it by accident.
 *
 * Drawn for a reader who may read monitors or create them. Create Monitor is
 * locked, saying why, for one who may not create them - not a wizard that
 * refuses them at the end.
 */

export const HOST_SERVICE_MONITORS_TEST_ID: string = "host-service-monitors";

export interface ComponentProps {
  kind: HostServiceKind;
  // As the host's collector reports it.
  serviceName: string;
  hostId: ObjectID;
  hostIdentifier: string;
}

const HostServiceMonitorsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const readGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Read,
  );
  const createGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );

  const canRead: boolean = readGate.isAllowed;
  const isCreateShown: boolean =
    createGate.isAllowed || Boolean(createGate.disabledReason);

  const [matches, setMatches] = useState<Array<HostServiceMonitorMatch> | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    if (!canRead) {
      return undefined;
    }

    let isCancelled: boolean = false;

    setError("");

    loadMonitorsWatchingHostService({
      kind: props.kind,
      serviceName: props.serviceName,
      hostId: props.hostId.toString(),
      hostIdentifier: props.hostIdentifier,
    })
      .then((found: Array<HostServiceMonitorMatch>) => {
        if (!isCancelled) {
          setMatches(found);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    canRead,
    props.kind,
    props.serviceName,
    props.hostId.toString(),
    props.hostIdentifier,
    readCount,
  ]);

  if (!canRead && !isCreateShown) {
    return <></>;
  }

  const copy: HostServiceMonitorsCopy = HOST_SERVICE_MONITORS_COPY[props.kind];
  const hasMonitors: boolean = Boolean(matches && matches.length > 0);

  const createButton: ReactElement | null = isCreateShown ? (
    <Button
      key="create-host-service-monitor"
      title={hasMonitors ? CREATE_ANOTHER_MONITOR : CREATE_MONITOR}
      icon={IconProp.Add}
      buttonStyle={ButtonStyleType.NORMAL}
      disabled={!createGate.isAllowed}
      tooltip={createGate.isAllowed ? undefined : createGate.disabledReason}
      dataTestId={`${HOST_SERVICE_MONITORS_TEST_ID}-create`}
      onClick={() => {
        if (!createGate.isAllowed) {
          return;
        }

        Navigation.navigate(
          getHostServiceMonitorRoute({
            hostId: props.hostId.toString(),
            kind: props.kind,
            serviceName: props.serviceName,
          }),
        );
      }}
    />
  ) : null;

  // A monitor switched off reads Disabled, grey, never its stale status.
  const renderStatus: (monitor: Monitor) => ReactElement = (
    monitor: Monitor,
  ): ReactElement => {
    if (monitor.disableActiveMonitoring) {
      return <Pill text="Disabled" tone={PillTone.Paused} />;
    }

    const statusName: string | undefined = monitor.currentMonitorStatus?.name;

    if (!statusName) {
      return <></>;
    }

    return (
      <Pill
        text={statusName}
        isUserContent={isRecordNameAsWritten(
          StateListType.MonitorStatus,
          statusName,
        )}
        color={monitor.currentMonitorStatus?.color || Gray500}
        isMinimal={true}
      />
    );
  };

  const renderBody: () => ReactElement = (): ReactElement => {
    if (!canRead) {
      return <></>;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          whatFailed={
            translator.translateText(copy.readFailed) || copy.readFailed
          }
          onRefreshClick={() => {
            setReadCount((count: number): number => {
              return count + 1;
            });
          }}
        />
      );
    }

    if (!matches) {
      return <TableSkeleton rows={1} columns={2} />;
    }

    if (matches.length === 0) {
      return (
        <p
          className="text-sm text-gray-600"
          data-testid={`${HOST_SERVICE_MONITORS_TEST_ID}-empty`}
        >
          {translator.translateText(copy.empty)}
        </p>
      );
    }

    return (
      <ul className={listClassName}>
        {matches.map((match: HostServiceMonitorMatch): ReactElement => {
          return (
            <li
              key={match.monitor._id?.toString() || match.monitor.name}
              data-testid={`${HOST_SERVICE_MONITORS_TEST_ID}-item`}
              className="flex items-center justify-between gap-3 px-5 py-3 md:px-6"
            >
              <div className="min-w-0 text-sm font-medium text-gray-900">
                <MonitorElement monitor={match.monitor} />
              </div>
              <div className="flex-shrink-0">{renderStatus(match.monitor)}</div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="mb-6" data-testid={HOST_SERVICE_MONITORS_TEST_ID}>
      <Card
        title={HOST_SERVICE_MONITORS_TITLE}
        description={copy.description}
        buttons={createButton ? [createButton] : []}
      >
        {renderBody()}
      </Card>
    </div>
  );
};

export default HostServiceMonitorsCard;
