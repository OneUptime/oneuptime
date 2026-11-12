// UX rule: Docs/ux/README.md#in-every-language
import {
  findPhoneNumberPrintSites,
  formatPhoneNumberPrintFindings,
  isPhoneNumberName,
  listPhoneNumberScanFiles,
  PhoneNumberPrintFinding,
  PhoneNumberPrintKind,
  PhoneNumberPrintSite,
  REPOSITORY_ROOT,
  scanPhoneNumberPrints,
} from "../PhoneNumberPrints";
import { toRelativePath } from "../ForeignHiddenRuleGuard";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6605: NO PHONE NUMBER IS PRINTED AS IT IS.
 *
 * On a Persian or Arabic page, laid out right to left, a phone number
 * printed as it is - in a span, a tooltip, a sentence - took the page's
 * way, and its "+" went after its digits: +447700900123 read 447700900123+
 * in the Twilio Config table, an incoming call policy's numbers, the
 * dialogs that reserve and release one, a user's notification methods.
 * Every number the product prints now goes through PhoneNumberText (an
 * isolate that reads left to right), and one in a line that can only be
 * text through phoneNumberInLine or phoneNumberListInLine. This guard reads
 * every browser module for a number printed any other way, so the next
 * one cannot come back unseen.
 *
 * And for a PhoneNumberText spaced by its start or end: its isolate reads
 * left to right, so a start margin (ml-2, or space-x-2 on its row, both
 * margin-inline-start here) is its left on a Persian page too. An incoming
 * call policy's number sat against the handset before it that way, with
 * 16px before "+1 more" after it.
 */

function sitesOf(source: string): Array<string> {
  return findPhoneNumberPrintSites("Snippet.tsx", source).map(
    (site: PhoneNumberPrintSite): string => {
      return `${site.kind}: ${site.text}`;
    },
  );
}

describe("every browser module", () => {
  let scanned: Array<PhoneNumberPrintFinding> = [];

  beforeAll(() => {
    scanned = scanPhoneNumberPrints();
  });

  test("prints no phone number as it is", () => {
    const findings: string = formatPhoneNumberPrintFindings(
      scanned.filter((finding: PhoneNumberPrintFinding): boolean => {
        return finding.kind !== PhoneNumberPrintKind.SideSpacing;
      }),
    );

    /*
     * A number drawn on the page: <PhoneNumberText phoneNumber={...} />.
     * In a tooltip or a translated sentence's value: phoneNumberInLine(
     * number, translator.language), or phoneNumberListInLine for a list.
     * (Common/UI/Components/PhoneNumber, Common/Types/PhoneNumberDirection.)
     */
    expect(findings).toBe("");
  });

  test("spaces no phone number by its start or end", () => {
    const findings: string = formatPhoneNumberPrintFindings(
      scanned.filter((finding: PhoneNumberPrintFinding): boolean => {
        return finding.kind === PhoneNumberPrintKind.SideSpacing;
      }),
    );

    /*
     * A row that holds a number is spaced by its gap (flex items-center
     * gap-2), never by space-x, and the number itself has no margin or
     * padding on one side: both would be its own left, as it reads left
     * to right, on a page read from the right.
     */
    expect(findings).toBe("");
  });

  test("the walk reads the modules the numbers are printed in", () => {
    const files: Array<string> = listPhoneNumberScanFiles().map(
      (file: string): string => {
        return toRelativePath(REPOSITORY_ROOT, file);
      },
    );

    // Not vacuous: thousands of modules, the ones this issue was about among them.
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigPhoneNumbers.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/CallSMS/PhoneNumberPurchase.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/CallSMS/CallSMSConfigTable.tsx",
        "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeModal.tsx",
        "packages/App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerTestSendButton.tsx",
        "packages/Common/UI/Components/Table/TableRow.tsx",
        "packages/Common/UI/Components/Detail/Detail.tsx",
      ]),
    );
    // Every one a module, none a declaration.
    for (const file of files) {
      expect(file).toMatch(/\.tsx?$/);
      expect(file.endsWith(".d.ts")).toBe(false);
    }
  });
});

