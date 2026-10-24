import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * What a bulk switch does to the records it turns, said under its question
 * ("Are you sure you want to disable 4 workflows?"), the way a Delete says
 * what goes with a record (DeleteConsequences). The question says how many
 * and which; this says what changes for them, which is what the person about
 * to press the button is deciding on.
 *
 * One sentence per kind of record and per side of its switch, written about
 * the kind ("A disabled workflow ...") so it reads the same under one row
 * and under twenty. A side with nothing a person would not expect has no
 * sentence, and its dialog asks the question alone.
 *
 * Keyed by the model's table name, then the switch's column. Every sentence
 * is a Dashboard translation key, translated in all seventeen locales; each
 * is held to the code that makes it true by BulkSwitchConsequences.test.ts
 * (Common Tests, UI/Components/BulkUpdate).
 */

export interface BulkSwitchConsequence {
  // Said when the action turns the switch on (writes true).
  on?: string | undefined;
  // Said when the action turns it off (writes false).
  off?: string | undefined;
}

export const BULK_SWITCH_CONSEQUENCES: Readonly<
  Record<string, Readonly<Record<string, BulkSwitchConsequence>>>
> = {
  /*
   * The other way round: Disable Monitoring on is a disabled monitor, so its
   * "on" is what Disable does.
   */
  Monitor: {
    disableActiveMonitoring: {
      on: translationKey(
        "A disabled monitor is not checked, and opens no incidents or alerts, until it is enabled again.",
      ),
    },
  },
  Workflow: {
    isEnabled: {
      on: translationKey(
        "An enabled workflow runs every time its trigger fires.",
      ),
      off: translationKey(
        "A disabled workflow does not run when its trigger fires. You can still run it by hand from its Builder.",
      ),
    },
  },
  Runbook: {
    isEnabled: {
      off: translationKey(
        "A disabled runbook cannot be run - not by hand, by its rules, by OneUptime AI, on its schedule or by its webhook - until it is enabled again.",
      ),
    },
  },
  ServiceLevelObjective: {
    isEnabled: {
      off: translationKey(
        "A disabled SLO is not evaluated: its error budget stops updating and its burn rate rules raise nothing.",
      ),
    },
  },
  IncomingCallPolicy: {
    isEnabled: {
      off: translationKey(
        "A disabled incoming call policy answers calls to its number with a short message and hangs up. Nobody is called.",
      ),
    },
  },
  DetectionRule: {
    isEnabled: {
      off: translationKey(
        "A disabled detection rule does not look at new security events, so it finds nothing until it is enabled again.",
      ),
    },
  },
  SecurityPlaybook: {
    isEnabled: {
      off: translationKey(
        "A disabled playbook does not run on its own. It can still be run by hand from a case.",
      ),
    },
  },
  /*
   * A pipeline transforms what it matches as it is ingested (the docs'
   * words); off, nothing it would change is changed.
   */
  LogPipeline: {
    isEnabled: {
      off: translationKey(
        "A disabled pipeline no longer transforms new logs: they are stored as they arrive.",
      ),
    },
  },
  TracePipeline: {
    isEnabled: {
      off: translationKey(
        "A disabled pipeline no longer transforms new spans: they are stored as they arrive.",
      ),
    },
  },
  LogDropFilter: {
    isEnabled: {
      off: translationKey(
        "A disabled drop filter keeps the logs it would drop, until it is enabled again.",
      ),
    },
  },
  TraceDropFilter: {
    isEnabled: {
      off: translationKey(
        "A disabled drop filter keeps the spans it would drop, until it is enabled again.",
      ),
    },
  },
  MonitorProbe: {
    isEnabled: {
      off: translationKey(
        "A disabled probe stops checking this monitor, and stays on the list to be enabled again.",
      ),
    },
  },
  StatusPageSubscriber: {
    isUnsubscribed: {
      on: translationKey(
        "Unsubscribed subscribers get no more updates from this status page. They stay in the list, and each can be subscribed again from its Edit form.",
      ),
    },
  },
};

// The English sentence for turning a switch of this table to `value`, or "".
export const getBulkSwitchConsequence: (data: {
  tableName: string | null | undefined;
  column: string;
  value: boolean;
}) => string = (data: {
  tableName: string | null | undefined;
  column: string;
  value: boolean;
}): string => {
  if (!data.tableName) {
    return "";
  }

  const consequence: BulkSwitchConsequence | undefined =
    BULK_SWITCH_CONSEQUENCES[data.tableName]?.[data.column];

  if (!consequence) {
    return "";
  }

  return (data.value ? consequence.on : consequence.off) || "";
};
