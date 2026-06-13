import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import OneUptimeDate from "../../../Types/Date";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

type MockClient = {
  set: jest.Mock;
  expire: jest.Mock;
  get: jest.Mock;
};

describe("GlobalCache.setString", () => {
  let client: MockClient;

  beforeEach(() => {
    client = {
      set: jest.fn().mockResolvedValue("OK"),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
    };
    (Redis.getClient as jest.Mock).mockReturnValue(client);
    (Redis.isConnected as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The TTL must be applied atomically with the SET. A separate
   * SET + EXPIRE pair can crash in between and leave a key that
   * never expires — for fence/throttle keys (e.g. the OTel ingest
   * maintenance fence) that permanently suppresses the work the
   * key gates.
   */
  test("sets the value and TTL in one atomic SET ... EX call", async () => {
    await GlobalCache.setString("ns", "key", "value", {
      expiresInSeconds: 60,
    });

    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith("ns-key", "value", "EX", 60);
    expect(client.expire).not.toHaveBeenCalled();
  });

  test("defaults the TTL to 30 days when no option is passed", async () => {
    await GlobalCache.setString("ns", "key", "value");

    expect(client.set).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith(
      "ns-key",
      "value",
      "EX",
      OneUptimeDate.getSecondsInDays(30),
    );
    expect(client.expire).not.toHaveBeenCalled();
  });

  test("throws when the cache is not connected", async () => {
    (Redis.isConnected as jest.Mock).mockReturnValue(false);

    await expect(GlobalCache.setString("ns", "key", "value")).rejects.toThrow(
      DatabaseNotConnectedException,
    );
    expect(client.set).not.toHaveBeenCalled();
  });

  test("setStringArray and setJSON funnel through the atomic setString", async () => {
    await GlobalCache.setStringArray("ns", "arr", ["a", "b"], {
      expiresInSeconds: 120,
    });
    await GlobalCache.setJSON("ns", "obj", { a: 1 }, { expiresInSeconds: 180 });

    expect(client.set).toHaveBeenNthCalledWith(
      1,
      "ns-arr",
      JSON.stringify(["a", "b"]),
      "EX",
      120,
    );
    expect(client.set).toHaveBeenNthCalledWith(
      2,
      "ns-obj",
      expect.any(String),
      "EX",
      180,
    );
    expect(client.expire).not.toHaveBeenCalled();
  });
});
