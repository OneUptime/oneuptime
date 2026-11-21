import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import DataSecurityApi from "../../../Components/DataSecurity/DataSecurityApi";
import {
  ExposurePill,
  IssueStatusPill,
  SensitivityPill,
  SeverityPill,
} from "../../../Components/DataSecurity/DataSecurityPills";
import {
  ASSIGN_ISSUE,
  ASSIGN_ISSUE_ICON,
  ISSUE_MOVES_LOCKED,
  ISSUE_MOVE_ICONS,
  ISSUE_MOVE_TITLES,
  IssueAcceptance,
  IssueAssigneePick,
  IssueMove,
  getIssueAssignWrite,
  getIssueMoveSentence,
  getIssueMoveWrite,
  isIssueMoveOffered,
  readAcceptedUntil,
} from "../../../Components/DataSecurity/IssueChanges";
import {
  DataTypeNamer,
  IssueDataTypeChips,
  readDataTypeIds,
  useDataTypeNamer,
} from "../../../Components/DataSecurity/IssueDataTypes";
import { getStoreViewRoute } from "../../../Components/DataSecurity/IssueListRoute";
import IssueAiAnalysisCard from "../../../Components/DataSecurity/IssueAiAnalysisCard";
import {
  AcceptIssueRiskModal,
  AssignIssueModal,
  IssueRepositoryModal,
  NotAnIssueModal,
} from "../../../Components/DataSecurity/IssueModals";
import IssueRemediation from "../../../Components/DataSecurity/IssueRemediation";
import IssueResponseAction from "../../../Components/DataSecurity/IssueResponseAction";
import IssueRiskScore, {
  readIssueRiskFactors,
} from "../../../Components/DataSecurity/IssueRiskScore";
import IssueTelemetryFindings from "../../../Components/DataSecurity/IssueTelemetryFindings";
import {
  STORE_DATA_TYPES_NOT_LOADED,
  StoreDataTypesRead,
  useStoreDataTypes,
} from "../../../Components/DataSecurity/StoreDataTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useAiOffered from "../../../Utils/UseAiOffered";
import DataSecurityIssueViewContext, {
  useDataSecurityIssueView,
} from "./IssueViewContext";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  DataSecurityFixRepository,
  DataSecurityFixResult,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  DataSecurityCheckInfo,
  FrameworkRequirementRef,
  getDataSecurityCheck,
  isTelemetryFindingCheck,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import { isComplianceFramework } from "Common/Types/DataSecurity/ComplianceFramework";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import {
  COMPLIANCE_REQUIREMENTS,
  ComplianceRequirementInfo,
} from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import CardMoreMenu from "Common/UI/Components/Card/CardMoreMenu";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import API from "Common/UI/Utils/API/API";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

const RISK_SCORE_BADGE: string = translationKey("Risk score {{score}}");
const ON_STORE: string = translationKey("On {{store}}");
const FIRST_DETECTED: string = translationKey("First detected {{time}}");
const LAST_DETECTED: string = translationKey("Last detected {{time}}");
const RESOLVED_AT: string = translationKey("Resolved {{time}}");
const ASSIGNED_TO: string = translationKey("Assigned to {{name}}");
const NOBODY_ASSIGNED: string = translationKey("Nobody is assigned yet.");
const ACCEPTED_UNTIL: string = translationKey(
  "Risk accepted until {{date}} by {{name}}.",
);
const ACCEPTED_UNTIL_NO_NAME: string = translationKey(
  "Risk accepted until {{date}}.",
);
const REOPENED_TIMES: PluralTemplate = {
  one: "Opened again {{count}} time after it was resolved.",
  other: "Opened again {{count}} times after it was resolved.",
};
const OPEN_SECURITY_CASE: string = translationKey("Security case");
const OPEN_ALERT: string = translationKey("Alert");
const OPEN_INCIDENT: string = translationKey("Incident");
const NO_EVIDENCE: string = translationKey(
  "The check failed without recording more detail.",
);
const EVIDENCE_LABEL: string = translationKey("What the check saw");
const STORE_HOLDS_LABEL: string = translationKey("What the store holds");
const EXPOSURE_LABEL: string = translationKey("Who can reach it");
const REQUIREMENTS_LABEL: string = translationKey("Requirements it affects");
const NO_DATA_TYPES: string = translationKey("No sensitive data found yet.");
const UNKNOWN_CHECK: string = translationKey(
  "This check is no longer in the catalog. Its evidence is below.",
);
const OPEN_TASK: string = translationKey("Open the task");
const HOW_TO_FIX: string = translationKey(
  "Fix it in the console, from the CLI or with Terraform, then mark it resolved: the store is checked again at once.",
);
// A telemetry issue is fixed at ingest and in the code that writes the data.
const HOW_TO_FIX_TELEMETRY: string = translationKey(
  "Scrub it at ingest from the list above, then fix the code that writes it. The issue resolves once the store is checked again.",
);
const MORE_ACTIONS: string = translationKey("More actions");

