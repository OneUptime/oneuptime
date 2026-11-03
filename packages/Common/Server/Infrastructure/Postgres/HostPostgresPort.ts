/*
 * THE PORT THIS MACHINE REACHES THE STACK'S POSTGRESQL ON.
 *
 * Inside the stack every service reaches PostgreSQL as postgres:5432. The
 * tools a developer runs on the machine itself - npm run
 * generate-postgres-migration and npm run check-postgres-schema-drift -
 * reach it where docker-compose.yml and the dev stack publish it on the
 * loopback address: DATABASE_PUBLISHED_PORT, 5400 unless config.env moves
 * it. They used to assume 5400 whatever config.env said (#5324's
 * follow-ups).
 *
 * DATABASE_MIGRATIONS_PORT wins over it, so a check can be pointed at a
 * throwaway database (the Postgres Schema Drift workflow's service
 * container) without editing config.env. An empty setting is not set. A
 * value that is not a port stops the tool with the setting's name, rather
 * than reaching a database nobody meant.
 */

export const DEFAULT_PUBLISHED_POSTGRES_PORT: number = 5400;

// The settings that name the port, in the order they are read.
export const HOST_POSTGRES_PORT_SETTINGS: ReadonlyArray<string> = [
  "DATABASE_MIGRATIONS_PORT",
  "DATABASE_PUBLISHED_PORT",
];

const WHOLE_NUMBER: RegExp = /^\d{1,5}$/;

export const getHostPostgresPort: (
  env: Record<string, string | undefined>,
) => number = (env: Record<string, string | undefined>): number => {
  for (const setting of HOST_POSTGRES_PORT_SETTINGS) {
    const value: string = (env[setting] || "").trim();

    if (!value) {
      continue;
    }

    const port: number = WHOLE_NUMBER.test(value) ? Number(value) : NaN;

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `${setting}=${value} is not a port. Set it to the port PostgreSQL is published on, such as ${setting}=${DEFAULT_PUBLISHED_POSTGRES_PORT}, or leave it empty.`,
      );
    }

    return port;
  }

  return DEFAULT_PUBLISHED_POSTGRES_PORT;
};
