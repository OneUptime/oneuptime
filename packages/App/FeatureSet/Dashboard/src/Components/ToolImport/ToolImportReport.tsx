import { toolImportDocsUrl } from "./ToolImportApi";
import ToolImportLogo from "./ToolImportLogo";
import ToolImportNoteList from "./ToolImportNoteList";
import {
  getToolImportReportRecords,
  getToolImportReportSections,
  TOOL_IMPORT_REPORT_COUNT_ORDER,
  TOOL_IMPORT_SECTION_PAGE_SIZE,
  ToolImportReportRecord,
  ToolImportReportSection,
} from "./ToolImportPlanView";
import { STATUS_PAGE_CUSTOM_DOMAINS } from "../CustomDomain/CustomDomainKinds";
import PublicAddresses from "../CustomDomain/PublicAddresses";
import { getTestPolicyGate } from "../OnCallTestPage/OnCallTestPageAccess";
import SendTestPageButton from "../OnCallTestPage/SendTestPageButton";
import { STATUS_PAGE_EXAMPLE_DOMAIN } from "../StatusPage/StatusPageOverviewCopy";
import {
  describeToolImportNote,
  formatToolImportDateTime,
  TOOL_IMPORT_KIND_TITLES,
  TOOL_IMPORT_OUTCOME_COUNTS,
  getToolImportOutcomeLabel,
} from "./ToolImportText";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Color from "Common/Types/Color";
import {
  Blue,
  Gray500,
  Green,
  Orange,
  Red,
  Slate500,
} from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  getToolImportSourceDefinition,
  isToolImportStatusPageHost,
  ToolImportCategory,
  ToolImportSourceDefinition,
} from "Common/Types/ToolImport/ToolImportCatalog";
import {
  countToolImportOutcomes,
  ToolImportOutcome,
  ToolImportOutcomeCounts,
  ToolImportReport as ToolImportReportData,
  ToolImportReportItem,
  ToolImportRunView,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "Common/Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { STATUS_PAGE_URL } from "Common/UI/Config";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
  useState,
} from "react";

/*
 * Step four: what the import did. The counts at the top, every item with
 * what it became - linked to the record it became, failures first - and,
 * once it is done, what is left to finish the switch, with the step that
 * proves it works: a test page to a policy it brought over, or where each
 * status page it brought over is live (#7032).
 *
 * A run that never got as far as importing (the read failed, the preview
 * was discarded or expired) says so, and offers a new import.
 */

const OUTCOME_COLORS: Record<ToolImportOutcome, Color> = {
  [ToolImportOutcome.Created]: Green,
  [ToolImportOutcome.Invited]: Blue,
  [ToolImportOutcome.Matched]: Slate500,
  [ToolImportOutcome.AlreadyImported]: Gray500,
  [ToolImportOutcome.Skipped]: Orange,
  [ToolImportOutcome.Failed]: Red,
};

/*
 * Where a record of each kind is opened: its own page, or - for incident
 * settings, which have none - the list it is in.
 */
export const TOOL_IMPORT_RECORD_PAGES: Record<
  ToolImportResourceKind,
  { page: PageMap; isRecordPage: boolean }
> = {
  [ToolImportResourceKind.Person]: {
    page: PageMap.USER_VIEW,
    isRecordPage: true,
  },
  [ToolImportResourceKind.Team]: {
    page: PageMap.TEAM_VIEW,
    isRecordPage: true,
  },
  [ToolImportResourceKind.Service]: {
    page: PageMap.SERVICE_VIEW,
    isRecordPage: true,
  },
  [ToolImportResourceKind.IncidentSeverity]: {
    page: PageMap.INCIDENTS_SETTINGS_SEVERITY,
    isRecordPage: false,
  },
  [ToolImportResourceKind.IncidentState]: {
    page: PageMap.INCIDENTS_SETTINGS_STATE,
    isRecordPage: false,
  },
  [ToolImportResourceKind.IncidentRole]: {
    page: PageMap.INCIDENTS_SETTINGS_ROLES,
    isRecordPage: false,
  },
  [ToolImportResourceKind.IncidentCustomField]: {
    page: PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS,
    isRecordPage: false,
  },
  [ToolImportResourceKind.OnCallSchedule]: {
    page: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
    isRecordPage: true,
  },
  [ToolImportResourceKind.OnCallPolicy]: {
    page: PageMap.ON_CALL_DUTY_POLICY_VIEW,
    isRecordPage: true,
  },
  [ToolImportResourceKind.Monitor]: {
    page: PageMap.MONITOR_VIEW,
    isRecordPage: true,
  },
  [ToolImportResourceKind.StatusPage]: {
    page: PageMap.STATUS_PAGE_VIEW,
    isRecordPage: true,
  },
  // A subscriber is listed on its status page, which the report names.
  [ToolImportResourceKind.StatusPageSubscriber]: {
    page: PageMap.STATUS_PAGES,
    isRecordPage: false,
  },
};

