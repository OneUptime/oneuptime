import Route from "Common/Types/API/Route";
import { Gray500, Red, Yellow } from "Common/Types/BrandColors";
import { CloudCostState } from "Common/Types/Cloud/CloudCost";
import {
  CLOUD_COMMITMENT_ALL_USED_PERCENT,
  CLOUD_COMMITMENT_KINDS,
  CloudCommitmentCoverageLevel,
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
  getCloudCommitmentCoverageLevel,
  getCloudCommitmentCoveragePercent,
  getCloudCommitmentKindLabel,
  getCloudCommitmentUtilizationPercent,
  hasCloudCommitment,
} from "Common/Types/Cloud/CloudCommitments";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import Color from "Common/Types/Color";
import Card from "Common/UI/Components/Card/Card";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { READ_THE_GUIDE } from "./CloudCostSetupSteps";
import {
  COST_SETUP_DOCS_PATHS,
  COST_STATE_LABELS,
  formatCloudMoney,
  getCloudCommitmentSetupStep,
} from "./CloudCostWords";
import { cloudConnectionDocsUrl } from "./Connect/CloudConnectApi";
import CloudConnectionLogo from "./Connect/CloudConnectionLogo";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * COMMITMENTS, ON SAVINGS AND AN ACCOUNT'S COSTS: how much of the last 30
 * days' spend each account's Savings Plans, reservations and committed use
 * discounts paid for, and how much of them was used (CloudCommitments) -
 * an account at a time, each kind its cloud has on a line of its own:
 *
 *   - what it covers: the share of the spend a commitment could pay for
 *     that one did, with a bar - or, with none, what ran on demand that one
 *     would pay for for less;
 *   - what of it is used: the share of what it cost that paid for usage,
 *     and what was left unused - or that its cloud does not say (Google
 *     Cloud's billing export says what a discount paid, not what was left).
 *
 * Its figures are each cloud's own, kind by kind: a reservation and a
 * savings plan can each count the same machine's spend as theirs to cover,
 * so they are never added together. An account whose commitments could
 * not be read says why, in its cloud's words, and what to do, in the
 * reader's, with its cloud's section of the guide - as Accounts left out
 * does. On an account's own Costs the account is the page's, so the card
 * names it nowhere. Nothing is drawn when no account has anything to say.
 */

export const COMMITMENTS_TITLE: string = translationKey("Commitments");
export const COMMITMENTS_DESCRIPTION: string = translationKey(
  "How much of the last 30 days' spend your Savings Plans, reservations and committed use discounts paid for, and how much of them was used.",
);
export const COMMITMENT_COVERS: string = translationKey("Covers {{percent}}");
export const COMMITMENT_COVERS_ALL: string = translationKey(
  "Covers all eligible spend",
);
export const COMMITMENT_COVERED_OF: string = translationKey(
  "{{covered}} of {{eligible}}",
);
export const COMMITMENT_NONE: string = translationKey("No commitment");
export const COMMITMENT_ON_DEMAND: string = translationKey(
  "{{amount}} ran at on-demand rates",
);
/*
 * A commitment's utilization, as the clouds' own consoles say it - never
 * "{{percent}} used", which the Dashboard says of a disk's or a pool's
 * capacity ("belegt", "occupied").
 */
export const COMMITMENT_USED: string = translationKey("{{percent}} utilized");
export const COMMITMENT_ALL_USED: string = translationKey("Fully utilized");
export const COMMITMENT_UNUSED: string = translationKey("{{amount}} unused");
export const COMMITMENT_USE_NOT_REPORTED: string = translationKey(
  "Utilization not reported",
);
export const COMMITMENT_ORGANIZATION: string = translationKey(
  "Every account of the organization",
);
export const COMMITMENTS_SHOWN: number = 6;
export const SHOW_MORE_COMMITMENTS: PluralTemplate = {
  one: "Show {{count}} more",
  other: "Show {{count}} more",
};
export const SHOW_FEWER_COMMITMENTS: string = translationKey("Show less");

// One account's commitments as the card draws them: its kinds, or why not.
export interface CloudCommitmentAccountRow {
  account: CloudAccountRow;
  summary: CloudCommitmentSummary;
  // The kinds with something to say: a commitment, or spend one could cover.
  kinds: Array<CloudCommitmentKindFigures>;
}

/*
 * The kinds of an account's commitments worth a line, in its cloud's
 * order: one it has, or one whose spend a commitment could cover.
 */
export function getCloudCommitmentKindsToShow(data: {
  provider: string;
  summary: CloudCommitmentSummary;
}): Array<CloudCommitmentKindFigures> {
  const order: ReadonlyArray<CloudCommitmentKind> =
    CLOUD_COMMITMENT_KINDS[data.provider as CloudProvider] ||
    Object.values(CloudCommitmentKind);

  return [...data.summary.kinds]
    .filter((figures: CloudCommitmentKindFigures): boolean => {
      return (
        hasCloudCommitment(figures) ||
        getCloudCommitmentCoverageLevel(figures) !==
          CloudCommitmentCoverageLevel.NothingToCover
      );
    })
    .sort(
      (
        a: CloudCommitmentKindFigures,
        b: CloudCommitmentKindFigures,
      ): number => {
        return order.indexOf(a.kind) - order.indexOf(b.kind);
      },
    );
}

/*
 * The accounts the card lists: each read with something to say, or not
 * read with why - those with a commitment first, then by what a commitment
 * could cover, the most first.
 */
export function getCloudCommitmentRows(
  accounts: Array<CloudAccountRow>,
): Array<CloudCommitmentAccountRow> {
  const rows: Array<CloudCommitmentAccountRow> = [];

  for (const account of accounts) {
    const summary: CloudCommitmentSummary | undefined =
      account.savingsSummary?.commitments;

    if (!summary) {
      continue;
    }

    const kinds: Array<CloudCommitmentKindFigures> =
      getCloudCommitmentKindsToShow({ provider: account.provider, summary });

    if (summary.state === CloudCostState.Reading && kinds.length === 0) {
      continue;
    }

    rows.push({ account, summary, kinds });
  }

  const weight: (row: CloudCommitmentAccountRow) => [number, number] = (
    row: CloudCommitmentAccountRow,
  ): [number, number] => {
    return [
      row.kinds.some(hasCloudCommitment) ? 1 : 0,
      row.kinds.reduce(
        (sum: number, figures: CloudCommitmentKindFigures): number => {
          return sum + figures.coveredSpend + figures.onDemandSpend;
        },
        0,
      ),
    ];
  };

  return rows.sort(
    (a: CloudCommitmentAccountRow, b: CloudCommitmentAccountRow): number => {
      const [aHas, aSpend] = weight(a);
      const [bHas, bSpend] = weight(b);

      return (
        bHas - aHas ||
        bSpend - aSpend ||
        (a.account.name || a.account.accountId).localeCompare(
          b.account.name || b.account.accountId,
        )
      );
    },
  );
}

function percentText(translator: Translator, percent: number): string {
  return `${translator.formatNumber(Math.round(percent))}%`;
}

/*
 * What a kind covers, in words: "Covers 64%" and "$7,870 of $12,300" - all
 * of it, or with none, what ran on demand.
 */
export function getCloudCommitmentCoverageWords(data: {
  figures: CloudCommitmentKindFigures;
  currency: string;
  translator: Translator;
}): { headline: string; detail: string; percent: number | null } {
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: data.currency,
      translator: data.translator,
    });
  };
  const level: CloudCommitmentCoverageLevel = getCloudCommitmentCoverageLevel(
    data.figures,
  );
  const percent: number | null = getCloudCommitmentCoveragePercent(
    data.figures,
  );

  if (
    level === CloudCommitmentCoverageLevel.None ||
    level === CloudCommitmentCoverageLevel.NothingToCover
  ) {
    return {
      headline:
        data.translator.translateText(COMMITMENT_NONE) || COMMITMENT_NONE,
      detail:
        data.figures.onDemandSpend > 0
          ? data.translator.translateTemplate(COMMITMENT_ON_DEMAND, {
              amount: money(data.figures.onDemandSpend),
            })
          : "",
      percent: level === CloudCommitmentCoverageLevel.None ? 0 : null,
    };
  }

  return {
    headline:
      level === CloudCommitmentCoverageLevel.All
        ? data.translator.translateText(COMMITMENT_COVERS_ALL) ||
          COMMITMENT_COVERS_ALL
        : data.translator.translateTemplate(COMMITMENT_COVERS, {
            percent: percentText(data.translator, percent || 0),
          }),
    detail: data.translator.translateTemplate(COMMITMENT_COVERED_OF, {
      covered: money(data.figures.coveredSpend),
      eligible: money(data.figures.coveredSpend + data.figures.onDemandSpend),
    }),
    percent,
  };
}

