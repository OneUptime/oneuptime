import {
  COLLECTOR_PORTS,
  TrafficSetupGuide as TrafficSetupGuideData,
  TrafficSetupVendor,
  getConfigurationForProbe,
  getNetworkTrafficDocsUrl,
  getTrafficSetupGuides,
} from "./NetworkTrafficSetup";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * What a Traffic page shows before any flow has arrived: three steps from
 * nothing to traffic. The probe already listens (step 1, with its ports);
 * the device needs a few lines of configuration (step 2, per vendor, ready
 * to paste); and records are matched to the device by the address they come
 * from (step 3, with the addresses this device is known by).
 */

export interface ComponentProps {
  scope: "device" | "site" | "network";
  // The probe the device is polled by (device page).
  probeName?: string | undefined;
  isGlobalProbe?: boolean | undefined;
  // The addresses this device's records are matched by: hostname, then Other Addresses.
  matchAddresses?: Array<string> | undefined;
  // Where the device's Other Addresses are edited.
  settingsRoute?: Route | undefined;
}

const PortBadge: FunctionComponent<{
  port: number;
  formats: string;
}> = (props: { port: number; formats: string }): ReactElement => {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-700 ring-1 ring-gray-200"
      data-testid="traffic-setup-port"
    >
      {/* A protocol and a port: the same in every language. */}
      <code className="font-mono font-semibold text-gray-900">
        UDP {props.port}
      </code>
      <span className="text-gray-500">{props.formats}</span>
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

const TrafficSetupGuide: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const guides: Array<TrafficSetupGuideData> = getTrafficSetupGuides();
  const [vendor, setVendor] = useState<TrafficSetupVendor>(
    TrafficSetupVendor.CiscoIosXe,
  );
  const guide: TrafficSetupGuideData =
    guides.find((candidate: TrafficSetupGuideData): boolean => {
      return candidate.vendor === vendor;
    }) || guides[0]!;
  const configuration: string | null = getConfigurationForProbe(guide, null);

  return (
    <div className="py-2" data-testid="traffic-setup-guide">
      <div className="flex items-start gap-4">
        <div
          className="max-sm:hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 sm:flex"
          aria-hidden="true"
        >
          <Icon icon={IconProp.ArrowUpDown} className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-900">
            {translator.translateText(
              props.scope === "device"
                ? "See where this device's traffic goes"
                : "See where your network's traffic goes",
            )}
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            {translator.translateText(
              props.scope === "device"
                ? "Turn on flow export on the device and send it to its probe. Who talks to whom, which applications use the bandwidth and through which interfaces shows up here within a minute."
                : "Turn on flow export on your routers, firewalls and switches and send it to one of your probes. Who talks to whom and which applications use the bandwidth shows up here within a minute - no device to add first.",
            )}
          </p>
        </div>
      </div>

      <ol className="mt-6 space-y-6">
        <li className="flex gap-3">
          <StepNumber number={1} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900">
              {props.probeName ? (
                <TranslatedSentence
                  template="Send flow records to probe {{probe}}"
                  slots={{
                    probe: (
                      <span className="font-semibold">{props.probeName}</span>
                    ),
                  }}
                />
              ) : (
                translator.translateText(
                  "Send flow records to one of your probes",
                )
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(
                "The probe already listens on these UDP ports at the IP address of the machine it runs on. Every port takes every format.",
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <PortBadge
                port={COLLECTOR_PORTS.netFlow}
                formats="NetFlow v5, v9 · IPFIX"
              />
              <PortBadge port={COLLECTOR_PORTS.ipfix} formats="IPFIX" />
              <PortBadge port={COLLECTOR_PORTS.sFlow} formats="sFlow v5" />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {translator.translateText(
                "A probe in Docker needs host networking (--network host) or the ports published, such as -p 2055:2055/udp.",
              )}
            </p>
            {props.isGlobalProbe ? (
              <div
                className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200"
                data-testid="traffic-setup-global-probe"
              >
                <Icon
                  icon={IconProp.Alert}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                />
                <span>
                  {translator.translateText(
                    "This device is polled by a global probe, which flow records from your network cannot reach. Run a custom probe on the device's network and pick it in the device's settings.",
                  )}
                </span>
              </div>
            ) : (
              <></>
            )}
          </div>
        </li>

        <li className="flex gap-3">
          <StepNumber number={2} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900">
              {translator.translateText(
                props.scope === "device"
                  ? "Turn on flow export on the device"
                  : "Turn on flow export on your devices",
              )}
            </div>
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              role="tablist"
              aria-label={translator.translateText("Device vendor")}
            >
              {guides.map((candidate: TrafficSetupGuideData): ReactElement => {
                const isActive: boolean = candidate.vendor === vendor;

                return (
                  <button
                    key={candidate.vendor}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isActive
                        ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                        : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setVendor(candidate.vendor);
                    }}
                    data-testid={`traffic-setup-vendor-${candidate.vendor}`}
                  >
                    {candidate.vendor === TrafficSetupVendor.Other
                      ? translator.translateText(candidate.label)
                      : candidate.label}
                  </button>
                );
              })}
            </div>
            {guide.vendor === TrafficSetupVendor.Other ? (
              <></>
            ) : (
              <div className="mt-3 text-xs text-gray-500">
                {translator.translateTemplate(
                  "Exports {{format}} to UDP {{port}}.",
                  {
                    format: guide.format,
                    port: guide.port,
                  },
                )}
              </div>
            )}
            <ol
              className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-600"
              data-testid="traffic-setup-steps"
            >
              {guide.steps.map((step: string): ReactElement => {
                return <li key={step}>{translator.translateText(step)}</li>;
              })}
            </ol>
            {configuration ? (
              <div className="mt-3" data-testid="traffic-setup-configuration">
                <CodeBlock code={configuration} language="text" />
              </div>
            ) : (
              <></>
            )}
          </div>
        </li>

        <li className="flex gap-3">
          <StepNumber number={3} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900">
              {translator.translateText(
                props.scope === "device"
                  ? "Traffic appears here"
                  : "Traffic appears here, device by device",
              )}
            </div>
            {props.scope === "device" ? (
              <div className="mt-1 text-sm text-gray-600">
                <p>
                  {translator.translateText(
                    "Records are matched to this device by the address they come from:",
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(props.matchAddresses || []).map(
                    (address: string): ReactElement => {
                      return (
                        <span
                          key={address}
                          className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800"
                          data-testid="traffic-setup-match-address"
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
                  "Flows from a device you have added show on its own Traffic page as well. Flows from an address that is not a device yet show here too, ready to add as a device in one click.",
                )}
              </p>
            )}
            <div className="mt-3 text-sm">
              <Link
                to={getNetworkTrafficDocsUrl()}
                openInNewTab={true}
                className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
              >
                <>
                  {translator.translateText(
                    "Every vendor's commands, and what each can export",
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

export default TrafficSetupGuide;
