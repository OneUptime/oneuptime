/*
 * What the public form page asks a server, answered here before it leaves
 * the browser (see Accounts.js). Every request the page makes - through
 * Common's API client, which its FormAPI extends - ends in API.fetch, and is
 * answered here; one the fixture does not answer is recorded as unexpected
 * (the spec fails on it) and answered 404.
 *
 * The form, "Report a problem", asks a summary, a File question
 * ("Screenshot") and a Multiple Files question ("Logs and captures"), each
 * with the limits the server tells the page (FormPublic: the kinds of file a
 * file custom field takes, 10 MB a file, 10 files a question).
 *
 * Steered by the query string:
 *   submit=slow   the submission takes about two seconds to send, in steps,
 *                 so its progress can be seen
 *   submit=busy   the form's hourly allowance of files is used up: 429
 *
 * Recorded on window.__formFixture: every request (`requests`), every
 * submission's body as sent (`submissions`) and every request the fixture
 * does not answer (`unexpected`).
 */
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { CUSTOM_FIELD_FILE_TYPES } from "Common/Types/CustomField/CustomFieldFile";
import {
  FORM_FILE_MAX_SIZE_IN_BYTES,
  FORM_FILE_QUESTION_MAX_FILES,
} from "Common/Types/Form/FormFileAnswer";

// The form's link key: a share key is a uuid.
const FORM_KEY = "70000000-0000-4000-8000-0000000000c1";

const params = new URLSearchParams(window.location.search);
const submitMode = params.get("submit") || "";

const record = {
  requests: [],
  submissions: [],
  unexpected: [],
};

window.__formFixture = record;

const FILE_LIMITS = {
  fileTypes: [...CUSTOM_FIELD_FILE_TYPES],
  maxFileSizeInBytes: FORM_FILE_MAX_SIZE_IN_BYTES,
};

const FORM = {
  name: "Report a problem",
  description: "Tell the Acme operations team what is wrong.",
  isCaptchaRequired: false,
  fields: [
    {
      id: "summary",
      label: "Summary",
      type: "Text",
      isRequired: true,
      maxLength: 10000,
    },
    {
      id: "screenshot",
      label: "Screenshot",
      type: "File",
      helpText: "A picture of what you saw.",
      ...FILE_LIMITS,
    },
    {
      id: "evidence",
      label: "Logs and captures",
      type: "MultipleFiles",
      ...FILE_LIMITS,
      maxFiles: FORM_FILE_QUESTION_MAX_FILES,
    },
  ],
};

const ok = (data) => {
  // A copy each time: a page is free to change what it is handed.
  return new HTTPResponse(200, JSON.parse(JSON.stringify(data)), {});
};

const refused = (status, message, headers) => {
  return new HTTPErrorResponse(status, { message }, headers || {});
};

const wait = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const answerSubmit = async (options) => {
  const body = JSON.parse(JSON.stringify(options.data || {}));
  record.submissions.push(body);

  const onUploadProgress = options.options && options.options.onUploadProgress;
  const total = JSON.stringify(body).length;
  const steps = submitMode === "slow" ? [0.15, 0.4, 0.65, 0.9, 1] : [1];

  for (const step of steps) {
    await wait(submitMode === "slow" ? 450 : 20);

    if (onUploadProgress) {
      onUploadProgress({ loaded: Math.round(total * step), total: total });
    }
  }

  if (submitMode === "busy") {
    return refused(
      429,
      "This form is receiving too many files right now. Please try again later.",
      { "retry-after": "1800" },
    );
  }

  return ok({ reference: "INC-42" });
};

const answer = async (options, apiPath) => {
  /*
   * The page asks whether this OneUptime is the newest: a Community Edition
   * server on the newest version.
   */
  if (apiPath === "/api/global-config/license") {
    return ok({ currentVersion: "1.0.0", latestVersion: "1.0.0" });
  }

  if (apiPath === `/api/form/public/${FORM_KEY}`) {
    return ok(FORM);
  }

  if (
    apiPath === `/api/form/public/${FORM_KEY}/submit` &&
    options.method === "POST"
  ) {
    return await answerSubmit(options);
  }

  return null;
};

API.fetch = async (options) => {
  const url = new URL(options.url.toString());
  const apiPath = url.pathname;
  const method = String(options.method || "").toUpperCase();

  record.requests.push(`${method} ${apiPath}`);

  const response = await answer({ ...options, method: method }, apiPath);

  if (response) {
    return response;
  }

  record.unexpected.push(`${method} ${apiPath}`);

  return refused(404, `The fixture does not answer ${apiPath}`);
};