/*
 * What of a kind is used, in words: "97% utilized" and "$210 unused", all
 * of it - or that its cloud does not say (isReported false, drawn quieter
 * than a figure); nothing for no commitment.
 */
export interface CloudCommitmentUseWords {
  headline: string;
  detail: string;
  hasUnused: boolean;
  isReported: boolean;
}

export function getCloudCommitmentUseWords(data: {
  figures: CloudCommitmentKindFigures;
  currency: string;
  translator: Translator;
}): CloudCommitmentUseWords | null {
  if (!hasCloudCommitment(data.figures)) {
    return null;
  }

  const percent: number | null = getCloudCommitmentUtilizationPercent(
    data.figures,
  );

  if (percent === null) {
    return {
      headline:
        data.translator.translateText(COMMITMENT_USE_NOT_REPORTED) ||
        COMMITMENT_USE_NOT_REPORTED,
      detail: "",
      hasUnused: false,
      isReported: false,
    };
  }

  const unused: number = Math.max(0, data.figures.unusedSpend || 0);

  if (percent >= CLOUD_COMMITMENT_ALL_USED_PERCENT) {
    return {
      headline:
        data.translator.translateText(COMMITMENT_ALL_USED) ||
        COMMITMENT_ALL_USED,
      detail: "",
      hasUnused: false,
      isReported: true,
    };
  }

  return {
    headline: data.translator.translateTemplate(COMMITMENT_USED, {
      percent: percentText(data.translator, percent),
    }),
    detail: data.translator.translateTemplate(COMMITMENT_UNUSED, {
      amount: formatCloudMoney({
        amount: unused,
        currency: data.currency,
        translator: data.translator,
      }),
    }),
    hasUnused: unused > 0,
    isReported: true,
  };
}

