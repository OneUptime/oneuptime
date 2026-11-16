import MonitorElement from "../Monitor/Monitor";
import IncomingRequestSecretsCopy from "./IncomingRequestSecretsCopy";
import IncomingRequestSecret from "Common/Models/DatabaseModels/IncomingRequestSecret";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import {
  INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS,
  IncomingRequestSecretProblem,
} from "Common/Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * Monitors -> Settings -> Incoming Request Secrets' list of the Incoming
 * Request monitors that got a request without a valid secret in the last day
 * (Monitor.incomingRequestWithoutSecretAt, issue #8498): before the project
 * requires a secret, the senders to fix first; after, the requests it
 * refuses. Each row says why (none sent, or a wrong one) and when a request
 * with a secret last came, so a sender that has been fixed shows it.
 *
 * Requests are checked only while the project has a secret, so the list says
 * nothing until it has one - the secrets' own list says to create one - and
 * an empty list is all clear only once that has been so for the whole
 * window: a nightly job has not called yet an hour after the first secret.
 */

export const REQUESTS_WITHOUT_SECRET_TABLE_ID: string =
  "incoming-request-monitors-without-secret-table";

// The project's Incoming Request monitors on the list at this moment.
export const getRequestsWithoutSecretQuery: (data: {
  projectId: ObjectID;
  now?: Date | undefined;
}) => Query<Monitor> = (data: {
  projectId: ObjectID;
  now?: Date | undefined;
}): Query<Monitor> => {
  return {
    projectId: data.projectId,
    monitorType: MonitorType.IncomingRequest,
    incomingRequestWithoutSecretAt: new GreaterThan(
      OneUptimeDate.addRemoveHours(
        data.now || OneUptimeDate.getCurrentDate(),
        -INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS,
      ),
    ),
  } as Query<Monitor>;
};

/*
 * Why a request had no valid secret, as the list words it (in English: the
 * cell translates it): none sent, a wrong one (or a signature none of the
 * project's secrets made), one of the project's that does not cover the
 * monitor (issue #8501), or a signature too old to accept (issue #8500). A
 * monitor stamped before the reason was kept, or with a reason this
 * Dashboard does not know, reads as none sent.
 */
export const getWithoutSecretReasonLabel: (
  reason: IncomingRequestSecretProblem | string | undefined | null,
) => string = (
  reason: IncomingRequestSecretProblem | string | undefined | null,
): string => {
  switch (reason) {
    case IncomingRequestSecretProblem.WrongSecret:
      return IncomingRequestSecretsCopy.reasonWrongSecret;
    case IncomingRequestSecretProblem.SecretNotForMonitor:
      return IncomingRequestSecretsCopy.reasonSecretNotForMonitor;
    case IncomingRequestSecretProblem.ExpiredSignature:
      return IncomingRequestSecretsCopy.reasonExpiredSignature;
    default:
      return IncomingRequestSecretsCopy.reasonNoSecret;
  }
};

/*
 * Since when the project's requests have been checked for a secret, from the
 * secrets' list as it loaded (sorted oldest first): the oldest secret's
 * creation, or null when the project has none.
 */
export const getCheckingSince: (
  secretsOnPage: Array<IncomingRequestSecret>,
  totalSecrets: number,
) => Date | null = (
  secretsOnPage: Array<IncomingRequestSecret>,
  totalSecrets: number,
): Date | null => {
  if (totalSecrets <= 0 || secretsOnPage.length === 0) {
    return null;
  }

  let oldest: Date | null = null;

  for (const secret of secretsOnPage) {
    if (!secret.createdAt) {
      continue;
    }

    const createdAt: Date = OneUptimeDate.fromString(secret.createdAt);

    if (!oldest || createdAt.getTime() < oldest.getTime()) {
      oldest = createdAt;
    }
  }

  // A secret is there, though its age was not read: it is checking now.
  return oldest || OneUptimeDate.getCurrentDate();
};

/*
 * What the empty list says: all clear once requests have been checked for
 * the whole window; until then, that nothing has come yet, and why a sender
 * may still be missing from it.
 */
export const getRequestsWithoutSecretEmptyState: (data: {
  checkingSince: Date;
  now?: Date | undefined;
}) => EmptyStateOptions = (data: {
  checkingSince: Date;
  now?: Date | undefined;
}): EmptyStateOptions => {
  const windowStart: Date = OneUptimeDate.addRemoveHours(
    data.now || OneUptimeDate.getCurrentDate(),
    -INCOMING_REQUEST_WITHOUT_SECRET_WINDOW_HOURS,
  );

  if (data.checkingSince.getTime() <= windowStart.getTime()) {
    return {
      isAllClear: true,
      title: IncomingRequestSecretsCopy.withoutSecretAllClearTitle,
      description: IncomingRequestSecretsCopy.withoutSecretAllClearDescription,
    };
  }

  return {
    title: IncomingRequestSecretsCopy.withoutSecretSoFarTitle,
    description: IncomingRequestSecretsCopy.withoutSecretSoFarDescription,
    hideCreateButton: true,
  };
};

export interface ComponentProps {
  projectId: ObjectID;
  /*
   * Since when requests have been checked (getCheckingSince); null while
   * the project has no secret, undefined until the secrets have loaded.
   * The list is drawn only once there is a date.
   */
  checkingSince: Date | null | undefined;
}

const RequestsWithoutSecretTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Read once per visit: the list's own Refresh reads it again.
  const query: Query<Monitor> = useMemo((): Query<Monitor> => {
    return getRequestsWithoutSecretQuery({ projectId: props.projectId });
  }, [props.projectId.toString()]);

  if (!props.checkingSince) {
    return <></>;
  }

  return (
    <ModelTable<Monitor>
      modelType={Monitor}
      query={query}
      id={REQUESTS_WITHOUT_SECRET_TABLE_ID}
      name="Monitors > Settings > Incoming Request Secrets > Requests Without a Secret"
      userPreferencesKey={REQUESTS_WITHOUT_SECRET_TABLE_ID}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showViewIdButton={false}
      cardProps={{
        title: IncomingRequestSecretsCopy.withoutSecretTableTitle,
        description: IncomingRequestSecretsCopy.withoutSecretTableDescription,
      }}
      emptyState={getRequestsWithoutSecretEmptyState({
        checkingSince: props.checkingSince,
      })}
      sortBy="incomingRequestWithoutSecretAt"
      sortOrder={SortOrder.Descending}
      showRefreshButton={true}
      filters={[]}
      columns={[
        {
          field: {
            name: true,
          },
          title: "Monitor",
          type: FieldType.Element,
          getElement: (item: Monitor): ReactElement => {
            return <MonitorElement monitor={item} />;
          },
        },
        {
          field: {
            incomingRequestWithoutSecretReason: true,
          },
          title: IncomingRequestSecretsCopy.reasonTitle,
          type: FieldType.Element,
          getElement: (item: Monitor): ReactElement => {
            return (
              <span>
                {translator.translateText(
                  getWithoutSecretReasonLabel(
                    item.incomingRequestWithoutSecretReason,
                  ),
                )}
              </span>
            );
          },
        },
        {
          field: {
            incomingRequestWithoutSecretAt: true,
          },
          title: IncomingRequestSecretsCopy.lastWithoutSecretTitle,
          type: FieldType.DateTime,
        },
        {
          field: {
            incomingRequestWithSecretAt: true,
          },
          /*
           * Later than the latest request without one: that sender was
           * fixed, or another sender of the same monitor sends it.
           */
          noValueMessage: IncomingRequestSecretsCopy.lastUsedNever,
          title: IncomingRequestSecretsCopy.lastWithSecretTitle,
          type: FieldType.DateTime,
        },
      ]}
    />
  );
};

export default RequestsWithoutSecretTable;
