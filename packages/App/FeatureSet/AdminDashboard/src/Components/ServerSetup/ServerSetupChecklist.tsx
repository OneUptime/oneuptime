import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { BILLING_ENABLED, HTTP_PROTOCOL } from "Common/UI/Config";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT A SELF-HOSTED SERVER NEEDS BEFORE PEOPLE RELY ON IT.
 *
 * A new install's admin landed on the Users list and had to find out for
 * themselves, from the Docker Compose guide's production checklist, that
 * the server could not send a single email, that everything crossed the
 * network unencrypted, and that anyone who could open it could sign up
 * (#5229's follow-ups). This card, at the top of the Admin Dashboard's first
 * page, says where each of the three stands and opens the place that
 * changes it:
 *
 *   - Email: a mail server (Custom SMTP, or SendGrid) is set up, so OneUptime
 *     can send invitations, password resets and alerts by email;
 *   - HTTPS: people reach the server over HTTPS and HTTP_PROTOCOL=https;
 *   - Sign-ups: whether anyone who can open the server can sign up, the
 *     guide's advice being to turn that off once the team has its accounts.
 *
 * It is drawn only on a self-hosted server (OneUptime Cloud's master admins
 * run neither its mail nor its HTTPS this way), only while one of the three
 * is still open, and not once its admin hides it in this browser. A read
 * that fails draws nothing: the card only ever helps.
 */

export enum ServerSetupItemName {
  Email = "email",
  Https = "https",
  Signups = "signups",
}

export interface ServerSetupState {
  emailIsSetUp: boolean;
  isServedOverHttps: boolean;
  /*
   * The page came over HTTPS while OneUptime is still set to HTTP: a proxy
   * in front encrypts the connection, and only HTTP_PROTOCOL is left.
   */
  isHttpsOnlyBeforeOneUptime?: boolean | undefined;
  signupsAreClosed: boolean;
}

export interface ServerSetupItem {
  name: ServerSetupItemName;
  isDone: boolean;
  title: string;
  description: string;
  actionTitle: string;
  // A page of the Admin Dashboard, or a guide opened in a new tab.
  route?: Route | undefined;
  guideUrl?: string | undefined;
}

// Where the browser remembers that this server's admin hid the card.
export const SERVER_SETUP_HIDDEN_STORAGE_KEY: string =
  "admin-dashboard-server-setup-hidden";

// The guide's section on HTTPS, for Docker Compose and the Helm chart alike.
export const SERVER_SETUP_HTTPS_GUIDE: string =
  "/docs/installation/docker-compose#set-up-https";

export const SERVER_SETUP_COPY: {
  title: string;
  description: string;
  hide: string;
  email: {
    title: string;
    done: string;
    open: string;
    action: string;
  };
  https: {
    title: string;
    done: string;
    open: string;
    onlyBeforeOneUptime: string;
    action: string;
  };
  signups: {
    title: string;
    done: string;
    open: string;
    action: string;
  };
  doneLabel: string;
  openLabel: string;
  opensInNewTab: string;
} = {
  title: "Finish setting up this server",
  description: "Most servers need these three before people rely on them.",
  hide: "Hide",
  email: {
    title: "Email",
    done: "Set up: OneUptime sends invitations, password resets and alerts by email.",
    open: "Not set up yet: OneUptime cannot send invitations, password resets or alerts by email.",
    action: "Set up email",
  },
  https: {
    title: "HTTPS",
    done: "People reach this server over HTTPS.",
    open: "Not set up yet: passwords and sessions cross the network unencrypted, and passkeys need HTTPS.",
    onlyBeforeOneUptime:
      "Almost: this page came over HTTPS, but OneUptime is still set to HTTP, so the links it sends start with http://. Set HTTP_PROTOCOL=https.",
    action: "How to set up HTTPS",
  },
  signups: {
    title: "Sign-ups",
    done: "Only people you invite can create an account.",
    open: "Anyone who can open this server can create an account. Turn this off once your team has its accounts.",
    action: "Choose who can sign up",
  },
  doneLabel: "Done",
  openLabel: "Still to do",
  opensInNewTab: "Opens in a new tab",
};

/*
 * Whether the server can send email: the mail server it is set to send
 * through has its address and its sender. An instance that never picked one
 * sends through Custom SMTP, as the Email settings page reads it.
 */
export const isEmailSetUp: (config: {
  emailServerType?: EmailServerType | undefined;
  smtpHost?: unknown;
  smtpFromEmail?: unknown;
  sendgridFromEmail?: unknown;
}) => boolean = (config: {
  emailServerType?: EmailServerType | undefined;
  smtpHost?: unknown;
  smtpFromEmail?: unknown;
  sendgridFromEmail?: unknown;
}): boolean => {
  const isSet: (value: unknown) => boolean = (value: unknown): boolean => {
    return Boolean(value && String(value).trim());
  };

  if (config.emailServerType === EmailServerType.Sendgrid) {
    return isSet(config.sendgridFromEmail);
  }

  return isSet(config.smtpHost) && isSet(config.smtpFromEmail);
};

/*
 * Whether people reach the server over HTTPS: OneUptime is told so
 * (HTTP_PROTOCOL=https, which its links and cookies follow) and this page
 * came over HTTPS. A page that came over HTTPS to a server still set to HTTP
 * - a proxy in front that nobody told OneUptime about - is not done.
 */
export const isServedOverHttps: (
  httpProtocol: Protocol,
  pageProtocol: string,
) => boolean = (httpProtocol: Protocol, pageProtocol: string): boolean => {
  return httpProtocol === Protocol.HTTPS && pageProtocol === "https:";
};

/*
 * A proxy in front of OneUptime answers over HTTPS, and nobody told
 * OneUptime: the connection is encrypted, but the links OneUptime sends and
 * its sign-in cookies still say HTTP. The card says exactly that - not that
 * passwords cross the network unencrypted, which here they do not.
 */
export const isHttpsOnlyBeforeOneUptime: (
  httpProtocol: Protocol,
  pageProtocol: string,
) => boolean = (httpProtocol: Protocol, pageProtocol: string): boolean => {
  return httpProtocol !== Protocol.HTTPS && pageProtocol === "https:";
};

export const getServerSetupItems: (
  state: ServerSetupState,
) => Array<ServerSetupItem> = (
  state: ServerSetupState,
): Array<ServerSetupItem> => {
  return [
    {
      name: ServerSetupItemName.Email,
      isDone: state.emailIsSetUp,
      title: SERVER_SETUP_COPY.email.title,
      description: state.emailIsSetUp
        ? SERVER_SETUP_COPY.email.done
        : SERVER_SETUP_COPY.email.open,
      actionTitle: SERVER_SETUP_COPY.email.action,
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_SMTP] as Route,
      ),
    },
    {
      name: ServerSetupItemName.Https,
      isDone: state.isServedOverHttps,
      title: SERVER_SETUP_COPY.https.title,
      description: state.isServedOverHttps
        ? SERVER_SETUP_COPY.https.done
        : state.isHttpsOnlyBeforeOneUptime
          ? SERVER_SETUP_COPY.https.onlyBeforeOneUptime
          : SERVER_SETUP_COPY.https.open,
      actionTitle: SERVER_SETUP_COPY.https.action,
      guideUrl: SERVER_SETUP_HTTPS_GUIDE,
    },
    {
      name: ServerSetupItemName.Signups,
      isDone: state.signupsAreClosed,
      title: SERVER_SETUP_COPY.signups.title,
      description: state.signupsAreClosed
        ? SERVER_SETUP_COPY.signups.done
        : SERVER_SETUP_COPY.signups.open,
      actionTitle: SERVER_SETUP_COPY.signups.action,
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
      ),
    },
  ];
};