describe("the code this issue was about is found", () => {
  test("the Twilio Config table's number and its +2 more tooltip", () => {
    // TwilioConfigPhoneNumbers before the fix.
    expect(
      sitesOf(`
        const number = (
          <span className="whitespace-nowrap text-gray-900">
            {line.phoneNumber}
          </span>
        );
        const more = (
          <span title={line.otherPhoneNumbers.join(", ")}>+2 more</span>
        );
      `),
    ).toEqual([
      `${PhoneNumberPrintKind.Child}: {line.phoneNumber}`,
      `${PhoneNumberPrintKind.Title}: title={line.otherPhoneNumbers.join(", ")}`,
    ]);
  });

  test("an incoming call policy's row, its card and its dialogs", () => {
    // IncomingCallPolicies and PhoneNumberPurchase before the fix.
    expect(
      sitesOf(`
        const row = <span className="font-mono truncate">{summary.visiblePhoneNumbers[0]}</span>;
        const card = (
          <p>{phoneNumberText || translator.translateText("Unknown phone number")}</p>
        );
        const owned = <p className="text-sm text-gray-500">{number.phoneNumber}</p>;
        const released = translator.translateTemplate(
          "{{phoneNumber}} has been released back to Twilio.",
          { phoneNumber: releasedPhoneNumber },
        );
        const release = translator.translateTemplate(
          "Are you sure you want to release {{phoneNumber}}?",
          { phoneNumber: getIncomingCallPolicyPhoneNumberText(phoneNumberToRelease) },
        );
      `),
    ).toEqual([
      `${PhoneNumberPrintKind.Child}: {summary.visiblePhoneNumbers[0]}`,
      `${PhoneNumberPrintKind.Child}: {phoneNumberText || translator.translateText("Unknown phone number")}`,
      `${PhoneNumberPrintKind.Child}: {number.phoneNumber}`,
      `${PhoneNumberPrintKind.SentenceValue}: phoneNumber: releasedPhoneNumber`,
      `${PhoneNumberPrintKind.SentenceValue}: phoneNumber: getIncomingCallPolicyPhoneNumberText(phoneNumberToRelease)`,
    ]);
  });

  test("a number in a sentence under another name", () => {
    // Call.tsx's verified-by-SMS dialog before the fix.
    expect(
      sitesOf(`
        translator.translateTemplate(CallNumberVerifiedBySmsCopy.description, {
          destination: verifiedBySmsItem.phone?.toString() || "",
        });
      `),
    ).toEqual([
      `${PhoneNumberPrintKind.SentenceValue}: destination: verifiedBySmsItem.phone?.toString() || ""`,
    ]);
  });
});

describe("the row this review was about is found", () => {
  test("an incoming call policy's row spaced with space-x", () => {
    // IncomingCallPolicies before the review.
    expect(
      sitesOf(`
        const row = (
          <div className="flex items-center space-x-2">
            <Icon icon={IconProp.Call} className="h-4 w-4 text-green-500 flex-shrink-0" />
            <PhoneNumberText
              phoneNumber={summary.visiblePhoneNumbers[0]}
              className="font-mono truncate"
            />
            <span className="rounded-full px-2">+1 more</span>
          </div>
        );
      `),
    ).toEqual([
      `${PhoneNumberPrintKind.SideSpacing}: className="flex items-center space-x-2"`,
    ]);
  });
});

