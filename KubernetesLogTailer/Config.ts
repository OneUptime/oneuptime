const required: (key: string) => string = (key: string): string => {
  const value: string | undefined = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional: (key: string, fallback: string) => string = (
  key: string,
  fallback: string,
): string => {
  return process.env[key] || fallback;
};

const parseList: (value: string) => Array<string> = (
  value: string,
): Array<string> => {
  return value
    .split(",")
    .map((s: string): string => {
      return s.trim();
    })
    .filter((s: string): boolean => {
      return s.length > 0;
    });
};

export const ONEUPTIME_URL: string = required("ONEUPTIME_URL").replace(
  /\/+$/,
  "",
);
export const ONEUPTIME_API_KEY: string = required("ONEUPTIME_API_KEY");
export const CLUSTER_NAME: string = required("CLUSTER_NAME");

export const NAMESPACE_INCLUDE: Array<string> = parseList(
  optional("NAMESPACE_INCLUDE", ""),
);
export const NAMESPACE_EXCLUDE: Array<string> = parseList(
  optional("NAMESPACE_EXCLUDE", "kube-system"),
);

export const AGENT_NAMESPACE: string = optional("AGENT_NAMESPACE", "");
export const AGENT_LABEL_SELECTOR: string = optional(
  "AGENT_LABEL_SELECTOR",
  "app.kubernetes.io/part-of=oneuptime",
);

export const BATCH_MAX_RECORDS: number = parseInt(
  optional("BATCH_MAX_RECORDS", "500"),
  10,
);
export const BATCH_MAX_MS: number = parseInt(
  optional("BATCH_MAX_MS", "5000"),
  10,
);
export const EXPORT_MAX_RETRIES: number = parseInt(
  optional("EXPORT_MAX_RETRIES", "5"),
  10,
);

export const SINCE_SECONDS_ON_START: number = parseInt(
  optional("SINCE_SECONDS_ON_START", "10"),
  10,
);

export const HEALTH_PORT: number = parseInt(optional("HEALTH_PORT", "13133"), 10);

export const LOG_LEVEL: string = optional("LOG_LEVEL", "info");
