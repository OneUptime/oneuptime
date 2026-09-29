import downloadFile from "../../../UI/Utils/DownloadFile";

describe("downloadFile", () => {
  let createObjectUrlMock: jest.Mock;
  let revokeObjectUrlMock: jest.Mock;
  let clickSpy: jest.SpyInstance;
  let capturedAnchor: HTMLAnchorElement | null;
  let originalCreateObjectUrl: typeof window.URL.createObjectURL | undefined;
  let originalRevokeObjectUrl: typeof window.URL.revokeObjectURL | undefined;

  beforeEach(() => {
    capturedAnchor = null;
    originalCreateObjectUrl = window.URL.createObjectURL;
    originalRevokeObjectUrl = window.URL.revokeObjectURL;
    createObjectUrlMock = jest.fn().mockReturnValue("blob:support-bundle");
    revokeObjectUrlMock = jest.fn();

    window.URL.createObjectURL = createObjectUrlMock;
    window.URL.revokeObjectURL = revokeObjectUrlMock;

    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const originalCreateElement: typeof document.createElement =
      document.createElement.bind(document);

    jest.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
    ): HTMLElement => {
      const element: HTMLElement = originalCreateElement(tagName);

      if (tagName === "a") {
        capturedAnchor = element as HTMLAnchorElement;
      }

      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalCreateObjectUrl) {
      window.URL.createObjectURL = originalCreateObjectUrl;
    } else {
      delete (window.URL as { createObjectURL?: unknown }).createObjectURL;
    }

    if (originalRevokeObjectUrl) {
      window.URL.revokeObjectURL = originalRevokeObjectUrl;
    } else {
      delete (window.URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  test("creates a Blob with the requested MIME type for string content", () => {
    downloadFile({
      content: "diagnostics",
      filename: "support.json",
      mimeType: "application/json;charset=utf-8;",
    });

    const blob: Blob = createObjectUrlMock.mock.calls[0]![0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/json;charset=utf-8;");
  });

  test("reuses Blob content rather than wrapping it in another Blob", () => {
    const blob: Blob = new Blob(["diagnostics"], {
      type: "application/json",
    });

    downloadFile({ content: blob, filename: "support.json" });

    expect(createObjectUrlMock).toHaveBeenCalledWith(blob);
  });

  test("clicks a safe download anchor and cleans it up", () => {
    downloadFile({ content: "diagnostics", filename: "support.json" });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor!.href).toContain("blob:support-bundle");
    expect(capturedAnchor!.download).toBe("support.json");
    expect(capturedAnchor!.rel).toBe("noopener");
    expect(document.body.contains(capturedAnchor)).toBe(false);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:support-bundle");
  });

  test("still removes the anchor and revokes the object URL when click fails", () => {
    clickSpy.mockImplementation(() => {
      throw new Error("Download blocked");
    });

    expect(() => {
      downloadFile({ content: "diagnostics", filename: "support.json" });
    }).toThrow("Download blocked");

    expect(document.body.contains(capturedAnchor)).toBe(false);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:support-bundle");
  });
});
