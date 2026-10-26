import React, { FunctionComponent, ReactElement, useMemo } from "react";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Log from "Common/Models/AnalyticsModels/Log";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { keyForVMwareVCenter } from "Common/Utils/Telemetry/EntityKey";
import DashboardLogsViewer from "../../Logs/LogsViewer";
import {
  VMWARE_HOST_HOSTNAME_COMMAND,
  VMWARE_PROBE_OR_AGENT_DOCS_PATH,
  VMWARE_SYSLOG_DOCS_PATH,
  VMWARE_SYSLOG_HOSTNAME_ATTRIBUTE,
  VMWARE_VCENTER_NAME_ATTRIBUTE,
  getVMwareClusterPowerCliSyslogCommand,
  getVMwareHostEsxcliSyslogCommands,
  getVMwareHostLogAttributes,
  getVMwareHostPowerCliSyslogCommand,
} from "../../../Pages/VMware/Utils/VMwareHostSyslog";

/*
 * An ESXi host's logs: the syslog the host sends to the VMware agent, out
 * of everything the vCenter's agent received - the same viewer as the host
 * page outside VMware, scoped to this vCenter and to this host's name.
 *
 * Until the host's first line arrives, the empty list says how to send
 * them, with the commands filled in for this host (and its cluster): the
 * one step from "no logs" to its vmkernel, hostd and vpxa logs. A vCenter a
 * probe collects gets no syslog at all, and says so instead.
 */

export interface ComponentProps {
  vcenterId: ObjectID;
  vcenterName: string;
  hostName: string;
  clusterName?: string | undefined;
  // A probe collects this vCenter: no agent, so no syslog listener.
  isProbeCollected: boolean;
  // The vCenter's setup guide, whose "Ship ESXi syslog" turns the listener on.
  setupGuideRoute: Route;
}

const STEP_NUMBER_CLASS_NAME: string =
  "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200";

const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

// What the empty list's block needs: the host, not the vCenter's identity.
export type VMwareHostLogsSetupProps = Pick<
  ComponentProps,
  "hostName" | "clusterName" | "isProbeCollected" | "setupGuideRoute"
>;

export const VMwareHostLogsSetup: FunctionComponent<
  VMwareHostLogsSetupProps
