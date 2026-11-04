import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";

/*
 * The apps in the connected accounts: what runs on their managed app and
 * container platforms - ECS and Fargate, Cloud Run, App Service and the
 * rest - which App Platforms shows (#5511 split it out of Cloud). Cloud's
 * Overview counts the environments in the accounts its connections read,
 * and their apps, each count a link to its list there, so a reader who
 * came to Cloud for an app finds it one click away. Nothing is drawn while
 * the accounts run none, or when the count cannot be read.
 *
 * App Platforms finds an environment from its telemetry, whatever account
 * it is in, and its lists hold every one: an environment in an account no
 * connection reads is in them too. The card says how many there are of
 * those, so a list that holds more than the count it was opened from says
 * why (#5646's review).
 */

export const APP_PLATFORMS_CARD_TITLE: string = translationKey("App Platforms");
export const APP_PLATFORMS_CARD_DESCRIPTION: string = translationKey(
  "The apps that run in these accounts on managed app and container platforms - ECS, Cloud Run, App Service and more.",
);
export const APP_PLATFORMS_ENVIRONMENTS: PluralTemplate = {
  one: "{{count}} environment",
  other: "{{count}} environments",
};
export const APP_PLATFORMS_APPS: PluralTemplate = {
  one: "{{count}} app",
  other: "{{count}} apps",
};
export const APP_PLATFORMS_OTHER_ENVIRONMENTS: PluralTemplate = {
  one: "The lists also hold {{count}} environment in an account Cloud does not read, and its apps.",
  other:
    "The lists also hold {{count}} environments in accounts Cloud does not read, and their apps.",
};

export interface CloudAppPlatformsCounts {
  // In the accounts Cloud reads.
  environments: number;
  apps: number;
  // In accounts no connection here reads: App Platforms lists them too.
  otherEnvironments: number;
}

// How an account is matched to an environment: its cloud and its id there.
function toAccountKey(provider: string, accountId: string): string {
  return `${(provider || "").toLowerCase()}:${(accountId || "").trim().toLowerCase()}`;
}

/*
 * The environments of the connected accounts - an environment is one per
 * platform, account and Region, named by its own telemetry - and how many
 * apps they run.
 */
export async function fetchCloudAppPlatformsCounts(
  accounts: Array<{ provider: string; accountId: string }>,
): Promise<CloudAppPlatformsCounts> {
  const keys: Set<string> = new Set(
    accounts.map((account: { provider: string; accountId: string }): string => {
      return toAccountKey(account.provider, account.accountId);
    }),
  );

  if (keys.size === 0) {
    return { environments: 0, apps: 0, otherEnvironments: 0 };
  }

  const environments: ListResult<CloudResource> =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        isArchived: false,
        cloudResourceKind: CloudResourceKind.Environment,
      },
      select: { _id: true, cloudProvider: true, cloudAccountId: true },
      sort: {},
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  const listed: Array<CloudResource> = environments.data.filter(
    (environment: CloudResource): boolean => {
      return Boolean(environment._id);
    },
  );
  const ids: Array<ObjectID> = listed
    .filter((environment: CloudResource): boolean => {
      return keys.has(
        toAccountKey(
          (environment.cloudProvider as string) || "",
          (environment.cloudAccountId as string) || "",
        ),
      );
    })
    .map((environment: CloudResource): ObjectID => {
      return new ObjectID(environment._id!.toString());
    });
  const otherEnvironments: number = listed.length - ids.length;

  if (ids.length === 0) {
    return { environments: 0, apps: 0, otherEnvironments };
  }

  const apps: number = await ModelAPI.count({
    modelType: CloudApp,
    query: { cloudResourceId: new Includes(ids) },
  });

  return { environments: ids.length, apps: apps || 0, otherEnvironments };
}

const CountLink: FunctionComponent<{
  to: Route;
  icon: IconProp;
  text: string;
  testId: string;
}> = (props: {
  to: Route;
  icon: IconProp;
  text: string;
  testId: string;
}): ReactElement => {
  return (
    <AppLink
      to={props.to}
      dataTestId={props.testId}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40"
    >
      <Icon icon={props.icon} className="h-4 w-4 flex-none text-indigo-500" />
      <span className="min-w-0 break-words">{props.text}</span>
    </AppLink>
  );
};

export interface ComponentProps {
  accounts: Array<{ provider: string; accountId: string }>;
}

const CloudAppPlatformsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [counts, setCounts] = useState<CloudAppPlatformsCounts | null>(null);
  const accountsKey: string = props.accounts
    .map((account: { provider: string; accountId: string }): string => {
      return toAccountKey(account.provider, account.accountId);
    })
    .sort()
    .join(",");

  useEffect(() => {
    let ignore: boolean = false;

    fetchCloudAppPlatformsCounts(props.accounts)
      .then((found: CloudAppPlatformsCounts): void => {
        if (!ignore) {
          setCounts(found);
        }
      })
      .catch((): void => {
        // A count that cannot be read draws nothing: it only points elsewhere.
        if (!ignore) {
          setCounts(null);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [accountsKey]);

  if (!counts || counts.environments === 0) {
    return <></>;
  }

  return (
    <Card
      title={APP_PLATFORMS_CARD_TITLE}
      description={APP_PLATFORMS_CARD_DESCRIPTION}
    >
      <div
        className="[container-type:inline-size]"
        data-testid="cloud-app-platforms-card"
      >
        <div className="grid grid-cols-1 gap-3 [@container(min-width:28rem)]:grid-cols-2">
          <CountLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENTS] as Route,
            )}
            icon={IconProp.Cloud}
            text={translator.translatePlural(
              APP_PLATFORMS_ENVIRONMENTS,
              counts.environments,
            )}
            testId="cloud-app-platforms-environments"
          />
          <CountLink
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_APPS] as Route,
            )}
            icon={IconProp.Squares}
            text={translator.translatePlural(APP_PLATFORMS_APPS, counts.apps)}
            testId="cloud-app-platforms-apps"
          />
        </div>
        {counts.otherEnvironments > 0 ? (
          <p
            data-testid="cloud-app-platforms-other-environments"
            className="mt-3 text-sm text-gray-500"
          >
            {translator.translatePlural(
              APP_PLATFORMS_OTHER_ENVIRONMENTS,
              counts.otherEnvironments,
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default CloudAppPlatformsCard;
