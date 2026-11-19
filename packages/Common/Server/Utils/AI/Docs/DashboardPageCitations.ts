import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import { AskAiRecordPage } from "../../../../Types/AI/AskAiRecordPages";
import { AIDashboardPage } from "./DashboardPageFinder";

/*
 * WHAT A "GO TO <PAGE>" BUTTON CARRIES (#6828, #7065).
 *
 * find_dashboard_page's citation is the button under a how-do-I answer.
 * It carries the page's route template from the server's own catalog,
 * never an address the model wrote, and the Dashboard opens it only after
 * checking it again (AskAiPageLinks, CitationTargetNav). Built here, with
 * no reads, so the tool and the test that opens every page the catalogs
 * hold build the same citation.
 */

// The most of a record's name a citation carries.
export const MAX_CITED_RECORD_TITLE_CHARS: number = 200;

// A page of the project: its route, its English title, and the key its button draws.
export const getDashboardPageCitationTarget: (
  page: AIDashboardPage,
) => AIChatCitationTarget = (page: AIDashboardPage): AIChatCitationTarget => {
  return {
    type: AIChatCitationTargetType.DashboardPage,
    params: {
      path: page.path,
      title: page.title,
      // The key its button draws, where it is not the title (#8817).
      ...(page.titleKey ? { titleKey: page.titleKey } : {}),
      // What fills that key, where it is a template (#8834).
      ...(page.titleKey && page.titleValues
        ? { titleValues: JSON.stringify(page.titleValues) }
        : {}),
    },
  };
};

/*
 * A page of one record (#7065): its route, which waits for the record's
 * id, the id the server read the record by, and the record's name as the
 * person reads it, drawn beside the button.
 */
export const getRecordPageCitationTarget: (data: {
  page: AskAiRecordPage;
  recordId: string;
  recordTitle?: string | undefined;
}) => AIChatCitationTarget = (data: {
  page: AskAiRecordPage;
  recordId: string;
  recordTitle?: string | undefined;
}): AIChatCitationTarget => {
  const recordTitle: string = (data.recordTitle || "")
    .trim()
    .slice(0, MAX_CITED_RECORD_TITLE_CHARS);

  return {
    type: AIChatCitationTargetType.DashboardPage,
    params: {
      path: data.page.path,
      title: data.page.title,
      recordId: data.recordId,
      ...(recordTitle ? { recordTitle } : {}),
    },
  };
};
