import { formatServerSetupTime } from "../../../Components/ServerSetup/ServerSetupChecklist";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ServerEmailLogUtil, {
  SERVER_EMAIL_LOG_ROUTE,
  ServerEmailLogAnswer,
  ServerEmailLogEntry,
  ServerEmailLogStatus,
  getServerEmailLogRetentionInDays,
} from "Common/Types/Email/ServerEmailLog";
import { JSONObject } from "Common/Types/JSON";
import ServerSendingWords from "Common/Types/ServerSending/ServerSendingWords";
import { PluralTemplate } from "Common/Types/Translator";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import InvitationLinkModal, {
  INVITATION_LINK_COPY,
  InvitationLinkInvitee,
} from "Common/UI/Components/InvitationLink/InvitationLinkModal";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Card from "Common/UI/Components/Card/Card";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import IconProp from "Common/Types/Icon/IconProp";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import {
  formatInline,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * THE SERVER'S EMAIL LOG, ON SETTINGS > EMAILS (#6878).
 *
 * "Did the password reset go out?" had no answer: an email that belongs to
 * no project left no row anywhere, and the banner only says the last thing
 * the mail server answered. This lists what the server keeps of the emails
 * it sends through its own settings (Types/Email/ServerEmailLog): every one
 * that belongs to no project - a sign-up, a password reset, an invitation,
 * an email to the server's admins - and every one it failed to send, a
 * project's too. Newest first, every email or the failed ones only, a page
 * at a time. Who it went to, what it was, when, and what the mail service
 * said - never the message, and the card says how long it is kept.
 *
 * Master admins only, as the route is: whom an email went to is personal
 * data.
 */

export const SERVER_EMAIL_LOG_CARD_TEST_ID: string = "server-email-log";
export const SERVER_EMAIL_LOG_ENTRY_TEST_ID: string = "server-email-log-entry";
export const SERVER_EMAIL_LOG_FAILED_ONLY_TEST_ID: string =
  "server-email-log-failed-only";
export const SERVER_EMAIL_LOG_SHOW_MORE_TEST_ID: string =
  "server-email-log-show-more";

export const SERVER_EMAIL_LOG_COPY: {
  title: string;
  description: PluralTemplate;
  failedOnly: string;
  sent: string;
  failed: string;
  noProject: string;
  deletedProject: string;
  template: string;
  notSetUp: string;
  noEmailsYet: string;
  noFailedEmails: string;
  showMore: string;
  couldNotLoad: string;
  invitationStillJoins: string;
} = {
  title: translationKey("Email Log"),
  description: {
    one: "Emails this server sent that belong to no project, such as password resets and invitations, and every email it failed to send. Each is kept for {{count}} day, without the message itself.",
    other:
      "Emails this server sent that belong to no project, such as password resets and invitations, and every email it failed to send. Each is kept for {{count}} days, without the message itself.",
  },
  failedOnly: translationKey("Failed emails only"),
  sent: translationKey("Sent"),
  failed: translationKey("Failed"),
  noProject: translationKey("No project"),
  deletedProject: translationKey("A deleted project"),
  template: translationKey("Template: {{name}}"),
  notSetUp: translationKey(
    "Not sent, because email isn't set up under Settings > Emails.",
  ),
  noEmailsYet: translationKey("No emails yet."),
  noFailedEmails: translationKey("No failed emails."),
  showMore: translationKey("Show more"),
  couldNotLoad: translationKey("The email log could not be loaded."),
  // Under an invitation email that was not sent: how the person still gets in (#7169).
  invitationStillJoins: translationKey(
    "They can still join: send them their invitation link yourself.",
  ),
};

// An invitation email's template, as the log names it (ServerEmailLogReader).
export const INVITATION_TEMPLATE_NAME: string =
  EmailTemplateType.InviteMember.replace(/\.hbs$/i, "");

export const SERVER_EMAIL_LOG_INVITATION_LINK_TEST_ID: string =
  "server-email-log-invitation-link";

/*
 * An invitation email the server failed to send, to a project's invitee
 * (#7169): the person never heard of it, so its row offers the link the
 * email would have carried, for the master admin to send them.
 */
export const getUnsentInvitation: (
  entry: ServerEmailLogEntry,
) => InvitationLinkInvitee | null = (
  entry: ServerEmailLogEntry,
): InvitationLinkInvitee | null => {
  if (
    entry.status !== ServerEmailLogStatus.Failed ||
    entry.templateName !== INVITATION_TEMPLATE_NAME ||
    !entry.projectId
  ) {
    return null;
  }

  return { projectId: entry.projectId, email: entry.toEmail };
};

// What a row says it was: OneUptime's own subject, or a project's template.
export const getServerEmailLogWhat: (
  entry: ServerEmailLogEntry,
  translator: Translator,
) => string | null = (
  entry: ServerEmailLogEntry,
  translator: Translator,
): string | null => {
  if (entry.subject) {
    return entry.subject;
  }

  if (entry.templateName) {
    return translator.translateTemplate(SERVER_EMAIL_LOG_COPY.template, {
      name: entry.templateName,
    });
  }

  return null;
};

// Which project a row was sent for, in the reader's words.
export const getServerEmailLogProject: (
  entry: ServerEmailLogEntry,
  translator: Translator,
) => string = (entry: ServerEmailLogEntry, translator: Translator): string => {
  if (!entry.projectId) {
    return (
      translator.translateText(SERVER_EMAIL_LOG_COPY.noProject) ||
      SERVER_EMAIL_LOG_COPY.noProject
    );
  }

  return (
    entry.projectName ||
    translator.translateText(SERVER_EMAIL_LOG_COPY.deletedProject) ||
    SERVER_EMAIL_LOG_COPY.deletedProject
  );
};

/*
 * Why a failed email did not go: the mail service's own words, as it said
 * them, or - when the server's email was never set up - where to set it up.
 */
export const getServerEmailLogReason: (
  entry: ServerEmailLogEntry,
  translator: Translator,
) => string | null = (
  entry: ServerEmailLogEntry,
  translator: Translator,
): string | null => {
  if (entry.status !== ServerEmailLogStatus.Failed) {
    return null;
  }

  if (ServerSendingWords.isServerEmailNotSetUpMessage(entry.statusMessage)) {
    return (
      translator.translateText(SERVER_EMAIL_LOG_COPY.notSetUp) ||
      SERVER_EMAIL_LOG_COPY.notSetUp
    );
  }

  return entry.statusMessage;
};

const readPage: (data: {
  failedOnly: boolean;
  skip: number;
}) => Promise<ServerEmailLogAnswer> = async (data: {
  failedOnly: boolean;
  skip: number;
}): Promise<ServerEmailLogAnswer> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.fetch<JSONObject>({
      method: HTTPMethod.GET,
      url: URL.fromURL(APP_API_URL)
        .addRoute(new Route(SERVER_EMAIL_LOG_ROUTE))
        .addQueryParams(ServerEmailLogUtil.toQueryParams(data)),
    });

  if (response instanceof HTTPErrorResponse || response.isFailure()) {
    throw response;
  }

  const answer: ServerEmailLogAnswer | null = ServerEmailLogUtil.parseAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error(SERVER_EMAIL_LOG_COPY.couldNotLoad);
  }

  return answer;
};

const ServerEmailLogCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  const [failedOnly, setFailedOnly] = useState<boolean>(false);
  const [entries, setEntries] = useState<Array<ServerEmailLogEntry>>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [retentionInDays, setRetentionInDays] = useState<number>(
    getServerEmailLogRetentionInDays(BILLING_ENABLED),
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // The unsent invitation whose link the dialog reads (#7169).
  const [invitationLinkFor, setInvitationLinkFor] =
    useState<InvitationLinkInvitee | null>(null);

  // Bumped by every first page asked for: a page for an older ask is dropped.
  const readRef: MutableRefObject<number> = useRef<number>(0);

  const loadFirstPage: (isFailedOnly: boolean) => Promise<void> = async (
    isFailedOnly: boolean,
  ): Promise<void> => {
    const read: number = readRef.current + 1;
    readRef.current = read;

    setIsLoading(true);
    setError("");

    try {
      const answer: ServerEmailLogAnswer = await readPage({
        failedOnly: isFailedOnly,
        skip: 0,
      });

      if (read !== readRef.current) {
        return;
      }

      setEntries(answer.entries);
      setHasMore(answer.hasMore);
      setRetentionInDays(answer.retentionInDays);
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setEntries([]);
      setHasMore(false);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const loadMore: () => Promise<void> = async (): Promise<void> => {
    const read: number = readRef.current;

    setIsLoadingMore(true);

    try {
      const answer: ServerEmailLogAnswer = await readPage({
        failedOnly: failedOnly,
        skip: entries.length,
      });

      if (read !== readRef.current) {
        return;
      }

      /*
       * Emails sent since the first page push older ones down a page: one
       * already shown is not shown twice.
       */
      const shown: Set<string> = new Set<string>(
        entries.map((entry: ServerEmailLogEntry): string => {
          return entry.id;
        }),
      );

      setEntries([
        ...entries,
        ...answer.entries.filter((entry: ServerEmailLogEntry): boolean => {
          return !shown.has(entry.id);
        }),
      ]);
      setHasMore(answer.hasMore);
    } catch (err) {
      if (read !== readRef.current) {
        return;
      }

      setError(API.getFriendlyMessage(err));
    }

    setIsLoadingMore(false);
  };

  useEffect(() => {
    void loadFirstPage(failedOnly);

    return () => {
      readRef.current += 1;
    };
  }, [failedOnly]);

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <TableSkeleton />;
    }

    if (error && entries.length === 0) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void loadFirstPage(failedOnly);
          }}
        />
      );
    }

    if (entries.length === 0) {
      return (
        <EmptyState
          id="server-email-log-empty"
          icon={IconProp.Email}
          size={EmptyStateSize.Inline}
          title={
            failedOnly
              ? SERVER_EMAIL_LOG_COPY.noFailedEmails
              : SERVER_EMAIL_LOG_COPY.noEmailsYet
          }
          description=""
        />
      );
    }

    return (
      <>
        <ul className="divide-y divide-gray-200">
          {entries.map((entry: ServerEmailLogEntry): ReactElement => {
            const isFailed: boolean =
              entry.status === ServerEmailLogStatus.Failed;
            const what: string | null = getServerEmailLogWhat(
              entry,
              translator,
            );
            const reason: string | null = getServerEmailLogReason(
              entry,
              translator,
            );
            const unsentInvitation: InvitationLinkInvitee | null =
              getUnsentInvitation(entry);

            return (
              <li
                key={entry.id}
                className="min-w-0 py-3"
                data-testid={SERVER_EMAIL_LOG_ENTRY_TEST_ID}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Pill
                    text={
                      isFailed
                        ? SERVER_EMAIL_LOG_COPY.failed
                        : SERVER_EMAIL_LOG_COPY.sent
                    }
                    tone={isFailed ? PillTone.Danger : PillTone.Success}
                  />
                  <span className="min-w-0 break-all text-sm font-medium text-gray-900">
                    {entry.toEmail}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatServerSetupTime(entry.at)}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-gray-600">
                  {formatInline(
                    [
                      ...(what ? [what] : []),
                      getServerEmailLogProject(entry, translator),
                    ],
                    translator,
                  )}
                </p>
                {reason ? (
                  <p className="mt-1 break-words text-xs text-gray-600">
                    {reason}
                  </p>
                ) : (
                  <></>
                )}
                {unsentInvitation ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="text-xs text-gray-600">
                      {translator.translateText(
                        SERVER_EMAIL_LOG_COPY.invitationStillJoins,
                      ) || SERVER_EMAIL_LOG_COPY.invitationStillJoins}
                    </p>
                    <Button
                      title={INVITATION_LINK_COPY.getLink}
                      buttonStyle={ButtonStyleType.OUTLINE}
                      buttonSize={ButtonSize.Small}
                      icon={IconProp.Link}
                      dataTestId={SERVER_EMAIL_LOG_INVITATION_LINK_TEST_ID}
                      onClick={() => {
                        setInvitationLinkFor(unsentInvitation);
                      }}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
        {error ? <ErrorMessage message={error} /> : <></>}
        {hasMore ? (
          <div className="pt-3">
            <Button
              title={SERVER_EMAIL_LOG_COPY.showMore}
              buttonStyle={ButtonStyleType.NORMAL}
              isLoading={isLoadingMore}
              disabled={isLoadingMore}
              dataTestId={SERVER_EMAIL_LOG_SHOW_MORE_TEST_ID}
              onClick={() => {
                void loadMore();
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </>
    );
  };

  return (
    <Card
      title={SERVER_EMAIL_LOG_COPY.title}
      description={translator.translatePlural(
        SERVER_EMAIL_LOG_COPY.description,
        retentionInDays,
      )}
    >
      <div data-testid={SERVER_EMAIL_LOG_CARD_TEST_ID}>
        <div className="pb-3">
          <Toggle
            title={SERVER_EMAIL_LOG_COPY.failedOnly}
            value={failedOnly}
            dataTestId={SERVER_EMAIL_LOG_FAILED_ONLY_TEST_ID}
            onChange={(value: boolean) => {
              setFailedOnly(value);
            }}
          />
        </div>
        {getBody()}
      </div>
      {invitationLinkFor ? (
        <InvitationLinkModal
          invitee={invitationLinkFor}
          onClose={() => {
            setInvitationLinkFor(null);
          }}
        />
      ) : (
        <></>
      )}
    </Card>
  );
};

export default ServerEmailLogCard;
