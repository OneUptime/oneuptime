import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const config: MockFunction = getJestMockFunction();

jest.mock("@monaco-editor/react", () => {
  return {
    loader: {
      config,
    },
  };
});

describe("configureMonacoLoader", () => {
  afterEach(() => {
    config.mockClear();
    delete process.env["MONACO_ASSET_PATH"];
    jest.resetModules();
  });

  type LoadLoader = () => Promise<() => void>;

  const loadLoader: LoadLoader = async (): Promise<() => void> => {
    const { default: configureMonacoLoader } = await import(
      "../../../UI/Components/CodeEditor/MonacoLoader"
    );

    return configureMonacoLoader;
  };

  test("points Monaco at the path the build baked in", async () => {
    process.env["MONACO_ASSET_PATH"] = "/dashboard/assets/monaco/vs";

    (await loadLoader())();

    /*
     * Absolute, not the root-relative value the build baked in: Monaco resolves
     * its language-service workers from this inside a blob: worker, which has no
     * base to resolve a root-relative path against.
     */
    expect(config).toHaveBeenCalledWith({
      paths: {
        vs: `${window.location.origin}/dashboard/assets/monaco/vs`,
      },
    });
  });

  test("gives Monaco an absolute path its blob workers can resolve", async () => {
    process.env["MONACO_ASSET_PATH"] = "/dashboard/assets/monaco/vs";

    (await loadLoader())();

    const configuredPath: string = (
      config.mock.calls[0] as unknown as Array<{ paths: { vs: string } }>
    )[0]!.paths.vs;

    expect(() => {
      return new URL(configuredPath);
    }).not.toThrow();
  });

  test("keeps the bundled default when the build set no path", async () => {
    (await loadLoader())();

    expect(config).not.toHaveBeenCalled();
  });
});
