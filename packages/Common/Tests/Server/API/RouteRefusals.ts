import ServerProductRoutes from "../../../Server/Utils/ServerProducts/ServerProductRoutes";

/*
 * A route's chain without the refusals of a product switched off on the
 * server (ServerProductRoutes, #7479, #9489): what a suite that pins the
 * middlewares in front of a handler reads, since each refusal is a
 * middleware of its own. Which routes refuse is
 * ProductCustomRoutesGuard's to hold; this lets a suite say the rest of the
 * chain is as it was.
 */
export const withoutRefusals: <T>(chain: ReadonlyArray<T>) => Array<T> = <T>(
  chain: ReadonlyArray<T>,
): Array<T> => {
  return chain.filter((handler: T): boolean => {
    return !ServerProductRoutes.isRefusal(handler);
  });
};

// How many refusals stand in a route's chain.
export const countRefusals: (chain: ReadonlyArray<unknown>) => number = (
  chain: ReadonlyArray<unknown>,
): number => {
  return chain.filter((handler: unknown): boolean => {
    return ServerProductRoutes.isRefusal(handler);
  }).length;
};