describe("what counts as spacing a number by its start or end", () => {
  test.each([
    ["a start margin", '<PhoneNumberText phoneNumber={p} className="ml-2" />'],
    ["an end margin", '<PhoneNumberText phoneNumber={p} className="mr-1" />'],
    [
      "a logical one at a breakpoint",
      '<PhoneNumberText phoneNumber={p} className="text-sm sm:me-1" />',
    ],
    [
      "a negative one",
      '<PhoneNumberText phoneNumber={p} className="-ml-[22px]" />',
    ],
    [
      "an important one",
      '<PhoneNumberText phoneNumber={p} className="!ms-2" />',
    ],
    ["a side padding", '<PhoneNumberText phoneNumber={p} className="ps-2" />'],
    [
      "one on a branch of a ternary",
      '<PhoneNumberText phoneNumber={p} className={wide ? "ml-2" : "truncate"} />',
    ],
    [
      "one in a template",
      "<PhoneNumberText phoneNumber={p} className={`truncate ${tone} mr-1`} />",
    ],
    [
      "one in a class list's call",
      '<PhoneNumberText phoneNumber={p} className={classNames("truncate", "ml-1")} />',
    ],
  ])("%s on the number", (_name: string, source: string) => {
    const sites: Array<PhoneNumberPrintSite> = findPhoneNumberPrintSites(
      "Snippet.tsx",
      `const element = ${source};`,
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]!.kind).toBe(PhoneNumberPrintKind.SideSpacing);
    expect(sites[0]!.text).toMatch(/^className=/);
  });

  test.each([
    [
      "its row",
      '<div className="flex space-x-2"><Icon /><PhoneNumberText phoneNumber={p} /></div>',
      'className="flex space-x-2"',
    ],
    [
      "its row at a breakpoint",
      '<span className="inline-flex sm:space-x-1"><b>x</b><PhoneNumberText phoneNumber={p} /></span>',
      'className="inline-flex sm:space-x-1"',
    ],
    [
      "its row, through a ternary",
      '<span className="space-x-1"><b>x</b>{show ? <PhoneNumberText phoneNumber={p} /> : null}</span>',
      'className="space-x-1"',
    ],
    [
      "its row, through a fragment",
      '<span className="space-x-1"><Fragment key={1}><b>x</b><PhoneNumberText phoneNumber={p} /></Fragment></span>',
      'className="space-x-1"',
    ],
    [
      "its row, through a list's map",
      '<div className="space-x-1">{numbers.map((n) => { return <PhoneNumberText key={n} phoneNumber={n} />; })}</div>',
      'className="space-x-1"',
    ],
    [
      "its row, by a constant of the module",
      "<div className={ROW}><Icon /><PhoneNumberText phoneNumber={p} /></div>",
      "className={ROW}",
    ],
  ])("a space-x on %s", (_name: string, source: string, found: string) => {
    expect(
      sitesOf(
        `const ROW: string = "flex items-center space-x-2";
const element = ${source};`,
      ),
    ).toEqual([`${PhoneNumberPrintKind.SideSpacing}: ${found}`]);
  });

  test("a row with two numbers in it is one finding", () => {
    expect(
      sitesOf(`
        const row = (
          <div className="space-x-2">
            <PhoneNumberText phoneNumber={a} />
            <PhoneNumberText phoneNumber={b} />
          </div>
        );
      `),
    ).toEqual([`${PhoneNumberPrintKind.SideSpacing}: className="space-x-2"`]);
  });

  test("a finding reads as the module, the line, what it does and the code", () => {
    expect(
      formatPhoneNumberPrintFindings([
        {
          file: "packages/App/FeatureSet/Dashboard/src/X.tsx",
          kind: PhoneNumberPrintKind.SideSpacing,
          line: 40,
          text: 'className="flex space-x-2"',
        },
      ]),
    ).toBe(
      'packages/App/FeatureSet/Dashboard/src/X.tsx:40 spaces a phone number by its start or end, its left and right on every page (side spacing): className="flex space-x-2"',
    );
  });
});

describe("what does not space a number by its start or end", () => {
  test.each([
    [
      "a row spaced by its gap",
      '<div className="flex items-center gap-2 min-w-0"><Icon /><PhoneNumberText phoneNumber={p} /></div>',
    ],
    [
      "a row spaced by a constant gap",
      "<div className={LINE}><Icon /><PhoneNumberText phoneNumber={p} /></div>",
    ],
    [
      "a column spaced by space-y",
      '<div className="space-y-1"><PhoneNumberText phoneNumber={a} /><PhoneNumberText phoneNumber={b} /></div>',
    ],
    [
      "a space-x on an element further out",
      '<div className="flex space-x-2"><Icon /><span><PhoneNumberText phoneNumber={p} /></span></div>',
    ],
    [
      "a space-x-reverse alone",
      '<div className="flex space-x-reverse"><PhoneNumberText phoneNumber={p} /></div>',
    ],
    [
      "margins above, below or on both sides",
      '<PhoneNumberText phoneNumber={p} className="mt-1 mb-2 my-1 mx-1 m-1 px-2 py-1 p-1" />',
    ],
    [
      "a class that only starts like one",
      '<PhoneNumberText phoneNumber={p} className="max-w-xs min-w-0 pointer-events-none" />',
    ],
    [
      "a class it is handed",
      "<PhoneNumberText phoneNumber={p} className={props.className} />",
    ],
    [
      "a side margin on its row, or on another element",
      '<div className="-ml-[22px] pl-[22px]"><IsolatedText text={t} className="ml-2" /><PhoneNumberText phoneNumber={p} /></div>',
    ],
    [
      "a list of numbers, a box drawn the page's way",
      '<div className="flex space-x-2"><Icon /><PhoneNumberTextList phoneNumbers={numbers} className="ml-1" /></div>',
    ],
    [
      "a number handed to a slot, away from its row",
      '<span className="space-x-1"><TranslatedSentence slots={{ value: <PhoneNumberText phoneNumber={p} /> }} /></span>',
    ],
  ])("%s", (_name: string, source: string) => {
    expect(
      sitesOf(
        `const LINE: string = "flex items-center gap-2 min-w-0";
const element = ${source};`,
      ),
    ).toEqual([]);
  });
});