function getRecordRoute(
  kind: ToolImportResourceKind,
  recordId: string,
): Route | null {
  const target: { page: PageMap; isRecordPage: boolean } =
    TOOL_IMPORT_RECORD_PAGES[kind];
  const route: Route | undefined = RouteMap[target.page];

  if (!route) {
    return null;
  }

  return target.isRecordPage
    ? RouteUtil.populateRouteParams(route, { modelId: recordId })
    : RouteUtil.populateRouteParams(route);
}

const ReportItem: FunctionComponent<{
  item: ToolImportReportItem;
  toolTitle: string;
}> = (props: {
  item: ToolImportReportItem;
  toolTitle: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const item: ToolImportReportItem = props.item;
  const firstRecordId: string | undefined = item.recordIds[0];
  const route: Route | null =
    firstRecordId && item.outcome !== ToolImportOutcome.Failed
      ? getRecordRoute(item.kind, firstRecordId)
      : null;
  const reason: string = item.reason
    ? describeToolImportNote(item.reason, translator, props.toolTitle)
    : "";

  return (
    <li
      className="px-4 py-3"
      data-testid={`tool-import-report-item-${item.key}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {route ? (
          <Link
            to={route}
            className="break-words text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            {item.name}
          </Link>
        ) : (
          <span className="break-words text-sm font-medium text-gray-900">
            {item.name}
          </span>
        )}
        <Pill
          text={getToolImportOutcomeLabel(translator, item.outcome)}
          isUserContent={true}
          color={OUTCOME_COLORS[item.outcome]}
          size={PillSize.Small}
        />
        {item.recordIds.length > 1 &&
          item.kind === ToolImportResourceKind.OnCallSchedule && (
            <span className="text-sm text-gray-500">
              {translator.translatePlural(
                {
                  one: "became {{count}} schedule",
                  other: "became {{count}} schedules",
                },
                item.recordIds.length,
              )}
            </span>
          )}
      </div>
      {reason && <p className="mt-1 text-sm text-gray-600">{reason}</p>}
      {item.error && (
        <p
          className="mt-1 break-words text-sm text-red-600"
          data-testid={`tool-import-report-error-${item.key}`}
        >
          {item.error}
        </p>
      )}
      <ToolImportNoteList notes={item.notes} toolTitle={props.toolTitle} />
    </li>
  );
};

const ReportSection: FunctionComponent<{
  section: ToolImportReportSection;
  toolTitle: string;
}> = (props: {
  section: ToolImportReportSection;
  toolTitle: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [shownCount, setShownCount] = useState<number>(
    TOOL_IMPORT_SECTION_PAGE_SIZE,
  );
  const section: ToolImportReportSection = props.section;
  const hiddenCount: number = section.items.length - shownCount;

  return (
    <section
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
      data-testid={`tool-import-report-section-${section.kind}`}
    >
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {translator.translateTemplate(TOOL_IMPORT_KIND_TITLES[section.kind])}
        </h3>
      </div>
      <ul className="divide-y divide-gray-200">
        {section.items
          .slice(0, shownCount)
          .map((item: ToolImportReportItem): ReactElement => {
            return (
              <ReportItem
                key={item.key}
                item={item}
                toolTitle={props.toolTitle}
              />
            );
          })}
      </ul>
      {hiddenCount > 0 && (
        <div className="border-t border-gray-200 px-4 py-2">
          <Button
            title={translator.translatePlural(
              { one: "Show {{count}} more", other: "Show {{count}} more" },
              Math.min(hiddenCount, TOOL_IMPORT_SECTION_PAGE_SIZE),
            )}
            isTitleTranslated={true}
            buttonStyle={ButtonStyleType.LINK}
            onClick={() => {
              setShownCount(shownCount + TOOL_IMPORT_SECTION_PAGE_SIZE);
            }}
            dataTestId={`tool-import-report-show-more-${section.kind}`}
          />
        </div>
      )}
    </section>
  );
};

/*
 * THE NEXT STEP AN IMPORT ENDS ON (issue #7032). A switch is done when it
 * works, not when the records exist: an on-call tool's checklist offers a
 * test page to a policy the import brought over (#6811's dialog), and a
 * status page tool's shows each page's address - where it is live now, to
 * open and copy - with the way to put it on the team's own domain
 * (PublicAddresses, as a status page's Overview draws them).
 */

export const TOOL_IMPORT_TEST_PAGE_TEST_ID: string = "tool-import-test-page";
export const TOOL_IMPORT_TEST_POLICY_TEST_ID: string =
  "tool-import-test-policy";
export const TOOL_IMPORT_TEST_POLICY_PICKER_TEST_ID: string =
  "tool-import-test-policy-picker";
export const TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID: string =
  "tool-import-status-page-addresses";

/*
 * How many imported status pages the address step shows: an account's
 * main pages, few enough for the checklist to stay a checklist. The rest
 * are a click away, on Status Pages.
 */
export const TOOL_IMPORT_STATUS_PAGE_ADDRESSES_SHOWN: number = 3;

export const TOOL_IMPORT_TEST_PAGE_COPY: {
  title: string;
  onePolicy: string;
  severalPolicies: string;
  policyPicker: string;
} = {
  title: translationKey("Send a test page"),
  onePolicy: translationKey(
    "Page {{policy}} once to see that it reaches people, without an incident. Every message says TEST.",
  ),
  severalPolicies: translationKey(
    "Pick a policy you brought over and page it once to see that it reaches people, without an incident. Every message says TEST.",
  ),
  policyPicker: translationKey("On-Call Policy"),
};

/*
 * Test this policy, on the policy picked: the first the import brought
 * over, or - with several - the one picked from them.
 */
const TestImportedPolicy: FunctionComponent<{
  policies: Array<ToolImportReportRecord>;
}> = (props: { policies: Array<ToolImportReportRecord> }): ReactElement => {
  const translator: Translator = useTranslator();
  const pickerId: string = useId();
  const [pickedId, setPickedId] = useState<string>(props.policies[0]!.id);
  const policy: ToolImportReportRecord =
    props.policies.find((candidate: ToolImportReportRecord): boolean => {
      return candidate.id === pickedId;
    }) || props.policies[0]!;

  // A policy's name is the team's own: drawn as written.
  const options: Array<DropdownOption> = props.policies.map(
    (candidate: ToolImportReportRecord): DropdownOption => {
      return {
        value: candidate.id,
        label: candidate.name,
        isUserContent: true,
      };
    },
  );

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2"
      data-testid={TOOL_IMPORT_TEST_PAGE_TEST_ID}
    >
      {props.policies.length > 1 ? (
        <div className="w-full min-w-0 sm:w-64">
          <label htmlFor={pickerId} className="sr-only">
            {translator.translateText(TOOL_IMPORT_TEST_PAGE_COPY.policyPicker)}
          </label>
          <Dropdown
            inputId={pickerId}
            options={options}
            value={options.find((option: DropdownOption): boolean => {
              return option.value === policy.id;
            })}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              if (typeof value === "string") {
                setPickedId(value);
              }
            }}
            isClearable={false}
            isCompact={true}
            dataTestId={TOOL_IMPORT_TEST_POLICY_PICKER_TEST_ID}
          />
        </div>
      ) : (
        <></>
      )}
      <SendTestPageButton
        target={{
          kind: "policy",
          policyId: policy.id,
          policyName: policy.name,
        }}
        buttonStyle={ButtonStyleType.OUTLINE}
        buttonSize={ButtonSize.Small}
        dataTestId={TOOL_IMPORT_TEST_POLICY_TEST_ID}
      />
    </div>
  );
};

/*
 * Each imported page's addresses: on OneUptime's own domain, live now, and
 * the team's own domain once it is added - with Add a custom domain, which
 * opens the page's Custom Domains, while it has none.
 */
const ImportedStatusPageAddresses: FunctionComponent<{
  pages: Array<ToolImportReportRecord>;
}> = (props: { pages: Array<ToolImportReportRecord> }): ReactElement => {
  return (
    <div
      className="mt-3 space-y-4"
      data-testid={TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID}
    >
      {props.pages
        .slice(0, TOOL_IMPORT_STATUS_PAGE_ADDRESSES_SHOWN)
        .map((page: ToolImportReportRecord): ReactElement => {
          const pageId: ObjectID = new ObjectID(page.id);

          return (
            <div
              key={page.id}
              data-testid={`${TOOL_IMPORT_STATUS_PAGE_ADDRESSES_TEST_ID}-${page.id}`}
            >
              <p className="mb-1.5 break-words font-medium text-gray-900">
                {page.name}
              </p>
              <PublicAddresses
                kind={STATUS_PAGE_CUSTOM_DOMAINS}
                parentId={pageId}
                oneUptimeUrl={URL.fromString(
                  `${STATUS_PAGE_URL.toString()}/${page.id}`,
                )}
                customDomainsRoute={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.STATUS_PAGE_VIEW_DOMAINS] as Route,
                  { modelId: pageId },
                )}
                exampleDomain={STATUS_PAGE_EXAMPLE_DOMAIN}
              />
            </div>
          );
        })}
    </div>
  );
};

interface FinishStep {
  title: string;
  description: string;
  link?: { title: string; route: Route } | undefined;
  // What the step offers to do there and then (#7032), under its words.
  content?: ReactElement | undefined;
}

/*
 * What is left to do once an uptime or status page tool's import is done:
 * check the monitors (a heartbeat has a new address), choose who is told,
 * point the status page's domain at OneUptime, and stop the old checks -
 * or, for a tool that only hosts status pages, check the pages, point the
 * domain and close the old page. The step on the domain shows each
 * imported page's address (#7032).
 */
function getMonitoringFinishSteps(data: {
  translator: Translator;
  toolTitle: string;
  bringsStatusPages: boolean;
  isStatusPageHost: boolean;
  statusPages: Array<ToolImportReportRecord>;
}): Array<FinishStep> {
  const translator: Translator = data.translator;
  const toolValues: { tool: string } = { tool: data.toolTitle };
  const statusPagesLink: { title: string; route: Route } = {
    title: translator.translateTemplate("Open Status Pages"),
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.STATUS_PAGES] as Route,
    ),
  };

  /*
   * Where the imported pages are, under the step that moves them to the
   * team's domain. Status Pages stays linked only for the pages the step
   * leaves out, or when the import brought none.
   */
  const addressStep: FinishStep = {
    title: translator.translateTemplate(
      "Point your status page's address at OneUptime",
    ),
    description: translator.translateTemplate(
      "Add your domain under the status page's Custom Domains, then change its DNS record. Your visitors and subscribers then reach the new page.",
    ),
    content:
      data.statusPages.length > 0 ? (
        <ImportedStatusPageAddresses pages={data.statusPages} />
      ) : undefined,
  };
  const addressStepLink: { title: string; route: Route } | undefined =
    data.statusPages.length > TOOL_IMPORT_STATUS_PAGE_ADDRESSES_SHOWN
      ? statusPagesLink
      : undefined;

  /*
   * A tool that only hosts status pages checks nothing: what is left is
   * the page itself, its address, and closing the old one.
   */
  if (data.isStatusPageHost) {
    return [
      {
        title: translator.translateTemplate("Check your status pages"),
        description: translator.translateTemplate(
          "Open each status page and compare it with the one in {{tool}}. Each component is a manual monitor: set its status in OneUptime when something changes.",
          toolValues,
        ),
        link: statusPagesLink,
      },
      { ...addressStep, link: addressStepLink },
      {
        title: translator.translateTemplate(
          "Turn off your page in {{tool}}",
          toolValues,
        ),
        description: translator.translateTemplate(
          "Once your domain points at OneUptime, close the page in {{tool}} so its subscribers are not told twice.",
          toolValues,
        ),
      },
    ];
  }

  const steps: Array<FinishStep> = [
    {
      title: translator.translateTemplate("Check your monitors"),
      description: translator.translateTemplate(
        "Open each monitor and check its first results. A heartbeat monitor has a new address: point the job that pings it there.",
      ),
      link: {
        title: translator.translateTemplate("Open Monitors"),
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS] as Route,
        ),
      },
    },
    {
      title: translator.translateTemplate("Choose who is told"),
      description: translator.translateTemplate(
        "Add owners to your monitors, or an on-call policy to the incidents they open, so the right people hear when something goes down.",
      ),
      link: {
        title: translator.translateTemplate("Open On-Call Policies"),
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route,
        ),
      },
    },
  ];

  if (data.bringsStatusPages) {
    steps.push({
      ...addressStep,
      link: data.statusPages.length > 0 ? addressStepLink : statusPagesLink,
    });
  }

  steps.push({
    title: translator.translateTemplate(
      "Turn off the checks in {{tool}}",
      toolValues,
    ),
    description: translator.translateTemplate(
      "Once OneUptime checks the same things, pause them in {{tool}} so nobody is told twice.",
      toolValues,
    ),
  });

  return steps;
}

/*
 * What is left to do once an on-call tool's import is done: check the
 * schedules, make sure everyone can be paged, send a test page to a policy
 * it brought over (#7032) - for whoever may test one - carry on the
 * incident numbers, send the alerts here, and switch the old paging off.
 */
function getOnCallFinishSteps(data: {
  translator: Translator;
  toolTitle: string;
  policies: Array<ToolImportReportRecord>;
  canTestPolicies: boolean;
}): Array<FinishStep> {
  const translator: Translator = data.translator;
  const toolValues: { tool: string } = { tool: data.toolTitle };
  const steps: Array<FinishStep> = [
    {
      title: translator.translateTemplate("Check the on-call schedules"),
      description: translator.translateTemplate(
        "Open each schedule and check who is on call now and who is next.",
      ),
      link: {
        title: translator.translateTemplate("Open On-Call Schedules"),
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES] as Route,
        ),
      },
    },
    {
      title: translator.translateTemplate("Make sure everyone can be paged"),
      description: translator.translateTemplate(
        "People you invited accept their invitation, then add a phone number, an email address or the mobile app to be paged on.",
      ),
      link: {
        title: translator.translateTemplate("Open On-Call Readiness"),
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.ON_CALL_DUTY_READINESS] as Route,
        ),
      },
    },
  ];

  /*
   * Once people can be paged, a test page proves it: the policy's first
   * escalation rule is paged as an incident would page it, each message
   * marked TEST, and nobody else is told.
   */
  if (data.policies.length > 0 && data.canTestPolicies) {
    const onlyPolicy: ToolImportReportRecord | undefined =
      data.policies.length === 1 ? data.policies[0] : undefined;

    steps.push({
      title: translator.translateTemplate(TOOL_IMPORT_TEST_PAGE_COPY.title),
      description: onlyPolicy
        ? translator.translateTemplate(TOOL_IMPORT_TEST_PAGE_COPY.onePolicy, {
            policy: onlyPolicy.name,
          })
        : translator.translateTemplate(
            TOOL_IMPORT_TEST_PAGE_COPY.severalPolicies,
          ),
      content: <TestImportedPolicy policies={data.policies} />,
    });
  }

  steps.push(
    /*
     * The import brings the setup over, not past incidents, so it
     * leaves the numbers alone: a team that says "INC-2345" carries
     * on after it, before its first incident is declared here.
     */
    {
      title: translator.translateTemplate("Carry on your incident numbers"),
      description: translator.translateTemplate(
        "If your team refers to incidents by number, start OneUptime's after your last one in {{tool}}: set Next Incident Number to one past it. A number then never means two different incidents.",
        toolValues,
      ),
      link: {
        title: translator.translateTemplate("Open Incident Numbering"),
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS_SETTINGS_NUMBERING] as Route,
        ),
      },
    },
    {
      title: translator.translateTemplate("Send your alerts to OneUptime"),
      description: translator.translateTemplate(
        "Point your monitors and the tools that raise alerts at OneUptime, and page yourself once to test it.",
      ),
      link: {
        title: translator.translateTemplate("Open Monitors"),
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS] as Route,
        ),
      },
    },
    {
      title: translator.translateTemplate(
        "Turn off paging in {{tool}}",
        toolValues,
      ),
      description: translator.translateTemplate(
        "Once OneUptime pages the right people, switch off notifications in {{tool}} so nobody is paged twice.",
        toolValues,
      ),
    },
  );

  return steps;
}

const FinishTheSwitch: FunctionComponent<{
  toolTitle: string;
  docsPath: string;
  category: ToolImportCategory;
  bringsStatusPages: boolean;
  isStatusPageHost: boolean;
  report: ToolImportReportData;
}> = (props: {
  toolTitle: string;
  docsPath: string;
  category: ToolImportCategory;
  bringsStatusPages: boolean;
  isStatusPageHost: boolean;
  report: ToolImportReportData;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const toolValues: { tool: string } = { tool: props.toolTitle };

  const steps: Array<FinishStep> =
    props.category === ToolImportCategory.Monitoring
      ? getMonitoringFinishSteps({
          translator: translator,
          toolTitle: props.toolTitle,
          bringsStatusPages: props.bringsStatusPages,
          isStatusPageHost: props.isStatusPageHost,
          statusPages: getToolImportReportRecords(
            props.report,
            ToolImportResourceKind.StatusPage,
          ),
        })
      : getOnCallFinishSteps({
          translator: translator,
          toolTitle: props.toolTitle,
          policies: getToolImportReportRecords(
            props.report,
            ToolImportResourceKind.OnCallPolicy,
          ),
          canTestPolicies: getTestPolicyGate().isAllowed,
        });

  return (
    <div
      className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4"
      data-testid="tool-import-finish"
    >
      <p className="text-sm font-semibold text-gray-900">
        {translator.translateTemplate("Finish the switch")}
      </p>
      <ol className="mt-3 space-y-3">
        {steps.map((step: FinishStep, index: number): ReactElement => {
          return (
            <li key={step.title} className="flex items-start gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
                {translator.formatNumber(index + 1)}
              </span>
              {/*
               * As wide as the row: a step's addresses line up across it,
               * their actions at its end.
               */}
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium text-gray-900">{step.title}</p>
                <p className="mt-0.5 text-gray-600">{step.description}</p>
                {step.content}
                {step.link && (
                  <Link
                    to={step.link.route}
                    className="mt-1 inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    {step.link.title}
                    <Icon icon={IconProp.ChevronRight} className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 text-sm">
        <Link
          to={toolImportDocsUrl(props.docsPath)}
          openInNewTab={true}
          className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-indigo-600"
        >
          {translator.translateTemplate(
            "Read the guide to moving from {{tool}}",
            toolValues,
          )}
          <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
};

export interface ComponentProps {
  run: ToolImportRunView;
  report?: ToolImportReportData | undefined;
  /*
   * Opens the tool picker - or, after a failure, the same tool's connect
   * step, since the key has to be pasted again either way.
   */
  onStartAnother: (
    source?: ToolImportSource | undefined,
    region?: string | undefined,
  ) => void;
}

const ToolImportReport: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const run: ToolImportRunView = props.run;
  const definition: ToolImportSourceDefinition = getToolImportSourceDefinition(
    run.source,
  );
  const toolTitle: string = definition.title;
  const report: ToolImportReportData = props.report || { items: [] };

  const sections: Array<ToolImportReportSection> = useMemo(() => {
    return getToolImportReportSections(report);
  }, [report]);

  const counts: ToolImportOutcomeCounts = countToolImportOutcomes(report);
  const isDone: boolean = run.status === ToolImportRunStatus.Completed;
  const isFailed: boolean = run.status === ToolImportRunStatus.Failed;
  const finishedAt: string | undefined = run.completedAt || run.createdAt;

  let headline: string;
  let explanation: string | null = null;

  if (isDone) {
    headline = translator.translateTemplate(
      "The import from {{tool}} is done",
      { tool: toolTitle },
    );
  } else if (isFailed) {
    headline =
      report.items.length > 0
        ? translator.translateTemplate(
            "The import from {{tool}} stopped part way",
            { tool: toolTitle },
          )
        : translator.translateTemplate("Reading {{tool}} did not work", {
            tool: toolTitle,
          });
    explanation =
      report.items.length > 0
        ? translator.translateTemplate(
            "What it did before it stopped is below. Run the import again to bring over the rest: nothing is created twice.",
          )
        : null;
  } else if (run.status === ToolImportRunStatus.Expired) {
    headline = translator.translateTemplate("This preview expired");
    explanation = translator.translateTemplate(
      "A preview is kept for a day. Read the tool again to import from it.",
    );
  } else {
    headline = translator.translateTemplate("This preview was discarded");
    explanation = translator.translateTemplate("Nothing was brought over.");
  }

  return (
    <div data-testid="tool-import-report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ToolImportLogo source={run.source} size="lg" />
          <div className="min-w-0">
            <p
              className="text-base font-semibold text-gray-900"
              data-testid="tool-import-report-headline"
            >
              {headline}
            </p>
            <p className="text-sm text-gray-500">
              {[
                run.accountName,
                run.createdByUserName
                  ? translator.translateTemplate("Started by {{name}}", {
                      name: run.createdByUserName,
                    })
                  : null,
                finishedAt
                  ? formatToolImportDateTime(finishedAt, translator.language)
                  : null,
              ]
                .filter((part: string | null | undefined): part is string => {
                  return Boolean(part);
                })
                .join(" · ")}
            </p>
          </div>
        </div>
        {isFailed ? (
          <Button
            title="Try again"
            buttonStyle={ButtonStyleType.PRIMARY}
            icon={IconProp.Refresh}
            onClick={() => {
              props.onStartAnother(run.source, run.region);
            }}
            dataTestId="tool-import-try-again"
          />
        ) : (
          <Button
            title="Start a new import"
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Add}
            onClick={() => {
              props.onStartAnother();
            }}
            dataTestId="tool-import-start-another"
          />
        )}
      </div>

      {isFailed && run.error && (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
          data-testid="tool-import-run-error"
        >
          <div className="mt-0.5 flex-shrink-0">
            <Icon icon={IconProp.ExclaimationCircle} className="h-4 w-4" />
          </div>
          <p className="break-words">
            {translator.translateTemplate(run.error)}
          </p>
        </div>
      )}

      {explanation && (
        <p className="mt-4 text-sm text-gray-600">{explanation}</p>
      )}

      {report.items.length > 0 && (
        <ul
          className="mt-4 flex flex-wrap gap-2"
          data-testid="tool-import-report-counts"
        >
          {TOOL_IMPORT_REPORT_COUNT_ORDER.filter(
            (outcome: ToolImportOutcome): boolean => {
              return counts[outcome] > 0;
            },
          ).map((outcome: ToolImportOutcome): ReactElement => {
            return (
              <li key={outcome}>
                <Pill
                  text={translator.translatePlural(
                    TOOL_IMPORT_OUTCOME_COUNTS[outcome],
                    counts[outcome],
                  )}
                  isUserContent={true}
                  color={OUTCOME_COLORS[outcome]}
                  size={PillSize.Normal}
                />
              </li>
            );
          })}
        </ul>
      )}

      {isDone && (
        <FinishTheSwitch
          toolTitle={toolTitle}
          docsPath={definition.docsPath}
          category={definition.category}
          bringsStatusPages={definition.kinds.includes(
            ToolImportResourceKind.StatusPage,
          )}
          isStatusPageHost={isToolImportStatusPageHost(definition)}
          report={report}
        />
      )}

      {sections.length > 0 && (
        <div className="mt-6 space-y-6">
          {sections.map((section: ToolImportReportSection): ReactElement => {
            return (
              <ReportSection
                key={section.kind}
                section={section}
                toolTitle={toolTitle}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ToolImportReport;
