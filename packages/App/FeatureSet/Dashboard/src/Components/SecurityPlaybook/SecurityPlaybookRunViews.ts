import PageMap from "../../Utils/PageMap";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import SecurityPlaybookRunStatus from "Common/Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The playbook runs, as two pages under Playbooks in the side menu: the
 * runs held for an approval - the ones that do nothing until a person
 * decides - and every run, to read back what each playbook did.
 *
 * They were three views along the top of one card (Waiting for Approval,
 * Running and All Runs). A run takes seconds unless a step holds it for an
 * approval, so "Running" listed the runs waiting for one; the two pages
 * left say what each list is for. The first is Approvals, the name that
 * fits beside its count in the side menu at every width and in every
 * language; a run held there still reads Waiting for Approval, its status.
 *
 * React-free so each page's query is pinned in a plain test.
 */

export type SecurityPlaybookRunViewKey = "waiting" | "all";

export interface SecurityPlaybookRunView {
  key: SecurityPlaybookRunViewKey;
  // The page, and its entry in the side menu.
  page: PageMap;
  // The page's name: its menu entry, card title, breadcrumb and Search.
  title: string;
  // What the list holds, under the card's title.
  description: string;
  // An empty list's headline, and what it means.
  emptyTitle: string;
  emptyDescription: string;
  /*
   * An empty list here is good news - nobody is being waited on - drawn
   * with a green check, as Active Incidents is.
   */
  isEmptyGoodNews: boolean;
  icon: IconProp;
  query: Query<SecurityPlaybookRun>;
}

// How many runs a page reads: the newest, which is what a person reads.
export const PLAYBOOK_RUNS_PAGE_LIMIT: number = 50;

export const SECURITY_PLAYBOOK_RUN_VIEWS: ReadonlyArray<SecurityPlaybookRunView> =
  [
    {
      key: "waiting",
      page: PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
      title: translationKey("Approvals"),
      description: translationKey(
        "Runs held before a step that needs approval. Approving carries the run on from that step; rejecting ends it.",
      ),
      emptyTitle: translationKey("No step is waiting for approval."),
      emptyDescription: translationKey(
        "A step that needs approval holds its run here until someone approves or rejects it.",
      ),
      isEmptyGoodNews: true,
      icon: IconProp.PauseCircle,
      query: { status: SecurityPlaybookRunStatus.WaitingForApproval },
    },
    {
      key: "all",
      page: PageMap.SECURITY_PLAYBOOK_RUNS,
      title: translationKey("Playbook Runs"),
      description: translationKey(
        "Every playbook run, the newest first. Show a run's steps to see what each did.",
      ),
      emptyTitle: translationKey("No playbook has run yet."),
      emptyDescription: translationKey(
        "A playbook runs when a case opens or grows, or when someone runs it on a case.",
      ),
      isEmptyGoodNews: false,
      icon: IconProp.Play,
      query: {},
    },
  ];

// A view by its key; the runs waiting for approval for anything else.
export function getSecurityPlaybookRunView(
  key: SecurityPlaybookRunViewKey | undefined,
): SecurityPlaybookRunView {
  return (
    SECURITY_PLAYBOOK_RUN_VIEWS.find(
      (view: SecurityPlaybookRunView): boolean => {
        return view.key === key;
      },
    ) || SECURITY_PLAYBOOK_RUN_VIEWS[0]!
  );
}
