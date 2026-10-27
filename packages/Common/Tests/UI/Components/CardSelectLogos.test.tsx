import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import CardSelect, {
  CardSelectOption,
  ComponentProps,
} from "../../../UI/Components/CardSelect/CardSelect";
import {
  PROVIDER_LOGO_TILE_CLASS_NAME,
  getProviderLogoTileSizeClassName,
} from "../../../UI/Components/ProviderLogo/ProviderLogoImage";
import { PROVIDER_ICON_TILE_TEST_ID } from "../../../UI/Components/ProviderLogo/ProviderLogoOrIcon";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Official logos audit: a choice that is another company's product (Amazon
 * S3 in the audit log export's Destination step, OpenAI in the LLM provider
 * form) shows that product's official logo where its icon was. A generic
 * choice in the same list (a webhook, syslog, any S3-compatible storage)
 * keeps its icon, on the same neutral tile as the logos, so the list reads
 * as one set. A list with no logos at all is drawn exactly as before.
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

describe("CardSelect with products' logos", () => {
  describe("the cards (grid)", () => {
    test("a product's card shows its official logo, decorative: its title names it", () => {
      render(<Picker options={DESTINATIONS} />);

      const logo: Element | null = logoIn(card("s3"));

      expect(logo).not.toBeNull();
      expect(logo).toHaveAttribute("data-provider-logo", "amazon-s3");
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(card("s3")).toHaveTextContent("Amazon S3");
      expect(logoIn(card("google-cloud-storage"))).toHaveAttribute(
        "data-provider-logo",
        "google-cloud-storage",
      );
    });

    test("a generic card among logos keeps its icon, on the logos' neutral tile", () => {
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

    test("logos and icons sit on tiles of one size and one look", () => {
      render(<Picker options={DESTINATIONS} />);

      expect(classesOf(logoIn(card("s3"))!)).toEqual(
        expect.arrayContaining(tileClasses(40)),
      );
    });

    test("picking a product keeps its logo as it is: a brand is never re-coloured", () => {
      render(<Picker options={DESTINATIONS} />);

      const before: string = logoIn(card("s3"))!.outerHTML;

      fireEvent.click(card("s3"));

      expect(card("s3")).toHaveAttribute("aria-checked", "true");
      expect(logoIn(card("s3"))!.outerHTML).toBe(before);
      expect(classesOf(logoIn(card("s3"))!)).not.toContain("bg-indigo-100");
    });

    test("a list without logos is drawn as before: grey tiles that turn indigo when picked", () => {
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
    test("each row shows its logo or icon on a 36 pixel tile", () => {
      render(<Picker options={DESTINATIONS} layout="list" />);

      expect(classesOf(logoIn(card("s3"))!)).toEqual(
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
      commonOptionValues: ["s3", "webhook"],
      moreOptionsText: "More destinations",
    };

    test("the common rows show their logos on a 32 pixel tile", () => {
      render(<Picker options={DESTINATIONS} catalog={CATALOG} />);

      expect(classesOf(logoIn(card("s3"))!)).toEqual(
        expect.arrayContaining(tileClasses(32)),
      );
      expect(logoIn(card("webhook"))).toBeNull();
    });

    test("the picked product, shrunk to one line, still shows its logo", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <Picker options={DESTINATIONS} catalog={CATALOG} onChange={onChange} />,
      );

      fireEvent.click(card("s3"));

      expect(onChange).toHaveBeenCalledWith("s3");

      const summary: HTMLElement = screen.getByTestId("card-select-summary");
      const logo: Element | null = logoIn(summary);

      expect(logo).toHaveAttribute("data-provider-logo", "amazon-s3");
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(classesOf(logo!)).toEqual(expect.arrayContaining(tileClasses(32)));
      expect(summary).toHaveTextContent("Amazon S3");
    });

    test("a picked generic choice keeps its indigo icon tile in the summary", () => {
      render(<Picker options={DESTINATIONS} catalog={CATALOG} />);

      fireEvent.click(card("webhook"));

      const summary: HTMLElement = screen.getByTestId("card-select-summary");

      expect(logoIn(summary)).toBeNull();
      expect(summary.querySelector(".bg-indigo-100 svg")).not.toBeNull();
    });
  });
});
