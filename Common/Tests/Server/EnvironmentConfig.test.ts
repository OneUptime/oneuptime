/*
 * StatusPageApiInternalUrl is used for server-to-server (in-cluster) calls,
 * e.g. the status page SEO lookup the app makes about itself. It must target
 * the internal app service hostname (SERVER_APP_HOSTNAME:APP_PORT) rather than
 * the public ingress HOST — otherwise, in Kubernetes/multi-host deployments the
 * pod calls its own public URL and times out (ETIMEDOUT).
 *
 * EnvironmentConfig computes its exports from process.env at import time, so we
 * re-import the module with controlled env via jest.resetModules() + import().
 */
describe("EnvironmentConfig.StatusPageApiInternalUrl", () => {
  const originalEnv: NodeJS.ProcessEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  const loadInternalUrl: (
    env: Record<string, string>,
  ) => Promise<string> = async (
    env: Record<string, string>,
  ): Promise<string> => {
    jest.resetModules();
    process.env = { ...originalEnv, ...env };
    const config: typeof import("../../Server/EnvironmentConfig") =
      await import("../../Server/EnvironmentConfig");
    return config.StatusPageApiInternalUrl.toString();
  };

  const publicAndInternalEnv: Record<string, string> = {
    SERVER_APP_HOSTNAME: "oneuptime-app",
    APP_PORT: "3002",
    HOST: "status.example.com",
    HTTP_PROTOCOL: "https",
  };

  test("uses the internal app service hostname, not the public ingress host", async () => {
    const url: string = await loadInternalUrl(publicAndInternalEnv);

    expect(url).toContain("oneuptime-app:3002");
    expect(url).not.toContain("status.example.com");
  });

  test("targets the /api/status-page internal route", async () => {
    const url: string = await loadInternalUrl(publicAndInternalEnv);

    expect(url).toContain("/api/status-page");
  });

  test("stays on http for in-cluster traffic even when the public protocol is https", async () => {
    const url: string = await loadInternalUrl(publicAndInternalEnv);

    expect(url.startsWith("http://")).toBe(true);
  });
});
