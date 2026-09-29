import SessionAwareImage, {
  enablePrivateImageSessionRefresh,
  isPrivateImageUrl,
  PRIVATE_IMAGE_ROUTE_SEGMENT,
  withCacheBuster,
} from "../../../UI/Components/Markdown.tsx/SessionAwareImage";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Private inline images (pasted into incident notes, postmortems, runbooks)
 * are served from /image/access-token/ and only to a request that carries a
 * session. The dashboard's access-token cookie expires with the 15-minute JWT
 * inside it, and an <img> cannot refresh a session the way a request through
 * the API class does - so once the cookie lapsed, every private image in the
 * markdown came back broken and stayed broken.
 *
 * SessionAwareImage (MarkdownViewer's img renderer) refreshes once on the
 * first failure of a private image and loads it again with a cache-busted src.
 * These tests pin every branch: when it retries, when it gives up, that it
 * retries at most once per image, and that it leaves status-page readers
 * (never signed in to the dashboard) alone.
 */

/*
 * Factories, not automocks: the real modules drag in LocalStorage, Navigation
 * and the whole HTTP client, none of which the component touches beyond these
 * two functions. The defaults are used only by the tests that omit the
 * isSignedIn / refreshSession props.
 */
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: jest.fn(),
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      refreshSession: jest.fn(),
    },
  };
});

const PRIVATE_SRC: string =
  "https://oneuptime.example/api/file/image/access-token/6a1f1c1e-img";
const OTHER_PRIVATE_SRC: string =
  "https://oneuptime.example/api/file/image/access-token/7b2e2d2f-img";
const PUBLIC_SRC: string = "https://cdn.example.com/diagram.png";
const NOW: number = 1767225600000;
const ALT: string = "architecture diagram";

type RefreshMock = jest.Mock<Promise<boolean>, []>;
type BooleanMock = jest.Mock<boolean, []>;
type ErrorHandlerMock = jest.Mock<
  void,
  [React.SyntheticEvent<HTMLImageElement>]
>;

type ImageElementFunction = () => HTMLImageElement;

const image: ImageElementFunction = (): HTMLImageElement => {
  return screen.getByAltText(ALT) as HTMLImageElement;
};

type FlushFunction = () => Promise<void>;

// Lets a settled refresh promise run its .then/.catch before asserting.
const flushPromises: FlushFunction = async (): Promise<void> => {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
};

describe("isPrivateImageUrl", () => {
  it("names the private image route", () => {
    expect(PRIVATE_IMAGE_ROUTE_SEGMENT).toBe("/image/access-token/");
  });

  it.each([
    [PRIVATE_SRC],
    ["/api/file/image/access-token/abc"],
    [`${PRIVATE_SRC}?sessionRetry=1`],
  ])("is true for %s", (src: string) => {
    expect(isPrivateImageUrl(src)).toBe(true);
  });

  it.each([
    ["a public CDN url", PUBLIC_SRC],
    ["a different file route", "https://oneuptime.example/api/file/image/abc"],
    ["an empty string", ""],
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    [
      "an object that merely mentions the route",
      {
        toString: (): string => {
          return PRIVATE_SRC;
        },
      },
    ],
  ])("is false for %s", (_label: string, src: unknown) => {
    expect(isPrivateImageUrl(src)).toBe(false);
  });
});

describe("withCacheBuster", () => {
  it("starts a query string when there is none", () => {
    expect(withCacheBuster(PRIVATE_SRC, "123")).toBe(
      `${PRIVATE_SRC}?sessionRetry=123`,
    );
  });

  it("appends to an existing query string", () => {
    expect(withCacheBuster(`${PRIVATE_SRC}?width=200`, "123")).toBe(
      `${PRIVATE_SRC}?width=200&sessionRetry=123`,
    );
  });

  it("encodes the value", () => {
    expect(withCacheBuster(PRIVATE_SRC, "a b&c")).toBe(
      `${PRIVATE_SRC}?sessionRetry=a%20b%26c`,
    );
  });
});

