import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import { UnloadedPart } from "Common/UI/Utils/ModelAPI/ItemInParts";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT OF A DATA SECURITY ISSUE COULD NOT BE LOADED, AND WHY (#10238).
 *
 * The issue's page reads the issue and the records it names in one read; a
 * read the server refuses for one of them is read again in parts
 * (getItemInParts), and the page shows the issue with everything else it
 * could read. Above it, this says what it could not, each in a sentence of
 * its own with the server's reason, and offers Try again - never one raw
 * sentence in place of the whole page, which is all a customer saw of every
 * issue from 14.0.99 to 17.0.0.
 */

// What each record the issue names is, as the sentence names it.
export const ISSUE_PART_NOT_LOADED: Readonly<Record<string, string>> = {
  dataStore: translationKey(
    "Couldn't load the store this issue is on. {{error}}",
  ),
  assignedToUser: translationKey(
    "Couldn't load who this issue is assigned to. {{error}}",
  ),
  assignedToTeam: translationKey(
    "Couldn't load the team this issue is assigned to. {{error}}",
  ),
  acceptedByUser: translationKey(
    "Couldn't load who accepted this issue's risk. {{error}}",
  ),
};

// A record the issue names that has no sentence of its own above.
export const ISSUE_PART_NOT_LOADED_OTHERWISE: string = translationKey(
  "Couldn't load part of this issue. {{error}}",
);

export function getIssuePartNotLoadedSentence(relation: string): string {
  return ISSUE_PART_NOT_LOADED[relation] || ISSUE_PART_NOT_LOADED_OTHERWISE;
}

export interface ComponentProps {
  parts: Array<UnloadedPart>;
  // Read the issue again.
  onTryAgain: () => void;
}

const IssuePartsNotLoaded: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.parts.length === 0) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      className="mb-5"
      dataTestId="data-security-issue-parts-not-loaded"
      title={
        <div className="space-y-1">
          {props.parts.map((part: UnloadedPart): ReactElement => {
            return (
              <div
                key={part.relation}
                data-testid={`data-security-issue-part-not-loaded-${part.relation}`}
              >
                <ErrorSentence
                  template={getIssuePartNotLoadedSentence(part.relation)}
                  error={part.error}
                />
              </div>
            );
          })}
        </div>
      }
      textOnRight="Try again"
      onClick={props.onTryAgain}
    />
  );
};

export default IssuePartsNotLoaded;
