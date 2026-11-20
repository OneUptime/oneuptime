import crypto from "crypto";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import {
  WORKSPACE_CHECKBOX_TICKED_VALUE,
  WorkspaceCheckboxBlock,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadContext,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  SecurityPlaybookApprovalAsk,
  SecurityPlaybookApprovalButtonWords,
  SecurityPlaybookApprovalFormWords,
  SecurityPlaybookApprovalLine,
  SecurityPlaybookApprovalStandingKind,
  SecurityPlaybookApprovalTarget,
  SecurityPlaybookApprovalTime,
  SecurityPlaybookApprovalWording,
  SecurityPlaybookApprovalWordingContext,
  getProposedTargets,
  getSecurityPlaybookApprovalButtonWords,
  getSecurityPlaybookApprovalFormWords,
  offersApproveSome,
  wordSecurityPlaybookApproval,
} from "../../../Utils/SecurityPlaybook/SecurityPlaybookApprovalWords";
import ProductBrandingText from "../ProductBrandingText";
import { getServerTranslator } from "../ServerTranslation";
import { SecurityPlaybookApprovalRound } from "../SecurityPlaybook/SecurityPlaybookApprovalReader";
import TokenSigningKey from "../TokenSigningKey";
import SlackActionType from "./Slack/Actions/ActionTypes";
import WorkspaceMessageTime from "./WorkspaceMessageTime";

/*
 * A PLAYBOOK STEP WAITING FOR APPROVAL, AS A SLACK OR MICROSOFT TEAMS
 * MESSAGE WITH ITS BUTTONS (#10341).
 *
 * The message is posted to the channels the project's Security Case rules
 * name for approvals, and sent to each approver who chose Slack or Microsoft
 * Teams for it (SecurityCaseNotifications). It says what the step does, to
 * what, why, who or what asked, the evidence and what can be undone
 * (SecurityPlaybookApprovalWords), and carries:
 *
 *   [Approve] [Approve Some…] [Reject] [Open Case]
 *
 * Approve decides at once - one tap, where the approver already is. Approve
 * Some… opens a form listing the step's proposed targets, each ticked, to
 * untick the ones to leave out (only for a step that proposes two or more:
 * leaving out the one leaves nothing to approve). Reject ends the run. Open
 * Case opens the approval on the case in OneUptime. Once somebody decides -
 * here, in another copy, in the Dashboard or the mobile app - every copy
 * says who, when and what came of it, with Open Case only
 * (WorkspaceSecurityPlaybookApprovalMessages).
 *
 * What the buttons carry is signed (encodeValue, readValue) under a key
 * derived for this purpose alone: the project, the run, the step, and what
 * the step proposed when the message was drawn. It says nothing of who may
 * decide, and decides nothing: a press is decided by the playbook run's own
 * decision (SecurityPlaybookRunAPI.decide), as the OneUptime member the chat
 * account that pressed is connected to, with the Dashboard's rules, and
 * only while the step still proposes what the message showed
 * (WorkspaceSecurityPlaybookApprovalActions). A value this installation did
 * not sign is refused before anything is read.
 *
 * Its words are in the reader's language: a person's own copy in the
 * language on their account, a channel's in English, as every channel post
 * is (SecurityCaseNotifications).
 */

// The field a target's box is in, in Approve Some's form: its place among the proposed.
export const SECURITY_PLAYBOOK_APPROVAL_TARGET_FIELD_PREFIX: string =
  "approveTarget";

// A value's first part: what it is, and the version of its fields.
const VALUE_PREFIX: string = "spa1";

const SIGNING_KEY_LABEL: string = "workspace-security-playbook-approval-button";

// No value this writes is near as long: anything longer is not one.
const MAX_VALUE_LENGTH: number = 1024;

// The longest step id a value carries.
const MAX_STEP_ID_LENGTH: number = 100;

// A digest of what the step proposed, as a value carries it.
const TARGETS_DIGEST_LENGTH: number = 22;

// The most steps a run has: a step's place is never more.
const MAX_STEP_INDEX: number = 1000;

// The longest a Slack option's text may be; a box's label is longer.
const SLACK_OPTION_TEXT_MAX_LENGTH: number = 75;
const SLACK_LABEL_MAX_LENGTH: number = 2000;

