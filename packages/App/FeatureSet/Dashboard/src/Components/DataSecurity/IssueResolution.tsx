import DataSecurityApi from "./DataSecurityApi";
import {
  A_PULL_REQUEST,
  CAME_BACK_STAYS_OPEN,
  CONTAINED_BODY,
  CONTAINED_TITLE,
  CONTAINMENT_NOT_LOADED,
  FIX_THE_CODE,
  KEPT_RULE_CHANGED,
  KEPT_RULE_TITLE,
  KEPT_RULE_UNCHANGED,
  REMOVE_RULE,
  REMOVE_RULE_QUESTION,
  REMOVE_RULE_TITLE,
  REMOVE_RULE_WHAT_CHANGES,
  RESOLUTION_LABELS,
  RULE_CHANGED_LATELY,
  RULE_CHANGED_LATELY_NO_VERSION,
  RULE_CHANGED_NOTHING_LATELY,
  RULE_NOT_COUNTED,
  RULE_REMOVED,
  ResolutionTone,
  getCameBackTemplate,
  getClosedLineTemplate,
  getFixedLineTemplate,
  getResolutionTone,
  isResolutionShown,
} from "./IssueResolutionCopy";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import OneUptimeDate from "Common/Types/Date";
import {
  DataSecurityIssueContainment,
  DataSecurityIssueContainmentRule,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueResolution, {
  DataSecurityIssueResolutionDetails,
  DataSecurityIssueResolutionFix,
  readDataSecurityIssueResolutionDetails,
} from "Common/Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import { isTelemetryFindingCheck } from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useState,
} from "react";

/*
 * HOW THE ISSUE WAS RESOLVED, IN ITS HEADER (#10368).
 *
 * One line that reads plainly, in the colour of what it means:
 *
 *   - fixed (green): "Fixed in pull request #482, deployed in version
 *     2.4.1, verified Nov 21, 2026, 2:10 PM", fixed from here with the
 *     response action, or its check passing;
 *   - contained at ingest (amber, never green): not fixed - a scrub rule
 *     hides the data, the code still writes it - with the rule, what it
 *     changed in the last week (#10366's counter), and Fix the Code;
 *   - closed another way (grey): a person, a check turned off, a store
 *     gone;
 *   - came back (red): the leak is back after its verified fix, in the
 *     version that brought it back, with Fix the Code.
 *
 * After a verified code fix the rule that contained the leak is kept, as
 * defence in depth, and says it has changed nothing since - with Remove
 * Rule, for a reader who may delete it.
 */

export const ISSUE_RESOLUTION_TEST_ID: string = "data-security-issue-resolution";

const PANEL_CLASS_NAMES: Record<ResolutionTone, string> = {
  [ResolutionTone.Fixed]:
    "border-emerald-200 bg-emerald-50 text-emerald-900",
  [ResolutionTone.Contained]: "border-amber-200 bg-amber-50 text-amber-900",
  [ResolutionTone.Closed]: "border-gray-200 bg-gray-50 text-gray-800",
  [ResolutionTone.CameBack]: "border-red-200 bg-red-50 text-red-900",
};

const PANEL_ICONS: Record<ResolutionTone, IconProp> = {
  [ResolutionTone.Fixed]: IconProp.CheckCircle,
  [ResolutionTone.Contained]: IconProp.EyeSlash,
  [ResolutionTone.Closed]: IconProp.CheckCircle,
  [ResolutionTone.CameBack]: IconProp.Refresh,
};

const LINK_CLASS_NAME: string = "font-medium underline hover:no-underline";

export interface ComponentProps {
  issue: DataSecurityIssue;
  issueId: ObjectID;
  // Fix the Code: the page's Fix with AI, while the project's AI is on.
  onFixTheCode?: (() => void) | undefined;
  isFixing?: boolean | undefined;
  // Why Fix the Code is locked for this reader, if it is.
  fixDisabledReason?: string | undefined;
  refreshToggle?: boolean | string | number | undefined;
}

// When, in the reader's zone and language.
function timeOf(at: string | undefined, fallback: Date | undefined): string {
  const date: Date | undefined = at ? new Date(at) : fallback;

  return date ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date) : "";
}

