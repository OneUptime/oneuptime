import SecurityCaseApi, { DeclaredIncident } from "./SecurityCaseApi";
import { SecurityCaseAiCopy } from "./SecurityCaseAiTriage";
import { SECURITY_CASE_OPEN_TASKS } from "./Tasks/SecurityCaseTasksCopy";
import useAiOffered from "../../Utils/UseAiOffered";
import { liftBlockFromCase } from "./Response/SecurityCaseAddressBlocks";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import SecurityBlock from "Common/Models/DatabaseModels/SecurityBlock";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityBlockState } from "Common/Types/SecurityBlocklist/SecurityBlock";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseAiVerdict, {
  getSuggestedCloseVerdict,
  isSecurityCaseAiVerdict,
} from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseVerdict, {
  SECURITY_CASE_VERDICTS,
  SecurityCaseVerdictDescription,
} from "Common/Types/SecurityCase/SecurityCaseVerdict";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import {
  formatList,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { recordNameInSentence } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// The verdict cards, each with what it means: TruePositive first, the one that needs follow-up.
export function getVerdictIcon(verdict: SecurityCaseVerdict): IconProp {
  switch (verdict) {
    case SecurityCaseVerdict.TruePositive:
      return IconProp.ShieldExclamation;
    case SecurityCaseVerdict.BenignPositive:
      return IconProp.CheckCircle;
    case SecurityCaseVerdict.FalsePositive:
      return IconProp.XCircle;
    default:
      return IconProp.QuestionMarkCircle;
  }
}

export const VERDICT_CARD_OPTIONS: Array<CardSelectOption> =
  SECURITY_CASE_VERDICTS.map(
    (item: SecurityCaseVerdictDescription): CardSelectOption => {
      return {
        value: item.verdict,
        title: item.verdict,
        description: item.description,
        icon: getVerdictIcon(item.verdict),
      };
    },
  );

interface CaseModalProps {
  securityCase: SecurityCase;
  onClose: () => void;
  onDone: () => void;
}

/*
 * The verdict the close dialog starts on: the case's own, else the one
 * OneUptime AI's read suggests (a person still picks), else True Positive.
 * A case whose data held text written to steer an AI is never started on
 * a dismissing verdict: its AI read is Inconclusive anyway, and suggests
 * none. With the project's AI off nothing of OneUptime AI is drawn, so
 * nothing of it is picked either.
 */
export function getInitialCloseVerdict(
  securityCase: SecurityCase,
  isAiOffered: boolean = true,
): SecurityCaseVerdict {
  if (securityCase.verdict) {
    return securityCase.verdict;
  }

  const suggested: SecurityCaseVerdict | undefined =
    !isAiOffered || securityCase.aiTriagePromptInjectionSuspected === true
      ? undefined
      : getSuggestedCloseVerdict(securityCase.aiVerdict);

  return suggested || SecurityCaseVerdict.TruePositive;
}

/*
 * OneUptime AI's read of the case, which the close dialog says over its
 * verdicts ("OneUptime AI read this case as Likely Benign. Pick what you
 * found."), so a person knows where the verdict it starts on came from and
 * that the pick is theirs: while the case has no verdict of its own yet,
 * and only with the project's AI on.
 */
export function getCloseVerdictAiRead(
  securityCase: SecurityCase,
  isAiOffered: boolean = true,
): SecurityCaseAiVerdict | undefined {
  if (!isAiOffered || securityCase.verdict) {
    return undefined;
  }

  return isSecurityCaseAiVerdict(securityCase.aiVerdict)
    ? securityCase.aiVerdict
    : undefined;
}

// Said in the close dialog when it closes the case into a status of the project's own.
export const CLOSE_INTO_STATUS: string = translationKey(
  "The case moves to {{status}}.",
);

/*
 * A case closed as a false positive or benign blocked nobody it should
 * have (#10342): the close dialog offers to lift its blocks, ticked, and
 * lists what it lifts.
 */
export const CLOSE_LIFT_BLOCKS_TITLE: string = translationKey(
  "Lift the Case's Blocks",
);
export const CLOSE_LIFT_BLOCKS_DESCRIPTION: string = translationKey(
  "Lifts the blocks this case made, so their addresses reach your app again: {{values}}.",
);
export const CLOSE_LIFT_REASON: string = translationKey(
  "The case was closed as {{verdict}}.",
);
export const CLOSE_LIFT_FAILED: string = translationKey(
  "The case is closed, but the block on {{value}} could not be lifted: {{error}}",
);

// The verdicts that say the case blocked nobody it should have.
export const VERDICTS_THAT_LIFT_BLOCKS: ReadonlyArray<SecurityCaseVerdict> = [
  SecurityCaseVerdict.FalsePositive,
  SecurityCaseVerdict.BenignPositive,
];

export function doesVerdictLiftBlocks(verdict: unknown): boolean {
  return VERDICTS_THAT_LIFT_BLOCKS.includes(verdict as SecurityCaseVerdict);
}

// The case's own blocks still in force, as the close dialog lists them.
export interface CaseActiveBlock {
  id: string;
  value: string;
}

export interface CloseCaseModalProps extends CaseModalProps {
  /*
   * The status the case closes into: the project's closed status (Close
   * Case), or another status that closes - one picked on the status steps.
   */
  closeToStatus: SecurityCaseStatus;
  // Whether that is the project's own closed status, which needs no saying.
  isProjectClosedStatus: boolean;
}

/*
 * Closing a case asks what it turned out to be. The verdict is what the
 * overview counts and what tunes detections: a rule whose cases keep closing
 * as False Positive is a rule to fix.
 */
export const CloseSecurityCaseModal: FunctionComponent<CloseCaseModalProps> = (
  props: CloseCaseModalProps,
): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const aiRead: SecurityCaseAiVerdict | undefined = getCloseVerdictAiRead(
    props.securityCase,
    isAiOffered,
  );

  /*
   * How many of the case's tasks are still open: closing a case with work
   * left on it is allowed, and worth a second look. Nothing is said while
   * they are read, when none is open, or when they cannot be read - a role
   * that cannot read tasks closes the case as before.
   */
  const [openTasks, setOpenTasks] = useState<number>(0);

  /*
   * The blocks this case made that are still in force (#10342): offered for
   * lifting when it closes as a false positive or benign. None when they
   * cannot be read - a role that cannot read the Blocklist closes as before.
   */
  const [caseBlocks, setCaseBlocks] = useState<Array<CaseActiveBlock>>([]);

  useEffect(() => {
    let isCurrent: boolean = true;
    const caseId: string = props.securityCase._id?.toString() || "";

    if (!caseId) {
      return;
    }

    ModelAPI.getList<SecurityBlock>({
      modelType: SecurityBlock,
      query: {
        securityCaseId: new ObjectID(caseId),
        state: SecurityBlockState.Active,
      },
      select: { _id: true, value: true },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: 50,
    })
      .then((result: { data: Array<SecurityBlock> }) => {
        if (isCurrent) {
          setCaseBlocks(
            result.data
              .map((block: SecurityBlock): CaseActiveBlock => {
                return {
                  id: block._id?.toString() || block.id?.toString() || "",
                  value: block.value || "",
                };
              })
              .filter((block: CaseActiveBlock): boolean => {
                return Boolean(block.id && block.value);
              }),
          );
        }
      })
      .catch(() => {
        // Unreadable: nothing to offer.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.securityCase._id?.toString()]);

  useEffect(() => {
    let isCurrent: boolean = true;
    const caseId: string = props.securityCase._id?.toString() || "";

    if (!caseId) {
      return;
    }

    ModelAPI.count<SecurityCaseTask>({
      modelType: SecurityCaseTask,
      query: {
        securityCaseId: new ObjectID(caseId),
        isDone: false,
      },
    })
      .then((count: number) => {
        if (isCurrent) {
          setOpenTasks(count);
        }
      })
      .catch(() => {
        // Unreadable: nothing to say.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.securityCase._id?.toString()]);

  /*
   * What the verdict's field says first: closing into a status of the
   * project's own, not its closed one, the status the case moves to - what
   * the dialog does comes first - then the tasks still open on it, then
   * OneUptime AI's read of the case, which ends on what to do: "Pick what
   * you found." Each, when it applies.
   */
  const closeHints: Array<string> = [
    ...(!props.isProjectClosedStatus
      ? [
          translator.translateTemplate(CLOSE_INTO_STATUS, {
            status: recordNameInSentence(
              StateListType.SecurityCaseStatus,
              props.closeToStatus.name || "",
            ),
          }),
        ]
      : []),
    ...(openTasks > 0
      ? [translator.translatePlural(SECURITY_CASE_OPEN_TASKS, openTasks)]
      : []),
    ...(aiRead
      ? [
          translator.translateTemplate(SecurityCaseAiCopy.closeVerdictHint, {
            read: translatableTerm(aiRead),
          }),
        ]
      : []),
  ];

  return (
    <BasicFormModal<JSONObject>
      title="Close Case"
      description="Say what this case turned out to be. The verdict is kept on the case, and counted on the overview."
      submitButtonText="Close Case"
      modalWidth={ModalWidth.Medium}
      isLoading={isLoading}
      error={error}
      onClose={props.onClose}
      formProps={{
        name: "security-case-close",
        initialValues: {
          verdict: getInitialCloseVerdict(props.securityCase, isAiOffered),
          liftBlocks: true,
        },
        fields: [
          {
            field: { verdict: true },
            title: "Verdict",
            ...(closeHints.length > 0
              ? { description: closeHints.join(" ") }
              : {}),
            fieldType: FormFieldSchemaType.CardSelect,
            required: true,
            cardSelectOptions: VERDICT_CARD_OPTIONS,
            cardSelectSingleColumn: true,
          },
          {
            field: { closingNote: true },
            title: "Closing Note",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            // The label says it is optional; the sentence says what it is for.
            description:
              "What was found and what was done, for whoever reads this case next.",
            placeholder:
              "e.g. Confirmed with the user; the sign-ins were theirs.",
          },
          {
            field: { liftBlocks: true },
            title: CLOSE_LIFT_BLOCKS_TITLE,
            description: translator.translateTemplate(
              CLOSE_LIFT_BLOCKS_DESCRIPTION,
              {
                values: formatList(
                  caseBlocks.map((block: CaseActiveBlock): string => {
                    return block.value;
                  }),
                  translator,
                ),
              },
            ),
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            showIf: (values: FormValues<JSONObject>): boolean => {
              return (
                caseBlocks.length > 0 &&
                doesVerdictLiftBlocks((values as JSONObject)["verdict"])
              );
            },
          },
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        setIsLoading(true);
        setError("");

        try {
          const closingNote: string =
            typeof values["closingNote"] === "string"
              ? (values["closingNote"] as string).trim()
              : "";

          await ModelAPI.updateById<SecurityCase>({
            modelType: SecurityCase,
            id: new ObjectID(props.securityCase._id!.toString()),
            data: {
              securityCaseStatusId: props.closeToStatus.id!.toString(),
              verdict:
                (values["verdict"] as string) ||
                SecurityCaseVerdict.Undetermined,
              ...(closingNote ? { closingNote } : {}),
            },
          });

          const verdict: string = (values["verdict"] as string) || "";

          // Its blocks, lifted as the case closed harmless (#10342).
          if (
            values["liftBlocks"] !== false &&
            doesVerdictLiftBlocks(verdict)
          ) {
            for (const block of caseBlocks) {
              try {
                await liftBlockFromCase({
                  blockId: block.id,
                  reason: translator.translateTemplate(CLOSE_LIFT_REASON, {
                    verdict: translatableTerm(verdict),
                  }),
                });
              } catch (liftError) {
                // The error said in the reader's language, a reference with it.
                Toast.error(
                  translator.translateTemplate(CLOSE_LIFT_FAILED, {
                    value: block.value,
                    error: errorInSentence(API.getFriendlyMessage(liftError)),
                  }),
                );
              }
            }
          }

          props.onDone();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
      }}
    />
  );
};

export interface RunPlaybookModalProps extends CaseModalProps {
  /*
   * The playbook the dialog starts on - the one OneUptime AI suggested on
   * the case's AI card. A person still picks, and runs it.
   */
  initialPlaybookId?: ObjectID | undefined;
}

/*
 * Runs a playbook against the case by hand - any enabled playbook, whatever
 * starts it on its own. The run appears under the case's Playbooks and on the
 * timeline, step by step.
 */
export const RunSecurityPlaybookModal: FunctionComponent<
  RunPlaybookModalProps
> = (props: RunPlaybookModalProps): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  return (
    <BasicFormModal<JSONObject>
      title="Run Playbook"
      description="Run a playbook against this case now. Steps that need approval wait for someone to approve them here."
      submitButtonText="Run Playbook"
      isLoading={isLoading}
      error={error}
      onClose={props.onClose}
      formProps={{
        name: "security-case-run-playbook",
        ...(props.initialPlaybookId
          ? {
              initialValues: {
                securityPlaybookId: props.initialPlaybookId.toString(),
              },
            }
          : {}),
        fields: [
          {
            field: { securityPlaybookId: true },
            title: "Playbook",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Choose a playbook",
            dropdownModal: {
              type: SecurityPlaybook,
              labelField: "name",
              valueField: "_id",
              sort: { name: SortOrder.Ascending },
              query: { isEnabled: true },
            },
          },
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        setIsLoading(true);
        setError("");

        try {
          const run: SecurityPlaybookRun = new SecurityPlaybookRun();
          run.projectId = ProjectUtil.getCurrentProjectId()!;
          run.securityCaseId = new ObjectID(props.securityCase._id!.toString());
          run.securityPlaybookId = new ObjectID(
            String(values["securityPlaybookId"] || ""),
          );

          await ModelAPI.create<SecurityPlaybookRun>({
            model: run,
            modelType: SecurityPlaybookRun,
          });

          props.onDone();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
      }}
    />
  );
};

export interface DeclareIncidentModalProps extends CaseModalProps {
  onDeclared: (incident: DeclaredIncident) => void;
}

/*
 * Hands the case to incident response: a OneUptime incident, linked both
 * ways, so on-call, status pages and postmortems take over from here.
 */
export const DeclareIncidentFromCaseModal: FunctionComponent<
  DeclareIncidentModalProps
> = (props: DeclareIncidentModalProps): ReactElement => {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  return (
    <BasicFormModal<JSONObject>
      title="Declare Incident"
      description="Declare an incident linked to this case, so on-call, status pages and the postmortem take it from here."
      submitButtonText="Declare Incident"
      isLoading={isLoading}
      error={error}
      onClose={props.onClose}
      formProps={{
        name: "security-case-declare-incident",
        fields: [
          {
            field: { incidentSeverityId: true },
            title: "Incident Severity",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Choose a severity",
            dropdownModal: {
              type: IncidentSeverity,
              labelField: "name",
              valueField: "_id",
              sort: { order: SortOrder.Ascending },
            },
          },
        ],
      }}
      onSubmit={async (values: FormValues<JSONObject>) => {
        setIsLoading(true);
        setError("");

        try {
          const incident: DeclaredIncident =
            await SecurityCaseApi.declareIncident({
              caseId: new ObjectID(props.securityCase._id!.toString()),
              incidentSeverityId: new ObjectID(
                String(values["incidentSeverityId"] || ""),
              ),
            });

          props.onDeclared(incident);
          props.onDone();
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
      }}
    />
  );
};