describe("what counts as printing a number as it is", () => {
  test.each([
    ["a property", "<span>{item.phone}</span>"],
    ["its text", "<span>{item.phone?.toString()}</span>"],
    ["String() of one", "<span>{String(callerPhone)}</span>"],
    ["a list joined", "<span>{otherPhoneNumbers.join(', ')}</span>"],
    ["one of a list", "<span>{phoneNumbers[0]}</span>"],
    ["one read by its key", "<span>{line['phoneNumber']}</span>"],
    ["trimmed", "<span>{phoneNumber.trim()}</span>"],
    ["a function that gives one", "<span>{getPhoneNumber(item)}</span>"],
    ["a template holding one", "<span>{`Call ${phoneNumber}`}</span>"],
    ["either branch of a ternary", "<span>{isMasked ? '***' : phone}</span>"],
    ["the right side of &&", "<span>{show && phoneNumber}</span>"],
    ["inside a fragment", "<>{phoneNumber}</>"],
    ["cast", "<span>{(phoneNumber as string)!}</span>"],
  ])("a child that is %s", (_name: string, source: string) => {
    expect(sitesOf(`const element = ${source};`)).toHaveLength(1);
    expect(
      findPhoneNumberPrintSites("Snippet.tsx", `const element = ${source};`)[0]!
        .kind,
    ).toBe(PhoneNumberPrintKind.Child);
  });

  test("a tooltip that is one", () => {
    expect(sitesOf("const e = <span title={phoneNumber}>x</span>;")).toEqual([
      `${PhoneNumberPrintKind.Title}: title={phoneNumber}`,
    ]);
  });

  test.each([
    [
      "by its name",
      "translator.translateTemplate(t, { phoneNumber: value });",
      "phoneNumber: value",
    ],
    [
      "by its value",
      "translator.translateTemplate(t, { to: item.phone.toString() });",
      "to: item.phone.toString()",
    ],
    [
      "written short",
      "translator.translateTemplate(t, { phoneNumber });",
      "phoneNumber",
    ],
    [
      "around a sentence",
      "translator.translateTemplateAround(t, { destination: phoneNumber }, x);",
      "destination: phoneNumber",
    ],
    [
      "set apart on one branch only",
      "translateTemplate(t, { phoneNumber: isRtl ? phoneNumberInLine(p, l) : p });",
      "phoneNumber: isRtl ? phoneNumberInLine(p, l) : p",
    ],
  ])(
    "a sentence's value that is one, %s",
    (_name: string, source: string, found: string) => {
      expect(sitesOf(source)).toEqual([
        `${PhoneNumberPrintKind.SentenceValue}: ${found}`,
      ]);
    },
  );

  test("a TranslatedSentence's value that is one", () => {
    expect(
      sitesOf(
        "const e = <TranslatedSentence template={t} values={{ phoneNumber: line.phoneNumber, name: name }} />;",
      ),
    ).toEqual([
      `${PhoneNumberPrintKind.SentenceValue}: phoneNumber: line.phoneNumber`,
    ]);
  });

  test("reports where it is: its line, as the module numbers them", () => {
    const sites: Array<PhoneNumberPrintSite> = findPhoneNumberPrintSites(
      "Snippet.tsx",
      [
        "const a = 1;",
        "",
        "const e = (",
        "  <span>",
        "    {line.phoneNumber}",
        "  </span>",
        ");",
      ].join("\n"),
    );

    expect(sites).toEqual([
      {
        kind: PhoneNumberPrintKind.Child,
        line: 5,
        text: "{line.phoneNumber}",
      },
    ]);
  });

  test("a finding reads as the module, the line, the kind and the code", () => {
    expect(
      formatPhoneNumberPrintFindings([
        {
          file: "packages/App/FeatureSet/Dashboard/src/X.tsx",
          kind: PhoneNumberPrintKind.Title,
          line: 12,
          text: "title={phone}",
        },
      ]),
    ).toBe(
      "packages/App/FeatureSet/Dashboard/src/X.tsx:12 prints a phone number as it is (title): title={phone}",
    );
    expect(formatPhoneNumberPrintFindings([])).toBe("");
  });
});