// "#482", opening the pull request where it lives; "a pull request" with no number.
const PullRequestSlot: FunctionComponent<{
  fix: DataSecurityIssueResolutionFix | undefined;
}> = (props: { fix: DataSecurityIssueResolutionFix | undefined }): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.fix?.number) {
    return <>{translator.translateText(A_PULL_REQUEST)}</>;
  }

  const label: ReactElement = <span dir="ltr">#{props.fix.number}</span>;

  return props.fix.url ? (
    <a
      href={props.fix.url}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLASS_NAME}
    >
      {label}
    </a>
  ) : (
    label
  );
};

const VersionSlot: FunctionComponent<{ text: string }> = (props: {
  text: string;
}): ReactElement => {
  return (
    <code
      dir="ltr"
      className="rounded bg-white/60 px-1 font-mono text-xs [overflow-wrap:anywhere]"
    >
      {props.text}
    </code>
  );
};

// A rule's name, as its project wrote it.
const RuleSlot: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  return (
    <span className="font-medium [overflow-wrap:anywhere]">
      <IsolatedText text={props.name} />
    </span>
  );
};

/*
 * Of the slots given, those the sentence holds. TranslatedSentence draws a
 * sentence only whole - each slot it is given, once - so one with no place
 * in this sentence (a commit, in a sentence naming a version) is left out.
 */
const slotsOf: (
  template: string | PluralTemplate,
  slots: Record<string, ReactNode>,
) => Record<string, ReactNode> = (
  template: string | PluralTemplate,
  slots: Record<string, ReactNode>,
): Record<string, ReactNode> => {
  const english: string =
    typeof template === "string" ? template : template.other;
  const held: Record<string, ReactNode> = {};

  for (const name of Object.keys(slots)) {
    if (english.includes(`{{${name}}}`)) {
      held[name] = slots[name];
    }
  }

  return held;
};

// The line of a fix OneUptime followed to production.
const FixedLine: FunctionComponent<{
  template: string;
  details: DataSecurityIssueResolutionDetails;
  resolvedAt: Date | undefined;
}> = (props: {
  template: string;
  details: DataSecurityIssueResolutionDetails;
  resolvedAt: Date | undefined;
}): ReactElement => {
  const fix: DataSecurityIssueResolutionFix | undefined = props.details.fix;

  return (
    <TranslatedSentence
      template={props.template}
      slots={slotsOf(props.template, {
        pullRequest: <PullRequestSlot fix={fix} />,
        version: <VersionSlot text={fix?.version || ""} />,
        commit: <VersionSlot text={(fix?.commitSha || "").slice(0, 7)} />,
      })}
      values={{ time: timeOf(props.details.at, props.resolvedAt) }}
    />
  );
};

