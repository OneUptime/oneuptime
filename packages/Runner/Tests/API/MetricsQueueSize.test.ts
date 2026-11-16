import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";

/*
 * The queue size KEDA scales a Runner on (GET /metrics/queue-size, the
 * global Runner's keda trigger in the Helm chart): the AI code fixes waiting
 * for it, which it asks OneUptime for.
 *
 * A Runner that takes no code fixes now has none waiting for it: one the
 * server grants none - a global Runner a master admin turned code fixes off
 * for (Runs AI Code Fixes, #6115), a project's Runner no repository works on
 * - or whose host turned them off. OneUptime's code-fix routes refuse its key
 * while it takes none, so asking would only fail, and KEDA would read an
 * error instead of a size. It answers 0 without asking.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

let queueSizeHandler: Handler;

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { sendJsonObjectResponse: jest.fn() },
  };
});

beforeAll(async () => {
  const router: { get: jest.Mock } = {
    get: jest.fn((path: string, handler: Handler): void => {
      if (path === "/queue-size") {
        queueSizeHandler = handler;
      }
    }),
  };

  jest
    .spyOn(Express, "getRouter")
    .mockReturnValue(router as unknown as ReturnType<typeof Express.getRouter>);

  await import("../../API/Metrics");
});

beforeEach(() => {
  jest.clearAllMocks();
  GlobalRunnerMode.reset();
});

async function askQueueSize(): Promise<{
  answered: JSONObject | undefined;
  next: jest.Mock;
}> {
  const next: jest.Mock = jest.fn();

  await queueSizeHandler(
    {} as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    answered: calls[0]?.[2] as JSONObject | undefined,
    next,
  };
}

describe("GET /metrics/queue-size", () => {
  test("a global Runner the server grants no code fixes reads 0, and asks OneUptime nothing", async () => {
    GlobalRunnerMode.setFromServer(true);
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
    const fetch: jest.SpyInstance = jest.spyOn(API, "fetch");

    const { answered, next } = await askQueueSize();

    expect(answered).toEqual({ queueSize: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test("a Runner granted code fixes reads the count OneUptime holds for it", async () => {
    GlobalRunnerMode.setFromServer(true);
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });
    const fetch: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { count: 7 }, {}) as never,
      );

    const { answered } = await askQueueSize();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0]![0] as { url: unknown }).url)).toContain(
      "/api/ai-agent-task/get-pending-task-count",
    );
    expect(answered).toEqual({ queueSize: 7 });
  });
});