// A message, and the line its notification shows.
export interface SecurityPlaybookApprovalMessage {
  messageBlocks: Array<WorkspaceMessageBlock>;
  notificationText: string;
}

export default class WorkspaceSecurityPlaybookApproval {
  // The buttons the message carries, and the form Approve Some… opens.
  public static readonly ACTION_TYPES: ReadonlyArray<string> = [
    SlackActionType.ApproveSecurityPlaybookStep,
    SlackActionType.ViewApproveSomeSecurityPlaybookStep,
    SlackActionType.SubmitApproveSomeSecurityPlaybookStep,
    SlackActionType.RejectSecurityPlaybookStep,
  ];

  public static isApprovalAction(actionType: string | undefined): boolean {
    return (
      Boolean(actionType) &&
      WorkspaceSecurityPlaybookApproval.ACTION_TYPES.includes(actionType!)
    );
  }

  /*
   * The project the first of these presses' values was signed for: what
   * tells a press's project apart in a workspace connected to more than
   * one (WorkspaceProjectResolution's drawnForProjectId). It decides only
   * where the press is read; what it may do there is read as the member who
   * pressed. Only a value this installation signed counts.
   */
  public static getSignedProjectId(
    presses: ReadonlyArray<{
      actionType?: string | undefined;
      actionValue?: string | undefined;
    }>,
  ): string | undefined {
    for (const press of presses) {
      if (
        !WorkspaceSecurityPlaybookApproval.isApprovalAction(press.actionType)
      ) {
        continue;
      }

      const round: SecurityPlaybookApprovalRound | null =
        WorkspaceSecurityPlaybookApproval.readValue(press.actionValue);

      if (round) {
        return round.projectId.toString();
      }
    }

    return undefined;
  }

  // ---------- what the buttons carry ----------

  // The value the message's buttons carry, signed.
  public static encodeValue(round: SecurityPlaybookApprovalRound): string {
    const payload: string = Buffer.from(
      JSON.stringify([
        round.projectId.toString(),
        round.runId.toString(),
        round.securityCaseId.toString(),
        round.stepIndex,
        round.stepId,
        round.targetsDigest,
      ]),
      "utf8",
    ).toString("base64url");

    return `${VALUE_PREFIX}.${payload}.${WorkspaceSecurityPlaybookApproval.sign(payload)}`;
  }

  /*
   * A button's value, read: null for anything this installation did not
   * sign as it is - another button's value, one changed by a character, one
   * signed with another key, one that is not text at all.
   */
  public static readValue(
    value: unknown,
  ): SecurityPlaybookApprovalRound | null {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > MAX_VALUE_LENGTH
    ) {
      return null;
    }

    const parts: Array<string> = value.split(".");

    if (parts.length !== 3 || parts[0] !== VALUE_PREFIX) {
      return null;
    }

    const payload: string = parts[1] || "";
    const signature: string = parts[2] || "";

    if (
      !payload ||
      !signature ||
      !WorkspaceSecurityPlaybookApproval.signaturesMatch(
        WorkspaceSecurityPlaybookApproval.sign(payload),
        signature,
      )
    ) {
      return null;
    }

    let fields: unknown;

    try {
      fields = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }

    if (!Array.isArray(fields) || fields.length !== 6) {
      return null;
    }

    const [projectId, runId, securityCaseId, stepIndex, stepId, digest] =
      fields as Array<unknown>;

    if (
      !WorkspaceSecurityPlaybookApproval.isId(projectId) ||
      !WorkspaceSecurityPlaybookApproval.isId(runId) ||
      !WorkspaceSecurityPlaybookApproval.isId(securityCaseId) ||
      typeof stepIndex !== "number" ||
      !Number.isInteger(stepIndex) ||
      stepIndex < 0 ||
      stepIndex > MAX_STEP_INDEX ||
      typeof stepId !== "string" ||
      !stepId ||
      stepId.length > MAX_STEP_ID_LENGTH ||
      typeof digest !== "string" ||
      digest.length !== TARGETS_DIGEST_LENGTH
    ) {
      return null;
    }

