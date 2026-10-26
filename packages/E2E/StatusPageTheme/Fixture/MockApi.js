/*
 * The status page API, answered from Data.js (see Index.js). Every request
 * the app makes is recorded on window.__statusPageThemeFixture, and one the
 * fixture does not answer is recorded as unexpected and answered 404.
 */
import API from "../../../App/FeatureSet/StatusPage/src/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  ANNOUNCEMENT_ID,
  INCIDENT_ID,
  MAINTENANCE_ID,
  PAGE_ID,
  buildFixture,
} from "./Data";

const params = new URLSearchParams(window.location.search);

const fixture = buildFixture({
  theme: params.get("theme") || "Light",
  isPrivate: params.get("private") === "1",
  hasSso: params.get("sso") === "1",
  hasDarkLogo: params.get("darkLogo") === "1",
});

const record = {
  requests: [],
  unexpected: [],
};

window.__statusPageThemeFixture = record;

const API_PREFIX = "/status-page-api";

const answers = {
  /*
   * The page on its own domain ("/" here): which page this host is, as the
   * API answers for a verified custom domain.
   */
  "/domain": { statusPageId: PAGE_ID },
  [`/master-page/${PAGE_ID}`]: fixture.masterPage,
  [`/overview/${PAGE_ID}`]: fixture.overview,
  [`/incidents/${PAGE_ID}`]: fixture.incidents,
  [`/incidents/${PAGE_ID}/${INCIDENT_ID}`]: fixture.incidents,
  [`/episodes/${PAGE_ID}`]: fixture.episodes,
  [`/announcements/${PAGE_ID}`]: fixture.announcements,
  [`/announcements/${PAGE_ID}/${ANNOUNCEMENT_ID}`]: fixture.announcements,
  [`/scheduled-maintenance-events/${PAGE_ID}`]: fixture.scheduledEvents,
  [`/scheduled-maintenance-events/${PAGE_ID}/${MAINTENANCE_ID}`]:
    fixture.scheduledEvents,
  [`/resources/${PAGE_ID}`]: fixture.resources,
};

API.fetch = async (options) => {
  const url = new URL(options.url.toString());
  const apiPath = url.pathname.startsWith(API_PREFIX)
    ? url.pathname.slice(API_PREFIX.length)
    : url.pathname;

  record.requests.push(`${options.method} ${apiPath}`);

  const answer = answers[apiPath];

  if (answer) {
    // A copy each time: the app is free to change what it is handed.
    return new HTTPResponse(200, JSON.parse(JSON.stringify(answer)), {});
  }

  record.unexpected.push(`${options.method} ${url.pathname}`);

  return new HTTPErrorResponse(
    404,
    { message: `The fixture does not answer ${url.pathname}` },
    {},
  );
};
