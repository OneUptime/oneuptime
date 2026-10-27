import express from "express";

/*
 * A ROUTER NONE OF WHOSE ROUTES CAN MATCH A REQUEST IS PASSED AT ONCE.
 *
 * The App mounts about 700 routers, most of them at /api: one for each
 * model's API (BaseAPI - /api/monitor/get-list, /api/incident/:id/get-item,
 * ...) and one for each feature's endpoints. Express 4 hands a request to
 * every router whose mount path matches, in order; each sets up its dispatch
 * for the request, reads the URL again and tries it against every one of
 * its route patterns before handing it on. So a request to /api/... was
 * tried against thousands of route patterns before it reached its own:
 * about 0.75 ms of CPU for each API request with 500 routers
 * (ExpressRouterGate.test.ts counts and times it), and the Dashboard, the
 * workflow triggers and the API all make them.
 *
 * gate() lets a router say which first path segments its routes can match,
 * and pass any other request on straight away. It knows that only of a
 * router whose every layer is a route with a plain first segment (letters,
 * digits, "-", "_", "." or "~" - "monitor" in "/monitor/get-list"): such a
 * route cannot match a path whose first segment is any other, compared
 * without case as Express matches. A router with a middleware of its own, a
 * route path with a parameter, a pattern or a regular expression in its
 * first segment, or a request URL Express would read otherwise (not starting
 * with "/", or holding a space, a tab or a "#") is handed to Express as
 * before. The router's routes are read again whenever their number changes.
 */

type HandleFunction = (
  req: express.Request,
  res: express.Response,
  out: express.NextFunction,
) => void;

interface RouterLayer {
  route?: { path?: unknown } | undefined;
}

interface GatableRouter {
  stack: Array<RouterLayer>;
  handle: HandleFunction;
}

interface GateState {
  layers: number;
  // The first segments its routes can match, or null: it cannot say.
  firstSegments: Set<string> | null;
}

const GATED: unique symbol = Symbol("oneuptime.expressRouterGate");

const PLAIN_SEGMENT: RegExp = /^[A-Za-z0-9_.~-]+$/;

// Characters that send Express's URL parser (parseurl) off its fast path.
const UNUSUAL_URL_CHARACTER: RegExp = /[\t\n\f\r # ﻿]/;

const states: WeakMap<object, GateState> = new WeakMap();

export default class ExpressRouterGate {
  /*
   * The first segment a route path can match, lower case, or null when the
   * path is not a string starting with "/" and a plain segment.
   */
  public static getRouteFirstSegment(path: unknown): string | null {
    if (typeof path !== "string" || path[0] !== "/") {
      return null;
    }

    const end: number = path.indexOf("/", 1);
    const segment: string = end === -1 ? path.slice(1) : path.slice(1, end);

    if (!PLAIN_SEGMENT.test(segment)) {
      return null;
    }

    return segment.toLowerCase();
  }

  /*
   * The first segment of a request URL's path as Express reads it, lower
   * case, or null for a URL Express does not read the plain way.
   */
  public static getRequestFirstSegment(url: unknown): string | null {
    if (
      typeof url !== "string" ||
      url[0] !== "/" ||
      UNUSUAL_URL_CHARACTER.test(url)
    ) {
      return null;
    }

    const queryAt: number = url.indexOf("?");
    const pathname: string = queryAt === -1 ? url : url.slice(0, queryAt);
    const end: number = pathname.indexOf("/", 1);
    const segment: string =
      end === -1 ? pathname.slice(1) : pathname.slice(1, end);

    return segment.toLowerCase();
  }

  /*
   * The first segments a router's routes can match, or null when it has a
   * layer that could match any.
   */
  public static getFirstSegments(
    stack: Array<RouterLayer>,
  ): Set<string> | null {
    const firstSegments: Set<string> = new Set();

    for (const layer of stack) {
      if (!layer.route) {
        return null;
      }

      const segment: string | null = ExpressRouterGate.getRouteFirstSegment(
        layer.route.path,
      );

      if (segment === null) {
        return null;
      }

      firstSegments.add(segment);
    }

    return firstSegments;
  }

  // Whether the router would hand `req` straight on, as no route matches it.
  public static passesBy(router: GatableRouter, req: express.Request): boolean {
    let state: GateState | undefined = states.get(router);

    if (!state || state.layers !== router.stack.length) {
      state = {
        layers: router.stack.length,
        firstSegments: ExpressRouterGate.getFirstSegments(router.stack),
      };
      states.set(router, state);
    }

    if (!state.firstSegments) {
      return false;
    }

    const segment: string | null = ExpressRouterGate.getRequestFirstSegment(
      req.url,
    );

    return segment !== null && !state.firstSegments.has(segment);
  }

  // Gate a router made by express.Router(). Returns the router.
  public static gate<TRouter extends express.Router>(router: TRouter): TRouter {
    const gatable: GatableRouter & { [GATED]?: boolean } =
      router as unknown as GatableRouter & { [GATED]?: boolean };

    if (gatable[GATED]) {
      return router;
    }

    const handle: HandleFunction = gatable.handle;

    gatable.handle = function (
      this: GatableRouter,
      req: express.Request,
      res: express.Response,
      out: express.NextFunction,
    ): void {
      if (typeof out === "function" && ExpressRouterGate.passesBy(this, req)) {
        out();
        return;
      }

      handle.call(this, req, res, out);
    };

    gatable[GATED] = true;

    return router;
  }

  // Whether a router is gated (tests).
  public static isGated(router: express.Router): boolean {
    return Boolean((router as unknown as { [GATED]?: boolean })[GATED]);
  }
}
