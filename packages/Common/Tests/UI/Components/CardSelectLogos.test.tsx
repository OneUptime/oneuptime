import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { beforeAll, describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import CardSelect, {
  CardSelectOption,
  ComponentProps,
} from "../../../UI/Components/CardSelect/CardSelect";
import {
  PROVIDER_LOGO_COLOR_CLASS_NAME,
  PROVIDER_LOGO_TILE_CLASS_NAME,
  getProviderLogoTileSizeClassName,
} from "../../../UI/Components/ProviderLogo/ProviderLogoImage";
import { PROVIDER_ICON_TILE_TEST_ID } from "../../../UI/Components/ProviderLogo/ProviderLogoOrIcon";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  getDrawnMark,
  getDrawnPathData,
  getMarkPathData,
  preloadProviderLogoMarks,
} from "../../Helpers/ProviderLogoMarks";

/*
 * A choice that is another company's product (Google Cloud Storage in the
 * audit log export's Destination step, OpenAI in the LLM provider form)
 * shows that product's official mark where its icon was - drawn as the icon
 * was: inline, in one colour, the grey of the tile's icons, never an image
 * and never the brand's colours. A product whose brand allows no logo here
 * (Amazon S3: AWS asks to be named in plain text) is drawn by an icon of
 * OneUptime's. A generic choice in the same list (a webhook, syslog, any
 * S3-compatible storage) keeps its icon on the same tile, so the list reads
 * as one set - the maintainer's screenshot of this very dialog showed three
 * colour images beside three grey outline icons. A list with no products at
 * all is drawn exactly as before.
 */

const amazonS3: CardSelectOption = {
  value: "s3",
  title: "Amazon S3",
  description: "Compressed NDJSON files in an S3 bucket.",
  icon: IconProp.Archive,
  logo: ProviderLogo.AmazonS3,
};

const s3Compatible: CardSelectOption = {
  value: "s3-compatible",
  title: "S3-compatible storage",
  description: "MinIO, Cloudflare R2, Backblaze B2, Wasabi.",
  icon: IconProp.ServerStack,
};

const webhook: CardSelectOption = {
  value: "webhook",
  title: "Webhook",
  description: "Batches of entries sent to an HTTPS endpoint.",
  icon: IconProp.Link,
};

const google: CardSelectOption = {
  value: "google-cloud-storage",
  title: "Google Cloud Storage",
  description: "Compressed NDJSON files in a Cloud Storage bucket.",
  icon: IconProp.Cloud,
  logo: ProviderLogo.GoogleCloudStorage,
};

const DESTINATIONS: Array<CardSelectOption> = [
  amazonS3,
  s3Compatible,
  google,
  webhook,
];

beforeAll(async (): Promise<void> => {
  await preloadProviderLogoMarks();
});

