import { mockRouter } from "./Helpers";
import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A LINK THAT CHANGES A SUBSCRIPTION CARRIES THE SUBSCRIPTION'S OWN TOKEN.
 *
 * A status page subscription is changed or cancelled from two pages a
 * subscriber opens from a link in a message, signed in or not: the
 * unsubscribe page and the manage page (Update Subscription). Their routes
 * are public, so the link is the whole of the authorisation - and the
 * subscriber's id cannot be it: every project member who may read
 * subscribers sees the id, read-only roles included, and every log that
 * names a subscription keeps it. The manage page was keyed by the id alone,
 * and a public status page's texts carried that link, so anyone who could
 * read about a subscription could change it.
 *
 * These hold the whole product to the rule, so the next route or the next
 * sender cannot quietly bring the id-only link back:
 *
 *   - every public status page route that names a subscriber takes the
 *     subscription's token too, but for the two listed below with why;
 *   - only Common/Types/StatusPage/StatusPageSubscriberUnsubscribe builds a
 *     link to the manage page - with the credential, never the id alone -
 *     and every other product file that names the page's route is listed
 *     with what it does with it. Read from the code by TypeScript's parser,
 *     so a word in a comment is never taken for code.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageSubscriberAPI from "../../../Server/API/StatusPageSubscriberAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";

interface RegisteredRoute {
  method: string;
  uri: string;
}

// A route parameter that names a status page subscriber.
const SUBSCRIBER_PARAMETER: RegExp =
  /\/:(?:subscriberId|statusPageSubscriberId)(?:\/|$)/;

// A TypeScript source file.
const TYPESCRIPT_FILE: RegExp = /\.(?:ts|tsx)$/;

/*
 * Public routes that name a subscriber without the token in their path, and
 * why each may.
 */
const ROUTES_WITHOUT_THE_TOKEN: Record<string, string> = {
  "GET /status-page/confirm-subscription/:statusPageSubscriberId":
    "confirms a sign-up only with the confirmation code its email carries (the verification-token query, refused unless it is text: StatusPageSubscriptionConfirmCode.test.ts), which no API answer hands out",
  "GET /status-page-subscriber/unsubscribe/:id":
    "the unsubscribe link notifications carried until the end of 2023: it changes nothing and leads to the unsubscribe page's out-of-date state, never handing out the token",
};

/*
 * Every product file whose code names the manage page's route, and what it
 * does with it. None of them builds a link to the page out of a subscriber
 * id: only buildManageSubscriptionLink builds one, from the credential.
 */
const MANAGE_ROUTE_NAMERS: Record<string, string> = {
  "packages/Common/Types/StatusPage/StatusPageSubscriberUnsubscribe.ts":
    "MANAGE_PAGE_ROUTE_SEGMENT, which buildManageSubscriptionLink puts before the credential",
  "packages/Common/Server/API/StatusPageAPI.ts":
    "registers the manage page's update-subscription route, which takes the token",
  "packages/Common/UI/Utils/SensitiveUrlToken.ts":
    "lists the route as one whose last segment is a credential, to take out of the address bar",
  "packages/App/FeatureSet/StatusPage/src/Utils/RouteMap.ts":
    "the status page app's routes to the page, whose last segment is the credential",
  "packages/App/FeatureSet/StatusPage/src/Pages/Subscribe/UpdateSubscription.tsx":
    "the page's own calls to its routes, with the credential it was opened with",
  "packages/Common/Types/StatusPage/SubscriberNotificationTemplatePreview.ts":
    "the sample manageSubscriptionUrl a template preview shows, which opens nothing",
};

const MANAGE_ROUTE: string = "update-subscription";

// The text of every string literal and template part in a file's code.
function stringsIn(file: string): Array<string> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

