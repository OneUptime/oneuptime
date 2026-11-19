/*
 * ASK AI'S DOCS TOOLS, BY NAME (#6828).
 *
 * search_docs and read_docs answer "how do I...?" from OneUptime's own
 * docs, and find_dashboard_page ends the answer with the page where it is
 * done (Server/Utils/AI/Toolbox/DocsTools). Their names live here, apart
 * from the tools: the prompt names them, the ratings and the analytics
 * tell an answer from the docs by them, and the Dashboard reads them -
 * none of which may load the tools themselves, which read the project's
 * records through its services.
 *
 * Pure: the server, the Dashboard and the tests read it.
 */

export const SEARCH_DOCS_TOOL_NAME: string = "search_docs";
export const READ_DOCS_TOOL_NAME: string = "read_docs";
export const FIND_DASHBOARD_PAGE_TOOL_NAME: string = "find_dashboard_page";

// Every docs tool: an answer that ran one of them drew on the docs.
export const ASK_AI_DOCS_TOOL_NAMES: ReadonlyArray<string> = [
  SEARCH_DOCS_TOOL_NAME,
  READ_DOCS_TOOL_NAME,
  FIND_DASHBOARD_PAGE_TOOL_NAME,
];