> = (props: VMwareHostLogsSetupProps): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  if (props.isProbeCollected) {
    return (
      <div
        className="mx-auto max-w-2xl px-4 py-8 text-center"
        data-testid="vmware-host-logs-probe"
      >
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={IconProp.Logs} className="h-5 w-5 text-gray-500" />
        </div>
        <h3 className="mt-3 text-sm font-semibold text-gray-900">
          {tx("No logs from this host")}
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {tx(
            "A probe collects this vCenter, and a probe reads the vSphere API only: it does not receive the syslog ESXi sends. The VMware agent has a syslog listener that brings this host's logs here.",
          )}
        </p>
        <div className="mt-3 text-sm">
          <Link
            to={new Route(VMWARE_PROBE_OR_AGENT_DOCS_PATH)}
            openInNewTab={true}
            className={LINK_CLASS_NAME}
          >
            {tx("Probe or agent?")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-3xl px-1 py-6 text-left sm:px-4"
      data-testid="vmware-host-logs-setup"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
          <Icon icon={IconProp.Logs} className="h-5 w-5 text-gray-500" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">
            {tx("No logs from this host yet")}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {tx(
              "ESXi sends its logs - vmkernel, hostd, vpxa and the rest - as syslog. Two steps bring them here:",
            )}
          </p>
        </div>
      </div>

      <ol className="mt-5 space-y-5">
        <li className="flex items-start gap-3">
          <span className={STEP_NUMBER_CLASS_NAME} aria-hidden="true">
            1
          </span>
          <div className="min-w-0 flex-1 text-sm text-gray-700">
            <div className="font-medium text-gray-900">
              {tx("Turn on the VMware agent's syslog listener")}
            </div>
            <p className="mt-1 text-gray-500">
              {tx(
                "It is off until you turn it on: uncomment the syslog receivers in the agent's config and open port 5514.",
              )}{" "}
              <Link to={props.setupGuideRoute} className={LINK_CLASS_NAME}>
                {tx("Open the setup guide")}
              </Link>
            </p>
          </div>
        </li>

        <li className="flex items-start gap-3">
          <span className={STEP_NUMBER_CLASS_NAME} aria-hidden="true">
            2
          </span>
          <div className="min-w-0 flex-1 text-sm text-gray-700">
            <div className="font-medium text-gray-900">
              {tx("Point this host at the agent")}
            </div>
            <p className="mt-1 text-gray-500">
              {tx(
                "Replace <agent-host> with the agent machine's address. On the host itself (ESXi Shell or SSH):",
              )}
            </p>
            <div className="mt-2" data-testid="vmware-host-logs-esxcli">
              <CodeBlock
                language="bash"
                code={getVMwareHostEsxcliSyslogCommands()}
              />
            </div>
            <p className="mt-3 text-gray-500">
              {tx("Or with PowerCLI, signed in to this vCenter:")}
            </p>
            <div className="mt-2" data-testid="vmware-host-logs-powercli">
              <CodeBlock
                language="plaintext"
                wrapLongLines={true}
                code={getVMwareHostPowerCliSyslogCommand(props.hostName)}
              />
            </div>
            {props.clusterName ? (
              <>
                <p className="mt-3 text-gray-500">
                  {translator.translateTemplate(
                    "Every host of cluster {{cluster}} at once:",
                    { cluster: props.clusterName },
                  )}
                </p>
                <div
                  className="mt-2"
                  data-testid="vmware-host-logs-powercli-cluster"
                >
                  <CodeBlock
                    language="plaintext"
                    wrapLongLines={true}
                    code={getVMwareClusterPowerCliSyslogCommand(
                      props.clusterName,
                    )}
                  />
                </div>
              </>
            ) : (
              <></>
            )}
          </div>
        </li>
      </ol>

      <p
        className="mt-5 text-xs text-gray-500"
        data-testid="vmware-host-logs-name-hint"
      >
        <TranslatedSentence
          template="Lines show here when the host names itself {{hostName}} in them. If it uses another name, see it with {{command}} on the host."
          slots={{
            hostName: (
              <span className="font-mono text-gray-700">{props.hostName}</span>
            ),
            command: (
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-700">
                {VMWARE_HOST_HOSTNAME_COMMAND}
              </code>
            ),
          }}
        />{" "}
        <Link
          to={new Route(VMWARE_SYSLOG_DOCS_PATH)}
          openInNewTab={true}
          className={LINK_CLASS_NAME}
        >
          {tx("Shipping ESXi syslog")}
        </Link>
      </p>
    </div>
  );
};

const VMwareHostLogsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const logQuery: Query<Log> = useMemo(() => {
    /*
     * `any` sidesteps a TS2589 deep-instantiation on Query<Log> with
     * inline attribute maps - the same workaround the vCenter's and the
     * host page's logs use.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {
      attributes: getVMwareHostLogAttributes({
        vcenterName: props.vcenterName,
        hostName: props.hostName,
      }),
    };
    return query as Query<Log>;
  }, [props.vcenterName, props.hostName]);

  /*
   * entityScope is the vCenter's, as on its own Logs page (contract C4):
   * new rows match through the bloom-indexed `entityKeys` column, older
   * rows through the vCenter attribute inside the same OR. The host's name
   * is a log attribute the syslog receiver writes, not a resource the
   * entity keys know, so it is the pinned `hostname` filter on top.
   */
  return (
    <DashboardLogsViewer
      id={`vmware-host-logs-${props.vcenterId.toString()}-${props.hostName}`}
      logQuery={logQuery}
      attributeFilterDisplayKeys={{
        [VMWARE_VCENTER_NAME_ATTRIBUTE]: "vCenter",
        [VMWARE_SYSLOG_HOSTNAME_ATTRIBUTE]: "Host",
      }}
      entityScope={{
        entityKeys: [
          keyForVMwareVCenter(
            ProjectUtil.getCurrentProjectId()!.toString(),
            props.vcenterName,
          ),
        ],
        attributeKey: VMWARE_VCENTER_NAME_ATTRIBUTE,
        attributeValue: props.vcenterName,
      }}
      showFilters={true}
      enableRealtime={true}
      noLogsMessage="Clear a filter or widen the time range to see this host's logs."
      emptyContentWhenUnfiltered={
        <VMwareHostLogsSetup
          hostName={props.hostName}
          clusterName={props.clusterName}
          isProbeCollected={props.isProbeCollected}
          setupGuideRoute={props.setupGuideRoute}
        />
      }
    />
  );
};

export default VMwareHostLogsTab;