describe("SessionAwareImage", () => {
  let refreshSession: RefreshMock;
  let isSignedIn: BooleanMock;
  let onError: ErrorHandlerMock;
  let dateNowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    jest.clearAllMocks();

    refreshSession = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);
    isSignedIn = jest.fn<boolean, []>().mockReturnValue(true);
    onError = jest.fn<void, [React.SyntheticEvent<HTMLImageElement>]>();

    dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  type RenderImageFunction = (
    props?: Partial<React.ComponentProps<typeof SessionAwareImage>>,
  ) => ReturnType<typeof render>;

  const renderImage: RenderImageFunction = (
    props?: Partial<React.ComponentProps<typeof SessionAwareImage>>,
  ): ReturnType<typeof render> => {
    return render(
      <SessionAwareImage
        src={PRIVATE_SRC}
        alt={ALT}
        refreshSession={refreshSession}
        isSignedIn={isSignedIn}
        onError={onError}
        {...props}
      />,
    );
  };

  it("renders a plain <img> with the src and the other image props", () => {
    renderImage({ className: "max-w-full", loading: "lazy" });

    expect(image().tagName).toBe("IMG");
    expect(image()).toHaveAttribute("src", PRIVATE_SRC);
    expect(image()).toHaveAttribute("class", "max-w-full");
    expect(image()).toHaveAttribute("loading", "lazy");
    // The component's own props are not leaked onto the DOM element.
    expect(image()).not.toHaveAttribute("refreshSession");
    expect(image()).not.toHaveAttribute("isSignedIn");
  });

  it("does nothing until the image actually fails", () => {
    renderImage();

    expect(refreshSession).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  describe("a private image failing while signed in", () => {
    it("refreshes the session once and reloads the image with a cache-busted src", async () => {
      renderImage();

      fireEvent.error(image());

      await waitFor(() => {
        expect(image()).toHaveAttribute(
          "src",
          `${PRIVATE_SRC}?sessionRetry=${NOW}`,
        );
      });

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it("keeps an existing query string when cache-busting", async () => {
      renderImage({ src: `${PRIVATE_SRC}?w=200` });

      fireEvent.error(image());

      await waitFor(() => {
        expect(image()).toHaveAttribute(
          "src",
          `${PRIVATE_SRC}?w=200&sessionRetry=${NOW}`,
        );
      });
    });

    it("gives up after one retry: a second failure goes to onError", async () => {
      renderImage();

      fireEvent.error(image());

      await waitFor(() => {
        expect(image().getAttribute("src")).toContain("sessionRetry=");
      });

      fireEvent.error(image());
      await flushPromises();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(image()).toHaveAttribute(
        "src",
        `${PRIVATE_SRC}?sessionRetry=${NOW}`,
      );
    });

    it("calls onError and does not retry when the refresh fails", async () => {
      refreshSession.mockResolvedValue(false);

      renderImage();

      fireEvent.error(image());

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(image()).toHaveAttribute("src", PRIVATE_SRC);

      // The one retry is spent: another failure does not refresh again.
      fireEvent.error(image());
      await flushPromises();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(2);
    });

    it("calls onError and does not retry when the refresh rejects", async () => {
      refreshSession.mockRejectedValue(new Error("network down"));

      renderImage();

      fireEvent.error(image());

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });

      expect(image()).toHaveAttribute("src", PRIVATE_SRC);
    });

    it("hands the original error event to onError", async () => {
      refreshSession.mockResolvedValue(false);

      renderImage();

      fireEvent.error(image());

      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(1);
      });

      const event: React.SyntheticEvent<HTMLImageElement> = onError.mock
        .calls[0]![0] as React.SyntheticEvent<HTMLImageElement>;

      expect(event.type).toBe("error");
    });
  });

  describe("when it does not try at all", () => {
    it("passes a non-private image's failure straight to onError", async () => {
      renderImage({ src: PUBLIC_SRC });

      fireEvent.error(image());
      await flushPromises();

      expect(refreshSession).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(image()).toHaveAttribute("src", PUBLIC_SRC);
    });

    /*
     * A status page renders the same markdown for anonymous readers. They have
     * no dashboard session to refresh, and a failed refresh would log them
     * "out" and redirect to the login page.
     */
    it("does not refresh for a reader who is not signed in", async () => {
      isSignedIn.mockReturnValue(false);

      renderImage();

      fireEvent.error(image());
      await flushPromises();

      expect(isSignedIn).toHaveBeenCalled();
      expect(refreshSession).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(image()).toHaveAttribute("src", PRIVATE_SRC);
    });

    it("tolerates a failure with no onError handler", async () => {
      render(
        <SessionAwareImage
          src={PUBLIC_SRC}
          alt={ALT}
          refreshSession={refreshSession}
          isSignedIn={isSignedIn}
        />,
      );

      expect(() => {
        fireEvent.error(image());
      }).not.toThrow();

      await flushPromises();

      expect(refreshSession).not.toHaveBeenCalled();
    });
  });

  describe("a new src", () => {
    it("is rendered, and gets its own one retry", async () => {
      const { rerender } = renderImage();

      // Spend the first image's retry entirely.
      fireEvent.error(image());
      await waitFor(() => {
        expect(image().getAttribute("src")).toContain("sessionRetry=");
      });
      fireEvent.error(image());
      await flushPromises();

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);

      rerender(
        <SessionAwareImage
          src={OTHER_PRIVATE_SRC}
          alt={ALT}
          refreshSession={refreshSession}
          isSignedIn={isSignedIn}
          onError={onError}
        />,
      );

      await waitFor(() => {
        expect(image()).toHaveAttribute("src", OTHER_PRIVATE_SRC);
      });

      fireEvent.error(image());

      await waitFor(() => {
        expect(image()).toHaveAttribute(
          "src",
          `${OTHER_PRIVATE_SRC}?sessionRetry=${NOW}`,
        );
      });

      expect(refreshSession).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  describe("defaults", () => {
    it("asks UserUtil.isLoggedIn when no isSignedIn is given", async () => {
      (UserUtil.isLoggedIn as unknown as BooleanMock).mockReturnValue(false);

      render(
        <SessionAwareImage
          src={PRIVATE_SRC}
          alt={ALT}
          refreshSession={refreshSession}
          onError={onError}
        />,
      );

      fireEvent.error(image());
      await flushPromises();

      expect(UserUtil.isLoggedIn).toHaveBeenCalled();
      expect(refreshSession).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
    });

    /*
     * Status pages and public dashboards render the same markdown with no
     * dashboard session to refresh. Unless the app opted in, a broken private
     * image stays broken rather than risking a dashboard logout.
     */
    it("does not refresh anything when neither the caller nor the app supplied a refresh", async () => {
      (UserUtil.isLoggedIn as unknown as BooleanMock).mockReturnValue(true);
      (API.refreshSession as unknown as RefreshMock).mockResolvedValue(true);

      render(
        <SessionAwareImage src={PRIVATE_SRC} alt={ALT} onError={onError} />,
      );

      fireEvent.error(image());

      expect(API.refreshSession).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(image()).toHaveAttribute("src", PRIVATE_SRC);
    });

    it("uses the refresh the app registered with enablePrivateImageSessionRefresh", async () => {
      (UserUtil.isLoggedIn as unknown as BooleanMock).mockReturnValue(true);
      const appRefresh: RefreshMock = jest.fn(async (): Promise<boolean> => {
        return true;
      }) as RefreshMock;

      enablePrivateImageSessionRefresh(appRefresh);

      try {
        render(
          <SessionAwareImage src={PRIVATE_SRC} alt={ALT} onError={onError} />,
        );

        fireEvent.error(image());

        await waitFor(() => {
          expect(image()).toHaveAttribute(
            "src",
            `${PRIVATE_SRC}?sessionRetry=${NOW}`,
          );
        });

        expect(appRefresh).toHaveBeenCalledTimes(1);
        expect(API.refreshSession).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
      } finally {
        enablePrivateImageSessionRefresh(null);
      }
    });

    it("prefers the caller's refresh over the one the app registered", async () => {
      (UserUtil.isLoggedIn as unknown as BooleanMock).mockReturnValue(true);
      const appRefresh: RefreshMock = jest.fn(async (): Promise<boolean> => {
        return true;
      }) as RefreshMock;
      const callerRefresh: RefreshMock = jest.fn(async (): Promise<boolean> => {
        return true;
      }) as RefreshMock;

      enablePrivateImageSessionRefresh(appRefresh);

      try {
        render(
          <SessionAwareImage
            src={PRIVATE_SRC}
            alt={ALT}
            onError={onError}
            refreshSession={callerRefresh}
          />,
        );

        fireEvent.error(image());

        await waitFor(() => {
          expect(callerRefresh).toHaveBeenCalledTimes(1);
        });

        expect(appRefresh).not.toHaveBeenCalled();
      } finally {
        enablePrivateImageSessionRefresh(null);
      }
    });
  });
});