// What one rule changed of the service, or since the fix.
const RuleLine: FunctionComponent<{
  rule: DataSecurityIssueContainmentRule;
  days: number;
  canRemove: PermissionGateResult;
  onRemove: () => void;
}> = (props: {
  rule: DataSecurityIssueContainmentRule;
  days: number;
  canRemove: PermissionGateResult;
  onRemove: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const rule: DataSecurityIssueContainmentRule = props.rule;
  const ruleSlot: ReactElement = <RuleSlot name={rule.name} />;
  let sentence: ReactElement;

  if (rule.isKept) {
    const sinceFix: number = rule.valuesChangedSinceFix || 0;

    sentence =
      sinceFix > 0 ? (
        <TranslatedSentence
          template={KEPT_RULE_CHANGED}
          count={sinceFix}
          slots={{ rule: ruleSlot }}
          values={{ count: translator.formatNumber(sinceFix) }}
        />
      ) : (
        <TranslatedSentence
          template={KEPT_RULE_UNCHANGED}
          slots={{ rule: ruleSlot }}
        />
      );
  } else if (rule.valuesChanged === null) {
    sentence = (
      <TranslatedSentence template={RULE_NOT_COUNTED} slots={{ rule: ruleSlot }} />
    );
  } else if (rule.valuesChanged === 0) {
    sentence = (
      <TranslatedSentence
        template={RULE_CHANGED_NOTHING_LATELY}
        slots={{ rule: ruleSlot }}
        values={{ days: translator.formatNumber(props.days) }}
      />
    );
  } else {
    const changedTemplate: PluralTemplate = rule.lastChangedVersion
      ? RULE_CHANGED_LATELY
      : RULE_CHANGED_LATELY_NO_VERSION;

    sentence = (
      <TranslatedSentence
        template={changedTemplate}
        count={rule.valuesChanged}
        slots={slotsOf(changedTemplate, {
          rule: ruleSlot,
          version: <VersionSlot text={rule.lastChangedVersion || ""} />,
        })}
        values={{
          count: translator.formatNumber(rule.valuesChanged),
          days: translator.formatNumber(props.days),
        }}
      />
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <span className="min-w-0">{sentence}</span>
      {rule.isKept && (props.canRemove.isAllowed || props.canRemove.disabledReason) ? (
        <Button
          title={REMOVE_RULE}
          icon={IconProp.Trash}
          buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
          buttonSize={ButtonSize.Small}
          disabled={!props.canRemove.isAllowed}
          tooltip={
            props.canRemove.isAllowed ? undefined : props.canRemove.disabledReason
          }
          onClick={props.onRemove}
          dataTestId="data-security-issue-remove-rule"
        />
      ) : (
        <></>
      )}
    </li>
  );
};

const IssueResolution: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const issue: DataSecurityIssue = props.issue;
  const details: DataSecurityIssueResolutionDetails =
    readDataSecurityIssueResolutionDetails(issue.resolutionDetails);
  const isShown: boolean = isResolutionShown({
    status: issue.status,
    resolution: issue.resolution,
    details,
  });
  const cameBack: boolean =
    issue.status === DataSecurityIssueStatus.Open && Boolean(details.regression);
  const tone: ResolutionTone = cameBack
    ? ResolutionTone.CameBack
    : getResolutionTone(issue.resolution);
  // What hides the data at ingest: read for a contained leak, a verified fix's kept rule, or one back.
  const readsContainment: boolean =
    isShown &&
    isTelemetryFindingCheck(issue.checkId) &&
    (cameBack ||
      issue.resolution === DataSecurityIssueResolution.ContainedAtIngest ||
      (issue.resolution === DataSecurityIssueResolution.FixedInCode &&
        (details.scrubRules || []).length > 0));

  const [containment, setContainment] =
    useState<DataSecurityIssueContainment | null>(null);
  const [containmentError, setContainmentError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [removing, setRemoving] =
    useState<DataSecurityIssueContainmentRule | null>(null);
  const [isRemoving, setIsRemoving] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>("");

  useEffect(() => {
    if (!readsContainment) {
      return;
    }

    let isCurrent: boolean = true;

    setContainmentError("");

    DataSecurityApi.getIssueContainment(props.issueId)
      .then((read: DataSecurityIssueContainment | null) => {
        if (isCurrent) {
          setContainment(read);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setContainmentError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readsContainment, props.issueId.toString(), props.refreshToggle, readCount]);

  if (!isShown) {
    return <></>;
  }

  const canRemoveOf: (
    rule: DataSecurityIssueContainmentRule,
  ) => PermissionGateResult = (
    rule: DataSecurityIssueContainmentRule,
  ): PermissionGateResult => {
    return PermissionGate.check(
      rule.signal === "trace" ? new TraceScrubRule() : new LogScrubRule(),
      ModelAction.Delete,
    );
  };

  const removeRule: () => Promise<void> = async (): Promise<void> => {
    if (!removing) {
      return;
    }

    setIsRemoving(true);
    setRemoveError("");

    try {
      await ModelAPI.deleteItem({
        modelType: removing.signal === "trace" ? TraceScrubRule : LogScrubRule,
        id: new ObjectID(removing.id),
      });
      Toast.success(translator.translateText(RULE_REMOVED) || RULE_REMOVED);
      setRemoving(null);
      setReadCount((count: number): number => {
        return count + 1;
      });
    } catch (err) {
      setRemoveError(API.getFriendlyMessage(err));
    }

    setIsRemoving(false);
  };

  let line: ReactNode;
  const fixedTemplate: string | null = getFixedLineTemplate({
    resolution: issue.resolution,
    fix: details.fix,
  });
  const closedTemplate: string | null = getClosedLineTemplate({
    resolution: issue.resolution,
    details,
  });

  if (cameBack) {
    line = (
      <>
        <p className="font-medium">
          <TranslatedSentence
            template={getCameBackTemplate(details)}
            slots={slotsOf(getCameBackTemplate(details), {
              pullRequest: <PullRequestSlot fix={details.regression?.fix} />,
              version: <VersionSlot text={details.regression?.version || ""} />,
              fixedVersion: (
                <VersionSlot text={details.regression?.fix?.version || ""} />
              ),
            })}
          />
        </p>
        <p className="mt-0.5">{translator.translateText(CAME_BACK_STAYS_OPEN)}</p>
      </>
    );
  } else if (issue.resolution === DataSecurityIssueResolution.ContainedAtIngest) {
    line = (
      <>
        <p className="font-medium">{translator.translateText(CONTAINED_TITLE)}</p>
        <p className="mt-0.5">{translator.translateText(CONTAINED_BODY)}</p>
      </>
    );
  } else if (fixedTemplate) {
    line = (
      <p className="font-medium">
        <FixedLine
          template={fixedTemplate}
          details={details}
          resolvedAt={issue.resolvedAt}
        />
      </p>
    );
  } else if (closedTemplate) {
    line = (
      <p>
        {translator.translateTemplate(closedTemplate, {
          time: timeOf(details.at, issue.resolvedAt),
          action: details.responseAction
            ? translator.translateText(details.responseAction) ||
              details.responseAction
            : "",
        })}
      </p>
    );
  } else {
    line = (
      <p>
        {translator.translateText(
          RESOLUTION_LABELS[issue.resolution as DataSecurityIssueResolution] ||
            "",
        )}
      </p>
    );
  }

  const rules: Array<DataSecurityIssueContainmentRule> = containment?.rules || [];
  const keptRules: Array<DataSecurityIssueContainmentRule> = rules.filter(
    (rule: DataSecurityIssueContainmentRule): boolean => {
      return rule.isKept;
    },
  );
  const offersFix: boolean =
    Boolean(props.onFixTheCode) &&
    (cameBack || issue.resolution === DataSecurityIssueResolution.ContainedAtIngest);

  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${PANEL_CLASS_NAMES[tone]}`}
      data-testid={ISSUE_RESOLUTION_TEST_ID}
      data-tone={tone}
    >
      <div className="flex items-start gap-2">
        <Icon icon={PANEL_ICONS[tone]} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {line}

          {readsContainment ? (
            <div className="mt-2" data-testid="data-security-issue-containment">
              {keptRules.length > 0 ? (
                <p className="text-xs font-medium uppercase tracking-wide">
                  {translator.translateText(KEPT_RULE_TITLE)}
                </p>
              ) : (
                <></>
              )}
              {containmentError ? (
                <p className="text-xs">
                  {translator.translateText(CONTAINMENT_NOT_LOADED)}{" "}
                  {containmentError}
                </p>
              ) : !containment ? (
                <InlineValueSkeleton widthClassName="w-64" />
              ) : (
                <ul className="mt-1 space-y-1.5">
                  {rules.map(
                    (rule: DataSecurityIssueContainmentRule): ReactElement => {
                      return (
                        <RuleLine
                          key={rule.id}
                          rule={rule}
                          days={containment.days}
                          canRemove={canRemoveOf(rule)}
                          onRemove={() => {
                            setRemoveError("");
                            setRemoving(rule);
                          }}
                        />
                      );
                    },
                  )}
                </ul>
              )}
            </div>
          ) : (
            <></>
          )}

          {offersFix ? (
            <div className="mt-2">
              <Button
                title={FIX_THE_CODE}
                icon={IconProp.Bolt}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                isLoading={props.isFixing}
                disabled={Boolean(props.isFixing) || Boolean(props.fixDisabledReason)}
                tooltip={props.fixDisabledReason}
                onClick={props.onFixTheCode}
                dataTestId="data-security-issue-fix-the-code"
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>

      {removing ? (
        <ConfirmModal
          title={REMOVE_RULE_TITLE}
          description={
            <div className="space-y-2">
              <p>
                <TranslatedSentence
                  template={REMOVE_RULE_QUESTION}
                  slots={{ rule: <RuleSlot name={removing.name} /> }}
                />
              </p>
              <p>{translator.translateText(REMOVE_RULE_WHAT_CHANGES)}</p>
            </div>
          }
          submitButtonText={REMOVE_RULE}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isRemoving}
          error={removeError || undefined}
          onClose={() => {
            setRemoving(null);
            setRemoveError("");
          }}
          onSubmit={() => {
            void removeRule();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default IssueResolution;
