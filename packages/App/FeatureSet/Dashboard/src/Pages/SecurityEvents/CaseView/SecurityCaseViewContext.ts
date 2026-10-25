import { SecurityCaseValueLists } from "../../../Components/SecurityCase/SecurityCaseValues";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { useOutletContext } from "react-router-dom";

/*
 * What a case's layout hands the page below it, in its <Outlet>.
 *
 * The layout reads the case once, with everything its header and its pages
 * show, keeps it fresh (a colleague's change, a playbook step, a detection
 * joining it), and holds the case's dialogs - Close Case, Run Playbook,
 * Declare Incident, Edit Case and Delete Case - so every page works the
 * same case the header shows, and asks for those the same way.
 */
export default interface SecurityCaseViewContext {
  caseId: ObjectID;
  securityCase: SecurityCase;
  // The project's case priorities and statuses, the case is drawn with.
  values: SecurityCaseValueLists;
  /*
   * Bumped whenever the case or anything on it changes, so each page reads
   * what it shows again: its detections, runs, timeline.
   */
  refreshToggle: string;
  // A change to the case is being saved.
  isWorking: boolean;
  // Read the case again, and every page's lists with it.
  refresh: () => void;
  // Save a change to the case, then read it again.
  updateCase: (data: JSONObject) => Promise<void>;
  /*
   * Open Run Playbook, on the playbook given (the one OneUptime AI
   * suggested) or on none.
   */
  runPlaybook: (playbookId?: ObjectID | undefined) => void;
  // Ask whether to delete the case, as the header's ⋯ does.
  requestDelete: () => void;
}

export function useSecurityCaseView(): SecurityCaseViewContext {
  return useOutletContext<SecurityCaseViewContext>();
}
