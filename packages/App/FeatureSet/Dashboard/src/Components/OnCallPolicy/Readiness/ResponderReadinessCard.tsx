import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import { DASHBOARD_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import UserElement from "../../User/User";
import StatTile from "./StatTile";
import {
  READINESS_STATUS_NOT_REACHABLE,
  READINESS_STATUS_READY,
  ReadinessCoverageCellWire,
  ReadinessDeliveryContext,
  ReadinessMethodWire,
  ReadinessStatusValue,
  ReadinessSummaryWire,
  ResponderSourceValue,
  UserReadinessWire,
  SettingsPageLink,
  getCoverageCellLabel,
  getCoverageGaps,
  getResponderSourceLabel,
  getSettingsPageForRuleType,
  getSelfAddressedConsequence,
  getStatusConsequence,
  getStatusShortLabel,
  getVerifiedMethods,
} from "./ReadinessTypes";
import useOnCallReadiness, { OnCallReadinessState } from "./useOnCallReadiness";
import {
  translateTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * "Can this policy actually page the people on it?", answered on the page an
 * admin already looks at.
 *
 * This is the surface Teams > Compliance never managed to be. That table is
 * opt-in per team and hides itself entirely when unconfigured
 * (TeamComplianceStatusTable.tsx:176), so the overwhelmingly common case — a
 * project that never opened the compliance settings — sees nothing at all. This
 * card is always on, is scoped to the policy rather than to a team (so directly
 * attached users, schedule-layer users and overrides are all included), and every
 * warning it prints ships with the action that resolves it. A warning with no fix
 * is a warning people learn to scroll past.
 *
 * The three-state colour is load-bearing and is deliberately not the old binary
 * Compliant / Non-Compliant: red means pages are being dropped right now, amber
 * means the responder is still reached by the fallback but not the way they
 * configured. Collapsing those two into one alarming colour is how a status
 * surface trains its readers to ignore it.
 */

export interface ComponentProps {
  onCallDutyPolicyId: ObjectID;
}

/*
 * Where a responder goes to resolve their own gap, and what to call the trip.
 * Admins cannot edit another person's rules or methods today — that is a
 * deliberate boundary, since being able to attach a phone number to somebody
 * else's account is a paging-hijack vector — so for anyone but the signed-in
 * user the action is to ask them, with the destination already written down.
 */
interface ReadinessFix extends SettingsPageLink {
  actionTitle: string;
}

const getFix: (
  user: UserReadinessWire,
  gaps: Array<ReadinessCoverageCellWire>,
) => ReadinessFix = (
  user: UserReadinessWire,
  gaps: Array<ReadinessCoverageCellWire>,
): ReadinessFix => {
  if (user.status === READINESS_STATUS_NOT_REACHABLE) {
    return {
      page: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      actionTitle: "Add a notification method",
    };
  }

  const firstGap: ReadinessCoverageCellWire | undefined = gaps[0];

  /*
   * The On-Call Rules page, on the tab of the first hole. With no hole named
   * (a partially ready responder whose gaps were not reported), the page's
   * first tab.
   */
  return {
    ...(firstGap
      ? getSettingsPageForRuleType(firstGap.ruleType)
      : { page: PageMap.USER_SETTINGS_ON_CALL_RULES }),
    actionTitle: "Add the missing rules",
  };
};

// The fix's page, on the right tab, inside the dashboard.
const getFixRoute: (fix: ReadinessFix) => Route = (
  fix: ReadinessFix,
): Route => {
  return RouteUtil.addQuery(
    RouteUtil.populateRouteParams(RouteMap[fix.page] as Route),
    fix.query,
  );
};

// The dashboard-absolute link, so it survives being pasted into an email.
const getAbsoluteRouteUrl: (fix: ReadinessFix) => string = (
  fix: ReadinessFix,
): string => {
  return new URL(
    DASHBOARD_URL.protocol,
    DASHBOARD_URL.hostname,
    getFixRoute(fix),
  ).toString();
};

const getFirstName: (user: UserReadinessWire) => string = (
  user: UserReadinessWire,
): string => {
  const name: string = (user.userName || "").trim();

  if (!name) {
    return user.userEmail;
  }

  return name.split(" ")[0] || name;
};

/*
 * A prefilled draft in the admin's own mail client — not a message this product
 * sends on their behalf. It is the only fix that works today for somebody else's
 * account, and it beats "Non-Compliant" with no next step by a wide margin.
 */
const getMailToHref: (params: {
  user: UserReadinessWire;
  fix: ReadinessFix;
  delivery: ReadinessDeliveryContext;
}) => string = (params: {
  user: UserReadinessWire;
  fix: ReadinessFix;
  delivery: ReadinessDeliveryContext;
}): string => {
  // Written in the admin's language: it is their draft, sent from their mail client.
  const subject: string = translateTemplate(
    "Your OneUptime on-call notifications need setup",
  );
  const body: string = [
    translateTemplate("Hi {{name}},", { name: getFirstName(params.user) }),
    "",
    translateTemplate(
      "You are a responder on a OneUptime on-call policy, but {{consequence}}",
      {
        consequence: getSelfAddressedConsequence(params.user, params.delivery),
      },
    ),
    "",
    translateTemplate("You can fix it here: {{link}}", {
      link: getAbsoluteRouteUrl(params.fix),
    }),
    "",
    translateTemplate("Thank you!"),
  ].join("\n");

  return `mailto:${encodeURIComponent(
    params.user.userEmail,
  )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};

// NotReachable first: it is the only state that is actively losing pages.
const statusSortWeight: Record<ReadinessStatusValue, number> = {
  NotReachable: 0,
  PartiallyReady: 1,
  Ready: 2,
};

// How many coverage-gap chips a row prints before it summarises the rest.
const MAX_GAP_CHIPS: number = 6;

const ResponderReadinessCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readiness: OnCallReadinessState = useOnCallReadiness({
    onCallDutyPolicyId: props.onCallDutyPolicyId,
  });

  /*
   * The signed-in user is the only person whose rules they can actually change
   * from here, so their row gets a button and everybody else's gets a nudge.
   */
  const currentUserId: string = UserUtil.getUserId().toString();

  /*
   * Skeleton rows rather than a blanked body. The compliance table swaps its
   * whole card for a spinner while loading (TeamComplianceStatusTable.tsx:182),
   * which on a slow request reads as "this feature is broken" rather than "this
   * is still loading" — the card's shape disappears along with its content.
   */
  const getSkeleton: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index: number): ReactElement => {
            return (
              <div
                key={`tile-skeleton-${index}`}
                className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
              />
            );
          })}
        </div>
        <div className="space-y-3">
          {[0, 1].map((index: number): ReactElement => {
            return (
              <div
                key={`row-skeleton-${index}`}
                className="rounded-xl border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-gray-100" />
                  <div className="h-3.5 w-44 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="mt-3.5 h-3 w-full animate-pulse rounded bg-gray-100" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-gray-100" />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getGapChips: (
    gaps: Array<ReadinessCoverageCellWire>,
  ) => ReactElement = (
    gaps: Array<ReadinessCoverageCellWire>,
  ): ReactElement => {
    const shown: Array<ReadinessCoverageCellWire> = gaps.slice(
      0,
      MAX_GAP_CHIPS,
    );
    const remaining: number = gaps.length - shown.length;

    return (
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500">
          {translator.translateText("No rule for")}
        </span>
        {shown.map(
          (cell: ReadinessCoverageCellWire, index: number): ReactElement => {
            return (
              <span
                key={`gap-${index}`}
                className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
              >
                {getCoverageCellLabel(cell)}
              </span>
            );
          },
        )}
        {remaining > 0 ? (
          <span className="text-xs text-gray-500">
            {translator.translateTemplate("and {{count}} more", {
              count: remaining,
            })}
          </span>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const getMethodChips: (
    methods: Array<ReadinessMethodWire>,
  ) => ReactElement = (methods: Array<ReadinessMethodWire>): ReactElement => {
    if (methods.length === 0) {
      return <></>;
    }

    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500">
          {translator.translateText("Reachable on")}
        </span>
        {methods.map(
          (method: ReadinessMethodWire, index: number): ReactElement => {
            return (
              <span
                key={`method-${index}`}
                className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
              >
                {translator.translateTerm(method.methodType)}
                <span className="font-normal text-gray-500">
                  {method.maskedIdentifier}
                </span>
              </span>
            );
          },
        )}
      </div>
    );
  };

  const getResponderRow: (
    user: UserReadinessWire,
    delivery: ReadinessDeliveryContext,
  ) => ReactElement = (
    user: UserReadinessWire,
    delivery: ReadinessDeliveryContext,
  ): ReactElement => {
    const isNotReachable: boolean =
      user.status === READINESS_STATUS_NOT_REACHABLE;
    const gaps: Array<ReadinessCoverageCellWire> = getCoverageGaps(user);
    const verifiedMethods: Array<ReadinessMethodWire> =
      getVerifiedMethods(user);
    const fix: ReadinessFix = getFix(user, gaps);
    const isCurrentUser: boolean =
      Boolean(currentUserId) && currentUserId === user.userId;

    return (
      <div
        key={user.userId}
        className={`rounded-xl border p-4 ${
          isNotReachable
            ? "border-red-200 bg-red-50/40"
            : "border-amber-200 bg-amber-50/40"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <UserElement
            user={{
              _id: user.userId,
              name: user.userName,
              email: user.userEmail,
              profilePictureId: user.userProfilePictureId,
            }}
          />
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
              isNotReachable
                ? "bg-red-50 text-red-700 ring-red-200"
                : "bg-amber-50 text-amber-700 ring-amber-200"
            }`}
          >
            <Icon
              icon={isNotReachable ? IconProp.BellSlash : IconProp.Alert}
              className={`h-3 w-3 ${
                isNotReachable ? "text-red-500" : "text-amber-500"
              }`}
            />
            {getStatusShortLabel(user)}
          </span>
        </div>

        <p className="mt-2.5 text-sm leading-relaxed text-gray-700">
          {getStatusConsequence(user, delivery)}
        </p>

        {user.reasons.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {user.reasons.map((reason: string, index: number): ReactElement => {
              return (
                <li
                  key={`reason-${index}`}
                  className="flex items-start gap-2 text-xs leading-relaxed text-gray-600"
                >
                  <span
                    className={`mt-1.5 h-1 w-1 flex-shrink-0 rounded-full ${
                      isNotReachable ? "bg-red-400" : "bg-amber-400"
                    }`}
                  />
                  {reason}
                </li>
              );
            })}
          </ul>
        ) : (
          <></>
        )}

        {gaps.length > 0 ? getGapChips(gaps) : <></>}
        {getMethodChips(verifiedMethods)}

        {user.reachedVia.length > 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            {translator.translateTemplate("On this policy via {{sources}}.", {
              sources: user.reachedVia
                .map((source: ResponderSourceValue): string => {
                  return getResponderSourceLabel(source);
                })
                .join(", "),
            })}
          </p>
        ) : (
          <></>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-3 border-t border-gray-200/70 pt-3">
          {isCurrentUser ? (
            <Button
              title={fix.actionTitle}
              icon={IconProp.Settings}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                Navigation.navigate(getFixRoute(fix));
              }}
            />
          ) : (
            <>
              <a
                href={getMailToHref({
                  user: user,
                  fix: fix,
                  delivery: delivery,
                })}
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                <Icon icon={IconProp.Email} className="h-3.5 w-3.5" />
                {translator.translateTemplate("Email {{name}} the fix", {
                  name: getFirstName(user),
                })}
              </a>
              <span className="text-xs leading-relaxed text-gray-500">
                {translator.translateTemplate(
                  "Only {{name}} can change their own notification setup, so the fix is a nudge with the link already in it.",
                  { name: getFirstName(user) },
                )}
              </span>
            </>
          )}
        </div>
      </div>
    );
  };

  const getBody: () => ReactElement = (): ReactElement => {
    /*
     * Only the first load draws skeletons. A Recheck keeps the current answer on
     * screen (with the button disabled) rather than tearing the card down and
     * rebuilding it, because a status surface that flickers to grey every time
     * it refreshes trains people not to press the refresh button.
     */
    if (readiness.isLoading && !readiness.summary) {
      return getSkeleton();
    }

    if (readiness.error) {
      return (
        <ErrorMessage
          message={readiness.error}
          onRefreshClick={() => {
            readiness.reload().catch(() => {
              // The hook already surfaces the failure through its error state.
            });
          }}
        />
      );
    }

    const summary: ReadinessSummaryWire | null = readiness.summary;

    if (!summary) {
      return <></>;
    }

    /*
     * "Nobody is on this policy" and "the check came back with nobody in it" are
     * the same empty list and opposite facts. Claiming the first when the answer
     * is incomplete tells an admin their policy is empty - and an empty policy
     * pages no one - about a policy that may be fully staffed. The truncated
     * case therefore falls through to the caveat below instead.
     */
    if (summary.users.length === 0 && !readiness.isTruncated) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-8 text-center">
          <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-600">
            <TranslatedSentence
              template="No one is on this policy yet, so there is nobody to check. Add on-call schedules, teams or users on the {{tab}} tab and their readiness shows up here."
              slots={{
                tab: (
                  <span className="font-semibold text-gray-900">
                    {translator.translateText("Escalation")}
                  </span>
                ),
              }}
            />
          </p>
        </div>
      );
    }

    /*
     * Read once, here, and handed to every row. The alternative — each row
     * reaching for the summary itself — is how the "so nothing is dropped"
     * hardcode survived review in the first place: nothing forced a row to
     * acknowledge that the project could be configured to drop those pages.
     */
    const delivery: ReadinessDeliveryContext = {
      isFallbackEnabled: summary.isFallbackEnabled,
    };

    const needsAttention: Array<UserReadinessWire> = summary.users
      .filter((user: UserReadinessWire): boolean => {
        return user.status !== READINESS_STATUS_READY;
      })
      .sort((a: UserReadinessWire, b: UserReadinessWire): number => {
        const weightDifference: number =
          statusSortWeight[a.status] - statusSortWeight[b.status];

        if (weightDifference !== 0) {
          return weightDifference;
        }

        return (a.userName || a.userEmail).localeCompare(
          b.userName || b.userEmail,
        );
      });

    return (
      <div>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            icon={IconProp.CheckCircle}
            label="Ready"
            value={`${summary.readyCount}`}
            tone={summary.readyCount > 0 ? "positive" : "neutral"}
          />
          <StatTile
            icon={IconProp.Alert}
            label="Needs setup"
            value={`${summary.partiallyReadyCount}`}
            tone={summary.partiallyReadyCount > 0 ? "warning" : "neutral"}
          />
          <StatTile
            icon={IconProp.BellSlash}
            label="Unreachable"
            value={`${summary.notReachableCount}`}
            tone={summary.notReachableCount > 0 ? "critical" : "neutral"}
          />
          <StatTile
            icon={IconProp.User}
            label={summary.users.length === 1 ? "Responder" : "Responders"}
            value={`${summary.users.length}`}
          />
        </div>

        {/*
         * The tiles above count the rows this card is holding. When the policy
         * has more responders than the hook was willing to read, that is a count
         * of part of a list, and saying so is the difference between a paged
         * answer and a truncated one - a silent "0 unreachable" computed from a
         * prefix is exactly the reassuring lie this card exists to prevent.
         */}
        {readiness.isTruncated ? (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-gray-300 bg-gray-50 p-4">
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
            />
            <p className="text-sm leading-relaxed text-gray-700">
              {summary.isTruncated
                ? translator.translateText(
                    "This project is large enough that the readiness check hit its own read limits, so some responders, methods or rules are missing from what is shown. Read the counts below as a floor, not a total - there may be more people who cannot be paged than appear here.",
                  )
                : translator.translateTemplate(
                    "This policy has {{total}} responders, more than this card reads at once. The counts and the list below cover the {{shown}} most-affected of them; anyone missing sorts behind everyone already shown.",
                    {
                      total: readiness.totalCount,
                      shown: summary.users.length,
                    },
                  )}
            </p>
          </div>
        ) : (
          <></>
        )}

        {/*
         * Stated once, at the top, because it changes what every row underneath
         * means. Without it a reader who knows the product assumes the fallback
         * is on — it is on by default and it is on almost everywhere — and reads
         * each amber row as "late page" when in this project it is "no page".
         */}
        {summary.isFallbackEnabled ? (
          <></>
        ) : (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
            />
            <p className="text-sm leading-relaxed text-amber-800">
              {translator.translateText(
                "On-call notification fallback is switched off for this project, so a missing notification rule is not a late page — it is no page at all. Every gap listed below is dropped rather than delivered on another channel.",
              )}
            </p>
          </div>
        )}

        {/*
         * The all-clear is the one claim this card must never make on partial
         * evidence: "every responder can be paged" over an answer that is
         * missing responders is the precise sentence this feature exists to stop
         * anybody believing. When the answer is incomplete the caveat above
         * stands alone and nothing green is drawn.
         */}
        {needsAttention.length === 0 && readiness.isTruncated ? (
          <></>
        ) : needsAttention.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-2.5">
              <Icon
                icon={IconProp.CheckCircle}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500"
              />
              <div>
                <p className="text-sm font-semibold text-emerald-800">
                  {translator.translateText("Every responder can be paged")}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-emerald-700">
                  {translator.translatePlural(
                    {
                      one: "All {{count}} responder on this policy have a verified notification method, and a rule for every severity and rule type they can be paged for.",
                      other:
                        "All {{count}} responders on this policy have a verified notification method, and a rule for every severity and rule type they can be paged for.",
                    },
                    summary.users.length,
                  )}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {translator.translateText("Needs attention")}
              </span>
              <span className="text-xs font-medium tabular-nums text-gray-500">
                {translator.translateTemplate("{{count}} of {{total}}", {
                  count: needsAttention.length,
                  total: summary.users.length,
                })}
              </span>
            </div>
            <div className="space-y-3">
              {needsAttention.map((user: UserReadinessWire): ReactElement => {
                return getResponderRow(user, delivery);
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {translator.translateText("Responder readiness")}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
            {translator.translateText(
              "Whether everyone this policy can page is actually reachable right now — including people it reaches through a team, a schedule or an override.",
            )}
          </p>
        </div>
        <div className="flex-shrink-0">
          <Button
            title="Recheck"
            icon={IconProp.Reload}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.OUTLINE}
            disabled={readiness.isLoading}
            onClick={() => {
              readiness.reload().catch(() => {
                // The hook already surfaces the failure through its error state.
              });
            }}
          />
        </div>
      </div>

      <div className="p-6">{getBody()}</div>
    </div>
  );
};

export default ResponderReadinessCard;
