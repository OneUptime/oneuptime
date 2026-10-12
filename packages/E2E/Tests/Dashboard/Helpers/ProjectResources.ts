import { BASE_URL } from "../../../Config";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import { clickRowMenuAction } from "../../Helpers/RowActions";

/*
 * Small helpers for specs that create a project's own resources (labels,
 * teams, monitor groups...) through the Dashboard and read them back through
 * the API, as the signed-in user, so what the form saved is checked on the
 * server rather than only on the page that just rendered it.
 */

export const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

/*
 * For assertions that wait on the server (a save, a page's first fetch, a
 * full navigation): the suite's 5s default is for what is already on screen.
 */
export const SERVER: { timeout: number } = { timeout: 30000 };

export const UUID_PATTERN: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type ServerRow = Record<string, unknown> & { _id: string };

/*
 * The project's rows of one model whose name is `name`, read through the
 * model's CRUD API ("/api/label/get-list") with the fields asked for.
 */
type ListByNameFunction = (data: {
  page: Page;
  projectId: string;
  apiPath: string;
  name: string;
  select?: Record<string, boolean> | undefined;
}) => Promise<Array<ServerRow>>;

export const listByName: ListByNameFunction = async (data: {
  page: Page;
  projectId: string;
  apiPath: string;
  name: string;
  select?: Record<string, boolean> | undefined;
}): Promise<Array<ServerRow>> => {
  const response: APIResponse = await data.page.request.post(
    urlFor(`/api/${data.apiPath}/get-list`),
    {
      headers: { tenantid: data.projectId },
      data: {
        query: { projectId: data.projectId, name: data.name },
        select: { _id: true, name: true, ...(data.select || {}) },
        limit: 10,
        skip: 0,
        sort: {},
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body: { data: Array<ServerRow> } = await response.json();

  return body.data;
};

/*
 * Deletes the temporary project a spec made, so runs do not pile them up.
 * Best effort and bounded: this is cleanup in a `finally`, and a delete that
 * fails or stalls (a billing provider the stack cannot reach, say) must not
 * replace whatever the test itself found. A failed delete is recorded as an
 * annotation on the test instead.
 */
export const deleteProject: (
  page: Page,
  projectId: string,
) => Promise<void> = async (page: Page, projectId: string): Promise<void> => {
  let problem: string | null = null;

  try {
    const response: APIResponse = await page.request.delete(
      urlFor(`/api/project/${projectId}`),
      { headers: { tenantid: projectId }, timeout: 60000 },
    );

    if (!response.ok()) {
      problem = `HTTP ${response.status()}: ${await response.text()}`;
    }
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  if (problem) {
    test.info().annotations.push({
      type: "cleanup",
      description: `Temporary project ${projectId} was not deleted: ${problem}`,
    });
  }
};

/*
 * Runs a row's action whether it is the row's one button or folded into the
 * row's ⋯ menu (Common/UI/Components/ActionButton/SplitActionButtons.ts picks
 * which), so a spec does not depend on which of a table's actions won the
 * button.
 */
export const clickRowAction: (data: {
  row: Locator;
  name: string;
}) => Promise<void> = async (data: {
  row: Locator;
  name: string;
}): Promise<void> => {
  const button: Locator = data.row.getByRole("button", {
    name: data.name,
    exact: true,
  });

  if ((await button.count()) > 0) {
    await button.click();
    return;
  }

  await clickRowMenuAction({ row: data.row, name: data.name });
};
