import {
  NetworkQuickAction,
  getNetworkQuickActionRoute,
} from "./NetworkQuickActions";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the Network Overview shows before there is anything on it: the two
 * ways in, side by side, each one click from its form.
 *
 *   - Discover devices: scan an address range and pick what to add - for a
 *     whole network at once.
 *   - Add one device: by its IP address or hostname - for the one switch or
 *     router someone came to add.
 *
 * Each choice says who it is for, so nobody has to know what a "discovery
 * scan" is to pick the right one. Both open their form straight away (the
 * quick-action links, NetworkQuickActions), rather than a list with a button
 * on it somewhere.
 */

interface GetStartedChoice {
  action: NetworkQuickAction;
  icon: IconProp;
  title: string;
  description: string;
  actionText: string;
  dataTestId: string;
}

const CHOICES: Array<GetStartedChoice> = [
  {
    action: NetworkQuickAction.DiscoverDevices,
    icon: IconProp.Search,
    title: "Discover devices",
    description:
      "Scan an address range, see what answers, and pick the devices to add. Best for a whole network or a new site.",
    actionText: "Start a scan",
    dataTestId: "network-get-started-discover",
  },
  {
    action: NetworkQuickAction.AddDevice,
    icon: IconProp.Add,
    title: "Add one device",
    description:
      "Add a switch, router, firewall or anything else by its IP address or hostname.",
    actionText: "Add a device",
    dataTestId: "network-get-started-add",
  },
];

const NetworkGetStarted: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Card
      title="Bring your network in"
      description="See every switch, router and firewall you run - whether it is up, how it is wired, and when something goes wrong."
    >
      <div
        data-testid="network-get-started"
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        {CHOICES.map((choice: GetStartedChoice): ReactElement => {
          return (
            <button
              key={choice.action}
              type="button"
              data-testid={choice.dataTestId}
              className="group flex h-full flex-col items-start rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-gray-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              onClick={() => {
                Navigation.navigate(getNetworkQuickActionRoute(choice.action));
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
                <Icon icon={choice.icon} className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="mt-4 text-base font-semibold text-gray-900">
                {translator.translateText(choice.title)}
              </div>
              <div className="mt-1 flex-1 text-sm text-gray-500">
                {translator.translateText(choice.description)}
              </div>
              <div className="mt-4 flex items-center gap-1 text-sm font-medium text-indigo-600">
                {translator.translateText(choice.actionText)}
                <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-5 text-sm text-gray-500">
        {translator.translateText(
          "Every device is pinged by a probe on its network, so it has a status within minutes. Give it SNMP credentials and you also see its interfaces, traffic and health.",
        )}
      </p>
    </Card>
  );
};

export default NetworkGetStarted;
