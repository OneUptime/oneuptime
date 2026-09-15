import {
  RuleRunAction,
  RuleRunResult,
  RuleRunType,
  RuleRunTypeMetadata,
  RuleRunTypeUtil,
} from "../../Types/Rules/RuleRun";

/*
 * The sentences a rule run shows: before it starts, while it is chaining
 * passes, and once it is done.
 *
 * Pure and dependency-free on purpose. A run that changes nothing is the
 * common case once a rule has been run - "matched 40, added 0" with no reason
 * reads as a broken button - so how each outcome is phrased is the part of
 * this feature that most needs every branch pinned by a test.
 */

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function resources(value: number, meta: RuleRunTypeMetadata): string {
  return count(value, meta.resourceSingular, meta.resourcePlural);
}

// "was" / "were", agreeing with a count.
function wasOrWere(value: number): string {
  return value === 1 ? "was" : "were";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default class RuleRunSummary {
  // What the confirmation modal says the run is about to do.
  public static describeConfirmation(ruleType: RuleRunType): string {
    const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(ruleType);

    switch (meta.action) {
      case RuleRunAction.AddLabels:
        return `Evaluate this rule against the ${meta.resourcePlural} that already exist in this project and attach its labels to the ones it matches. Label rules normally only run when a ${meta.resourceSingular} is created, so this is how a rule reaches ${meta.resourcePlural} that existed before it was written.\n\nLabels are only added, never removed, so running this more than once is safe.`;
      case RuleRunAction.AddOwners:
        return `Evaluate this rule against the ${meta.resourcePlural} that already exist in this project and add its owners to the ones it matches. Owner rules normally only run when a ${meta.resourceSingular} is created, so this is how a rule reaches ${meta.resourcePlural} that existed before it was written.\n\nOwners are only added, never removed, and owners who are already assigned are skipped, so running this more than once is safe.`;
      case RuleRunAction.MarkPrivate:
        return `Evaluate this rule against the ${meta.resourcePlural} that already exist in this project and make the ones it matches private. Privacy rules normally only run when a ${meta.resourceSingular} is created, so this is how a rule reaches ${meta.resourcePlural} that existed before it was written.\n\nNothing is ever made public again by a run, so running this more than once is safe.`;
      case RuleRunAction.SyncStatusPageMonitors:
        return "Re-evaluate this rule against every monitor in the project: monitors it matches are added to this status page, and monitors it added earlier that no longer match are removed. Monitors added to the page by hand are never touched.\n\nRules already re-sync when they are saved, so use this to pick up changes the page missed.";
    }
  }

  /*
   * The confirmation for running several rules from the table's bulk actions.
   * A bulk run cannot ask the per-run notification question, so for owner
   * rules it says plainly that it adds owners silently.
   */
  public static describeBulkConfirmation(data: {
    ruleType: RuleRunType;
    ruleCount: number;
  }): string {
    const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(
      data.ruleType,
    );
    const rules: string = count(
      data.ruleCount,
      "selected rule",
      "selected rules",
    );

    if (meta.action === RuleRunAction.SyncStatusPageMonitors) {
      return `Re-sync this status page against ${rules}? Each rule adds the monitors it matches and removes the monitors it added that no longer match. Monitors added by hand are never touched.`;
    }

    const lines: Array<string> = [
      `Run ${rules} against the ${meta.resourcePlural} that already exist in this project? Each rule is applied the same way it is when a ${meta.resourceSingular} is created, and disabled rules are skipped with an error.`,
    ];

    if (meta.action === RuleRunAction.AddOwners) {
      lines.push(
        "Owners added by a bulk run are not notified. To notify them, run a single rule from its page instead.",
      );
    }

    return lines.join(" ");
  }

  // The line shown while a run is still chaining passes.
  public static describeProgress(data: {
    ruleType: RuleRunType;
    result: RuleRunResult;
  }): string {
    const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(
      data.ruleType,
    );

    return `Evaluated ${resources(
      data.result.resourcesEvaluated,
      meta,
    )} so far, and updated ${data.result.resourcesUpdated}. Still running — leave this open.`;
  }

  // The report once a run is done.
  public static describe(data: {
    ruleType: RuleRunType;
    result: RuleRunResult;
  }): string {
    const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(
      data.ruleType,
    );
    const result: RuleRunResult = data.result;

    if (meta.action === RuleRunAction.SyncStatusPageMonitors) {
      return RuleRunSummary.describeStatusPageSync(result);
    }

    const lines: Array<string> = [];

    /*
     * Matched resources that neither changed nor failed already had what the
     * rule adds. Reported separately because "nothing to do" and "could not
     * do it" call for opposite reactions.
     */
    const alreadyApplied: number = Math.max(
      result.resourcesMatched -
        result.resourcesUpdated -
        result.resourcesFailed,
      0,
    );

    const matchedOutOf: string = `This rule matched ${resources(
      result.resourcesMatched,
      meta,
    )} out of the ${resources(result.resourcesEvaluated, meta)} it looked at.`;

    if (meta.action === RuleRunAction.AddLabels) {
      if (result.resourcesUpdated > 0) {
        lines.push(
          `Added labels to ${resources(result.resourcesUpdated, meta)} (${count(
            result.itemsAdded,
            "label",
            "labels",
          )} attached).`,
        );

        if (alreadyApplied > 0) {
          lines.push(
            `${capitalize(resources(alreadyApplied, meta))} already had this rule's labels.`,
          );
        }
      } else {
        lines.push(`No labels were attached. ${matchedOutOf}`);

        if (alreadyApplied > 0) {
          lines.push(
            `Every matching ${meta.resourceSingular} already has this rule's labels, so there was nothing to add.`,
          );
        }
      }
    }

    if (meta.action === RuleRunAction.AddOwners) {
      if (result.resourcesUpdated > 0) {
        lines.push(
          `Added owners to ${resources(result.resourcesUpdated, meta)} (${count(
            result.itemsAdded,
            "owner",
            "owners",
          )} assigned).`,
        );

        lines.push(
          result.ownersNotified
            ? "The added owners will be notified."
            : "The added owners were not notified.",
        );

        if (alreadyApplied > 0) {
          lines.push(
            `${capitalize(resources(alreadyApplied, meta))} already had this rule's owners.`,
          );
        }
      } else {
        lines.push(`No owners were added. ${matchedOutOf}`);

        if (alreadyApplied > 0) {
          lines.push(
            `Every matching ${meta.resourceSingular} already has this rule's owners, so there was nothing to add.`,
          );
        }
      }
    }

    if (meta.action === RuleRunAction.MarkPrivate) {
      if (result.resourcesUpdated > 0) {
        lines.push(`Made ${resources(result.resourcesUpdated, meta)} private.`);

        if (alreadyApplied > 0) {
          lines.push(
            `${capitalize(resources(alreadyApplied, meta))} ${wasOrWere(
              alreadyApplied,
            )} already private.`,
          );
        }
      } else {
        lines.push(
          `No ${meta.resourcePlural} were made private. ${matchedOutOf}`,
        );

        if (alreadyApplied > 0) {
          lines.push(
            `Every matching ${meta.resourceSingular} is already private, so there was nothing to change.`,
          );
        }
      }
    }

    if (result.resourcesFailed > 0) {
      lines.push(
        `${capitalize(resources(result.resourcesFailed, meta))} could not be updated. Check the server logs for the reason.`,
      );
    }

    if (result.isTruncated) {
      lines.push(
        `The run stopped after evaluating ${resources(
          result.resourcesEvaluated,
          meta,
        )} so that it stays bounded. Run the rule again to continue - ${meta.resourcePlural} it already updated are skipped.`,
      );
    }

    return lines.join(" ");
  }

  private static describeStatusPageSync(result: RuleRunResult): string {
    const monitors: (value: number) => string = (value: number): string => {
      return count(value, "monitor", "monitors");
    };

    const changes: Array<string> = [];

    if (result.itemsAdded > 0) {
      changes.push(`added ${monitors(result.itemsAdded)} to the status page`);
    }

    if (result.itemsRemoved > 0) {
      changes.push(
        `removed ${monitors(result.itemsRemoved)} this rule no longer matches`,
      );
    }

    if (result.resourcesUpdated > 0) {
      changes.push(
        `refreshed the display settings of ${monitors(result.resourcesUpdated)}`,
      );
    }

    if (changes.length === 0) {
      return "The status page already matches this rule, so nothing changed.";
    }

    return `${capitalize(changes.join(", "))}.`;
  }
}
