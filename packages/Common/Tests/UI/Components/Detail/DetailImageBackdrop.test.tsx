import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import Detail from "../../../../UI/Components/Detail/Detail";
import {
  DETAIL_IMAGE_BACKDROP_ATTRIBUTE,
  DETAIL_IMAGE_BACKDROP_CLASS_NAMES,
  DetailImageBackdrop,
} from "../../../../UI/Components/Detail/DetailImageBackdrop";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * An image file a detail card shows on the page it is made for
 * (DetailImageBackdrop): a status page's logo on its light page's grey, and
 * its Dark Theme Logo - light lettering - on its dark page's slate, in the
 * dashboard's light theme and its dark one alike. On the card's own white
 * frame the dark theme logo's lettering vanished, and in the dashboard's
 * dark theme the logo's dark lettering did, on the slate the white frame
 * turns into there.
 */

type Item = {
  logo?: { file: Uint8Array; fileType: string } | undefined;
};

const ITEM: Item = {
  logo: {
    file: new Uint8Array([60, 115, 118, 103, 47, 62]),
    fileType: "image/svg+xml",
  },
};

const THEME_CSS: string = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

const renderLogo: (extra?: Partial<Field<Item>>) => HTMLElement = (
  extra?: Partial<Field<Item>>,
): HTMLElement => {
  render(
    <Detail<Item>
      id="detail"
      item={ITEM}
      fields={[
        {
          key: "logo",
          title: "Logo",
          fieldType: FieldType.ImageFile,
          ...extra,
        },
      ]}
    />,
  );

  // The frame the image is drawn in.
  return within(screen.getByTestId("detail-value")).getByRole("img")
    .parentElement as HTMLElement;
};

const originalCreateObjectURL: typeof URL.createObjectURL | undefined = (
  URL as unknown as { createObjectURL?: typeof URL.createObjectURL }
).createObjectURL;

beforeEach(() => {
  // jsdom has no object URLs; the card makes one for the image's bytes.
  (
    URL as unknown as { createObjectURL: (blob: Blob) => string }
  ).createObjectURL = (): string => {
    return "blob:logo";
  };
});

afterEach(() => {
  cleanup();

  const url: { createObjectURL?: typeof URL.createObjectURL | undefined } =
    URL as unknown as {
      createObjectURL?: typeof URL.createObjectURL | undefined;
    };

  if (originalCreateObjectURL) {
    url.createObjectURL = originalCreateObjectURL;
  } else {
    delete url.createObjectURL;
  }

  jest.restoreAllMocks();
});

describe("an image file on a detail card", () => {
  test("without a backdrop, sits on the card's own white frame, as every image did", () => {
    const frame: HTMLElement = renderLogo();

    expect(frame.className).toContain("bg-white");
    expect(frame.className).toContain("border-gray-200");
    expect(frame.className).toContain("p-1");
    expect(frame).not.toHaveAttribute(DETAIL_IMAGE_BACKDROP_ATTRIBUTE);
    expect(within(frame).getByRole("img")).toHaveAttribute("src", "blob:logo");
  });

  test.each([
    [DetailImageBackdrop.Light, "light", "bg-[#f9fafb]", "border-[#e5e7eb]"],
    [DetailImageBackdrop.Dark, "dark", "bg-[#0f172a]", "border-[#1e293b]"],
  ])(
    "on a %s page's background, not the card's, with room around it",
    (
      backdrop: DetailImageBackdrop,
      attribute: string,
      background: string,
      border: string,
    ) => {
      const frame: HTMLElement = renderLogo({ imageBackdrop: backdrop });

      expect(frame).toHaveAttribute(DETAIL_IMAGE_BACKDROP_ATTRIBUTE, attribute);
      expect(frame.className.split(" ")).toEqual(
        expect.arrayContaining([background, border, "px-4", "py-3"]),
      );
      // Not the card's surface, which each theme colours its own way.
      expect(frame.className.split(" ")).not.toContain("bg-white");
      expect(frame.className.split(" ")).not.toContain("border-gray-200");
      expect(DETAIL_IMAGE_BACKDROP_CLASS_NAMES[backdrop]).toBe(
        `${border} ${background}`,
      );
    },
  );

  /*
   * The dark theme re-colours the card's light classes (Theme.css, under
   * html.dark), so the backdrops are arbitrary colours it leaves alone: a
   * page's background is the same in both of the dashboard's themes.
   */
  test("the backdrops are colours the dark theme does not re-colour", () => {
    for (const className of Object.values(DETAIL_IMAGE_BACKDROP_CLASS_NAMES)) {
      for (const token of className.split(" ")) {
        // An arbitrary colour, which no theme rule names.
        expect([token, token.includes("-[#")]).toEqual([token, true]);
      }
    }

    // A rule on an arbitrary colour class is written with an escaped "[".
    for (const prefix of ["bg-\\[", "border-\\["]) {
      expect([prefix, THEME_CSS.includes(prefix)]).toEqual([prefix, false]);
    }
  });

  test("the two pages' backgrounds are the status page's own canvases", () => {
    // The light status page's canvas (gray-50) and its dark one (slate-900).
    expect(
      DETAIL_IMAGE_BACKDROP_CLASS_NAMES[DetailImageBackdrop.Light],
    ).toContain("bg-[#f9fafb]");
    expect(
      DETAIL_IMAGE_BACKDROP_CLASS_NAMES[DetailImageBackdrop.Dark],
    ).toContain("bg-[#0f172a]");
    expect(Object.values(DetailImageBackdrop).sort()).toEqual([
      "Dark",
      "Light",
    ]);
  });
});
