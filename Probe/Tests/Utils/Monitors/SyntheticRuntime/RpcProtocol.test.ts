import {
  MAX_RPC_REQUEST_BYTES,
  PlaywrightRpcRequest,
  SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
  byteLengthOfJson,
  createExecutionId,
  isBinaryDescriptor,
  isBigIntDescriptor,
  isCapabilityDescriptor,
  isFunctionDescriptor,
  isLocatorDescriptor,
  isMapDescriptor,
  isRegExpDescriptor,
  isScreenshotDescriptor,
  validateRpcRequest,
} from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";

describe("SyntheticRuntime RpcProtocol", () => {
  test("accepts a strictly shaped, execution-bound request", () => {
    const executionId: string = createExecutionId();
    const value: PlaywrightRpcRequest = {
      version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
      executionId,
      requestId: "request-1",
      capabilityId: "capability-1",
      method: "click",
      args: ["button", { timeout: 1000 }],
      locatorChain: [{ method: "locator", args: ["main"] }],
    };

    expect(validateRpcRequest(value, executionId)).toEqual(value);
  });

  test.each([
    ["wrong version", { version: 99 }],
    ["wrong execution", { executionId: "wrong" }],
    ["empty request id", { requestId: "" }],
    ["empty capability id", { capabilityId: "" }],
    ["private method", { method: "_channel" }],
    ["punctuated method", { method: "click.call" }],
    ["non-array args", { args: {} }],
    ["non-array chain", { locatorChain: {} }],
  ])("rejects %s", (_name: string, override: Record<string, unknown>) => {
    const executionId: string = createExecutionId();
    expect(() => {
      validateRpcRequest(
        {
          version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
          executionId,
          requestId: "request-1",
          capabilityId: "capability-1",
          method: "click",
          args: [],
          ...override,
        },
        executionId,
      );
    }).toThrow();
  });

  test("bounds request bytes and treats undefined results as zero-byte values", () => {
    const executionId: string = createExecutionId();
    expect(byteLengthOfJson(undefined)).toBe(0);
    expect(byteLengthOfJson({ cyclic: BigInt(1) })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(() => {
      validateRpcRequest(
        {
          version: SYNTHETIC_RUNTIME_PROTOCOL_VERSION,
          executionId,
          requestId: "request-1",
          capabilityId: "capability-1",
          method: "click",
          args: ["x".repeat(MAX_RPC_REQUEST_BYTES)],
        },
        executionId,
      );
    }).toThrow("size limit");
  });

  test("recognizes only the copied descriptor shapes", () => {
    expect(
      isCapabilityDescriptor({
        __oneuptimeCapability: true,
        id: "id",
        type: "page",
      }),
    ).toBe(true);
    expect(
      isLocatorDescriptor({
        __oneuptimeLocator: true,
        rootCapabilityId: "id",
        chain: [],
      }),
    ).toBe(true);
    expect(
      isFunctionDescriptor({
        __oneuptimeFunction: true,
        source: "() => 1",
      }),
    ).toBe(true);
    expect(
      isRegExpDescriptor({
        __oneuptimeRegExp: true,
        source: "x",
        flags: "i",
      }),
    ).toBe(true);
    expect(
      isBinaryDescriptor({
        __oneuptimeBinary: true,
        base64: "AQI=",
      }),
    ).toBe(true);
    expect(
      isBigIntDescriptor({
        __oneuptimeBigInt: true,
        value: "-9007199254740993",
      }),
    ).toBe(true);
    expect(
      isMapDescriptor({
        __oneuptimeMap: true,
        entries: [["answer", 42]],
      }),
    ).toBe(true);
    expect(
      isScreenshotDescriptor({
        __oneuptimeScreenshot: true,
        id: "id",
        byteLength: 2,
      }),
    ).toBe(true);

    expect(isCapabilityDescriptor({ id: "id", type: "page" })).toBe(false);
    expect(isLocatorDescriptor({ rootCapabilityId: "id", chain: [] })).toBe(
      false,
    );
    expect(isFunctionDescriptor({ source: "() => 1" })).toBe(false);
    expect(isBinaryDescriptor({ base64: "AQI=" })).toBe(false);
    expect(isBigIntDescriptor({ __oneuptimeBigInt: true, value: "1.5" })).toBe(
      false,
    );
    expect(isMapDescriptor({ __oneuptimeMap: true, entries: [["key"]] })).toBe(
      false,
    );
    expect(isScreenshotDescriptor({ id: "id", byteLength: 2 })).toBe(false);
  });
});