function Picker(
  props: Partial<ComponentProps> & { options: Array<CardSelectOption> },
): ReactElement {
  const [value, setValue] = useState<string | undefined>(props.value);

  return (
    <CardSelect
      {...props}
      options={props.options}
      value={value}
      onChange={(next: string) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

function card(value: string): HTMLElement {
  return screen.getByTestId(`card-select-option-${value}`);
}

function logoIn(element: Element): Element | null {
  return element.querySelector("[data-provider-logo]");
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

function tileClasses(size: 32 | 36 | 40): Array<string> {
  return [
    ...PROVIDER_LOGO_TILE_CLASS_NAME.split(" "),
    ...getProviderLogoTileSizeClassName(size).split(" "),
  ];
}

describe("CardSelect with products' marks", () => {
  describe("the cards (grid)", () => {
    test("a product's card shows its official mark, inline and decorative: its title names it", () => {
      render(<Picker options={DESTINATIONS} />);

      const logo: Element | null = logoIn(card("google-cloud-storage"));

      expect(logo).toHaveAttribute("data-provider-logo", "google-cloud-storage");
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(getDrawnPathData(getDrawnMark(logo))).toEqual(
        getMarkPathData(ProviderLogo.GoogleCloudStorage),
      );
      expect(card("google-cloud-storage")).toHaveTextContent(
        "Google Cloud Storage",
      );
    });

    test("no card draws an image: every mark and icon is an inline SVG", () => {
      render(<Picker options={DESTINATIONS} />);

      expect(document.querySelectorAll("img")).toHaveLength(0);
      expect(
        document.querySelectorAll("[data-card-select-value] svg").length,
      ).toBeGreaterThanOrEqual(DESTINATIONS.length);
    });

    test("Amazon S3 is drawn by an icon of OneUptime's: AWS allows its services to be named in plain text only", () => {
      render(<Picker options={DESTINATIONS} />);

      const logo: Element | null = logoIn(card("s3"));

      expect(logo).toHaveAttribute("data-provider-logo", "amazon-s3");
      expect(logo).toHaveAttribute("data-provider-logo-icon", IconProp.Archive);
      expect(getDrawnMark(logo)).toBeNull();
      expect(logo!.querySelectorAll("svg")).toHaveLength(1);
      expect(card("s3")).toHaveTextContent("Amazon S3");
    });

    test("a generic card among products keeps its icon, on the same neutral tile", () => {
      render(<Picker options={DESTINATIONS} />);

      for (const value of ["s3-compatible", "webhook"]) {
        expect(logoIn(card(value))).toBeNull();

        const tile: Element | null = card(value).querySelector(
          `[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
        );

        expect(tile).not.toBeNull();
        expect(tile!.querySelector("svg")).not.toBeNull();
        expect(classesOf(tile!)).toEqual(
          expect.arrayContaining(tileClasses(40)),
        );
      }
    });

    test("marks and icons sit on tiles of one size, one look and one grey", () => {
      render(<Picker options={DESTINATIONS} />);

      const tiles: Array<Element> = [
        logoIn(card("google-cloud-storage"))!,
        logoIn(card("s3"))!,
        card("webhook").querySelector(
          `[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
        )!,
      ];

      for (const tile of tiles) {
        expect(classesOf(tile)).toEqual(
          expect.arrayContaining([
            ...tileClasses(40),
            PROVIDER_LOGO_COLOR_CLASS_NAME,
          ]),
        );
      }
    });

    test("picking a product turns its mark indigo, as a picked icon turns, on the same tile", () => {
      render(<Picker options={DESTINATIONS} />);

      const before: Element = logoIn(card("google-cloud-storage"))!;
      const drawn: Array<string> = getDrawnPathData(getDrawnMark(before));

      expect(drawn).toEqual(getMarkPathData(ProviderLogo.GoogleCloudStorage));

      expect(classesOf(before)).toContain(PROVIDER_LOGO_COLOR_CLASS_NAME);
      expect(classesOf(before)).not.toContain("text-indigo-600");

      fireEvent.click(card("google-cloud-storage"));

      const picked: Element = logoIn(card("google-cloud-storage"))!;

      expect(card("google-cloud-storage")).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(card("google-cloud-storage")).toHaveClass("border-indigo-500");
      // The mark takes the picked indigo, as the tick and the edge do...
      expect(classesOf(picked)).toContain("text-indigo-600");
      expect(classesOf(picked)).not.toContain(PROVIDER_LOGO_COLOR_CLASS_NAME);
      // ...on the same neutral tile, at the same size, the same drawing.
      expect(classesOf(picked)).toEqual(
        expect.arrayContaining(tileClasses(40)),
      );
      expect(classesOf(picked)).not.toContain("bg-indigo-100");
      expect(getDrawnPathData(getDrawnMark(picked))).toEqual(drawn);
      // The products not picked keep the tile's grey.
      expect(classesOf(logoIn(card("s3"))!)).toContain(
        PROVIDER_LOGO_COLOR_CLASS_NAME,
      );
    });

    test("a picked generic choice among products turns its icon indigo on its neutral tile", () => {
      render(<Picker options={DESTINATIONS} />);

      const iconTile: () => Element = (): Element => {
        return card("webhook").querySelector(
          `[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
        )!;
      };

      expect(classesOf(iconTile())).toContain(PROVIDER_LOGO_COLOR_CLASS_NAME);

      fireEvent.click(card("webhook"));

      expect(classesOf(iconTile())).toContain("text-indigo-600");
      expect(classesOf(iconTile())).not.toContain(
        PROVIDER_LOGO_COLOR_CLASS_NAME,
      );
      expect(classesOf(iconTile())).toEqual(
        expect.arrayContaining(tileClasses(40)),
      );
      // Picking another choice gives the webhook its grey back.
      fireEvent.click(card("google-cloud-storage"));
      expect(classesOf(iconTile())).toContain(PROVIDER_LOGO_COLOR_CLASS_NAME);
    });

    test("a list without products is drawn as before: grey tiles that turn indigo when picked", () => {
      render(<Picker options={[s3Compatible, webhook]} />);

      expect(document.querySelector("[data-provider-logo]")).toBeNull();
      expect(
        document.querySelector(`[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`),
      ).toBeNull();

      const tile: Element = card("webhook").querySelector("svg")!
        .parentElement!.parentElement!;

      expect(tile).toHaveClass("bg-gray-100");

      fireEvent.click(card("webhook"));

      const picked: Element = card("webhook").querySelector("svg")!
        .parentElement!.parentElement!;

      expect(picked).toHaveClass("bg-indigo-100");
    });
  });

  describe("the list layout", () => {
    test("each row shows its mark or icon on a 36 pixel tile", () => {
      render(<Picker options={DESTINATIONS} layout="list" />);

      expect(classesOf(logoIn(card("google-cloud-storage"))!)).toEqual(
        expect.arrayContaining(tileClasses(36)),
      );

      const tile: Element | null = card("webhook").querySelector(
        `[data-testid='${PROVIDER_ICON_TILE_TEST_ID}']`,
      );

      expect(classesOf(tile!)).toEqual(expect.arrayContaining(tileClasses(36)));
    });
  });

  describe("the catalog layout", () => {
    const CATALOG: ComponentProps["catalog"] = {
      commonOptionValues: ["google-cloud-storage", "webhook"],
      moreOptionsText: "More destinations",
    };

    test("the common rows show their marks on a 32 pixel tile", () => {
      render(<Picker options={DESTINATIONS} catalog={CATALOG} />);

      expect(classesOf(logoIn(card("google-cloud-storage"))!)).toEqual(
        expect.arrayContaining(tileClasses(32)),
      );
      expect(logoIn(card("webhook"))).toBeNull();
    });

    test("the picked product, shrunk to one line, shows its mark on the picked indigo tile, as an icon would be", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Picker options={DESTINATIONS} catalog={CATALOG} onChange={onChange} />,
      );

      fireEvent.click(card("google-cloud-storage"));

      expect(onChange).toHaveBeenCalledWith("google-cloud-storage");

      const summary: HTMLElement = screen.getByTestId("card-select-summary");
      const logo: Element | null = logoIn(summary);

      expect(logo).toHaveAttribute("data-provider-logo", "google-cloud-storage");
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(logo).toHaveClass("text-indigo-600");
      expect(logo!.parentElement).toHaveClass("bg-indigo-100", "h-8", "w-8");
      expect(getDrawnPathData(getDrawnMark(logo))).toEqual(
        getMarkPathData(ProviderLogo.GoogleCloudStorage),
      );
      expect(summary).toHaveTextContent("Google Cloud Storage");
    });

    test("a picked generic choice keeps its indigo icon tile in the summary", () => {
      render(<Picker options={DESTINATIONS} catalog={CATALOG} />);

      fireEvent.click(card("webhook"));

      const summary: HTMLElement = screen.getByTestId("card-select-summary");

      expect(logoIn(summary)).toBeNull();
      expect(summary.querySelector(".bg-indigo-100 svg")).not.toBeNull();
    });

    test("a mark and an icon take the same picked tile in the summary", () => {
      const { unmount } = render(
        <Picker options={DESTINATIONS} catalog={CATALOG} />,
      );

      fireEvent.click(card("google-cloud-storage"));
      const markTile: string = classesOf(
        logoIn(screen.getByTestId("card-select-summary"))!.parentElement!,
      ).join(" ");
      unmount();

      render(<Picker options={DESTINATIONS} catalog={CATALOG} />);
      fireEvent.click(card("webhook"));
      const iconTile: string = classesOf(
        screen.getByTestId("card-select-summary").querySelector(
          ".bg-indigo-100",
        )!,
      ).join(" ");

      expect(markTile).toBe(iconTile);
    });
  });
});
