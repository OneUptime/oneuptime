import { translationKey } from "../Translator";
import {
  SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseHandOffReason,
} from "./SecurityCaseAi";

/*
 * WHAT ONEUPTIME AI SAYS OF WHAT IT DID ON A CASE (#10352), in one place:
 * the case's AI card words its log from these keys in the reader's
 * language, the timeline and the notices write them in English, and the
 * docs test that they say what the code does.
 *
 * Each sentence is an English key (translationKey), with its values as
 * {{placeholders}}: the case's own values - an address, a user, a host -
 * are filled in where it is drawn, as text, never as markup.
 *
 * Kept free of anything server-side, so the Dashboard reads these exact
 * strings.
 */

// What one thing OneUptime AI did, asked or left reads as, by kind and by what became of it.
export interface SecurityCaseAiActionTitles {
  done: string;
  asked: string;
  left: string;
}

export const SECURITY_CASE_AI_ACTION_TITLES: Readonly<
  Record<SecurityCaseAiActionKind, SecurityCaseAiActionTitles>
> = {
  [SecurityCaseAiActionKind.TakeCase]: {
    done: translationKey("Took the case"),
    asked: translationKey("Asks to take the case"),
    left: translationKey("Did not take the case"),
  },
  [SecurityCaseAiActionKind.SetPriority]: {
    done: translationKey("Raised the priority"),
    asked: translationKey("Asks to raise the priority"),
    left: translationKey("Did not change the priority"),
  },
  [SecurityCaseAiActionKind.MarkStepDone]: {
    done: translationKey("Marked a step done"),
    asked: translationKey("Asks to mark a step done"),
    left: translationKey("Left a step for a person"),
  },
  [SecurityCaseAiActionKind.MarkContained]: {
    done: translationKey("Moved the case to Contained"),
    asked: translationKey("Asks to move the case to Contained"),
    left: translationKey("Did not move the case to Contained"),
  },
  [SecurityCaseAiActionKind.BlockAddress]: {
    done: translationKey("Blocked {{value}} for 24 hours"),
    asked: translationKey("Asks to block {{value}} for 24 hours"),
    left: translationKey("Did not block {{value}}"),
  },
  [SecurityCaseAiActionKind.ContainAccount]: {
    done: translationKey("Contained the account {{value}}"),
    asked: translationKey("Asks to contain the account {{value}}"),
    left: translationKey("Did not contain the account {{value}}"),
  },
  [SecurityCaseAiActionKind.ContainHost]: {
    done: translationKey("Contained the host {{value}}"),
    asked: translationKey("Asks to contain the host {{value}}"),
    left: translationKey("Did not contain the host {{value}}"),
  },
  [SecurityCaseAiActionKind.DeclareIncident]: {
    done: translationKey("Declared an incident"),
    asked: translationKey("Asks to declare an incident"),
    left: translationKey("Did not declare an incident"),
  },
  [SecurityCaseAiActionKind.RequestCodeFix]: {
    done: translationKey("Asked Fix With AI for a pull request"),
    asked: translationKey("Asks to have Fix With AI open a pull request"),
    left: translationKey("Did not ask for a code fix"),
  },
  [SecurityCaseAiActionKind.CloseCase]: {
    done: translationKey("Closed the case as {{verdict}}"),
    asked: translationKey("Asks to close the case as {{verdict}}"),
    left: translationKey("Did not close the case"),
  },
  [SecurityCaseAiActionKind.LiftBlock]: {
    done: translationKey("Lifted the case's blocks: {{value}}"),
    asked: translationKey("Asks to lift the case's blocks: {{value}}"),
    left: translationKey("Did not lift the case's blocks"),
  },
  [SecurityCaseAiActionKind.OfferRuleException]: {
    done: translationKey("The rule's exception for {{value}} was added"),
    asked: translationKey("Offers the rule an exception for {{value}}"),
    left: translationKey("Did not offer the rule an exception"),
  },
  [SecurityCaseAiActionKind.StepForPeople]: {
    done: translationKey("A person did a step"),
    asked: translationKey("Asks a person to do a step"),
    left: translationKey("Left a step for a person"),
  },
  [SecurityCaseAiActionKind.HandToPeople]: {
    done: translationKey("Handed the case to people"),
    asked: translationKey("Handed the case to people"),
    left: translationKey("Handed the case to people"),
  },
};

// The title of one row of the log, by what became of it.
export function getSecurityCaseAiActionTitle(data: {
  kind: SecurityCaseAiActionKind;
  status: SecurityCaseAiActionStatus;
}): string {
  const titles: SecurityCaseAiActionTitles =
    SECURITY_CASE_AI_ACTION_TITLES[data.kind];

  switch (data.status) {
    case SecurityCaseAiActionStatus.Asked:
      return titles.asked;
    case SecurityCaseAiActionStatus.Left:
      return titles.left;
    default:
      return titles.done;
  }
}

// What became of it, as its chip says.
export const SECURITY_CASE_AI_ACTION_STATUS_LABELS: Readonly<
  Record<SecurityCaseAiActionStatus, string>
> = {
  [SecurityCaseAiActionStatus.Doing]: translationKey("In progress"),
  [SecurityCaseAiActionStatus.Done]: translationKey("Done"),
  [SecurityCaseAiActionStatus.Asked]: translationKey("Waiting for approval"),
  [SecurityCaseAiActionStatus.Declined]: translationKey("Declined"),
  [SecurityCaseAiActionStatus.Left]: translationKey("Left for a person"),
  [SecurityCaseAiActionStatus.Failed]: translationKey("Did not finish"),
  [SecurityCaseAiActionStatus.Undone]: translationKey("Undone"),
};