describe("what does not", () => {
  test.each([
    [
      "drawn by PhoneNumberText",
      "<PhoneNumberText phoneNumber={line.phoneNumber} />",
    ],
    [
      "listed by PhoneNumberTextList",
      "<PhoneNumberTextList phoneNumbers={line.otherPhoneNumbers} />",
    ],
    [
      "a tooltip set apart",
      "<span title={phoneNumberListInLine(others, language)} />",
    ],
    ["whether a window is a phone's", "<div>{isPhone ? <A /> : <B />}</div>"],
    ["a phone view's switch", "<div>{isPhoneView && 'compact'}</div>"],
    ["how many numbers there are", "<span>{phoneNumbers.length}</span>"],
    ["a count", "<span>{phoneNumberCount}</span>"],
    ["a width", "<span>{PHONE_BELOW_WIDTH_IN_PX}</span>"],
    ["an id", "<span>{line.phoneNumberId}</span>"],
    ["a field's label", "<span>{phoneNumberLabel}</span>"],
    ["an element a function draws", "<div>{renderPhoneNumbers()}</div>"],
    [
      "the words Phone Number",
      "<p>{translator.translateText('Phone Number')}</p>",
    ],
    ["a string that says phone", "<p>{'phone'}</p>"],
    [
      "an attribute that is no tooltip",
      "<input placeholder={phonePlaceholder} value={phone} />",
    ],
  ])("%s", (_name: string, source: string) => {
    expect(sitesOf(`const element = ${source};`)).toEqual([]);
  });

  test("a sentence's number set apart for its line", () => {
    expect(
      sitesOf(`
        translator.translateTemplate(t, {
          phoneNumber: phoneNumberInLine(line.phoneNumber, translator.language),
        });
        translator.translateTemplate(t, {
          destination: isEmail ? phoneNumberInLine(a, l) : phoneNumberListInLine(b, l),
        });
        translator.translateTemplate(t, { count: phoneNumbers.length, name: name });
      `),
    ).toEqual([]);
  });

  test("a translated sentence with no values, or values the guard cannot read", () => {
    expect(
      sitesOf(`
        translator.translateTemplate("Phone number {{phoneNumber}}");
        translator.translateTemplate(t, values);
      `),
    ).toEqual([]);
  });

  test("a comment or a string that mentions a phone number", () => {
    expect(
      sitesOf(`
        // <span>{line.phoneNumber}</span>
        /* title={phoneNumber} */
        const words = "<span>{phoneNumber}</span>";
      `),
    ).toEqual([]);
  });
});

describe("a name that holds a phone number", () => {
  test.each([
    "phone",
    "phoneNumber",
    "phoneNumbers",
    "callerPhoneNumber",
    "otherPhoneNumbers",
    "twilioPrimaryPhoneNumber",
    "legacyPhoneNumber",
    "routingPhoneNumber",
    "phoneNumberText",
  ])("%s does", (name: string) => {
    expect(isPhoneNumberName(name)).toBe(true);
  });

  test.each([
    "isPhone",
    "isPhoneView",
    "hasPhoneNumber",
    "showPhoneNumbers",
    "PHONE_BELOW_WIDTH_IN_PX",
    "phoneNumberCount",
    "phoneNumberId",
    "callProviderPhoneNumberId",
    "phoneNumberSid",
    "phoneNumberError",
    "phoneNumberLabel",
    "phoneNumberPlaceholder",
    "phoneNumberPurchasedAt",
    "phoneNumberCountryCode",
    "email",
    "name",
  ])("%s does not", (name: string) => {
    expect(isPhoneNumberName(name)).toBe(false);
  });
});
