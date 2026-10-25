import PageComponentProps from "../../PageComponentProps";
import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getSecurityCaseNoteKind } from "../../../Components/SecurityCase/SecurityCaseNoteKind";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import SecurityCaseNote from "Common/Models/DatabaseModels/SecurityCaseNote";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the team wrote on the case, in the composer an incident's private
 * notes have. A case's notes stay with the team that works security cases:
 * it has no public side, so this is its one notes page, named as an
 * incident's and an alert's private notes are.
 */
const SecurityCaseNotesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const view: SecurityCaseViewContext = useSecurityCaseView();

  return (
    <EventNotes<SecurityCaseNote>
      key={view.caseId.toString()}
      {...getSecurityCaseNoteKind({ securityCaseId: view.caseId })}
      currentProject={props.currentProject}
    />
  );
};

export default SecurityCaseNotesPage;
