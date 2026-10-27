import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import VideoCallProviderGallery, {
  VIDEO_CALL_GALLERY_CLASS_NAME,
  VIDEO_CALL_GALLERY_CONTAINER_CLASS_NAME,
  VIDEO_CALL_TILE_FOOTER_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallProviderGallery";
import {
  VideoCallProviderCatalog,
  VideoCallProviderDefinition,
} from "../../../Types/VideoCall/VideoCallProviderCatalog";

/*
 * UI review of the official logos (Project Settings > Workspace > Video
 * Calls): the provider gallery put five tiles side by side from a 1280px
 * window, but beside the Settings side menu the gallery has some 880px
 * there, so each tile was 160px wide and its "Setup guide" link broke over
 * two lines while its Connect button ran out of the tile - in German past
 * the tile's edge. The columns now follow the gallery's own width (a size
 * container), and a tile's footer wraps instead of overflowing.
 */

const renderGallery: () => void = (): void => {
  render(
    <MemoryRouter>
      <VideoCallProviderGallery
        connectionCounts={{}}
        canConnect={true}
        onConnect={() => {}}
      />
    </MemoryRouter>,
  );
};

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return element.className.split(" ").filter(Boolean);
};

// The rem a container step names: "[@container(min-width:51rem)]:grid-cols-3" -> 51.
const CONTAINER_STEP_PREFIX: string = "[@container(min-width:";

// Columns set by a window breakpoint: "sm:grid-cols-2", "xl:grid-cols-5".
const WINDOW_BREAKPOINT_COLUMNS: RegExp = /^\w+:grid-cols-/;

const containerStepsOf: (classes: Array<string>) => Array<string> = (
  classes: Array<string>,
): Array<string> => {
  return classes
    .filter((name: string): boolean => {
      return name.startsWith(CONTAINER_STEP_PREFIX);
    })
    .map((name: string): string => {
      return name.slice(CONTAINER_STEP_PREFIX.length, name.indexOf(")"));
    });
};

afterEach(() => {
  cleanup();
});

describe("the video call provider gallery's layout", () => {
  test("the gallery is a size container, and its list reads that container's width", () => {
    renderGallery();

    const container: HTMLElement = screen.getByTestId(
      "video-call-provider-gallery-container",
    );
    const list: HTMLElement = screen.getByTestId("video-call-provider-gallery");

    expect(container.className).toBe(VIDEO_CALL_GALLERY_CONTAINER_CLASS_NAME);
    expect(classesOf(container)).toEqual(
      expect.arrayContaining(["[container-type:inline-size]", "min-w-0"]),
    );
    expect(list.parentElement).toBe(container);
    expect(list.className).toBe(VIDEO_CALL_GALLERY_CLASS_NAME);
  });

  test("columns step up with the gallery's width - two, three, then all five - never with the window's", () => {
    const classes: Array<string> = VIDEO_CALL_GALLERY_CLASS_NAME.split(" ");

    expect(classes).toEqual(
      expect.arrayContaining([
        "grid",
        "grid-cols-1",
        "[@container(min-width:34rem)]:grid-cols-2",
        "[@container(min-width:51rem)]:grid-cols-3",
        "[@container(min-width:78rem)]:grid-cols-5",
      ]),
    );

    // No window breakpoint decides the columns any more (sm:, md:, lg:, xl:, 2xl:).
    for (const name of classes) {
      expect({
        name,
        isWindowColumns: WINDOW_BREAKPOINT_COLUMNS.test(name),
      }).toEqual({
        name,
        isWindowColumns: false,
      });
    }
  });

  test("the container steps sort as text in the order of their widths, as the Tailwind runtime writes them", () => {
    const steps: Array<string> = containerStepsOf(
      VIDEO_CALL_GALLERY_CLASS_NAME.split(" "),
    );

    expect(steps).toEqual(["34rem", "51rem", "78rem"]);
    expect([...steps].sort()).toEqual(steps);
  });

  test("a provider tile's footer wraps - the guide link over the button - rather than overflowing the tile", () => {
    renderGallery();

    for (const definition of VideoCallProviderCatalog as Array<VideoCallProviderDefinition>) {
      const footer: HTMLElement = screen.getByTestId(
        `video-call-provider-footer-${definition.provider}`,
      );

      expect(footer.className).toBe(VIDEO_CALL_TILE_FOOTER_CLASS_NAME);
      expect(classesOf(footer)).toEqual(
        expect.arrayContaining(["flex", "flex-wrap", "gap-y-2"]),
      );

      // The guide link stays on one line ("Setup guide", "Einrichtungsanleitung").
      const link: HTMLElement = within(footer).getAllByRole("link")[0]!;

      expect(link).toHaveClass("whitespace-nowrap");
      expect(
        within(footer).getByTestId(`video-call-connect-${definition.provider}`),
      ).toBeInTheDocument();
    }
  });
});