// Why it is as it is, in a sentence.
export const SECURITY_CASE_AI_ACTION_REASON_SENTENCES: Readonly<
  Record<SecurityCaseAiActionReason, string>
> = {
  [SecurityCaseAiActionReason.OnItsOwn]: translationKey(
    "Done on its own: your settings allow it.",
  ),
  [SecurityCaseAiActionReason.Approved]: translationKey(
    "Done once a person approved it.",
  ),
  [SecurityCaseAiActionReason.SettingAsks]: translationKey(
    "Your settings have this wait for a person's approval.",
  ),
  [SecurityCaseAiActionReason.AlwaysAsks]: translationKey(
    "This always waits for a person, whatever your settings say.",
  ),
  [SecurityCaseAiActionReason.EdgeNotCleared]: translationKey(
    "Edge is set to On its own, but no Security Admin has confirmed it yet, so it asks.",
  ),
  [SecurityCaseAiActionReason.SettingOff]: translationKey(
    "Your settings leave this to a person.",
  ),
  [SecurityCaseAiActionReason.NoWayToDoIt]: translationKey(
    "OneUptime has no way to do this step, so a person does it.",
  ),
  [SecurityCaseAiActionReason.NeedsJudgement]: translationKey(
    "This takes a judgement the evidence cannot settle, so a person makes it.",
  ),
  [SecurityCaseAiActionReason.FixLooksDone]: translationKey(
    "The fix looks done, but OneUptime cannot prove it yet, so a person confirms it.",
  ),
  [SecurityCaseAiActionReason.FixNotChecked]: translationKey(
    "OneUptime cannot check this fix yet, so a person confirms it.",
  ),
  [SecurityCaseAiActionReason.ProtectedTarget]: translationKey(
    "What it acts on is protected, so OneUptime AI did not touch it.",
  ),
  [SecurityCaseAiActionReason.AlreadyBlocked]: translationKey(
    "A block already holds this address.",
  ),
  [SecurityCaseAiActionReason.NoBlockDestination]: translationKey(
    "Nothing enforces your blocklist yet. Connect Cloudflare, AWS WAF or a firewall to block from OneUptime.",
  ),
  [SecurityCaseAiActionReason.NothingToFixInCode]: translationKey(
    "None of the case's requests threw an exception, so there is no code to fix.",
  ),
  [SecurityCaseAiActionReason.EngineFailed]:
    translationKey("It did not finish."),
  [SecurityCaseAiActionReason.UndoneByPerson]:
    translationKey("A person undid it."),
  [SecurityCaseAiActionReason.DeclinedByPerson]: translationKey(
    "A person turned it down.",
  ),
  [SecurityCaseAiActionReason.HandedOff]: translationKey(
    "OneUptime AI handed the case to people.",
  ),
};

// Why OneUptime AI handed a case to people, in a sentence.
export const SECURITY_CASE_HAND_OFF_SENTENCES: Readonly<
  Record<SecurityCaseHandOffReason, string>
> = {
  [SecurityCaseHandOffReason.SteeringText]: translationKey(
    "Some of the case's data reads like instructions to an AI, so a person has to look at it.",
  ),
  [SecurityCaseHandOffReason.HighestPriority]: translationKey(
    "The case is at your highest priority, so a person takes it.",
  ),
  [SecurityCaseHandOffReason.ProtectedTarget]: translationKey(
    "What its next step acts on is protected, so OneUptime AI will not touch it.",
  ),
  [SecurityCaseHandOffReason.BreakerTripped]: translationKey(
    "OneUptime AI has acted on its own as often as it may in an hour across your cases.",
  ),
  [SecurityCaseHandOffReason.AiOff]: translationKey(
    "OneUptime AI is turned off for this project, or for security cases.",
  ),
  [SecurityCaseHandOffReason.NoLlmProvider]: translationKey(
    "No LLM provider is set up for OneUptime AI.",
  ),
  [SecurityCaseHandOffReason.OutOfCredits]: translationKey(
    "The project is out of AI credits, or reached its daily AI limit.",
  ),
  [SecurityCaseHandOffReason.NotLikelyMalicious]: translationKey(
    "OneUptime AI's triage could not tell whether the case is real, so a person decides.",
  ),
  [SecurityCaseHandOffReason.DidNotHold]: translationKey(
    "A step OneUptime AI took does not hold, and it will not try the same again blindly.",
  ),
  [SecurityCaseHandOffReason.StepFailed]: translationKey(
    "A step OneUptime AI started did not finish.",
  ),
  [SecurityCaseHandOffReason.Declined]: translationKey(
    "A person turned down or undid a step OneUptime AI took.",
  ),
  [SecurityCaseHandOffReason.OnlyPeopleCanDo]: translationKey(
    "Everything left on the case is a person's to do.",
  ),
  [SecurityCaseHandOffReason.CannotTell]: translationKey(
    "OneUptime AI could not tell what to do next.",
  ),
  [SecurityCaseHandOffReason.TakenOver]: translationKey(
    "A person took the case over.",
  ),
};

// The breaker's limit, as its sentence would name it.
export const SECURITY_CASE_AI_BREAKER_LIMIT: number =
  SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR;
