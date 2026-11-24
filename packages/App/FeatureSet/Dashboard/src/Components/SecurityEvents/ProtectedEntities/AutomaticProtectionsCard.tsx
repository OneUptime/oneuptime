import {
  AutomaticProtectionGroup,
  readAutomaticProtections,
} from "../Blocklist/BlocklistApi";
import { writeSecurityProtection } from "../Blocklist/BlocklistWords";
import {
  AUTOMATIC_PROTECTIONS_DESCRIPTION,
  AUTOMATIC_PROTECTIONS_MORE,
  AUTOMATIC_PROTECTIONS_TEST_ID,
  AUTOMATIC_PROTECTIONS_TITLE,
  AUTOMATIC_PROTECTIONS_UNREAD,
} from "./AutomaticProtectionsCopy";
import { SecurityAddressProtection } from "Common/Types/SecurityBlocklist/SecurityProtectedAddress";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * PROTECTED AUTOMATICALLY (#10338): the addresses OneUptime never blocks
 * because they are the project's own - its hosts, Kubernetes nodes, cloud
 * resources, network devices and endpoints, the addresses its people named,
 * its probes and OneUptime's, the ranges that are not on the internet, and
 * the edge in front of it when one is connected. Worked out from what
 * OneUptime knows each time it is read, never stored, so nothing here can be
 * removed: each row says what the address is, in the words a refused block
 * uses.
 *
 * Read with the reader's own permissions: a kind of record they may not read
 * is not listed, and the card says so - its addresses are protected all the
 * same. A source with more than the card lists says so too.
 */

const AutomaticProtectionsCard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [groups, setGroups] = useState<Array<AutomaticProtectionGroup> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    readAutomaticProtections()
      .then((read: Array<AutomaticProtectionGroup>) => {
        if (isCurrent) {
          setGroups(read);
        }
      })
      .catch((caught: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(caught));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const protections: Array<SecurityAddressProtection> = (groups || []).flatMap(
    (group: AutomaticProtectionGroup): Array<SecurityAddressProtection> => {
      return group.protections;
    },
  );
  const hasMore: boolean = (groups || []).some(
    (group: AutomaticProtectionGroup): boolean => {
      return group.hasMore;
    },
  );
  const hasUnread: boolean = (groups || []).some(
    (group: AutomaticProtectionGroup): boolean => {
      return !group.isRead;
    },
  );

  return (
    <div data-testid={AUTOMATIC_PROTECTIONS_TEST_ID}>
      <Card
        title={AUTOMATIC_PROTECTIONS_TITLE}
        description={AUTOMATIC_PROTECTIONS_DESCRIPTION}
      >
        {error ? (
          <ErrorMessage message={error} />
        ) : !groups ? (
          <TableSkeleton rows={4} columns={2} hasHeader={false} />
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-gray-100">
              {protections.map(
                (
                  protection: SecurityAddressProtection,
                  index: number,
                ): ReactElement => {
                  return (
                    <li
                      key={`${protection.source}-${protection.protectedValue}-${index}`}
                      className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4"
                    >
                      <span className="shrink-0 break-all font-mono text-sm text-gray-900 sm:w-56">
                        {protection.protectedValue}
                      </span>
                      <span className="text-sm text-gray-600">
                        {writeSecurityProtection(translator, {
                          value: protection.protectedValue,
                          protection,
                        })}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
            {hasMore ? (
              <p className="text-xs text-gray-500">
                {translator.translateText(AUTOMATIC_PROTECTIONS_MORE)}
              </p>
            ) : (
              <></>
            )}
            {hasUnread ? (
              <p className="text-xs text-gray-500">
                {translator.translateText(AUTOMATIC_PROTECTIONS_UNREAD)}
              </p>
            ) : (
              <></>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AutomaticProtectionsCard;
