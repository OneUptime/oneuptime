import DetectionRuleSummary, {
  DetectionRuleTypeLabel,
} from "./DetectionRuleSummary";
import {
  ADDED,
  ADDED_AS,
  DATA_KIND_HOW_TO_SEND,
  DATA_KIND_SEND_PAGE,
  DATA_KIND_TITLES,
  DATA_STATUS_SENTENCES,
  GO_TO_DETECTION_RULES,
  HOW_IT_RUNS,
  MITRE_ATTACK,
  RECOMMENDED,
  RULE_LIBRARY_CATEGORY_TITLES,
  SIGMA_RULE,
  TURNED_OFF_NOTE,
  WHAT_IT_READS,
  getDataKindSendLinkText,
  getDataSourceDetail,
} from "./RuleLibraryCopy";
import RuleLibraryDataStatus from "./RuleLibraryDataStatus";
import { LibraryRuleDataStatus, LibraryRuleView } from "./RuleLibraryUtil";
import SecurityEventSeverityPill from "./SecurityEventSeverityPill";
import { getMitreAttackUrl } from "../SecurityCase/MitreAttackLinks";
import { getProblemReasonText } from "../SecurityOverview/SecurityTurnOnProblems";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { DetectionRuleLibraryEntry } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  MitreTactic,
  getMitreTactic,
  getMitreTechnique,
} from "Common/Types/SecurityEvent/MitreAttack";
import { TurnOnRecommendedProblem } from "Common/Types/SecurityEvent/TurnOnRecommended";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A library rule's details, beside the list (a side panel, so the list
 * stays where the reader left it): what it finds and how severe that is,
 * the events it reads and whether the project sends them - and, when it
 * does not, how to start - how it runs, the ATT&CK tactics and techniques
 * it is tagged with (each a link to its page on attack.mitre.org) and its
 * Sigma rule, to read or copy. Add Rule in the footer adds it; a rule the
 * project has already says so, and whether it is on.
 */

export const RULE_LIBRARY_PANEL_TEST_ID: string = "rule-library-details";

// How a rule runs, as its details name each fact.
const RUNS_EVERY: string = translationKey("Runs every");
const FIRES_AT: string = translationKey("Fires at");
const GROUPED_BY: string = translationKey("Grouped by");
const COUNTING_DISTINCT: string = translationKey("Counting distinct");

export interface ComponentProps {
  view: LibraryRuleView;
  canAdd: boolean;
  cannotAddReason?: string | undefined;
  isAdding: boolean;
  // Another add is in flight.
  isAddDisabled: boolean;
  // Why the last Add could not add this rule, if it could not.
  problem: TurnOnRecommendedProblem | undefined;
  problemKey: number;
  onAdd: () => void;
  onClose: () => void;
}

// A section's name, an English key looked up in the reader's language.
const SectionTitle: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
      {translator.translateText(props.text) || props.text}
    </h3>
  );
};

function pageRoute(page: PageMap): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route) as Route;
}

const LINK_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

// A tactic or technique, its id in the code font, linked to attack.mitre.org.
const AttackItem: FunctionComponent<{ id: string; name: string }> = (props: {
  id: string;
  name: string;
}): ReactElement => {
  const url: string | null = getMitreAttackUrl(props.id);

  const content: ReactElement = (
    <>
      <span className="font-mono text-xs text-gray-500">{props.id}</span>
      <span className="text-sm text-gray-700">{props.name}</span>
    </>
  );

  return (
    <li className="flex min-w-0 items-baseline gap-2">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-baseline gap-2 rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {content}
          <Icon
            icon={IconProp.ExternalLink}
            className="h-3 w-3 flex-none self-center text-gray-400"
          />
        </a>
      ) : (
        content
      )}
    </li>
  );
};

const RuleLibraryRulePanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const view: LibraryRuleView = props.view;
  const entry: DetectionRuleLibraryEntry = view.entry;
  const isCorrelation: boolean = Boolean(
    view.shape && view.shape.isCorrelation,
  );

  const runsEvery: string = translator.translatePlural(
    { one: "{{count}} minute", other: "{{count}} minutes" },
    entry.evaluationIntervalInMinutes,
  );

  /*
   * How it runs: a correlation says what it looks for in a sentence and
   * holds its own grouping; a single rule counts its matches by the fields
   * the library sets. A fact the rule does not use is left out rather than
   * drawn as a dash.
   */
  const groupBy: string = isCorrelation
    ? (view.shape?.groupBy || []).join(" / ")
    : entry.groupByField || "";
  const facts: Array<{ label: string; value: string; isCode: boolean }> = [
    { label: RUNS_EVERY, value: runsEvery, isCode: false },
    ...(isCorrelation
      ? []
      : [
          {
            label: FIRES_AT,
            value: translator.translatePlural(
              { one: "{{count}} match", other: "{{count}} matches" },
              entry.matchCountThreshold,
            ),
            isCode: false,
          },
        ]),
    ...(groupBy ? [{ label: GROUPED_BY, value: groupBy, isCode: true }] : []),
    ...(!isCorrelation && entry.distinctCountField
      ? [
          {
            label: COUNTING_DISTINCT,
            value: entry.distinctCountField,
            isCode: true,
          },
        ]
      : []),
  ];

  const tactics: Array<MitreTactic> = view.attack.tacticIds
    .map((id: string): MitreTactic | undefined => {
      return getMitreTactic(id);
    })
    .filter((tactic: MitreTactic | undefined): tactic is MitreTactic => {
      return Boolean(tactic);
    });

  const isNotReceived: boolean =
    view.dataStatus === LibraryRuleDataStatus.NotReceived;
  const dataSourceDetail: string | null = getDataSourceDetail(entry);

  const addedNote: ReactElement = view.isAdded ? (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
      data-testid="rule-library-details-added"
    >
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900">
        <Icon
          icon={IconProp.Check}
          className="h-4 w-4 flex-none text-emerald-600"
        />
        {view.addedAsName
          ? translator.translateTemplate(ADDED_AS, {
              name: view.addedAsName,
            })
          : translator.translateText(ADDED)}
      </span>
      {view.isTurnedOff ? (
        <span
          className="text-sm text-gray-600"
          data-testid="rule-library-details-off"
        >
          {translator.translateText(TURNED_OFF_NOTE)}
        </span>
      ) : (
        <></>
      )}
      <Link
        to={pageRoute(PageMap.SECURITY_EVENTS_DETECTION_RULES)}
        className={`${LINK_CLASS_NAME} ml-auto`}
        dataTestId="rule-library-details-rules-link"
      >
        <>
          {translator.translateText(GO_TO_DETECTION_RULES)}
          <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
        </>
      </Link>
    </div>
  ) : (
    <></>
  );

  return (
    <SideOver
      title={entry.title}
      description={entry.description}
      onClose={props.onClose}
      size={SideOverSize.Small}
      {...(!view.isAdded
        ? {
            submitButtonText: "Add Rule",
            submitButtonIsLoading: props.isAdding,
            submitButtonDisabled:
              !props.canAdd || props.isAdding || props.isAddDisabled,
            onSubmit: props.onAdd,
          }
        : {})}
      leftFooterElement={
        !view.isAdded && !props.canAdd && props.cannotAddReason ? (
          <p
            className="max-w-xs self-center text-sm text-gray-500"
            data-testid="rule-library-details-cannot-add"
          >
            {props.cannotAddReason}
          </p>
        ) : undefined
      }
    >
      <div
        className="space-y-6 sm:pt-6"
        data-testid={RULE_LIBRARY_PANEL_TEST_ID}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SecurityEventSeverityPill severityName={view.severity} />
          {view.isRecommended ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
              <Icon icon={IconProp.Star} className="h-3 w-3" />
              {translator.translateText(RECOMMENDED)}
            </span>
          ) : (
            <></>
          )}
          {view.shape && view.shape.isCorrelation ? (
            <DetectionRuleTypeLabel shape={view.shape} />
          ) : (
            <></>
          )}
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
            {translator.translateText(
              RULE_LIBRARY_CATEGORY_TITLES[entry.category],
            )}
          </span>
        </div>

        {addedNote}

        {props.problem ? (
          <div
            key={props.problemKey}
            className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 [overflow-wrap:anywhere]"
            data-testid="rule-library-details-problem"
            role="alert"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <span>{getProblemReasonText(translator, props.problem)}</span>
          </div>
        ) : (
          <></>
        )}

        <section data-testid="rule-library-details-data">
          <SectionTitle text={WHAT_IT_READS} />
          <div className="mt-2 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-gray-900">
                {translator.translateText(DATA_KIND_TITLES[entry.dataKind])}
              </span>
              <RuleLibraryDataStatus
                status={view.dataStatus}
                dataTestId="rule-library-details-data-status"
              />
            </div>
            {dataSourceDetail ? (
              <p
                className="text-sm text-gray-500"
                data-testid="rule-library-details-data-source"
              >
                {dataSourceDetail}
              </p>
            ) : (
              <></>
            )}
            {view.dataStatus !== LibraryRuleDataStatus.Unknown ? (
              <p className="text-sm text-gray-600">
                {translator.translateText(
                  DATA_STATUS_SENTENCES[view.dataStatus],
                )}
              </p>
            ) : (
              <></>
            )}
            {isNotReceived ? (
              <div
                className="mt-2 space-y-2 rounded-lg border border-gray-200 px-3 py-2"
                data-testid="rule-library-details-how-to-send"
              >
                <p className="text-sm text-gray-700">
                  {translator.translateText(
                    DATA_KIND_HOW_TO_SEND[entry.dataKind],
                  )}
                </p>
                <Link
                  to={pageRoute(DATA_KIND_SEND_PAGE[entry.dataKind])}
                  className={LINK_CLASS_NAME}
                  dataTestId="rule-library-details-send-link"
                >
                  <>
                    {translator.translateText(
                      getDataKindSendLinkText(entry.dataKind),
                    )}
                    <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
                  </>
                </Link>
              </div>
            ) : (
              <></>
            )}
          </div>
        </section>

        <section data-testid="rule-library-details-runs">
          <SectionTitle text={HOW_IT_RUNS} />
          <div className="mt-2 space-y-3">
            {isCorrelation ? (
              <DetectionRuleSummary
                shape={view.shape}
                dataTestId="rule-library-details-summary"
              />
            ) : (
              <></>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {facts.map(
                (fact: {
                  label: string;
                  value: string;
                  isCode: boolean;
                }): ReactElement => {
                  return (
                    <div key={fact.label}>
                      <dt className="text-xs text-gray-500">
                        {translator.translateText(fact.label)}
                      </dt>
                      <dd
                        className={`break-words text-gray-900 ${
                          fact.isCode ? "font-mono text-xs leading-5" : ""
                        }`}
                      >
                        {fact.value}
                      </dd>
                    </div>
                  );
                },
              )}
            </dl>
          </div>
        </section>

        {tactics.length > 0 || view.attack.techniqueIds.length > 0 ? (
          <section data-testid="rule-library-details-attack">
            <SectionTitle text={MITRE_ATTACK} />
            <ul className="mt-2 space-y-1">
              {tactics.map((tactic: MitreTactic): ReactElement => {
                return (
                  <AttackItem
                    key={tactic.id}
                    id={tactic.id}
                    name={tactic.name}
                  />
                );
              })}
              {view.attack.techniqueIds.map((id: string): ReactElement => {
                return (
                  <AttackItem
                    key={id}
                    id={id}
                    name={getMitreTechnique(id)?.name || ""}
                  />
                );
              })}
            </ul>
          </section>
        ) : (
          <></>
        )}

        <section data-testid="rule-library-details-sigma">
          <SectionTitle text={SIGMA_RULE} />
          <div className="mt-2">
            <CodeBlock
              code={entry.sigmaRuleYaml}
              language="yaml"
              maxHeight="24rem"
            />
          </div>
        </section>
      </div>
    </SideOver>
  );
};

export default RuleLibraryRulePanel;