    return {
      projectId: new ObjectID(projectId),
      runId: new ObjectID(runId),
      securityCaseId: new ObjectID(securityCaseId),
      stepIndex,
      stepId,
      targetsDigest: digest,
    };
  }

  // ---------- the message ----------

  /*
   * How a moment reads in a chat message: in each reader's own time where
   * the chat can show it (WorkspaceMessageTime), and as the time in UTC in
   * the message's plain text.
   */
  public static formatTime(date: Date): SecurityPlaybookApprovalTime {
    const markdown: MarkdownText = WorkspaceMessageTime.time(date);

    return {
      markdown,
      text: WorkspaceMessageTime.toPlainText(markdown.toString()),
    };
  }

  // Everything a chat message is worded with, in `language`.
  public static getContext(
    language: string | null | undefined,
  ): SecurityPlaybookApprovalWordingContext {
    return {
      translator: getServerTranslator(language),
      productName: ProductBrandingText.getProductName(),
      formatTime: (date: Date): SecurityPlaybookApprovalTime => {
        return WorkspaceSecurityPlaybookApproval.formatTime(date);
      },
    };
  }

  /*
   * The message, as it stands now, for one chat and one reader's language:
   *
   *   ⏸️ **Approval needed on SEC-12: Credential stuffing from 35.205.11.131**
   *
   *   **Suspend the user in Okta**, through Okta (acme)
   *   • `alice@acme.com`: the case is grouped on it
   *   • `ceo@acme.com`: on your protected list, so it is never acted on
   *
   *   Asked by playbook **Contain account takeover**, which started when the case opened.
   *
   *   • 1,204 requests behind the case: Turned away: 1,180, Reached the app: 24
   *   • Nothing it acts on is on your protected list.
   *
   *   Can be undone: each one, with **Unsuspend the user in Okta** on the case.
   *
   *   [Approve] [Approve Some…] [Reject] [Open Case]
   *   Approve runs this step now, as you. Reject ends the run.
   *
   * Once decided, its headline says who and when and how the step went, each
   * target says what came of it, and only Open Case is left. In Microsoft
   * Teams each line is a paragraph of its own: a single newline in a card is
   * a space.
   */
  public static getMessage(data: {
    ask: SecurityPlaybookApprovalAsk;
    round: SecurityPlaybookApprovalRound;
    workspaceType: WorkspaceType;
    language?: string | null | undefined;
  }): SecurityPlaybookApprovalMessage {
    const context: SecurityPlaybookApprovalWordingContext =
      WorkspaceSecurityPlaybookApproval.getContext(data.language);
    const wording: SecurityPlaybookApprovalWording =
      wordSecurityPlaybookApproval({ ask: data.ask, context });
    const lineBreak: string =
      data.workspaceType === WorkspaceType.MicrosoftTeams ? "\n\n" : "\n";
    const isWaiting: boolean =
      data.ask.standing.kind === SecurityPlaybookApprovalStandingKind.Waiting;

    const markdown: (
      text: MarkdownText | string,
    ) => WorkspacePayloadMarkdown = (
      text: MarkdownText | string,
    ): WorkspacePayloadMarkdown => {
      return { _type: "WorkspacePayloadMarkdown", text: text.toString() };
    };

    const bullets: (lines: Array<SecurityPlaybookApprovalLine>) => string = (
      lines: Array<SecurityPlaybookApprovalLine>,
    ): string => {
      return lines
        .map((line: SecurityPlaybookApprovalLine): string => {
          return `• ${line.markdown.toString()}`;
        })
        .join(lineBreak);
    };

    const blocks: Array<WorkspaceMessageBlock> = [
      markdown(
        WorkspaceSecurityPlaybookApproval.getHeadlineMarkdown(
          data.ask,
          wording,
        ),
      ),
    ];

    blocks.push(
      markdown(
        [wording.action.markdown.toString(), bullets(wording.targets)]
          .filter((part: string): boolean => {
            return Boolean(part);
          })
          .join(lineBreak),
      ),
    );

    blocks.push(markdown(wording.source.markdown));

    if (wording.evidence.length > 0) {
      blocks.push(markdown(bullets(wording.evidence)));
    }

    blocks.push(markdown(wording.undo.markdown));

    const buttons: Array<WorkspaceMessagePayloadButton> = isWaiting
      ? WorkspaceSecurityPlaybookApproval.getDecisionButtons({
          ask: data.ask,
          value: WorkspaceSecurityPlaybookApproval.encodeValue(data.round),
          translator: context.translator,
        })
      : [];

    const caseUrl: URL | null = WorkspaceSecurityPlaybookApproval.toUrl(
      data.ask.caseUrl,
    );

    if (caseUrl) {
      buttons.push({
        _type: "WorkspaceMessagePayloadButton",
        title: getSecurityPlaybookApprovalButtonWords(context.translator)
          .openCase,
        value: "",
        actionId: SlackActionType.OpenInOneUptime,
        url: caseUrl,
      });
    }

    if (buttons.length > 0) {
      const buttonsBlock: WorkspacePayloadButtons = {
        _type: "WorkspacePayloadButtons",
        buttons,
      };

      blocks.push(buttonsBlock);
    }

    if (wording.note) {
      const note: WorkspacePayloadContext = {
        _type: "WorkspacePayloadContext",
        text: wording.note.markdown.toString(),
      };

      blocks.push(note);
    }

    return {
      messageBlocks: blocks,
      notificationText:
        WorkspaceSecurityPlaybookApproval.getNotificationText(wording),
    };
  }

  /*
   * The headline, with the mark of where it stands: waiting, approved and
   * how the step went, rejected, or no longer waiting.
   */
  public static getHeadlineMarkdown(
    ask: SecurityPlaybookApprovalAsk,
    wording: SecurityPlaybookApprovalWording,
  ): string {
    const headline: string = `**${wording.headline.markdown.toString()}**`;

    switch (ask.standing.kind) {
      case SecurityPlaybookApprovalStandingKind.Approved:
        return wording.progress
          ? `✅ ${headline} ${wording.progress.markdown.toString()}`
          : `✅ ${headline}`;
      case SecurityPlaybookApprovalStandingKind.Rejected:
        return `❌ ${headline}`;
      case SecurityPlaybookApprovalStandingKind.NoLongerWaiting:
        return `⏹️ ${headline}`;
      default:
        return `⏸️ ${headline}`;
    }
  }

  // What the message's notification shows: its headline, as text.
  public static getNotificationText(
    wording: SecurityPlaybookApprovalWording,
  ): string {
    return wording.progress
      ? `${wording.headline.text} ${wording.progress.text}`
      : wording.headline.text;
  }

  // Approve, Approve Some… for a step with two or more targets, and Reject.
  private static getDecisionButtons(data: {
    ask: SecurityPlaybookApprovalAsk;
    value: string;
    translator: Translator;
  }): Array<WorkspaceMessagePayloadButton> {
    const words: SecurityPlaybookApprovalButtonWords =
      getSecurityPlaybookApprovalButtonWords(data.translator);

    const buttons: Array<WorkspaceMessagePayloadButton> = [
      {
        _type: "WorkspaceMessagePayloadButton",
        title: words.approve,
        value: data.value,
        actionId: SlackActionType.ApproveSecurityPlaybookStep,
        isPrimary: true,
      },
    ];

    if (offersApproveSome(data.ask)) {
      buttons.push({
        _type: "WorkspaceMessagePayloadButton",
        title: words.approveSome,
        value: data.value,
        actionId: SlackActionType.ViewApproveSomeSecurityPlaybookStep,
      });
    }

    buttons.push({
      _type: "WorkspaceMessagePayloadButton",
      title: words.reject,
      value: data.value,
      actionId: SlackActionType.RejectSecurityPlaybookStep,
    });

    return buttons;
  }

  // ---------- Approve Some… ----------

  /*
   * The form Approve Some… opens: what the step does, then a box for each
   * target it proposes, every one ticked, named by the target and why it is
   * one. Its submission carries the button's value; the boxes left ticked
   * are what the step acts on (readKeptTargets). A Slack modal - Microsoft
   * Teams draws the same as a card (MicrosoftTeamsSecurityPlaybookApproval
   * Actions).
   */
  public static getApproveSomeForm(data: {
    ask: SecurityPlaybookApprovalAsk;
    round: SecurityPlaybookApprovalRound;
    language?: string | null | undefined;
  }): WorkspaceModalBlock {
    const context: SecurityPlaybookApprovalWordingContext =
      WorkspaceSecurityPlaybookApproval.getContext(data.language);
    const words: SecurityPlaybookApprovalFormWords =
      getSecurityPlaybookApprovalFormWords(context.translator);
    const wording: SecurityPlaybookApprovalWording =
      wordSecurityPlaybookApproval({ ask: data.ask, context });

    const intro: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: `${wording.action.markdown.toString()}\n\n${FeedMarkdown.textInLine(words.intro).toString()}`,
    };

    const boxes: Array<WorkspaceCheckboxBlock> =
      WorkspaceSecurityPlaybookApproval.getTargetBoxes({
        ask: data.ask,
        wording,
      });

    return {
      _type: "WorkspaceModalBlock",
      title: words.title,
      submitButtonTitle: words.submit,
      cancelButtonTitle: words.cancel,
      actionId: SlackActionType.SubmitApproveSomeSecurityPlaybookStep,
      actionValue: WorkspaceSecurityPlaybookApproval.encodeValue(data.round),
      blocks: [intro, ...boxes],
    };
  }

  /*
   * A box for each proposed target, ticked: its label the target and why
   * it is one, beside it the target. In the order the step proposed them.
   */
  public static getTargetBoxes(data: {
    ask: SecurityPlaybookApprovalAsk;
    wording: SecurityPlaybookApprovalWording;
  }): Array<WorkspaceCheckboxBlock> {
    const proposed: Array<SecurityPlaybookApprovalTarget> = getProposedTargets(
      data.ask,
    );

    return proposed.map(
      (
        target: SecurityPlaybookApprovalTarget,
        index: number,
      ): WorkspaceCheckboxBlock => {
        const line: SecurityPlaybookApprovalLine | undefined =
          data.wording.targets[data.ask.targets.indexOf(target)];

        return {
          _type: "WorkspaceCheckboxBlock",
          label: WorkspaceSecurityPlaybookApproval.cut(
            line?.text || target.value,
            SLACK_LABEL_MAX_LENGTH,
          ),
          blockId: WorkspaceSecurityPlaybookApproval.getTargetField(index),
          optionLabel: WorkspaceSecurityPlaybookApproval.cut(
            target.value,
            SLACK_OPTION_TEXT_MAX_LENGTH,
          ),
          initialValue: true,
          // Left unticked, the box still submits.
          optional: true,
        };
      },
    );
  }

  // The field of the box of the proposed target at `index`.
  public static getTargetField(index: number): string {
    return `${SECURITY_PLAYBOOK_APPROVAL_TARGET_FIELD_PREFIX}${index}`;
  }

  /*
   * The targets an Approve Some submission keeps: the proposed targets
   * whose boxes are ticked, by value, in the order the step proposed them.
   * `isTicked` reads one box as its chat sends it.
   */
  public static readKeptTargets(data: {
    ask: Pick<SecurityPlaybookApprovalAsk, "targets">;
    isTicked: (field: string) => boolean;
  }): Array<string> {
    return getProposedTargets(data.ask)
      .filter(
        (_target: SecurityPlaybookApprovalTarget, index: number): boolean => {
          return data.isTicked(
            WorkspaceSecurityPlaybookApproval.getTargetField(index),
          );
        },
      )
      .map((target: SecurityPlaybookApprovalTarget): string => {
        return target.value;
      });
  }

  // Whether a Slack form's box was ticked, as getValuesFromView reads it.
  public static isSlackBoxTicked(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.some((item: unknown): boolean => {
        return item === WORKSPACE_CHECKBOX_TICKED_VALUE;
      })
    );
  }

  // ---------- helpers ----------

  private static cut(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private static isId(value: unknown): value is string {
    return typeof value === "string" && ObjectID.isValidUUID(value);
  }

  private static toUrl(value: string): URL | null {
    try {
      return value ? URL.fromString(value) : null;
    } catch {
      return null;
    }
  }

  private static sign(payload: string): string {
    return crypto
      .createHmac("sha256", TokenSigningKey.deriveKey(SIGNING_KEY_LABEL))
      .update(payload, "utf8")
      .digest("base64url");
  }

  private static signaturesMatch(expected: string, given: string): boolean {
    const expectedBuffer: Buffer = Buffer.from(expected, "utf8");
    const givenBuffer: Buffer = Buffer.from(given, "utf8");

    return (
      expectedBuffer.length === givenBuffer.length &&
      crypto.timingSafeEqual(
        expectedBuffer as Uint8Array,
        givenBuffer as Uint8Array,
      )
    );
  }
}