const readHidden: () => boolean = (): boolean => {
  try {
    return LocalStorage.getItem(SERVER_SETUP_HIDDEN_STORAGE_KEY) === true;
  } catch {
    // Storage the browser does not allow: the card shows.
    return false;
  }
};

const rememberHidden: () => void = (): void => {
  try {
    LocalStorage.setItem(SERVER_SETUP_HIDDEN_STORAGE_KEY, true);
  } catch {
    // Hidden for this visit only.
  }
};

export interface ComponentProps {
  // For tests: the protocol this page came over (window.location.protocol).
  pageProtocol?: string | undefined;
}

const ServerSetupChecklist: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<ServerSetupState | null>(null);
  const [isHidden, setIsHidden] = useState<boolean>(readHidden);

  useEffect(() => {
    if (BILLING_ENABLED || isHidden) {
      return;
    }

    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        // Only what the three answers need: never a password or a key.
        const config: GlobalConfig | null =
          await ModelAPI.getItem<GlobalConfig>({
            modelType: GlobalConfig,
            id: ObjectID.getZeroObjectID(),
            select: {
              _id: true,
              emailServerType: true,
              smtpHost: true,
              smtpFromEmail: true,
              sendgridFromEmail: true,
              disableSignup: true,
            },
          });

        if (!isCurrent || !config) {
          return;
        }

        const pageProtocol: string =
          props.pageProtocol || window.location.protocol;

        setState({
          emailIsSetUp: isEmailSetUp(config),
          isServedOverHttps: isServedOverHttps(HTTP_PROTOCOL, pageProtocol),
          isHttpsOnlyBeforeOneUptime: isHttpsOnlyBeforeOneUptime(
            HTTP_PROTOCOL,
            pageProtocol,
          ),
          signupsAreClosed: config.disableSignup === true,
        });
      } catch {
        // Nothing to say: the card only ever helps.
      }
    };

    load().catch(() => {
      // handled above
    });

    return () => {
      isCurrent = false;
    };
  }, [isHidden]);

  if (BILLING_ENABLED || isHidden || !state) {
    return <></>;
  }

  const items: Array<ServerSetupItem> = getServerSetupItems(state);

  if (
    items.every((item: ServerSetupItem): boolean => {
      return item.isDone;
    })
  ) {
    return <></>;
  }

  return (
    <div data-testid="server-setup-checklist">
      <Card
        title={SERVER_SETUP_COPY.title}
        description={SERVER_SETUP_COPY.description}
        buttons={[
          {
            title: SERVER_SETUP_COPY.hide,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.EyeSlash,
            onClick: () => {
              rememberHidden();
              setIsHidden(true);
            },
          },
        ]}
      >
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {items.map((item: ServerSetupItem): ReactElement => {
            return (
              <li
                key={item.name}
                data-testid={`server-setup-${item.name}`}
                data-done={item.isDone ? "true" : "false"}
                className="flex flex-col gap-3 py-4 last:pb-0 sm:flex-row sm:items-start"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${
                      item.isDone
                        ? "bg-green-50 text-green-600"
                        : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    <Icon
                      icon={
                        item.isDone
                          ? IconProp.CheckCircle
                          : IconProp.ExclaimationCircle
                      }
                      className="h-4 w-4"
                    />
                    <span className="sr-only">
                      {translator.translateText(
                        item.isDone
                          ? SERVER_SETUP_COPY.doneLabel
                          : SERVER_SETUP_COPY.openLabel,
                      )}
                    </span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {translator.translateText(item.title)}
                    </p>
                    <p className="mt-0.5 text-sm text-gray-500 text-pretty">
                      {translator.translateText(item.description)}
                    </p>
                  </div>
                </div>
                {item.isDone ? (
                  <></>
                ) : (
                  <Link
                    to={
                      item.route ||
                      (item.guideUrl
                        ? URL.fromString(
                            `${window.location.origin}${item.guideUrl}`,
                          )
                        : undefined)
                    }
                    openInNewTab={Boolean(item.guideUrl)}
                    dataTestId={`server-setup-${item.name}-action`}
                    className="ml-9 inline-flex flex-none items-center self-start rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:ml-0"
                  >
                    {translator.translateText(item.actionTitle)}
                    {/* A guide opens in a tab of its own, and says so. */}
                    {item.guideUrl ? (
                      <>
                        <Icon
                          icon={IconProp.ExternalLink}
                          className="ms-1.5 h-3.5 w-3.5 text-gray-400"
                          data-testid={`server-setup-${item.name}-new-tab`}
                        />
                        <span className="sr-only">
                          {` (${translator.translateText(
                            SERVER_SETUP_COPY.opensInNewTab,
                          )})`}
                        </span>
                      </>
                    ) : (
                      <></>
                    )}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default ServerSetupChecklist;
