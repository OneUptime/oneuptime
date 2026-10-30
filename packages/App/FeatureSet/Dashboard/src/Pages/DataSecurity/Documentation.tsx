import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * How Data Security is set up, in the order it is done: a cloud connection
 * and what it may read, the databases a team runs itself, the telemetry
 * that is checked on its own, and where the results land. Each step names
 * the page it is done on; the full guide is in the documentation.
 */

interface SetupStep {
  key: string;
  icon: IconProp;
  title: string;
  description: string;
  linkText: string;
  page: PageMap;
}

const SETUP_STEPS: ReadonlyArray<SetupStep> = [
  {
    key: "connect",
    icon: IconProp.Cloud,
    title: "Connect a cloud account",
    description:
      "Connect AWS, Azure or Google Cloud with read-only access. The connection reads your accounts on a schedule; nothing is installed.",
    linkText: "Connect a cloud",
    page: PageMap.CLOUD_CONNECT,
  },
  {
    key: "access",
    icon: IconProp.Lock,
    title: "Choose what Data Security may read",
    description:
      "In the connection's settings, Data security is Off until you choose. Configuration only reads how each bucket and database is set up and who can reach it - never your data. Configuration and content samples also reads small samples of content to find sensitive data; only counts and masked examples are kept, never the values. Run the command the setting shows to grant that access.",
    linkText: "Open cloud connections",
    page: PageMap.CLOUD_CONNECT,
  },
  {
    key: "databases",
    icon: IconProp.Database,
    title: "Add the databases you run yourself",
    description:
      "A database no cloud lists is added by hand, with a read-only connection string for OneUptime's workers, or from one of your probes inside your network, which keeps the connection string to itself.",
    linkText: "Add a database",
    page: PageMap.DATA_SECURITY_STORES,
  },
  {
    key: "telemetry",
    icon: IconProp.Logs,
    title: "Your telemetry is checked on its own",
    description:
      "The logs, traces, exceptions, session replays and AI conversations your services send are scanned for sensitive data as well. Scrub It masks what is found at ingest, from then on.",
    linkText: "See your telemetry",
    page: PageMap.DATA_SECURITY_TELEMETRY,
  },
  {
    key: "review",
    icon: IconProp.ShieldExclamation,
    title: "Fix what matters first",
    description:
      "Each store's checks open issues, riskiest first. Owner rules send each store's issues to the people and teams who own it.",
    linkText: "See issues",
    page: PageMap.DATA_SECURITY_ISSUES,
  },
];

const DataSecurityDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Fragment>
      <Card
        title="What is Data Security?"
        description="Where your sensitive data lives, who can reach it, and what to fix first."
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            {translator.translateText(
              "Data Security finds the buckets, databases and warehouses in your clouds, and the telemetry your services send OneUptime, and works out which of them hold sensitive data: card numbers, personal data, health records, secrets. It reads how each one is set up and who can reach it, and opens an issue when something puts that data at risk - a public bucket, an unencrypted database, card numbers in your logs.",
            )}
          </p>
          <p>
            {translator.translateText(
              "Everything it reads is read-only, and it keeps no copy of your data: what it keeps of a finding is how many values matched and a few masked examples.",
            )}
          </p>
        </div>
      </Card>

      <Card
        title="Set It Up"
        description="What to do, in order, and the page each step is done on."
      >
        <ol className="divide-y divide-gray-100">
          {SETUP_STEPS.map((step: SetupStep): ReactElement => {
            return (
              <li
                key={step.key}
                className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
                    <Icon icon={step.icon} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {translator.translateText(step.title)}
                    </p>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {translator.translateText(step.description)}
                    </p>
                  </div>
                </div>
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[step.page] as Route,
                  )}
                  className="ml-11 inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 sm:ml-0"
                >
                  <>
                    <span>{translator.translateText(step.linkText)}</span>
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="h-3.5 w-3.5"
                    />
                  </>
                </AppLink>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card
        title="Full Documentation"
        description="What every check looks for, how each cloud's access is granted, and the API."
      >
        <Link
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          openInNewTab={true}
          to={URL.fromString(`${DOCS_URL.toString()}/data-security/index`)}
        >
          <>
            <Icon icon={IconProp.Book} className="h-4 w-4" />
            <span>
              {translator.translateText("Read the Data Security guide")}
            </span>
          </>
        </Link>
      </Card>
    </Fragment>
  );
};

export default DataSecurityDocumentation;
