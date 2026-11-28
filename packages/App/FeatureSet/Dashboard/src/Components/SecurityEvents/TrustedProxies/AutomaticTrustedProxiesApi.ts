import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  AutomaticTrustedProxies,
  readAutomaticTrustedProxies,
} from "Common/Types/SecurityEvent/AutomaticTrustedProxies";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * What Security Events trusts as a proxy without being listed (#10546), as
 * the server answers it (Server/API/SecurityTrustedProxiesAPI): the edges
 * the project connected, and its own application load balancers as the
 * reader may read them. Throws the server's error, for the card to say.
 *
 * Trusted Proxies and Trusted Automatically both read it as the page opens
 * (#11389: the first for the warning under its list), a moment apart - the
 * second once it has read the project. So one read serves both: shared
 * while it is on its way, and kept a few seconds once it has answered, or
 * failed - both cards then say the same. After that, an ask reads again.
 */
export const AUTOMATIC_TRUSTED_PROXIES_SHARED_FOR_MS: number = 10 * 1000;

let shared: {
  projectId: string;
  answer: Promise<AutomaticTrustedProxies>;
  // When it answered or failed; null while it is on its way.
  answeredAt: number | null;
} | null = null;

// Forget the shared answer, so the next ask reads again: for tests, each with an answer of its own.
export function forgetAutomaticTrustedProxies(): void {
  shared = null;
}

async function readAutomaticTrustedProxiesFromServer(): Promise<AutomaticTrustedProxies> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(AUTOMATIC_TRUSTED_PROXIES_PATH),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readAutomaticTrustedProxies(response.data);
}

export async function fetchAutomaticTrustedProxies(): Promise<AutomaticTrustedProxies> {
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  if (
    shared &&
    shared.projectId === projectId &&
    (shared.answeredAt === null ||
      Date.now() - shared.answeredAt < AUTOMATIC_TRUSTED_PROXIES_SHARED_FOR_MS)
  ) {
    return await shared.answer;
  }

  const answer: Promise<AutomaticTrustedProxies> =
    readAutomaticTrustedProxiesFromServer();
  const entry: {
    projectId: string;
    answer: Promise<AutomaticTrustedProxies>;
    answeredAt: number | null;
  } = { projectId, answer, answeredAt: null };

  shared = entry;

  try {
    return await answer;
  } finally {
    entry.answeredAt = Date.now();
  }
}