describe("the public routes that name a subscriber", () => {
  let routes: Array<RegisteredRoute>;

  beforeAll(() => {
    mockRouter.routes.length = 0;

    // BaseAPI's own routes for the model are permission-checked: left out.
    new BaseAPI<StatusPageSubscriber, DatabaseService<StatusPageSubscriber>>(
      StatusPageSubscriber,
      StatusPageSubscriberService,
    );
    const crudRoutes: Set<string> = new Set<string>(
      mockRouter.routes.map((route: RegisteredRoute): string => {
        return `${route.method} ${route.uri}`;
      }),
    );

    mockRouter.routes.length = 0;
    new StatusPageAPI();
    new StatusPageSubscriberAPI();

    routes = mockRouter.routes.filter((route: RegisteredRoute): boolean => {
      return !crudRoutes.has(`${route.method} ${route.uri}`);
    });
  });

  test("the walk finds the subscription routes it is about", () => {
    const names: Array<string> = routes.map(
      (route: RegisteredRoute): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    expect(names).toEqual(
      expect.arrayContaining([
        "POST /status-page/get-subscription/:statusPageId/:subscriberId/:token",
        "PUT /status-page/update-subscription/:statusPageId/:subscriberId/:token",
        "GET /status-page/unsubscribe/:statusPageId/:subscriberId/:token",
        "POST /status-page/unsubscribe/:statusPageId/:subscriberId/:token",
        ...Object.keys(ROUTES_WITHOUT_THE_TOKEN),
      ]),
    );
  });

  test("each takes the subscription's token, but for the ones listed with why", () => {
    const withoutTheToken: Array<string> = routes
      .filter((route: RegisteredRoute): boolean => {
        const namesASubscriber: boolean =
          SUBSCRIBER_PARAMETER.test(route.uri) ||
          route.uri.startsWith("/status-page-subscriber/");

        return namesASubscriber && !route.uri.endsWith("/:token");
      })
      .map((route: RegisteredRoute): string => {
        return `${route.method} ${route.uri}`;
      });

    expect(withoutTheToken.sort()).toEqual(
      Object.keys(ROUTES_WITHOUT_THE_TOKEN).sort(),
    );
  });
});

describe("the links to the manage page", () => {
  const namers: Array<string> = listProductFiles()
    .filter((file: string): boolean => {
      return (
        TYPESCRIPT_FILE.test(file) &&
        fs
          .readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8")
          .includes(MANAGE_ROUTE)
      );
    })
    .filter((file: string): boolean => {
      return stringsIn(file).some((text: string): boolean => {
        return text.includes(MANAGE_ROUTE);
      });
    });

  test("the scan reads the files it is about", () => {
    expect(namers).toEqual(
      expect.arrayContaining([
        "packages/Common/Types/StatusPage/StatusPageSubscriberUnsubscribe.ts",
        "packages/Common/Server/API/StatusPageAPI.ts",
      ]),
    );
  });

  test("only the listed files name the page's route in their code", () => {
    expect(namers.sort()).toEqual(Object.keys(MANAGE_ROUTE_NAMERS).sort());
  });

  test("no code puts anything but the credential after the route: the link is built in one place", () => {
    for (const file of namers) {
      for (const text of stringsIn(file)) {
        const index: number = text.indexOf(`${MANAGE_ROUTE}/`);

        if (index === -1) {
          continue;
        }

        /*
         * What follows the route in a literal: a route parameter, a sample,
         * or - for the API calls - the page's own path. Never the start of
         * an interpolation, which is how an id was put there.
         */
        const after: string = text.slice(index + MANAGE_ROUTE.length + 1);

        expect([file, text, after]).not.toEqual([file, text, ""]);
      }
    }
  });

  test("the one builder puts the credential after the route", () => {
    const builder: string = fs.readFileSync(
      path.join(
        REPOSITORY_DIRECTORY,
        "packages/Common/Types/StatusPage/StatusPageSubscriberUnsubscribe.ts",
      ),
      "utf8",
    );

    const body: string =
      builder.split("public static buildManageSubscriptionLink(")[1] || "";
    const method: string = body.slice(0, body.indexOf("\n  }\n"));

    expect(method).toContain("MANAGE_PAGE_ROUTE_SEGMENT");
    expect(method).toContain("buildCredential(");
    expect(method).toContain("unsubscribeToken: data.unsubscribeToken");
  });
});
