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

    expect(config).toHaveBeenCalledWith({
      paths: { vs: "/dashboard/assets/monaco/vs" },
    });
  });

  test("keeps the bundled default when the build set no path", async () => {
    (await loadLoader())();

    expect(config).not.toHaveBeenCalled();
  });
});