const STATE_COLORS: Readonly<Record<string, Color>> = {
  [CloudCostState.Reading]: Gray500,
  [CloudCostState.NotAllowed]: Yellow,
  [CloudCostState.NotSetUp]: Yellow,
  [CloudCostState.Failed]: Red,
};

/*
 * A kind's line, laid out by the width its account's column has - a
 * container query, since an account's own page leaves the card half the
 * window beside its side menu: its name, what it covers and what of it is
 * used side by side with room for three; its name over the two figures
 * with room for two; one under another on a phone.
 */
export const COMMITMENT_KIND_CLASS_NAME: string =
  "grid grid-cols-1 gap-x-6 gap-y-1 [@container(min-width:22rem)]:grid-cols-2 [@container(min-width:34rem)]:grid-cols-3";
export const COMMITMENT_KIND_LABEL_CLASS_NAME: string =
  "text-sm text-gray-700 [@container(min-width:22rem)]:col-span-2 [@container(min-width:34rem)]:col-span-1";

// One kind of an account's commitments: its name, what it covers, what of it is used.
const CloudCommitmentKindLine: FunctionComponent<{
  figures: CloudCommitmentKindFigures;
  provider: string;
  currency: string;
}> = (props: {
  figures: CloudCommitmentKindFigures;
  provider: string;
  currency: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const coverage: {
    headline: string;
    detail: string;
    percent: number | null;
  } = getCloudCommitmentCoverageWords({
    figures: props.figures,
    currency: props.currency,
    translator,
  });
  const use: CloudCommitmentUseWords | null = getCloudCommitmentUseWords({
    figures: props.figures,
    currency: props.currency,
    translator,
  });
  const label: string = getCloudCommitmentKindLabel({
    provider: props.provider,
    kind: props.figures.kind,
  });

  return (
    <div
      className={COMMITMENT_KIND_CLASS_NAME}
      data-testid="cloud-commitment-kind"
      data-kind={props.figures.kind}
    >
      <div className={COMMITMENT_KIND_LABEL_CLASS_NAME}>
        {translator.translateText(label) || label}
      </div>
      <div className="min-w-0">
        <div
          className="text-sm font-medium text-gray-900"
          data-testid="cloud-commitment-coverage"
        >
          {coverage.headline}
        </div>
        {coverage.percent !== null ? (
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
            aria-hidden="true"
          >
            {coverage.percent > 0 ? (
              <div
                className="h-full rounded-full bg-indigo-500"
                data-testid="cloud-commitment-coverage-bar"
                style={{
                  width: `${Math.max(2, Math.min(100, coverage.percent))}%`,
                }}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
        {coverage.detail ? (
          <div
            className="mt-1 text-xs text-gray-600"
            data-testid="cloud-commitment-coverage-detail"
          >
            {coverage.detail}
          </div>
        ) : (
          <></>
        )}
      </div>
      <div className="min-w-0">
        {use ? (
          <>
            <div
              className={
                use.isReported
                  ? "text-sm font-medium text-gray-900"
                  : "text-sm text-gray-500"
              }
              data-testid="cloud-commitment-use"
              data-reported={use.isReported ? "true" : "false"}
            >
              {use.headline}
            </div>
            {use.detail ? (
              <div
                className={`mt-1 text-xs ${
                  use.hasUnused ? "text-amber-700" : "text-gray-600"
                }`}
                data-testid="cloud-commitment-use-detail"
              >
                {use.detail}
              </div>
            ) : (
              <></>
            )}
          </>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export interface ComponentProps {
  accounts: Array<CloudAccountRow>;
  /*
   * On one account's own Costs: the page is the account's, so the card
   * names it nowhere - its kinds, or why they are not read, come first.
   */
  isOneAccount?: boolean | undefined;
}

const CloudCommitmentsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showAll, setShowAll] = useState<boolean>(false);
  const rows: Array<CloudCommitmentAccountRow> = getCloudCommitmentRows(
    props.accounts,
  );

  if (rows.length === 0) {
    return <></>;
  }

  const hidden: number = rows.length - COMMITMENTS_SHOWN;
  const shown: Array<CloudCommitmentAccountRow> =
    showAll || hidden <= 0 ? rows : rows.slice(0, COMMITMENTS_SHOWN);

  return (
    <Card title={COMMITMENTS_TITLE} description={COMMITMENTS_DESCRIPTION}>
      <div data-testid="cloud-commitments">
        <ul className="-mt-3 divide-y divide-gray-100">
          {shown.map((row: CloudCommitmentAccountRow): ReactElement => {
            const name: string = row.account.name || row.account.accountId;
            const isRead: boolean =
              row.summary.state === CloudCostState.Reading;
            // What to do, in the reader's language, beside the cloud's words.
            const step: string | undefined = isRead
              ? undefined
              : getCloudCommitmentSetupStep({
                  provider: row.account.provider,
                  state: row.summary.state,
                });
            const docsPath: string | undefined =
              COST_SETUP_DOCS_PATHS[row.account.provider as CloudProvider];
            // Over every account, its name; on its own page, its state alone.
            const hasHeading: boolean = !props.isOneAccount || !isRead;
            const isOrganization: boolean = Boolean(row.summary.isOrganization);

            return (
              <li
                key={row.account.id.toString()}
                className="flex items-start gap-3 py-4"
                data-testid="cloud-commitment-account"
                data-state={row.summary.state}
              >
                {props.isOneAccount ? (
                  <></>
                ) : (
                  <CloudConnectionLogo
                    provider={row.account.provider}
                    size="sm"
                  />
                )}
                <div className="min-w-0 flex-1 [container-type:inline-size]">
                  {hasHeading ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {props.isOneAccount ? (
                        <></>
                      ) : (
                        <AppLink
                          to={RouteUtil.populateRouteParams(
                            RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
                            { modelId: row.account.id },
                          )}
                          className="min-w-0 break-words text-sm font-medium text-gray-900 hover:underline"
                          dataTestId="cloud-commitment-account-name"
                        >
                          <bdi>{name}</bdi>
                        </AppLink>
                      )}
                      {!isRead ? (
                        <Pill
                          text={
                            COST_STATE_LABELS[
                              row.summary.state as CloudCostState
                            ] || row.summary.state
                          }
                          color={STATE_COLORS[row.summary.state] || Gray500}
                        />
                      ) : (
                        <></>
                      )}
                    </div>
                  ) : (
                    <></>
                  )}
                  {isOrganization ? (
                    <p
                      className={`${
                        hasHeading ? "mt-0.5 " : ""
                      }text-xs text-gray-500`}
                      data-testid="cloud-commitment-organization"
                    >
                      {translator.translateText(COMMITMENT_ORGANIZATION)}
                    </p>
                  ) : (
                    <></>
                  )}
                  {!isRead && row.summary.message ? (
                    /*
                     * The cloud's own words, nearly always English: in
                     * their own direction, as a line of their own, so a
                     * page read right to left never runs them into the
                     * state beside them.
                     */
                    <p
                      dir="auto"
                      className="mt-1 line-clamp-3 break-words text-xs text-gray-600"
                      data-testid="cloud-commitment-message"
                    >
                      {row.summary.message}
                    </p>
                  ) : (
                    <></>
                  )}
                  {step ? (
                    <p
                      className="mt-1 text-xs text-gray-600"
                      data-testid="cloud-commitment-step"
                    >
                      {translator.translateText(step)}
                      {docsPath ? (
                        <>
                          {" "}
                          <a
                            href={cloudConnectionDocsUrl(docsPath).toString()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="whitespace-nowrap font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            {translator.translateText(READ_THE_GUIDE)}
                          </a>
                        </>
                      ) : (
                        <></>
                      )}
                    </p>
                  ) : (
                    <></>
                  )}
                  {row.kinds.length > 0 ? (
                    <div
                      className={
                        hasHeading || isOrganization
                          ? "mt-2 space-y-3"
                          : "space-y-3"
                      }
                      data-testid="cloud-commitment-kinds"
                    >
                      {row.kinds.map(
                        (figures: CloudCommitmentKindFigures): ReactElement => {
                          return (
                            <CloudCommitmentKindLine
                              key={figures.kind}
                              figures={figures}
                              provider={row.account.provider}
                              currency={row.summary.currency}
                            />
                          );
                        },
                      )}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {hidden > 0 ? (
          <button
            type="button"
            aria-expanded={showAll}
            data-testid="cloud-commitments-toggle"
            className="-ms-2 mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => {
              setShowAll(!showAll);
            }}
          >
            <Icon
              icon={showAll ? IconProp.ChevronUp : IconProp.ChevronDown}
              className="h-3 w-3"
            />
            <span>
              {showAll
                ? translator.translateText(SHOW_FEWER_COMMITMENTS)
                : translator.translatePlural(SHOW_MORE_COMMITMENTS, hidden)}
            </span>
          </button>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default CloudCommitmentsCard;
