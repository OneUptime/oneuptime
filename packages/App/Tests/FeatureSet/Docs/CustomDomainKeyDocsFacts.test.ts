import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import {
  getCustomDomainCertificateFields,
  hasNoStoredCertificateKey,
} from "../../../FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCertificateFields";
import {
  isUploadedCertificateRefusal,
  isUploadedKeyRefusal,
  UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE,
  UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
} from "Common/Types/CustomDomain/UploadedCertificateRefusals";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the custom domain docs say about an uploaded certificate's private
 * key (#8991), held to the product. Since #8933 the key is write-only: it is
 * stored encrypted, nobody reads it back, and the Edit dialog never loads it.
 * Since #8918 the dialogs say what that means: on a domain that serves its
 * own certificate, Edit leaves the key empty and blank keeps it, so a
 * certificate renewed with the same key is pasted alone; switching Upload
 * Custom Certificate on for a domain on the free certificate asks for the
 * key; and a pair that does not belong together is refused with the reason
 * under the half that is wrong. The docs said none of it, and the dashboards
 * page told a reader to "paste the new one" with no word on the key field
 * that is empty on purpose.
 *
 * Three pages put a domain on your own certificate: a status page's, a
 * dashboard's and a form's. Each says all four, in English, where its
 * custom domain steps are; and each translation names the key and the
 * upload switch, in its own Dashboard's words, as often as the English page
 * does - so a language that kept the old passage fails here.
 */

const PAGES: ReadonlyArray<string> = [
  "status-pages/branding-and-domains",
  "dashboards/sharing",
  "forms/sharing-and-security",
];

// What each page says, in the words the English pages use.
const ENGLISH_FACTS: Record<string, string> = {
  "the key is stored encrypted and never shown again":
    "The key is stored encrypted and never shown again.",
  "Edit leaves the key empty, and blank keeps it":
    "**Certificate Private Key** is empty in the **Edit** dialog: leave it blank to keep the stored key, which is all a certificate renewed with the same key needs, or paste a new key.",
  "moving to your own certificate asks for the key":
    "switching **Upload Custom Certificate** on asks for the key.",
  "a pair that does not match is refused under its field":
    "A certificate and key that do not belong together are refused, with the reason under the field that is wrong.",
};

const KEY_FIELD: string = "Certificate Private Key";
const UPLOAD_SWITCH: string = "Upload Custom Certificate";

const REPOSITORY_PACKAGES: string = path.resolve(__dirname, "../../../..");

const countOf: (text: string, needle: string) => number = (
  text: string,
  needle: string,
): number => {
  return text.split(needle).length - 1;
};

// The page from its custom domain heading on: where these facts belong.
const customDomainPart: (page: string) => string = (page: string): string => {
  const text: string = readPage("en", page);
  const start: number = text.search(/^#{2,3} .*(Custom domain|custom domain)/m);

  expect([page, start]).not.toEqual([page, -1]);

  return text.slice(start);
};

describe("the custom domain docs say what happens to an uploaded private key (English)", () => {
  describe.each(PAGES)("%s", (page: string) => {
    it.each(Object.entries(ENGLISH_FACTS))(
      "says %s, in its custom domain steps",
      (_fact: string, words: string) => {
        expect(customDomainPart(page)).toContain(words);
      },
    );

    it("no longer has a renewal that says nothing of the key field", () => {
      const text: string = readPage("en", page);

      for (const renewal of text.split("\n").filter((line: string) => {
        return line.includes("Renewing an uploaded certificate");
      })) {
        expect(renewal).toContain("leave it blank to keep the stored key");
      }
    });
  });
});

describe("what the docs promise is what the dialogs do", () => {
  const editKey: Record<string, unknown> = getCustomDomainCertificateFields()
    .map((field: unknown): Record<string, unknown> => {
      return field as Record<string, unknown>;
    })
    .find((field: Record<string, unknown>): boolean => {
      return Boolean(
        (field["field"] as Record<string, unknown> | undefined)?.[
          "customCertificateKey"
        ],
      );
    })!;

  /*
   * Add Custom Domain's key field, as its source declares it: the dialog is
   * a React component this suite's environment does not draw.
   */
  const addDialog: string = fs.readFileSync(
    path.join(
      REPOSITORY_PACKAGES,
      "App/FeatureSet/Dashboard/src/Components/CustomDomain/AddCustomDomainModal.tsx",
    ),
    "utf8",
  );
  const addKey: string = addDialog.slice(
    addDialog.indexOf("customCertificateKey: true"),
    addDialog.indexOf(
      "collapsibleSection",
      addDialog.indexOf("customCertificateKey: true"),
    ),
  );

  it("both dialogs say the key is stored encrypted and never shown again", () => {
    expect(editKey["title"]).toBe(KEY_FIELD);
    expect(String(editKey["description"])).toContain(
      "It is stored encrypted and never shown again.",
    );

    expect(addKey).toContain(`title: "${KEY_FIELD}"`);
    expect(addKey).toContain("It is stored encrypted and never shown again.");
  });

  it("Edit keeps the stored key of a domain that serves its own certificate, and asks one moving to it", () => {
    expect(
      hasNoStoredCertificateKey({ isCustomCertificate: true } as never),
    ).toBe(false);
    expect(
      hasNoStoredCertificateKey({ isCustomCertificate: false } as never),
    ).toBe(true);
    expect(editKey["hasNothingStoredWhenEditing"]).toBe(
      hasNoStoredCertificateKey,
    );

    // The key is asked for exactly while the upload switch is on.
    const required: (values: Record<string, unknown>) => boolean = editKey[
      "required"
    ] as never;

    expect(required({ isCustomCertificate: true })).toBe(true);
    expect(required({ isCustomCertificate: false })).toBe(false);
  });

  it("a field left blank on Edit keeps the stored value, in the form's own words", () => {
    const modelForm: string = fs.readFileSync(
      path.join(
        REPOSITORY_PACKAGES,
        "Common/UI/Components/Forms/ModelForm.tsx",
      ),
      "utf8",
    );

    expect(modelForm).toContain(
      "{{description}} Leave blank to keep the stored value.",
    );
  });

  it("a refused pair is said under the half it is about, in both dialogs", () => {
    expect(
      (editKey["ownsServerError"] as (message: string) => boolean)(
        UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE,
      ),
    ).toBe(true);
    expect(addKey).toContain("ownsServerError: isUploadedKeyRefusal");

    const editCertificate: Record<string, unknown> =
      getCustomDomainCertificateFields()
        .map((field: unknown): Record<string, unknown> => {
          return field as Record<string, unknown>;
        })
        .find((field: Record<string, unknown>): boolean => {
          return Boolean(
            (field["field"] as Record<string, unknown> | undefined)?.[
              "customCertificate"
            ],
          );
        })!;

    expect(
      (editCertificate["ownsServerError"] as (message: string) => boolean)(
        UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE,
      ),
    ).toBe(true);
    expect(isUploadedKeyRefusal(UPLOADED_KEY_DOES_NOT_MATCH_MESSAGE)).toBe(
      true,
    );
    expect(
      isUploadedCertificateRefusal(UPLOADED_CERTIFICATE_UNREADABLE_MESSAGE),
    ).toBe(true);
  });
});

describe("every translation carries the key's passages", () => {
  const englishCounts: Record<string, { key: number; upload: number }> = {};

  for (const page of PAGES) {
    const english: string = readPage("en", page);

    englishCounts[page] = {
      key: countOf(english, `**${KEY_FIELD}**`),
      upload: countOf(english, `**${UPLOAD_SWITCH}**`),
    };
  }

  it("the English pages name the key field and the upload switch where these facts are", () => {
    for (const page of PAGES) {
      // Pasted on add, and empty in Edit.
      expect([page, englishCounts[page]!.key >= 2]).toEqual([page, true]);
      // Switched on to add one, and on to move a domain to its own.
      expect([page, englishCounts[page]!.upload >= 2]).toEqual([page, true]);
    }
  });

  describe.each(TRANSLATED_LANGUAGES)("%s", (language: string) => {
    it.each(PAGES)(
      "%s names the key field and the upload switch as often as the English page, in its Dashboard's words",
      (page: string) => {
        const translated: string = readPage(language, page);
        const keyField: string = drawnActionLabel(language, KEY_FIELD);
        const uploadSwitch: string = drawnActionLabel(language, UPLOAD_SWITCH);

        expect({
          page,
          keyField,
          count: countOf(translated, `**${keyField}**`),
        }).toEqual({ page, keyField, count: englishCounts[page]!.key });
        expect({
          page,
          uploadSwitch,
          count: countOf(translated, `**${uploadSwitch}**`),
        }).toEqual({ page, uploadSwitch, count: englishCounts[page]!.upload });
      },
    );
  });
});
