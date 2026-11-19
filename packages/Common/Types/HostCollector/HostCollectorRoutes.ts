/*
 * Try again on a host's collector card: POST /host/:id/<this> sends the host
 * the config that failed on it again (HostAPI). The Dashboard and the server
 * name it from here.
 */
export const TRY_COLLECTOR_CONFIG_AGAIN_ROUTE: string =
  "try-collector-config-again";
