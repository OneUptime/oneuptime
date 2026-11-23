import {
  DataSecurityAiProposalActions,
  useDataSecurityAiProposalActions,
} from "./DataSecurityAiProposalActions";
import { DataSecurityAiPageCopy } from "./DataSecurityAiCopy";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import { isDataSecurityAiProposalUndoable } from "Common/Types/DataSecurity/DataSecurityAi";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  proposalId: ObjectID;
  // After the change is undone: the timeline reads its new entry.
  onUndone: () => void;
}

export const ISSUE_FEED_UNDO_TEST_ID: string = "data-security-issue-feed-undo";

/*
 * THE UNDO ON A CHANGE ONEUPTIME AI MADE, ON THE ISSUE'S OWN TIMELINE
 * (#10366).
 *
 * A scrub rule OneUptime AI made without asking - or one a person approved
 * - is taken back from the very entry that says it was made, as from Data
 * Security > AI: the same dialog, the same route, the person's own
 * permission to delete the rule. Shown while the change still stands; once
 * it is undone the entry keeps its words and loses its button.
 */
const IssueFeedProposalUndo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [proposal, setProposal] = useState<DataSecurityAiProposal | null>(null);
  const [readCount, setReadCount] = useState<number>(0);
  const actions: DataSecurityAiProposalActions =
    useDataSecurityAiProposalActions((): void => {
      setReadCount((count: number): number => {
        return count + 1;
      });
      props.onUndone();
    });

  useEffect(() => {
    let isCurrent: boolean = true;

    // A proposal the person may not read draws no button.
    ModelAPI.getItem<DataSecurityAiProposal>({
      modelType: DataSecurityAiProposal,
      id: props.proposalId,
      select: { _id: true, status: true, title: true },
    })
      .then((found: DataSecurityAiProposal | null) => {
        if (isCurrent) {
          setProposal(found);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setProposal(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.proposalId.toString(), readCount]);

  if (!proposal || !isDataSecurityAiProposalUndoable(proposal.status)) {
    return <></>;
  }

  return (
    <div className="mt-2" data-testid={ISSUE_FEED_UNDO_TEST_ID}>
      <Button
        title={DataSecurityAiPageCopy.undo}
        buttonStyle={ButtonStyleType.NORMAL}
        buttonSize={ButtonSize.Small}
        onClick={() => {
          actions.undo(proposal);
        }}
      />
      {actions.dialogs}
    </div>
  );
};

export default IssueFeedProposalUndo;
