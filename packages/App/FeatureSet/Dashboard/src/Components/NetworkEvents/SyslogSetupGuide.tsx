import {
  SYSLOG_PORT,
  SyslogSetupGuide as SyslogSetupGuideData,
  SyslogSetupVendor,
  getConfigurationForProbe,
  getNetworkEventsDocsUrl,
  getSyslogSetupGuides,
  getSyslogSetupVendorForDevice,
} from "./NetworkEventsSetup";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * What an Events page shows before any syslog has arrived: three steps
 * from nothing to events. The probe already listens (step 1, with its
 * port); the device needs a remote syslog server set (step 2, per vendor,
 * ready to paste); and messages are matched to the device by the address
 * they come from (step 3, with the addresses this device is known by).
 *
 * On a device's page the guide opens on the steps of the device's own
 * maker, when OneUptime knows it. A device polled by a global probe is
 * told first that its syslog cannot get there: step 1 then asks for a
 * probe of the reader's own rather than naming the one that cannot hear.
 */

export interface ComponentProps {
  scope: "device" | "network";
  // The probe the device is polled by (device page).
  probeName?: string | undefined;
  isGlobalProbe?: boolean | undefined;
  // The addresses this device's messages are matched by: hostname, then Other Addresses.
  matchAddresses?: Array<string> | undefined;
  // Where the device's Other Addresses are edited.
  settingsRoute?: Route | undefined;
  // The page is looking for the first message by itself, and says so.
  isWaiting?: boolean | undefined;
  /*
   * Who made the device, when it is known (device page): its Vendor and
   * its system description. The guide opens on that maker's steps.
   */
  deviceVendor?: string | undefined;
}

/*
 * The room the lines to paste keep free for their copy button, which a code
 * block lays over its top right corner.
 *
 * Below xl the block is narrower than a vendor's longest first line, so the
 * button stood on the line - on a phone on its port number, however far the
 * lines were scrolled. There the lines start under the button.
 *
 * From xl every vendor's lines fit beside it. They get a little more room
 * above and below than a code block gives itself, so that with one line to
 * paste (HPE Aruba) the button does not reach past the frame.
 *
 * At every width the button's own width stays free where the lines end: a
 * probe's address can be long enough to reach it.
 */
const CONFIGURATION_CLASS_NAME: string =
  "mt-3 [&_code]:!pb-3 [&_code]:!pr-12 max-xl:[&_code]:!pt-12 xl:[&_code]:!pt-3";

const PortBadge: FunctionComponent<{
  protocol: "UDP" | "TCP";
}> = (props: { protocol: "UDP" | "TCP" }): ReactElement => {
  return (
    <span
      className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs ring-1 ring-gray-200"
      data-testid="syslog-setup-port"
    >
      {/* A protocol and a port: the same in every language. */}
      <code className="font-mono font-semibold text-gray-900">
        {props.protocol} {SYSLOG_PORT}
      </code>
    </span>
  );
};

const StepNumber: FunctionComponent<{ number: number }> = (props: {
  number: number;
}): ReactElement => {
  return (
    <div
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200"
      aria-hidden="true"
    >
      {props.number}
    </div>
  );
};

