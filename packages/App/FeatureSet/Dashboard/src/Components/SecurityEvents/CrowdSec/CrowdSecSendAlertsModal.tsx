import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import Protocol from "Common/Types/API/Protocol";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SECURITY_EVENTS_INGEST_PATH } from "Common/Types/SecurityEvent/Connectors/PushedConnectionAddress";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CROWDSEC_NOTIFICATION_FILE,
  CROWDSEC_PROFILES_FILE,
  CROWDSEC_PROFILE_NOTIFICATIONS,
  CROWDSEC_RELOAD_COMMAND,
  CROWDSEC_TEST_COMMAND,
  getCrowdSecAlertsAddress,
  getCrowdSecNotificationYaml,
} from "Common/Types/SecurityEvent/CrowdSec/CrowdSecNotification";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AppLink from "../../AppLink/AppLink";
import SetupGuideSteps, {
  SetupGuideStepView,
} from "../../SetupGuide/SetupGuideSteps";
import IngestionKeySelector from "../../Telemetry/IngestionKeySelector";
import {
  connectionAlertsRoute,
  connectorDocsUrl,
} from "../SecurityEventConnectionDiagnosticsUtil";

/*
 * "How do CrowdSec's alerts get here?" (#11158)
 *
 * CrowdSec sends its alerts itself, through the http notification plugin
 * of its Local API: a CrowdSec connection is never polled. This dialog is
 * that connection's Send alerts, opened when the connection is made and
 * from its row. It hands over the notification for this connection and the
 * key picked (CrowdSecNotification), the line its profiles add and the
 * command that sends a test alert - and says when one arrives, so the setup
 * ends with an alert that came through, not with a saved form.
 */

export const CROWDSEC_SEND_ALERTS_TEST_ID: string = "crowdsec-send-alerts";

// How often the dialog asks whether an alert has arrived.
export const CROWDSEC_ALERTS_WATCH_MS: number = 5 * 1000;

// When the connection's last alert arrived, as the API hands it back.
export function readLastAlertAt(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const at: Date =
    value instanceof Date ? value : new Date(String(value as string));

  return Number.isNaN(at.getTime()) ? null : at;
}

export type CrowdSecAlertsArrival =
  | { state: "arrived"; at: Date }
  | { state: "waiting"; lastAt: Date | null };

/*
 * Whether an alert has arrived since the dialog opened: the connection's
 * last alert is a later one than when it opened. Compared with what the
 * server said then, not the browser's clock, which can run ahead of it.
 */
export function getCrowdSecAlertsArrival(data: {
  lastAlertAtWhenOpened: Date | null;
  lastAlertAt: Date | null;
}): CrowdSecAlertsArrival {
  if (
    data.lastAlertAt &&
    (!data.lastAlertAtWhenOpened ||
      data.lastAlertAt.getTime() > data.lastAlertAtWhenOpened.getTime())
  ) {
    return { state: "arrived", at: data.lastAlertAt };
  }

  return { state: "waiting", lastAt: data.lastAlertAt };
}

// The ingest's address on this OneUptime, or a placeholder where it is not known.
export function getSecurityEventsIngestUrl(): string {
  return HOST
    ? `${HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http"}://${HOST}${SECURITY_EVENTS_INGEST_PATH}`
    : `<YOUR_ONEUPTIME_URL>${SECURITY_EVENTS_INGEST_PATH}`;
}

export interface ComponentProps {
  connection: SecurityEventConnection;
  onClose: () => void;
}

const CrowdSecSendAlertsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // An English sentence of the dialog, in the reader's language.
  const say: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const connectionId: string = props.connection.id?.toString() || "";
  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.CrowdSec,
    );
  const [selectedKey, setSelectedKey] = useState<TelemetryIngestionKey | null>(
    null,
  );
  const [lastAlertAtWhenOpened] = useState<Date | null>(() => {
    return readLastAlertAt(props.connection.lastEventIngestedAt);
  });
  const [lastAlertAt, setLastAlertAt] = useState<Date | null>(
    lastAlertAtWhenOpened,
  );

  // While the dialog is open, whether an alert has arrived is asked every few seconds.
  useEffect(() => {
    if (!props.connection.id) {
      return undefined;
    }

    const id: ObjectID = props.connection.id;
    let isCurrent: boolean = true;

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      ModelAPI.getItem<SecurityEventConnection>({
        modelType: SecurityEventConnection,
        id,
        select: { lastEventIngestedAt: true },
      })
        .then((read: SecurityEventConnection | null) => {
          if (isCurrent && read) {
            setLastAlertAt(readLastAlertAt(read.lastEventIngestedAt));
          }
        })
        .catch(() => {
          // Asked again at the next tick.
        });
    }, CROWDSEC_ALERTS_WATCH_MS);

    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [connectionId]);

  const address: string = getCrowdSecAlertsAddress({
    ingestUrl: getSecurityEventsIngestUrl(),
    connectionId,
  });
  const notification: string = getCrowdSecNotificationYaml({
    address,
    token: selectedKey?.secretKey?.toString() || "<YOUR_ONEUPTIME_TOKEN>",
  });
  const arrival: CrowdSecAlertsArrival = getCrowdSecAlertsArrival({
    lastAlertAtWhenOpened,
    lastAlertAt,
  });

  let arrivalElement: ReactElement;

  if (arrival.state === "arrived") {
    arrivalElement = (
      <div
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
        role="status"
        aria-live="polite"
        data-testid={`${CROWDSEC_SEND_ALERTS_TEST_ID}-arrival`}
        data-state="arrived"
      >
        <div className="flex items-start gap-3">
          <Icon
            icon={IconProp.CheckCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
          />
          <div className="min-w-0 space-y-1 text-sm text-emerald-900">
            <p>
              {translator.translateTemplate(
                "An alert arrived at {{time}}: CrowdSec's alerts reach this connection.",
                {
                  time: OneUptimeDate.getDateAsLocalShortDateTimeString(
                    arrival.at,
                  ),
                },
              )}
            </p>
            <AppLink
              className="font-medium text-emerald-800 underline hover:text-emerald-900"
              to={connectionAlertsRoute(connectionId)}
            >
              {say(translationKey("View alerts"))}
            </AppLink>
          </div>
        </div>
      </div>
    );
  } else {
    arrivalElement = (
      <div
        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
        role="status"
        aria-live="polite"
        data-testid={`${CROWDSEC_SEND_ALERTS_TEST_ID}-arrival`}
        data-state="waiting"
      >
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          {/* The dot's own indigo: a mid-tone reads the same in the dark theme. */}
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
        </span>
        <p className="text-sm text-gray-700">
          {arrival.lastAt
            ? translator.translateTemplate(
                "Waiting for the next alert. The last one arrived at {{time}}.",
                {
                  time: OneUptimeDate.getDateAsLocalShortDateTimeString(
                    arrival.lastAt,
                  ),
                },
              )
            : say(
                translationKey(
                  "Waiting for the first alert. It arrives within seconds of the test.",
                ),
              )}
        </p>
      </div>
    );
  }

  const steps: Array<SetupGuideStepView> = [
    {
      title: say(translationKey("Pick an ingestion key")),
      description: say(
        translationKey(
          "CrowdSec sends it with each alert. Give CrowdSec a key of its own, which you can delete to cut it off.",
        ),
      ),
      content: (
        <IngestionKeySelector
          endpointLabel={translationKey("Alerts address")}
          endpointValue={address}
          keyTypeFilter={TelemetryIngestionKeyType.Server}
          newKeyName={translationKey("CrowdSec key")}
          onSelectedKeyChange={setSelectedKey}
          hideValues={true}
        />
      ),
    },
    {
      title: translator.translateTemplate("Save this as {{file}}", {
        file: CROWDSEC_NOTIFICATION_FILE,
      }),
      description: say(
        translationKey(
          "On the host that runs CrowdSec's Local API, which sends the alerts of every machine that reports to it.",
        ),
      ),
      content: (
        <CodeBlock code={notification} language="yaml" showCopyButton={true} />
      ),
    },
    {
      title: say(translationKey("Send your profiles' alerts to it")),
      description: translator.translateTemplate(
        "In {{file}}, add it to the notifications of each profile whose alerts OneUptime should receive, then reload CrowdSec.",
        { file: CROWDSEC_PROFILES_FILE },
      ),
      content: (
        <div className="space-y-3">
          <CodeBlock
            code={CROWDSEC_PROFILE_NOTIFICATIONS}
            language="yaml"
            showCopyButton={true}
          />
          <CodeBlock
            code={CROWDSEC_RELOAD_COMMAND}
            language="bash"
            showCopyButton={true}
          />
        </div>
      ),
    },
    {
      title: say(translationKey("Send a test alert")),
      description: say(
        translationKey(
          "It arrives as an informational event, and opens no case.",
        ),
      ),
      content: (
        <div className="space-y-3">
          <CodeBlock
            code={CROWDSEC_TEST_COMMAND}
            language="bash"
            showCopyButton={true}
          />
          {arrivalElement}
        </div>
      ),
    },
  ];

  return (
    <Modal
      title={translator.translateTemplate("Send alerts: {{name}}", {
        name: props.connection.name || definition?.title || "CrowdSec",
      })}
      isTitleTranslated={true}
      description="CrowdSec's notification plugin sends each alert to this connection as it is raised."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText={arrival.state === "arrived" ? "Done" : "Close"}
      leftFooterElement={
        definition ? (
          <Link
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
            openInNewTab={true}
            to={connectorDocsUrl(definition)}
          >
            <>
              <Icon icon={IconProp.Book} className="h-4 w-4" />
              {say(translationKey("CrowdSec setup guide"))}
            </>
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-6" data-testid={CROWDSEC_SEND_ALERTS_TEST_ID}>
        {props.connection.isEnabled === false ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
            data-testid={`${CROWDSEC_SEND_ALERTS_TEST_ID}-disabled`}
          >
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
            />
            <p>
              {say(
                translationKey(
                  "This connection is disabled: the alerts it receives are kept as events, and open no cases.",
                ),
              )}
            </p>
          </div>
        ) : (
          <></>
        )}

        <SetupGuideSteps steps={steps} />
      </div>
    </Modal>
  );
};

export default CrowdSecSendAlertsModal;
