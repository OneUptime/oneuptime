import PageComponentProps from "../PageComponentProps";
import { getFirewallName } from "./BlocklistFeeds";
import {
  RotatedFeedSecret,
  revokeFeedSecret,
  rotateFeedSecret,
  takeSecretForFeed,
} from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedApi";
import {
  getBlocklistFeedFormFields,
  getFeedStatus,
} from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedFields";
import BlocklistFeedSetupCard from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedSetupCard";
import {
  ALLOWLIST_FIELD_TITLE,
  ANSWER_COLUMN_TITLE,
  ANY_ADDRESS,
  AUTHENTICATION_LABELS,
  BLOCKLIST_FEEDS_TEST_IDS,
  DETAILS_CARD_TITLE,
  ENTRIES_COLUMN_TITLE,
  ENTRIES_FIELD_TITLE,
  FAMILY_FIELD_TITLE,
  FAMILY_LABELS,
  FETCHED_AT_COLUMN_TITLE,
  FETCHED_WITH_COLUMN_TITLE,
  FETCHES_EMPTY_DESCRIPTION,
  FETCHES_EMPTY_TITLE,
  FETCHES_EVERY_FIELD_TITLE,
  FETCHES_TABLE_DESCRIPTION,
  FETCHES_TABLE_TITLE,
  FETCH_PLURAL,
  FEED_NOT_FOUND,
  FETCH_SINGULAR,
  FILE_COLUMN_TITLE,
  FIREWALL_FIELD_TITLE,
  FROM_COLUMN_TITLE,
  LAST_FETCHED_FIELD_TITLE,
  LAST_FETCHED_FROM,
  LIST_CHANGED,
  LIST_NOT_CHANGED,
  LIST_SENT,
  NAME_FIELD_TITLE,
  NEVER_FETCHED,
  NOT_FETCHED_SENTENCE,
  PREVIOUS_SECRET_USED,
  PREVIOUS_SECRET_USED_TOOLTIP,
  PREVIOUS_SECRET_WORKS_UNTIL,
  REVOKED_SENTENCE,
  REVOKE_SECRET,
  REVOKE_SECRET_DESCRIPTION,
  ROTATE_SECRET,
  ROTATE_SECRET_DESCRIPTION,
  SECRET_DONE,
  SECRET_ENDS_IN,
  SECRET_FIELD_TITLE,
  SECRET_REVOKED,
  SECRET_ROTATED,
  SECRET_SENT_AS_COLUMN_TITLE,
  SECRET_SHOWN_ONCE_DESCRIPTION,
  SECRET_SHOWN_ONCE_TITLE,
  STOPPED_READING_SENTENCE,
} from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedsCopy";
import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { formatCompactDurationInMinutes } from "../../Utils/CompactDuration";
import SecurityBlocklistFeed from "Common/Models/DatabaseModels/SecurityBlocklistFeed";
import SecurityBlocklistFeedFetch from "Common/Models/DatabaseModels/SecurityBlocklistFeedFetch";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedStatus,
  isPreviousSecurityBlocklistFeedSecretInGrace,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import { SecurityBlocklistFeedAuthentication } from "Common/Types/SecurityBlocklist/SecurityBlocklistFeedSetup";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import ShownOnceSecretModal from "Common/UI/Components/ShownOnceSecret/ShownOnceSecretModal";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * ONE BLOCKLIST FEED (#10345), the important thing first: whether its
 * firewall reads it - and if it stopped, since when - then how to set a
 * firewall up to read it, the feed itself with its secret's hint, every
 * fetch of the last 30 days, and last, revoking its secret and deleting it.
 *
 * Its secret is shown once: right after the feed is made (the list hands
 * the create's answer here) or its secret is rotated, in a dialog Done
 * closes, and in the setup steps while the page stays open. OneUptime keeps
 * only its hash, so a reload, another tab or a coworker's view never sees
 * it again: they see where the secret goes, and Rotate Secret.
 *
 * Inside the Security Events menu, Blocklist Feeds lit; its crumb names the
 * feed once it is read.
 */

const FEED_SELECT: {
  _id: true;
  name: true;
  firewall: true;
  family: true;
  allowedSourceAddresses: true;
  secretHint: true;
  secretMadeAt: true;
  previousSecretExpiresAt: true;
  revokedAt: true;
  lastFetchedAt: true;
  lastFetchSourceIp: true;
  lastFetchUserAgent: true;
  usualFetchIntervalInSeconds: true;
  servedCount: true;
} = {
  _id: true,
  name: true,
  firewall: true,
  family: true,
  allowedSourceAddresses: true,
  secretHint: true,
  secretMadeAt: true,
  previousSecretExpiresAt: true,
  revokedAt: true,
  lastFetchedAt: true,
  lastFetchSourceIp: true,
  lastFetchUserAgent: true,
  usualFetchIntervalInSeconds: true,
  servedCount: true,
};

const SecurityBlocklistFeedViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const feedId: ObjectID = Navigation.getLastParamAsObjectID();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [feed, setFeed] = useState<SecurityBlocklistFeed | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [canRetry, setCanRetry] = useState<boolean>(false);

  // The secret, while this page holds it: the create's or a rotation's answer.
  const [secret, setSecret] = useState<string | null>(() => {
    return takeSecretForFeed(feedId);
  });
  const [isSecretShown, setIsSecretShown] = useState<boolean>(Boolean(secret));

  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [isRevoking, setIsRevoking] = useState<boolean>(false);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const item: SecurityBlocklistFeed | null =
        await ModelAPI.getItem<SecurityBlocklistFeed>({
          modelType: SecurityBlocklistFeed,
          id: feedId,
          select: FEED_SELECT,
        });

      setFeed(item);
      setCanRetry(false);
      setError(
        item ? "" : translator.translateText(FEED_NOT_FOUND) || FEED_NOT_FOUND,
      );
    } catch (err) {
      setCanRetry(true);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoaded(true);
  }, [feedId.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Security Events > Playbooks > Blocklist Feeds > Palo Alto feed", once it is read.
  const breadcrumbs: Array<Link> | null = useMemo(() => {
    return (
      nameRecordInTrail({
        links: getSecurityEventsBreadcrumbs(path),
        recordId: feedId.toString(),
        recordName: feed?.name,
      }) || null
    );
  }, [path, feedId.toString(), feed?.name]);

  usePageBreadcrumbLinks(feed?.name ? breadcrumbs : null);

  if (!isLoaded) {
    return <PageSkeleton shape="table" />;
  }

  if (error || !feed) {
    return (
      <ErrorMessage
        message={error || FEED_NOT_FOUND}
        onRefreshClick={
          canRetry
            ? () => {
                setIsLoaded(false);
                setError("");
                void load();
              }
            : undefined
        }
      />
    );
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const status: SecurityBlocklistFeedStatus = getFeedStatus(feed, now);

  const rotate: () => Promise<void> = async (): Promise<void> => {
    setIsWorking(true);
    setActionError("");

    try {
      const made: RotatedFeedSecret = await rotateFeedSecret(feedId);

      setSecret(made.secret);
      setIsSecretShown(true);
      setIsRotating(false);
      Toast.success(translator.translateText(SECRET_ROTATED) || SECRET_ROTATED);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsWorking(false);
  };

  const revoke: () => Promise<void> = async (): Promise<void> => {
    setIsWorking(true);
    setActionError("");

    try {
      await revokeFeedSecret(feedId);

      setSecret(null);
      setIsRevoking(false);
      Toast.success(translator.translateText(SECRET_REVOKED) || SECRET_REVOKED);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsWorking(false);
  };

  const rotateButton: CardButtonSchema | null = PermissionGate.gateCardButton(
    {
      title: ROTATE_SECRET,
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Refresh,
      onClick: (): void => {
        setActionError("");
        setIsRotating(true);
      },
    },
    new SecurityBlocklistFeed(),
    ModelAction.Update,
  );

  const revokeButton: CardButtonSchema | null = feed.secretHint
    ? PermissionGate.gateCardButton(
        {
          title: REVOKE_SECRET,
          buttonStyle: ButtonStyleType.DANGER_OUTLINE,
          icon: IconProp.Close,
          onClick: (): void => {
            setActionError("");
            setIsRevoking(true);
          },
        },
        new SecurityBlocklistFeed(),
        ModelAction.Update,
      )
    : null;

  return (
    <Fragment>
      {isSecretShown && secret ? (
        <ShownOnceSecretModal
          title={SECRET_SHOWN_ONCE_TITLE}
          description={SECRET_SHOWN_ONCE_DESCRIPTION}
          doneButtonText={SECRET_DONE}
          secret={secret}
          onDone={() => {
            setIsSecretShown(false);
          }}
        />
      ) : (
        <></>
      )}

      <div className="space-y-6">
        {status === SecurityBlocklistFeedStatus.StoppedReading &&
        feed.lastFetchedAt ? (
          <Alert
            type={AlertType.DANGER}
            dataTestId={BLOCKLIST_FEEDS_TEST_IDS.statusNotice}
            title={translator.translateTemplate(STOPPED_READING_SENTENCE, {
              time: OneUptimeDate.fromNow(new Date(feed.lastFetchedAt), now),
            })}
          />
        ) : (
          <></>
        )}

        {status === SecurityBlocklistFeedStatus.NotSetUp ? (
          <Alert
            type={AlertType.INFO}
            dataTestId={BLOCKLIST_FEEDS_TEST_IDS.statusNotice}
            title={
              translator.translateText(NOT_FETCHED_SENTENCE) ||
              NOT_FETCHED_SENTENCE
            }
          />
        ) : (
          <></>
        )}

        {status === SecurityBlocklistFeedStatus.Revoked ? (
          <Alert
            type={AlertType.WARNING}
            dataTestId={BLOCKLIST_FEEDS_TEST_IDS.statusNotice}
            title={
              translator.translateText(REVOKED_SENTENCE) || REVOKED_SENTENCE
            }
          />
        ) : (
          <></>
        )}

        <BlocklistFeedSetupCard
          key={feed.firewall || ""}
          feedId={feedId.toString()}
          firewall={feed.firewall}
          secret={secret}
        />

        <CardModelDetail<SecurityBlocklistFeed>
          name="Security Events > Blocklist Feed"
          cardProps={{
            title: DETAILS_CARD_TITLE,
            buttons: rotateButton ? [rotateButton] : [],
          }}
          isEditable={true}
          editButtonText="Edit"
          formFields={getBlocklistFeedFormFields({ translator })}
          onSaveSuccess={() => {
            void load();
          }}
          modelDetailProps={{
            modelType: SecurityBlocklistFeed,
            id: "security-blocklist-feed-detail",
            modelId: feedId,
            showDetailsInNumberOfColumns: 2,
            style: DetailStyle.Compact,
            fields: [
              {
                field: { name: true },
                title: NAME_FIELD_TITLE,
                fieldType: FieldType.Text,
              },
              {
                field: { firewall: true },
                title: FIREWALL_FIELD_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: SecurityBlocklistFeed): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {getFirewallName(translator, item.firewall)}
                    </span>
                  );
                },
              },
              {
                field: { family: true },
                title: FAMILY_FIELD_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: SecurityBlocklistFeed): ReactElement => {
                  return (
                    <span className="text-sm text-gray-900">
                      {translator.translateText(
                        FAMILY_LABELS[
                          item.family || SecurityBlocklistFeedFamily.Both
                        ],
                      )}
                    </span>
                  );
                },
              },
              {
                field: { allowedSourceAddresses: true },
                title: ALLOWLIST_FIELD_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: SecurityBlocklistFeed): ReactElement => {
                  return item.allowedSourceAddresses ? (
                    <span
                      className="whitespace-pre-line break-all font-mono text-sm text-gray-900"
                      dir="ltr"
                    >
                      {item.allowedSourceAddresses}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-700">
                      {translator.translateText(ANY_ADDRESS)}
                    </span>
                  );
                },
              },
              {
                field: { secretHint: true },
                title: SECRET_FIELD_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: SecurityBlocklistFeed): ReactElement => {
                  if (!item.secretHint) {
                    return (
                      <Pill text={SECRET_REVOKED} tone={PillTone.Paused} />
                    );
                  }

                  return (
                    <div className="text-sm text-gray-900">
                      {translator.translateTemplate(SECRET_ENDS_IN, {
                        hint: item.secretHint,
                      })}
                      {isPreviousSecurityBlocklistFeedSecretInGrace({
                        previousSecretExpiresAt: item.previousSecretExpiresAt,
                        now,
                      }) ? (
                        <span className="mt-0.5 block text-xs text-gray-500">
                          {translator.translateTemplate(
                            PREVIOUS_SECRET_WORKS_UNTIL,
                            {
                              time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                                new Date(item.previousSecretExpiresAt!),
                              ),
                            },
                          )}
                        </span>
                      ) : (
                        <></>
                      )}
                    </div>
                  );
                },
              },
              {
                field: { lastFetchedAt: true },
                title: LAST_FETCHED_FIELD_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: SecurityBlocklistFeed): ReactElement => {
                  if (!item.lastFetchedAt) {
                    return (
                      <span className="text-sm text-gray-700">
                        {translator.translateText(NEVER_FETCHED)}
                      </span>
                    );
                  }

                  const time: string = OneUptimeDate.fromNow(
                    new Date(item.lastFetchedAt),
                    now,
                  );

                  return (
                    <span className="text-sm text-gray-900">
                      {item.lastFetchSourceIp
                        ? translator.translateTemplate(LAST_FETCHED_FROM, {
                            time,
                            address: item.lastFetchSourceIp,
                          })
                        : time}
                    </span>
                  );
                },
              },
              {
                field: { usualFetchIntervalInSeconds: true },
                title: FETCHES_EVERY_FIELD_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: SecurityBlocklistFeed): ReactElement => {
                  return typeof item.usualFetchIntervalInSeconds ===
                    "number" ? (
                    <span className="text-sm text-gray-900">
                      {formatCompactDurationInMinutes(
                        Math.max(
                          1,
                          Math.round(item.usualFetchIntervalInSeconds / 60),
                        ),
                        translator.language,
                      )}
                    </span>
                  ) : (
                    <TableEmptyValue />
                  );
                },
              },
              {
                field: { servedCount: true },
                title: ENTRIES_FIELD_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: SecurityBlocklistFeed): ReactElement => {
                  return typeof item.servedCount === "number" ? (
                    <span className="text-sm text-gray-900">
                      {translator.formatNumber(item.servedCount)}
                    </span>
                  ) : (
                    <TableEmptyValue />
                  );
                },
              },
              {
                // The feed's line: its ID, who created it and who last changed it.
                field: { _id: true },
                title: "ID",
                fieldType: FieldType.ObjectID,
              },
            ],
          }}
        />

        <ModelTable<SecurityBlocklistFeedFetch>
          modelType={SecurityBlocklistFeedFetch}
          id={BLOCKLIST_FEEDS_TEST_IDS.fetchesTable}
          name="Security Events > Blocklist Feed > Fetches"
          userPreferencesKey={BLOCKLIST_FEEDS_TEST_IDS.fetchesTable}
          singularName={FETCH_SINGULAR}
          pluralName={FETCH_PLURAL}
          query={{ securityBlocklistFeedId: feedId }}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          sortBy="fetchedAt"
          sortOrder={SortOrder.Descending}
          cardProps={{
            title: FETCHES_TABLE_TITLE,
            description: FETCHES_TABLE_DESCRIPTION,
          }}
          emptyState={{
            title: FETCHES_EMPTY_TITLE,
            description: FETCHES_EMPTY_DESCRIPTION,
            icon: IconProp.CloudArrowDown,
          }}
          showRefreshButton={true}
          filters={[]}
          selectMoreFields={{
            isChanged: true,
            usedPreviousSecret: true,
            authMethod: true,
          }}
          columns={[
            {
              field: { fetchedAt: true },
              title: FETCHED_AT_COLUMN_TITLE,
              type: FieldType.DateTime,
            },
            {
              field: { sourceIp: true },
              title: FROM_COLUMN_TITLE,
              type: FieldType.Element,
              getElement: (fetch: SecurityBlocklistFeedFetch): ReactElement => {
                return fetch.sourceIp ? (
                  <span className="font-mono text-sm text-gray-900" dir="ltr">
                    {fetch.sourceIp}
                  </span>
                ) : (
                  <TableEmptyValue />
                );
              },
            },
            {
              field: { userAgent: true },
              title: FETCHED_WITH_COLUMN_TITLE,
              type: FieldType.Element,
              hideOnMobile: true,
              wrapContent: true,
              wrapMaxWidthClassName: "max-w-[14rem]",
              getElement: (fetch: SecurityBlocklistFeedFetch): ReactElement => {
                return fetch.userAgent ? (
                  <span className="break-all text-sm text-gray-700">
                    {fetch.userAgent}
                  </span>
                ) : (
                  <TableEmptyValue />
                );
              },
            },
            {
              field: { file: true },
              title: FILE_COLUMN_TITLE,
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (fetch: SecurityBlocklistFeedFetch): ReactElement => {
                return (
                  <span className="font-mono text-xs text-gray-700" dir="ltr">
                    {fetch.file || ""}
                  </span>
                );
              },
            },
            {
              field: { authMethod: true },
              title: SECRET_SENT_AS_COLUMN_TITLE,
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (fetch: SecurityBlocklistFeedFetch): ReactElement => {
                const label: string | undefined =
                  AUTHENTICATION_LABELS[readAuthentication(fetch.authMethod)];

                return (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-sm text-gray-700">
                      {translator.translateText(label || "")}
                    </span>
                    {fetch.usedPreviousSecret ? (
                      <Pill
                        text={PREVIOUS_SECRET_USED}
                        tone={PillTone.Warning}
                        tooltip={PREVIOUS_SECRET_USED_TOOLTIP}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              field: { statusCode: true },
              title: ANSWER_COLUMN_TITLE,
              type: FieldType.Element,
              getElement: (fetch: SecurityBlocklistFeedFetch): ReactElement => {
                return (
                  <div className="flex flex-wrap items-center gap-1">
                    <Pill
                      text={
                        fetch.statusCode === 304 ? LIST_NOT_CHANGED : LIST_SENT
                      }
                      tone={PillTone.Neutral}
                      isDotHidden={true}
                    />
                    {fetch.isChanged && fetch.statusCode !== 304 ? (
                      <Pill
                        text={LIST_CHANGED}
                        tone={PillTone.Info}
                        isDotHidden={true}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
            {
              field: { entryCount: true },
              title: ENTRIES_COLUMN_TITLE,
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (fetch: SecurityBlocklistFeedFetch): ReactElement => {
                return typeof fetch.entryCount === "number" ? (
                  <span className="text-sm text-gray-700">
                    {translator.formatNumber(fetch.entryCount)}
                  </span>
                ) : (
                  <TableEmptyValue />
                );
              },
            },
          ]}
        />

        {revokeButton ? (
          <Card
            title={REVOKE_SECRET}
            description={REVOKE_SECRET_DESCRIPTION}
            buttons={[revokeButton]}
          />
        ) : (
          <></>
        )}

        <ModelDelete
          modelType={SecurityBlocklistFeed}
          modelId={feedId}
          singularName={DETAILS_CARD_TITLE}
          itemName={feed.name || ""}
          onDeleteSuccess={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_BLOCKLIST_FEEDS] as Route,
              ),
            );
          }}
        />
      </div>

      {isRotating ? (
        <ConfirmModal
          title={ROTATE_SECRET}
          description={ROTATE_SECRET_DESCRIPTION}
          submitButtonText={ROTATE_SECRET}
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isWorking}
          error={actionError || undefined}
          onSubmit={() => {
            void rotate();
          }}
          onClose={() => {
            setIsRotating(false);
          }}
        />
      ) : (
        <></>
      )}

      {isRevoking ? (
        <ConfirmModal
          title={REVOKE_SECRET}
          description={REVOKE_SECRET_DESCRIPTION}
          submitButtonText={REVOKE_SECRET}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isWorking}
          error={actionError || undefined}
          onSubmit={() => {
            void revoke();
          }}
          onClose={() => {
            setIsRevoking(false);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

// How a fetch's secret came, as the log keeps it ("Basic", "Bearer", "Path").
function readAuthentication(
  method: string | undefined,
): SecurityBlocklistFeedAuthentication {
  if (method === "Bearer") {
    return SecurityBlocklistFeedAuthentication.Bearer;
  }

  if (method === "Path") {
    return SecurityBlocklistFeedAuthentication.PathSecret;
  }

  return SecurityBlocklistFeedAuthentication.Basic;
}

export default SecurityBlocklistFeedViewPage;
