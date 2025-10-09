import Constants from "expo-constants";

export type AppConfig = {
  appApiUrl: string;
  identityApiUrl: string;
  realtimeUrl?: string;
};

const defaultConfig: AppConfig = {
  appApiUrl: "https://app.oneuptime.com/api",
  identityApiUrl: "https://app.oneuptime.com/identity",
  realtimeUrl: "wss://app.oneuptime.com/realtime",
};

const loadConfig = (): AppConfig => {
  const extra = (Constants.expoConfig?.extra || Constants.manifest?.extra || {}) as Record<string, string>;

  const env = (
    globalThis as { process?: { env?: Record<string, string> } }
  ).process?.env;

  const appApiUrl =
    (extra["appApiUrl"] as string | undefined) ||
    env?.EXPO_PUBLIC_APP_API_URL ||
    defaultConfig.appApiUrl;

  const identityApiUrl =
    (extra["identityApiUrl"] as string | undefined) ||
    env?.EXPO_PUBLIC_IDENTITY_API_URL ||
    defaultConfig.identityApiUrl;

  const realtimeUrl =
    (extra["realtimeUrl"] as string | undefined) ||
    env?.EXPO_PUBLIC_REALTIME_URL ||
    defaultConfig.realtimeUrl;

  return {
    appApiUrl,
    identityApiUrl,
    realtimeUrl,
  };
};

const config = loadConfig();

export default config;