type IssueDialog = "accept" | "assign" | "repository" | "notAnIssue" | null;

interface FixNotice {
  message: string;
  taskId?: string | undefined;
}

// The requirements an issue is evidence for: its own, else its check's.
const readRequirements: (
  issue: DataSecurityIssue,
  check: DataSecurityCheckInfo | undefined,
) => Array<FrameworkRequirementRef> = (
  issue: DataSecurityIssue,
  check: DataSecurityCheckInfo | undefined,
): Array<FrameworkRequirementRef> => {
  const stored: Array<FrameworkRequirementRef> = Array.isArray(issue.frameworks)
    ? (issue.frameworks as Array<unknown>)
        .filter((entry: unknown): entry is JSONObject => {
          return (
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
          );
        })
        .map((entry: JSONObject): FrameworkRequirementRef | null => {
          const framework: unknown = entry["framework"];
          const requirement: unknown = entry["requirement"];

          return isComplianceFramework(framework) &&
            typeof requirement === "string"
            ? { framework: framework, requirement: requirement }
            : null;
        })
        .filter(
          (
            ref: FrameworkRequirementRef | null,
          ): ref is FrameworkRequirementRef => {
            return ref !== null;
          },
        )
    : [];

  return stored.length > 0 ? stored : [...(check?.requirements || [])];
};

const RequirementChip: FunctionComponent<{
  reference: FrameworkRequirementRef;
}> = (props: { reference: FrameworkRequirementRef }): ReactElement => {
  const translator: Translator = useTranslator();
  const info: ComplianceRequirementInfo | undefined =
    COMPLIANCE_REQUIREMENTS.find(
      (requirement: ComplianceRequirementInfo): boolean => {
        return (
          requirement.framework === props.reference.framework &&
          requirement.requirement === props.reference.requirement
        );
      },
    );

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700"
      title={info ? translator.translateText(info.title) : undefined}
    >
      <span className="font-semibold">{props.reference.framework}</span>
      <span>{props.reference.requirement}</span>
    </span>
  );
};

/*
 * WHAT EXACTLY IS WRONG, AND HOW TO FIX IT.
 *
 * The page an owner lands on from a notification: the issue in a line,
 * with its severity, where it stands and its risk score, the store it is
 * on and who has it; what the check saw; why it matters - the check's
 * reason, what the store holds, who can reach it and the requirements it
 * affects; for a telemetry issue, each kind of data it found, where it
 * sits and the newest records that carry it, which open in the trace, the
 * logs, the exception or the session (IssueTelemetryFindings); how to fix
 * it on this store's cloud, as console steps, a CLI command and Terraform
 * to copy; and how the risk score was worked out.
 *
 * The moves are in the header: Mark Resolved once it is fixed (the store
 * is checked again at once), Accept Risk with a reason and an end date,
 * and in its ⋯ Not an Issue, with the reason (#10369), and Assign; a
 * closed issue offers Reopen. While the project's AI is on, OneUptime AI's
 * analysis comes right after the issue (IssueAiAnalysisCard, #10369): is
 * it real, what it puts at risk, what the fix would break, the shortest
 * path to fixed, with the buttons they name - it replaces Explain with AI.
 * Fix with AI sits with the fix too; it asks which repository when the
 * person may ask OneUptime AI to work in several, and offers only those.
 * An open issue that a response action fixes - a public bucket, a shared
 * snapshot - offers it first, as one click (IssueResponseAction).
 */
const DataSecurityIssueOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const view: DataSecurityIssueViewContext = useDataSecurityIssueView();
  const issue: DataSecurityIssue = view.issue;
  const namer: DataTypeNamer = useDataTypeNamer();
  const isAiOffered: boolean = useAiOffered();

  const [dialog, setDialog] = useState<IssueDialog>(null);
  const [confirmMove, setConfirmMove] = useState<IssueMove | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [confirmError, setConfirmError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  // OneUptime AI's draft of the reason a dialog starts from (#10369).
  const [draftReason, setDraftReason] = useState<string>("");
  const [isFixing, setIsFixing] = useState<boolean>(false);
  const [fixNotice, setFixNotice] = useState<FixNotice | null>(null);
  // The repositories Fix with AI may be asked in, when there is a choice.
  const [repositoryChoices, setRepositoryChoices] = useState<
    Array<DataSecurityFixRepository>
  >([]);

  const check: DataSecurityCheckInfo | undefined = issue.checkId
    ? getDataSecurityCheck(issue.checkId)
    : undefined;
  const store: DataStore | undefined = issue.dataStore;
  const storeId: string =
    issue.dataStoreId?.toString() || store?._id?.toString() || "";
  const storeName: string = store?.name || "";
  const title: string =
    translator.translateText(check?.title || issue.title) || issue.title || "";

  /*
   * What the store holds: the data types the issue was assessed with, else
   * the store's own, read from the store by its own read permissions -
   * never through the issue's relation (StoreDataTypes.ts, #10238).
   */
  const ownDataTypeIds: Array<string> = readDataTypeIds(issue.dataTypeIds);
  const storeDataTypes: StoreDataTypesRead = useStoreDataTypes({
    storeId: storeId,
    isNeeded: ownDataTypeIds.length === 0,
    refreshToggle: view.refreshToggle,
  });
  const dataTypeIds: Array<string> =
    ownDataTypeIds.length > 0 ? ownDataTypeIds : storeDataTypes.dataTypeIds;

  const updateGate: PermissionGateResult = PermissionGate.check(
    new DataSecurityIssue(),
    ModelAction.Update,
    { sentence: ISSUE_MOVES_LOCKED },
  );

  // Locked, saying what it takes, for someone who may not change issues.
  const gate: (button: CardButtonSchema) => CardButtonSchema | null = (
    button: CardButtonSchema,
  ): CardButtonSchema | null => {
    return PermissionGate.gateCardButton(
      button,
      new DataSecurityIssue(),
      ModelAction.Update,
      { sentence: ISSUE_MOVES_LOCKED },
    );
  };

  const runMove: (move: IssueMove) => Promise<void> = async (
    move: IssueMove,
  ): Promise<void> => {
    setActionError("");

    try {
      await view.updateIssue(getIssueMoveWrite(move));
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }
  };

  /*
   * Asks OneUptime AI for a pull request. The server answers without a run
   * when something stands in the way - AI is off, no Runner is online, no
   * repository the person may change is connected - and says what to fix;
   * or, when the person may ask in several repositories, lists them to
   * choose from (#10362).
   */
  const askForFix: (
    codeRepositoryId?: ObjectID | undefined,
  ) => Promise<boolean> = async (
    codeRepositoryId?: ObjectID | undefined,
  ): Promise<boolean> => {
    const result: DataSecurityFixResult = await DataSecurityApi.fixIssueWithAi(
      view.issueId,
      codeRepositoryId,
    );

    if (result.aiRunId) {
      setFixNotice({ message: result.message, taskId: result.aiRunId });
      view.refresh();
      return true;
    }

    if (!codeRepositoryId && (result.repositories || []).length > 0) {
      setRepositoryChoices(result.repositories || []);
      setDialog("repository");
      return false;
    }

    setFixNotice({ message: result.message });
    return true;
  };

  const fixWithAi: () => Promise<void> = async (): Promise<void> => {
    setIsFixing(true);
    setActionError("");
    setFixNotice(null);

    try {
      await askForFix();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsFixing(false);
  };

  // The header's buttons: the one move that fits first, the rest in ⋯.
  const headerButtons: Array<CardButtonSchema | ReactElement> = [];

  if (isIssueMoveOffered(issue, IssueMove.Resolve)) {
    const button: CardButtonSchema | null = gate({
      title: ISSUE_MOVE_TITLES[IssueMove.Resolve],
      icon: ISSUE_MOVE_ICONS[IssueMove.Resolve],
      buttonStyle: ButtonStyleType.NORMAL,
      disabled: view.isWorking,
      onClick: () => {
        setConfirmError("");
        setConfirmMove(IssueMove.Resolve);
      },
    });

    if (button) {
      headerButtons.push(button);
    }
  }

  if (isIssueMoveOffered(issue, IssueMove.Accept)) {
    const button: CardButtonSchema | null = gate({
      title: ISSUE_MOVE_TITLES[IssueMove.Accept],
      icon: ISSUE_MOVE_ICONS[IssueMove.Accept],
      buttonStyle: ButtonStyleType.OUTLINE,
      disabled: view.isWorking,
      onClick: () => {
        setDraftReason("");
        setDialog("accept");
      },
    });

    if (button) {
      headerButtons.push(button);
    }
  }

  if (isIssueMoveOffered(issue, IssueMove.Reopen)) {
    const button: CardButtonSchema | null = gate({
      title: ISSUE_MOVE_TITLES[IssueMove.Reopen],
      icon: ISSUE_MOVE_ICONS[IssueMove.Reopen],
      buttonStyle: ButtonStyleType.OUTLINE,
      disabled: view.isWorking,
      onClick: () => {
        void runMove(IssueMove.Reopen);
      },
    });

    if (button) {
      headerButtons.push(button);
    }
  }

  // Not shown before the reader's permissions are known.
  if (updateGate.isAllowed || updateGate.disabledReason) {
    const isLocked: boolean = !updateGate.isAllowed;
    const moreItems: Array<ReactElement> = [];

    if (isIssueMoveOffered(issue, IssueMove.NotAnIssue)) {
      moreItems.push(
        <MoreMenuItem
          key="not-an-issue"
          text={ISSUE_MOVE_TITLES[IssueMove.NotAnIssue]}
          icon={ISSUE_MOVE_ICONS[IssueMove.NotAnIssue]}
          isDisabled={isLocked || view.isWorking}
          tooltip={isLocked ? updateGate.disabledReason : undefined}
          isTooltipTranslated={true}
          onClick={() => {
            setDraftReason("");
            setDialog("notAnIssue");
          }}
        />,
      );
    }

    moreItems.push(
      <MoreMenuItem
        key="assign"
        text={ASSIGN_ISSUE}
        icon={ASSIGN_ISSUE_ICON}
        isDisabled={isLocked || view.isWorking}
        tooltip={isLocked ? updateGate.disabledReason : undefined}
        isTooltipTranslated={true}
        onClick={() => {
          setDialog("assign");
        }}
      />,
    );

    headerButtons.push(
      <CardMoreMenu key="issue-more" ariaLabel={MORE_ACTIONS}>
        {moreItems}
      </CardMoreMenu>,
    );
  }

  // Fix with AI, beside the fix, while the project's AI is on.
  const fixButtons: Array<CardButtonSchema> = [];

  if (isAiOffered) {
    const fixButton: CardButtonSchema | null = gate({
      title: "Fix with AI",
      icon: IconProp.Bolt,
      buttonStyle: ButtonStyleType.OUTLINE,
      isLoading: isFixing,
      disabled: isFixing,
      onClick: () => {
        void fixWithAi();
      },
    });

    if (fixButton) {
      fixButtons.push(fixButton);
    }
  }

  const requirements: Array<FrameworkRequirementRef> = readRequirements(
    issue,
    check,
  );
  const acceptedUntil: Date | null = issue.acceptedUntil
    ? readAcceptedUntil(issue.acceptedUntil)
    : null;
  const acceptedBy: string =
    issue.acceptedByUser?.name?.toString() ||
    issue.acceptedByUser?.email?.toString() ||
    "";
  const assigneeName: string =
    issue.assignedToUser?.name?.toString() ||
    issue.assignedToUser?.email?.toString() ||
    issue.assignedToTeam?.name ||
    "";
  const securityCaseId: string = issue.securityCaseId?.toString() || "";
  const alertId: string = issue.alertId?.toString() || "";
  const incidentId: string = issue.incidentId?.toString() || "";

  return (
    <>
      {actionError ? (
        <Alert
          type={AlertType.DANGER}
          title={actionError}
          dataTestId="data-security-issue-action-error"
          onClose={() => {
            setActionError("");
          }}
        />
      ) : (
        <></>
      )}

      <Card title={title} buttons={headerButtons}>
        <div className="space-y-3" data-testid="data-security-issue-header">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityPill severity={issue.severity} />
            <IssueStatusPill status={issue.status} />
            <Pill
              text={translator.translateTemplate(RISK_SCORE_BADGE, {
                score: translator.formatNumber(issue.riskScore || 0),
              })}
              isUserContent={true}
              tone={PillTone.Neutral}
              isDotHidden={true}
              tooltip="From 0 to 100: severity, exposure, records held, recent activity and production."
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
            {storeId ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon
                  icon={IconProp.Database}
                  className="h-4 w-4 shrink-0 text-gray-400"
                />
                <AppLink
                  className="min-w-0 font-medium text-gray-900 hover:underline [overflow-wrap:anywhere]"
                  to={getStoreViewRoute(storeId)}
                >
                  {translator.translateTemplate(ON_STORE, {
                    store: storeName || storeId,
                  })}
                </AppLink>
              </span>
            ) : (
              <></>
            )}
            {issue.checkGroup ? (
              <span>
                {translator.translateText(issue.checkGroup) || issue.checkGroup}
              </span>
            ) : (
              <></>
            )}
            {issue.firstDetectedAt ? (
              <span
                title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  issue.firstDetectedAt,
                )}
              >
                {translator.translateTemplate(FIRST_DETECTED, {
                  time: OneUptimeDate.fromNow(issue.firstDetectedAt),
                })}
              </span>
            ) : (
              <></>
            )}
            {issue.lastDetectedAt ? (
              <span
                title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  issue.lastDetectedAt,
                )}
              >
                {translator.translateTemplate(LAST_DETECTED, {
                  time: OneUptimeDate.fromNow(issue.lastDetectedAt),
                })}
              </span>
            ) : (
              <></>
            )}
            {issue.resolvedAt &&
            issue.status !== DataSecurityIssueStatus.Open ? (
              <span
                title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  issue.resolvedAt,
                )}
              >
                {translator.translateTemplate(RESOLVED_AT, {
                  time: OneUptimeDate.fromNow(issue.resolvedAt),
                })}
              </span>
            ) : (
              <></>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
            <span className="inline-flex items-center gap-1.5">
              <Icon
                icon={
                  issue.assignedToTeam && !issue.assignedToUser
                    ? IconProp.UserGroup
                    : IconProp.User
                }
                className="h-4 w-4 shrink-0 text-gray-400"
              />
              {assigneeName
                ? translator.translateTemplate(ASSIGNED_TO, {
                    name: assigneeName,
                  })
                : translator.translateText(NOBODY_ASSIGNED)}
            </span>
            {securityCaseId ? (
              <AppLink
                className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:underline"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
                  { modelId: new ObjectID(securityCaseId) },
                )}
              >
                <Icon icon={IconProp.ShieldExclamation} className="h-4 w-4" />
                <span>{translator.translateText(OPEN_SECURITY_CASE)}</span>
              </AppLink>
            ) : (
              <></>
            )}
            {alertId ? (
              <AppLink
                className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:underline"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.ALERT_VIEW] as Route,
                  { modelId: new ObjectID(alertId) },
                )}
              >
                <Icon icon={IconProp.ExclaimationCircle} className="h-4 w-4" />
                <span>{translator.translateText(OPEN_ALERT)}</span>
              </AppLink>
            ) : (
              <></>
            )}
            {incidentId ? (
              <AppLink
                className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:underline"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.INCIDENT_VIEW] as Route,
                  { modelId: new ObjectID(incidentId) },
                )}
              >
                <Icon icon={IconProp.Alert} className="h-4 w-4" />
                <span>{translator.translateText(OPEN_INCIDENT)}</span>
              </AppLink>
            ) : (
              <></>
            )}
          </div>

          {issue.status === DataSecurityIssueStatus.Accepted &&
          acceptedUntil ? (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              data-testid="data-security-issue-accepted"
            >
              <div className="font-medium">
                {acceptedBy
                  ? translator.translateTemplate(ACCEPTED_UNTIL, {
                      date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        acceptedUntil,
                        true,
                      ),
                      name: acceptedBy,
                    })
                  : translator.translateTemplate(ACCEPTED_UNTIL_NO_NAME, {
                      date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        acceptedUntil,
                        true,
                      ),
                    })}
              </div>
              {issue.acceptedReason ? (
                <div className="mt-0.5 [overflow-wrap:anywhere]">
                  <IsolatedText text={issue.acceptedReason} />
                </div>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}

          {issue.reopenCount && issue.reopenCount > 0 ? (
            <p className="text-xs text-gray-500">
              {translator.translatePlural(REOPENED_TIMES, issue.reopenCount)}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {isAiOffered ? (
        <IssueAiAnalysisCard
          issue={issue}
          issueId={view.issueId}
          namer={namer}
          refreshToggle={view.refreshToggle}
          isFixing={isFixing}
          onAcceptRisk={(draft: string) => {
            setDraftReason(draft);
            setDialog("accept");
          }}
          onNotAnIssue={(draft: string) => {
            setDraftReason(draft);
            setDialog("notAnIssue");
          }}
          onFixWithAi={() => {
            void fixWithAi();
          }}
          onChanged={() => {
            view.refresh();
          }}
        />
      ) : (
        <></>
      )}

      {/*
       * What is wrong and why it matters are what the cards say, not a
       * description of them: they are drawn in the cards' bodies, so a
       * phone - which hides a card's description - shows them too.
       */}
      <CardGrid columns={2}>
        <Card title="What's Wrong">
          <div className="space-y-2">
            <p
              className="mb-4 text-sm leading-relaxed text-gray-700"
              data-testid="data-security-issue-what-is-wrong"
            >
              {check
                ? translator.translateText(check.description) ||
                  check.description
                : translator.translateText(UNKNOWN_CHECK) || UNKNOWN_CHECK}
            </p>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText(EVIDENCE_LABEL)}
            </div>
            <div
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 [overflow-wrap:anywhere]"
              data-testid="data-security-issue-evidence"
            >
              {issue.evidence ? (
                <IsolatedText
                  text={
                    translator.translateText(issue.evidence) || issue.evidence
                  }
                />
              ) : (
                <span className="text-gray-500">
                  {translator.translateText(NO_EVIDENCE)}
                </span>
              )}
            </div>
          </div>
        </Card>

        <Card title="Why It Matters">
          {check ? (
            <p
              className="mb-4 text-sm leading-relaxed text-gray-700"
              data-testid="data-security-issue-why-it-matters"
            >
              {translator.translateText(check.whyItMatters) ||
                check.whyItMatters}
            </p>
          ) : (
            <></>
          )}
          <dl className="space-y-4">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(STORE_HOLDS_LABEL)}
              </dt>
              <dd
                className="mt-1.5 flex flex-wrap items-center gap-2"
                data-testid="data-security-issue-store-holds"
              >
                {/*
                 * Only a sensitivity read: one the reader may not read, or
                 * of a store that did not load, is not "Public" (#10281).
                 */}
                {store?.sensitivity ? (
                  <SensitivityPill sensitivity={store.sensitivity} />
                ) : (
                  <></>
                )}
                {storeDataTypes.isLoading ? (
                  <InlineValueSkeleton widthClassName="w-32" />
                ) : storeDataTypes.error && dataTypeIds.length === 0 ? (
                  <span
                    className="text-sm text-gray-600"
                    data-testid="data-security-issue-store-data-types-error"
                  >
                    <ErrorSentence
                      template={STORE_DATA_TYPES_NOT_LOADED}
                      error={storeDataTypes.error}
                    />
                  </span>
                ) : (
                  <IssueDataTypeChips
                    dataTypeIds={dataTypeIds}
                    namer={namer}
                    limit={8}
                    emptyElement={
                      <span className="text-sm text-gray-500">
                        {translator.translateText(NO_DATA_TYPES)}
                      </span>
                    }
                  />
                )}
              </dd>
            </div>
            {store?.exposure ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {translator.translateText(EXPOSURE_LABEL)}
                </dt>
                <dd className="mt-1.5">
                  <ExposurePill exposure={store.exposure} />
                </dd>
              </div>
            ) : (
              <></>
            )}
            {requirements.length > 0 ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {translator.translateText(REQUIREMENTS_LABEL)}
                </dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {requirements.map(
                    (
                      reference: FrameworkRequirementRef,
                      index: number,
                    ): ReactElement => {
                      return (
                        <RequirementChip
                          key={`${index}-${reference.framework}-${reference.requirement}`}
                          reference={reference}
                        />
                      );
                    },
                  )}
                </dd>
              </div>
            ) : (
              <></>
            )}
          </dl>
        </Card>
      </CardGrid>

      {isTelemetryFindingCheck(issue.checkId) && storeId ? (
        <IssueTelemetryFindings
          issue={issue}
          store={store}
          onChanged={() => {
            view.refresh();
          }}
        />
      ) : (
        <></>
      )}

      <Card
        title="How to Fix"
        description={
          isTelemetryFindingCheck(issue.checkId)
            ? HOW_TO_FIX_TELEMETRY
            : HOW_TO_FIX
        }
        buttons={fixButtons}
      >
        <div className="space-y-4">
          {issue.status === DataSecurityIssueStatus.Open && storeId ? (
            <IssueResponseAction
              issueId={view.issueId}
              checkId={issue.checkId}
              dataStoreId={storeId}
              storeKind={store?.kind}
              storeName={storeName}
              onChanged={() => {
                view.refresh();
              }}
            />
          ) : (
            <></>
          )}
          {fixNotice ? (
            <Alert
              type={fixNotice.taskId ? AlertType.SUCCESS : AlertType.WARNING}
              title={fixNotice.message}
              dataTestId="data-security-issue-fix-notice"
              onClose={() => {
                setFixNotice(null);
              }}
            />
          ) : (
            <></>
          )}
          {fixNotice?.taskId ? (
            <AppLink
              className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.CODE_TASK_VIEW] as Route,
                { modelId: new ObjectID(fixNotice.taskId) },
              )}
            >
              <Icon icon={IconProp.ExternalLink} className="h-4 w-4" />
              <span>{translator.translateText(OPEN_TASK)}</span>
            </AppLink>
          ) : (
            <></>
          )}
          {check ? (
            <IssueRemediation
              check={check}
              kind={store?.kind}
              storeName={storeName}
              region={store?.region}
            />
          ) : (
            <p className="text-sm text-gray-600">
              {translator.translateText(UNKNOWN_CHECK)}
            </p>
          )}
        </div>
      </Card>

      <Card
        title="Risk Score"
        description="Why this issue ranks where it does: its severity first, then what makes it worse on this store."
      >
        <IssueRiskScore
          score={issue.riskScore || 0}
          factors={readIssueRiskFactors(issue.riskFactors)}
        />
      </Card>

      {dialog === "accept" ? (
        <AcceptIssueRiskModal
          issues={[issue]}
          draftReason={draftReason}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={async (acceptance: IssueAcceptance): Promise<void> => {
            await view.updateIssue(
              getIssueMoveWrite(IssueMove.Accept, acceptance),
            );
            setDialog(null);
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "notAnIssue" ? (
        <NotAnIssueModal
          issues={[issue]}
          draftReason={draftReason}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={async (reason: string): Promise<void> => {
            await view.updateIssue(
              getIssueMoveWrite(IssueMove.NotAnIssue, undefined, reason),
            );
            setDialog(null);
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "assign" ? (
        <AssignIssueModal
          issue={issue}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={async (pick: IssueAssigneePick): Promise<void> => {
            await view.updateIssue(getIssueAssignWrite(pick));
            setDialog(null);
          }}
        />
      ) : (
        <></>
      )}

      {dialog === "repository" ? (
        <IssueRepositoryModal
          repositories={repositoryChoices}
          isTelemetry={isTelemetryFindingCheck(issue.checkId)}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={async (codeRepositoryId: ObjectID): Promise<void> => {
            setFixNotice(null);

            if (await askForFix(codeRepositoryId)) {
              setDialog(null);
            }
          }}
        />
      ) : (
        <></>
      )}

      {confirmMove ? (
        <ConfirmModal
          title={ISSUE_MOVE_TITLES[confirmMove]}
          description={getIssueMoveSentence(confirmMove, translator)}
          submitButtonText={ISSUE_MOVE_TITLES[confirmMove]}
          isLoading={isConfirming}
          error={confirmError || undefined}
          onClose={() => {
            setConfirmMove(null);
            setConfirmError("");
          }}
          onSubmit={async () => {
            const move: IssueMove = confirmMove;

            setIsConfirming(true);
            setConfirmError("");

            try {
              await view.updateIssue(getIssueMoveWrite(move));
              setConfirmMove(null);
            } catch (err) {
              setConfirmError(API.getFriendlyMessage(err));
            }

            setIsConfirming(false);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DataSecurityIssueOverviewPage;