const SyslogSetupGuide: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const guides: Array<SyslogSetupGuideData> = getSyslogSetupGuides();
  const deviceGuideVendor: SyslogSetupVendor | null =
    getSyslogSetupVendorForDevice(props.deviceVendor);
  const [vendor, setVendor] = useState<SyslogSetupVendor>(
    deviceGuideVendor || SyslogSetupVendor.Cisco,
  );
  // Until the reader picks a tab themselves, the device's maker picks it.
  const [hasPickedVendor, setHasPickedVendor] = useState<boolean>(false);
  const tabsId: string = useId();

  /*
   * The device's details arrive after the page: the guide moves to its
   * maker's steps then, unless the reader has already chosen a tab.
   */
  useEffect(() => {
    if (deviceGuideVendor && !hasPickedVendor) {
      setVendor(deviceGuideVendor);
    }
  }, [deviceGuideVendor]);

  const guide: SyslogSetupGuideData =
    guides.find((candidate: SyslogSetupGuideData): boolean => {
      return candidate.vendor === vendor;
    }) || guides[0]!;
  const configuration: string | null = getConfigurationForProbe(guide, null);
  const isDevice: boolean = props.scope === "device";
  // A global probe cannot be sent syslog: it is not named as where to send it.
  const probeName: string | undefined = props.isGlobalProbe
    ? undefined
    : props.probeName;
  const panelId: string = `${tabsId}-panel`;
  const getTabId: (tabVendor: SyslogSetupVendor) => string = (
    tabVendor: SyslogSetupVendor,
  ): string => {
    return `${tabsId}-tab-${tabVendor}`;
  };

  return (
    <div className="py-2" data-testid="syslog-setup-guide">
      <div className="flex items-start gap-4">
        <div
          className="max-sm:hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 sm:flex"
          aria-hidden="true"
        >
          <Icon icon={IconProp.Activity} className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">
            {translator.translateText(
              isDevice
                ? "See what this device reports"
                : "See what your network devices report",
            )}
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            {translator.translateText(
              isDevice
                ? "Point the device's syslog at its probe. Links going down, tunnels, failovers, restarts and sign-ins show up here as they happen, in the same words whoever made the device."
                : "Point the syslog of your routers, firewalls, switches and access points at one of your probes. Links going down, tunnels, failovers, restarts and sign-ins show up here as they happen, in the same words whoever made the device - no device to add first.",
            )}
          </p>
        </div>
      </div>

      <ol className="mt-6 space-y-6">
        <li className="flex gap-3">
          <StepNumber number={1} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900">
              {probeName ? (
                <TranslatedSentence
                  template="Send syslog to probe {{probe}}"
                  slots={{
                    probe: <span className="font-semibold">{probeName}</span>,
                  }}
                />
              ) : (
                translator.translateText("Send syslog to one of your probes")
              )}
            </div>
            {props.isGlobalProbe ? (
              <div
                role="note"
                className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200"
                data-testid="syslog-setup-global-probe"
              >
                <Icon
                  icon={IconProp.Alert}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                />
                <span>
                  {translator.translateText(
                    "This device is polled by a global probe, which syslog from your network cannot reach. Run a custom probe on the device's network and pick it in the device's settings.",
                  )}
                </span>
              </div>
            ) : (
              <></>
            )}
            <p
              className={`${props.isGlobalProbe ? "mt-3" : "mt-1"} text-sm text-gray-600`}
            >
              {translator.translateText(
                "The probe already listens on this port, over UDP and over TCP, at the IP address of the machine it runs on.",
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <PortBadge protocol="UDP" />
              <PortBadge protocol="TCP" />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {translator.translateText(
                "A probe in Docker needs host networking (--network host) or the port published, such as -p 5140:5140/udp. For a device that can only send to port 514, publish it as -p 514:5140/udp.",
              )}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              <TranslatedSentence
                template="A probe you have not updated in a while listens only when it is started with {{setting}}, and only over UDP."
                slots={{
                  setting: <code>PROBE_SYSLOG_RECEIVER_ENABLED=true</code>,
                }}
              />
            </p>
          </div>
        </li>

        <li className="flex gap-3">
          <StepNumber number={2} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900">
              {translator.translateText(
                isDevice
                  ? "Set the probe as the device's syslog server"
                  : "Set the probe as your devices' syslog server",
              )}
            </div>
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              role="tablist"
              aria-label={translator.translateText("Device vendor")}
            >
              {guides.map((candidate: SyslogSetupGuideData): ReactElement => {
                const isActive: boolean = candidate.vendor === vendor;

                return (
                  <button
                    key={candidate.vendor}
                    id={getTabId(candidate.vendor)}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={panelId}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                        : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setHasPickedVendor(true);
                      setVendor(candidate.vendor);
                    }}
                    data-testid={`syslog-setup-vendor-${candidate.vendor}`}
                  >
                    {candidate.vendor === SyslogSetupVendor.Other
                      ? translator.translateText(candidate.name)
                      : candidate.name}
                  </button>
                );
              })}
            </div>
            <div
              id={panelId}
              role="tabpanel"
              aria-labelledby={getTabId(guide.vendor)}
            >
              <ol
                className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-600"
                data-testid="syslog-setup-steps"
              >
                {guide.steps.map((step: string): ReactElement => {
                  return <li key={step}>{translator.translateText(step)}</li>;
                })}
              </ol>
              {configuration ? (
                <div
                  className={CONFIGURATION_CLASS_NAME}
                  data-testid="syslog-setup-configuration"
                >
                  <CodeBlock code={configuration} language="text" />
                </div>
              ) : (
                <></>
              )}
            </div>
          </div>
        </li>

        <li className="flex gap-3">
          <StepNumber number={3} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900">
              {translator.translateText(
                isDevice
                  ? "Events appear here"
                  : "Events appear here, device by device",
              )}
            </div>
            {isDevice ? (
              <div className="mt-1 text-sm text-gray-600">
                <p>
                  {translator.translateText(
                    "Messages are matched to this device by the address they come from:",
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(props.matchAddresses || []).map(
                    (address: string): ReactElement => {
                      return (
                        <span
                          key={address}
                          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800"
                          data-testid="syslog-setup-match-address"
                        >
                          {address}
                        </span>
                      );
                    },
                  )}
                </div>
                <p className="mt-2">
                  {translator.translateText(
                    "If the device sends from another address, such as a loopback, add it to its Other Addresses.",
                  )}{" "}
                  {props.settingsRoute ? (
                    <Link
                      to={props.settingsRoute}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {translator.translateText("Open device settings")}
                    </Link>
                  ) : (
                    <></>
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-gray-600">
                {translator.translateText(
                  "Events from a device you have added show on its own Events page as well. Messages from an address that is not a device yet show here too, ready to add as a device in one click.",
                )}
              </p>
            )}
            {props.isWaiting ? (
              <div
                role="status"
                className="mt-3 inline-flex items-center gap-2.5 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600 ring-1 ring-gray-200"
                data-testid="syslog-setup-waiting"
              >
                <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-500" />
                </span>
                <span>
                  {translator.translateText(
                    "Waiting for the first message. This page checks for it every few seconds.",
                  )}
                </span>
              </div>
            ) : (
              <></>
            )}
            <div className="mt-3 text-sm">
              <Link
                to={getNetworkEventsDocsUrl()}
                openInNewTab={true}
                className="font-medium text-indigo-600 hover:underline [&_div]:ml-1 [&_div]:inline-block [&_div]:align-[-0.125rem]"
              >
                <>
                  {translator.translateText(
                    "Every vendor's steps, and the events each one reports",
                  )}
                  <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
                </>
              </Link>
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
};

export default SyslogSetupGuide;
