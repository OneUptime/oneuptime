import SnmpTrapRefusalList from "./SnmpTrapRefusalList";
import {
  SNMP_TRAPS_CARD_DESCRIPTION,
  SNMP_TRAPS_CARD_TITLE,
  SNMP_TRAPS_ENGINE_ID_HINT,
  SNMP_TRAPS_FACT_LABELS,
  SNMP_TRAPS_LISTEN_ERRORS,
  SNMP_TRAPS_LISTEN_ERROR_OTHER,
  SNMP_TRAPS_LISTENS_ON,
  SNMP_TRAPS_NONE_RECEIVED,
  SNMP_TRAPS_NONE_REFUSED,
  SNMP_TRAPS_NOT_REPORTED,
  SNMP_TRAPS_NO_USERS,
  SNMP_TRAPS_REFUSED_DESCRIPTION,
  SNMP_TRAPS_REFUSED_TITLE,
  SNMP_TRAPS_TURNED_OFF,
  SNMP_TRAPS_USER_COUNT,
} from "./SnmpTrapReceiverCopy";
import Probe from "Common/Models/DatabaseModels/Probe";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import SnmpTrapReceiverUtil, {
  SnmpTrapReceiverReport,
} from "Common/Types/Probe/SnmpTrapReceiver";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  probeId: ObjectID;
}

/*
 * A probe page's SNMP Traps card (OneUptime issue #11005): what the probe
 * last said about its trap receiver (Probe.snmpTrapReceiver). Its SNMPv3
 * engine ID, which a device sending informs needs, to copy; how many
 * SNMPv3 users it takes traps from; and the SNMPv3 traps it refused in the
 * last day, each with what to change so it stops.
 *
 * Read by the probe's readers only, like the probe's packet capture report:
 * once the permission snapshot says this viewer may not read it, the card
 * is left out rather than drawn as a refusal.
 */
const ProbeSnmpTraps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [report, setReport] = useState<SnmpTrapReceiverReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const mayReadReport: boolean =
    !PermissionGate.hasPermissionSnapshot() ||
    PermissionGate.canReadColumn(new Probe(), "snmpTrapReceiver");

  useEffect(() => {
    if (!mayReadReport) {
      return;
    }

    const load: PromiseVoidFunction = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const item: Probe | null = await ModelAPI.getItem<Probe>({
          modelType: Probe,
          id: props.probeId,
          select: {
            _id: true,
            snmpTrapReceiver: true,
          },
        });

        setReport(SnmpTrapReceiverUtil.parseReport(item?.snmpTrapReceiver));
        setError("");
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.probeId, mayReadReport]);

  if (!mayReadReport) {
    return <></>;
  }

  const card: (body: ReactElement) => ReactElement = (
    body: ReactElement,
  ): ReactElement => {
    return (
      <Card
        title={SNMP_TRAPS_CARD_TITLE}
        description={SNMP_TRAPS_CARD_DESCRIPTION}
      >
        {body}
      </Card>
    );
  };

  if (isLoading) {
    return card(<DetailListSkeleton />);
  }

  if (error) {
    return card(<ErrorMessage message={error} />);
  }

  if (!report) {
    return card(
      <p className="text-sm text-gray-600" data-testid="probe-snmp-traps-not-reported">
        {translator.translateText(SNMP_TRAPS_NOT_REPORTED)}
      </p>,
    );
  }

  if (!report.isEnabled) {
    return card(
      <p className="text-sm text-gray-600" data-testid="probe-snmp-traps-off">
        {translator.translateText(SNMP_TRAPS_TURNED_OFF)}
      </p>,
    );
  }

  const port: string = String(report.port || 162);
  const userCount: number = report.userCount || 0;

  const facts: Array<{ label: string; value: ReactElement }> = [
    {
      label: SNMP_TRAPS_FACT_LABELS.listensOn,
      value: (
        <span>
          {translator.translateTemplate(SNMP_TRAPS_LISTENS_ON, { port: port })}
        </span>
      ),
    },
  ];

  if (report.engineId) {
    facts.push({
      label: SNMP_TRAPS_FACT_LABELS.engineId,
      value: (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <code
              className="break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono text-sm text-gray-900"
              data-testid="probe-snmp-engine-id"
            >
              {report.engineId}
            </code>
            <CopyTextButton
              textToBeCopied={report.engineId}
              size="xs"
              variant="ghost"
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {translator.translateText(SNMP_TRAPS_ENGINE_ID_HINT)}
          </p>
        </div>
      ),
    });
  }

  facts.push({
    label: SNMP_TRAPS_FACT_LABELS.users,
    value: (
      <span data-testid="probe-snmp-users">
        {userCount > 0
          ? translator.translatePlural(SNMP_TRAPS_USER_COUNT, userCount)
          : translator.translateText(SNMP_TRAPS_NO_USERS)}
      </span>
    ),
  });

  facts.push({
    label: SNMP_TRAPS_FACT_LABELS.lastReceived,
    value: (
      <span>
        {report.lastReceivedAt
          ? OneUptimeDate.fromNow(
              OneUptimeDate.fromString(report.lastReceivedAt),
            )
          : translator.translateText(SNMP_TRAPS_NONE_RECEIVED)}
      </span>
    ),
  });

  const listenError: string | undefined = report.listenError
    ? translator.translateTemplate(
        SNMP_TRAPS_LISTEN_ERRORS[report.listenError] ||
          SNMP_TRAPS_LISTEN_ERROR_OTHER,
        { port: port, code: report.listenError },
      )
    : undefined;

  return card(
    <div className="space-y-6" data-testid="probe-snmp-traps">
      {listenError && (
        <Alert
          type={AlertType.DANGER}
          title={listenError}
          dataTestId="probe-snmp-traps-listen-error"
        />
      )}

      <dl className="divide-y divide-gray-100">
        {facts.map((fact: { label: string; value: ReactElement }) => {
          return (
            <div
              key={fact.label}
              className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:gap-4"
            >
              <dt className="flex-shrink-0 text-gray-500 sm:w-44">
                {translator.translateText(fact.label)}
              </dt>
              <dd className="min-w-0 text-gray-900">{fact.value}</dd>
            </div>
          );
        })}
      </dl>

      <div>
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateText(SNMP_TRAPS_REFUSED_TITLE)}
        </h3>
        <p className="text-sm text-gray-500">
          {translator.translateText(SNMP_TRAPS_REFUSED_DESCRIPTION)}
        </p>
        <div className="mt-3">
          {report.refusals.length > 0 ? (
            <SnmpTrapRefusalList refusals={report.refusals} />
          ) : (
            <p
              className="text-sm text-gray-600"
              data-testid="probe-snmp-traps-none-refused"
            >
              {translator.translateText(SNMP_TRAPS_NONE_REFUSED)}
            </p>
          )}
        </div>
      </div>
    </div>,
  );
};

export default ProbeSnmpTraps;
