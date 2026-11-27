import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { jest } from "@jest/globals";
import { TextEncoder, TextDecoder } from "util";
import { webcrypto, randomUUID } from "crypto";
import {
  CENSUS_ENVIRONMENT_VARIABLE,
  refuseRealRequests,
} from "./Helpers/RealNetworkRequests";

// Polyfill TextEncoder/TextDecoder for jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).TextEncoder = TextEncoder;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).TextDecoder = TextDecoder;

/*
 * jsdom does not expose crypto.randomUUID, so back it with Node's webcrypto
 * (UUID.ts calls globalThis.crypto.randomUUID() to stay browser-bundle-safe).
 */
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}
if (typeof globalThis.crypto.randomUUID !== "function") {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: randomUUID,
    configurable: true,
  });
}

// Mock window.scrollTo for jsdom
Object.defineProperty(window, "scrollTo", {
  value: jest.fn(),
  writable: true,
});

/*
 * Testing Library waits a default of one second for findBy/waitFor. That is a
 * generous budget for a state update and a hopeless one for a React.lazy
 * boundary: the first component to render LazyMarkdownViewer has to resolve
 * the dynamic import and put MarkdownViewer (plus its mermaid mock) through
 * ts-jest before any assertion on the markdown text can pass. Locally that is
 * ~400 ms; on a CI runner with the other shard workers competing for the same
 * cores it goes past a second, and the test fails having rendered the Suspense
 * fallback -- a timeout wearing the costume of a missing element.
 *
 * ~20 components reach the viewer through that wrapper (FeedItem, EventItem,
 * Detail, BaseModelTable and the rest), so this is a whole class of flake
 * rather than one test, and it belongs here rather than at one call site.
 * Five seconds is still short enough that a genuinely broken assertion fails
 * promptly instead of sitting out the 60 s testTimeout.
 */
configure({ asyncUtilTimeout: 5000 });

/*
 * No suite reaches the network through jsdom's XMLHttpRequest: a request
 * that would leave is refused at once, as a refused connection, and fails
 * the test that sent it, naming it (Tests/Helpers/RealNetworkRequests.ts).
 * ONEUPTIME_NETWORK_CENSUS=1 lists every request instead of failing on it.
 */
refuseRealRequests({
  census: process.env[CENSUS_ENVIRONMENT_VARIABLE] === "1",
});

/*
 * THE RECOMMENDATION COVERAGE ROUTE IS ANSWERED IN EVERY SUITE (#11170).
 *
 * Every resource's side menu, a part's alerts card, a cloud account's
 * recommendations and the telemetry guided setup ask the server which
 * recommended monitors exist (POST /monitor/recommendation-coverage). They
 * read the project's monitors through ModelAPI before, which every page
 * suite stands in for; since #11170 each suite that draws one sent the
 * request, and the rule above failed it (StorageArrayPages and the rest).
 *
 * So the Dashboard's coverage client answers every suite as the server
 * would, from the monitors the suite's ModelAPI stands in for
 * (Tests/App/Dashboard/MonitorCoverageAnswer), and sends nothing. A suite that
 * answers coverage itself - MonitorCoverageServer.serveCoverageFrom, or a
 * jest.spyOn of findCoveringMonitors - still does, and the client's own
 * suite tests the real request with jest.unmock. The module is loaded only
 * by a suite that draws one of those pages.
 */
jest.mock(
  "../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi",
  () => {
    const client: { default: { findCoveringMonitors: unknown } } =
      jest.requireActual(
        "../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi",
      ) as { default: { findCoveringMonitors: unknown } };
    const standIn: { answerCoverageFromModelApi: unknown } = jest.requireActual(
      "./App/Dashboard/MonitorCoverageAnswer",
    ) as { answerCoverageFromModelApi: unknown };

    client.default.findCoveringMonitors = standIn.answerCoverageFromModelApi;

    return client;
  },
);
