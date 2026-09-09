import { APIResponse, Page, Response, expect } from "@playwright/test";

export type JSONish = Record<string, any>;

export const buildUrl: (route: string) => string = (route: string): string => {
  return `${process.env["HTTP_PROTOCOL"] || "http"}://${process.env["HOST"] || "localhost"}${route}`;
};

export const toId: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : String((value as JSONish)?.["value"] || "");
};

interface RequestData {
  page: Page;
  projectId: string;
  path: string;
  body: JSONish;
}

const requestJson: (data: RequestData) => Promise<JSONish> = async (
  data: RequestData,
): Promise<JSONish> => {
  const response: APIResponse = await data.page.request.post(buildUrl(data.path), {
    headers: { "content-type": "application/json", tenantid: data.projectId, projectid: data.projectId },
    data: data.body,
  });
  expect(response.ok(), `${data.path}: ${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
};

export const createItem: (data: { page: Page; projectId: string; path: string; item: JSONish }) => Promise<JSONish> = async (
  data: { page: Page; projectId: string; path: string; item: JSONish },
): Promise<JSONish> => {
  const response: JSONish = await requestJson({ ...data, body: { data: data.item } });
  return response["data"] || response;
};

export const listItems: (data: { page: Page; projectId: string; path: string; query?: JSONish; select: JSONish }) => Promise<Array<JSONish>> = async (
  data: { page: Page; projectId: string; path: string; query?: JSONish; select: JSONish },
): Promise<Array<JSONish>> => {
  const response: JSONish = await requestJson({ ...data, path: `${data.path}/get-list`, body: { query: data.query || {}, select: data.select, limit: 100, skip: 0 } });
  return response["data"] || [];
};

export const getItem: (data: { page: Page; projectId: string; path: string; id: string; select: JSONish }) => Promise<JSONish> = async (
  data: { page: Page; projectId: string; path: string; id: string; select: JSONish },
): Promise<JSONish> => {
  const response: JSONish = await requestJson({ ...data, path: `${data.path}/${data.id}/get-item`, body: { select: data.select } });
  return response["data"] || response;
};

export const deleteItem: (data: { page: Page; projectId: string; path: string; id: string }) => Promise<void> = async (
  data: { page: Page; projectId: string; path: string; id: string },
): Promise<void> => {
  const response: APIResponse = await data.page.request.delete(buildUrl(`${data.path}/${data.id}`), {
    headers: { tenantid: data.projectId, projectid: data.projectId },
  });
  expect(response.ok(), `Cleanup ${data.path}: ${response.status()} ${await response.text()}`).toBe(true);
};


export const registerAndCreateProject: (data: { page: Page; projectNamePrefix: string }) => Promise<string> = async (
  data: { page: Page; projectNamePrefix: string },
): Promise<string> => {
  const unique: string = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await data.page.goto(buildUrl("/accounts/register"));
  await data.page.getByTestId("email").fill(`label-transfer-${unique}@example.com`);
  await data.page.getByTestId("name").fill("Label Transfer Test");
  await data.page.getByTestId("password").fill("sample");
  await data.page.getByTestId("confirmPassword").fill("sample");
  const signUpResponse: Promise<Response> = data.page.waitForResponse((response: Response): boolean => {
    return response.url().endsWith("/identity/signup") && response.request().method() === "POST";
  });
  await data.page.getByTestId("Sign Up").click();
  const registered: Response = await signUpResponse;
  expect(registered.ok(), `Signup failed: ${registered.status()}`).toBe(true);
  await expect(data.page).toHaveURL(/\/dashboard\/welcome/, { timeout: 120000 });
  await data.page.getByTestId("create-new-project-button").click();
  await data.page.locator("#create-project-from input[type='text']").first().fill(`${data.projectNamePrefix} ${unique}`);
  await data.page.getByTestId("modal-footer-submit-button").click();
  await expect(data.page).toHaveURL(/\/dashboard\/([a-f0-9-]+)(?:\/home\/?)?$/, { timeout: 120000 });
  const projectId: string | undefined = data.page.url().match(/\/dashboard\/([a-f0-9-]+)/)?.[1];
  expect(projectId).toBeTruthy();
  return projectId!;
};
