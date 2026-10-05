import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import IconProp from "Common/Types/Icon/IconProp";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  SUBSCRIBE_PREFERENCES_COPY,
  SUBSCRIBE_PREFERENCES_SECTION_ID,
  SubscribePreferenceChoice,
  SubscribePreferenceOptions,
  getSubscribePreferenceChoices,
  getSubscribePreferenceFields,
  getSubscribePreferencesSection,
  getSubscribePreferencesSummaryKeys,
} from "../../FeatureSet/StatusPage/src/Pages/Subscribe/SubscribePageUtils";

/*
 * Subscribing on a status page is one page: where to send updates, then -
 * on a page that lets subscribers choose resources or event types - the
 * Preferences section, folded to one line that says what the visitor will
 * get, and Subscribe. (It walked two steps for a while, and once a stepped
 * form's action moved to its last step only, a visitor who wanted
 * everything pressed Next before Subscribe.)
 *
 * The line, the section and the preference fields are plain functions,
 * called directly here. The five subscribe forms are read from their
 * sources, the way the other *Wiring.test.ts files here read theirs:
 * rendering them needs the Status Page's own runtime (Common's
 * Tests/App/StatusPage/StatusPageSubscribeOnePage.test.tsx renders them).
 */

const SUBSCRIBE_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src/Pages/Subscribe",
);

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/StatusPage/src/Locales",
);

const BOTH: SubscribePreferenceOptions = {
  allowSubscribersToChooseResources: true,
  allowSubscribersToChooseEventTypes: true,
};

const RESOURCES_ONLY: SubscribePreferenceOptions = {
  allowSubscribersToChooseResources: true,
  allowSubscribersToChooseEventTypes: false,
};

const EVENT_TYPES_ONLY: SubscribePreferenceOptions = {
  allowSubscribersToChooseResources: false,
  allowSubscribersToChooseEventTypes: true,
};

const NEITHER: SubscribePreferenceOptions = {
  allowSubscribersToChooseResources: false,
  allowSubscribersToChooseEventTypes: false,
};

const SUMMARY: typeof SUBSCRIBE_PREFERENCES_COPY.summary =
  SUBSCRIBE_PREFERENCES_COPY.summary;

function translate(key: string): string {
  return `[${key}]`;
}

function values(
  record: Record<string, unknown>,
): FormValues<StatusPageSubscriber> {
  return record as FormValues<StatusPageSubscriber>;
}

// What a form that has just put its defaults in holds.
const UNTOUCHED: FormValues<StatusPageSubscriber> = values({
  isSubscribedToAllResources: true,
  isSubscribedToAllEventTypes: true,
});

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function fieldKey(field: Field<StatusPageSubscriber>): string {
  return Object.keys(field.field || {})[0] || "";
}

describe("what a subscription takes, of what the page lets subscribers choose", () => {
  test("everything, as the form starts and before its defaults are in", () => {
    for (const formValues of [UNTOUCHED, values({}), undefined]) {
      expect(
        getSubscribePreferenceChoices({ ...BOTH, values: formValues }),
      ).toEqual({
        resources: SubscribePreferenceChoice.All,
        eventTypes: SubscribePreferenceChoice.All,
      });
    }
  });

  test("only an unticked box narrows anything down", () => {
    expect(
      getSubscribePreferenceChoices({
        ...BOTH,
        values: values({
          isSubscribedToAllResources: false,
          statusPageResources: ["checkout"],
          isSubscribedToAllEventTypes: true,
          // Picks left over under a ticked box count for nothing.
          statusPageEventTypes: ["Incident"],
        }),
      }),
    ).toEqual({
      resources: SubscribePreferenceChoice.Picked,
      eventTypes: SubscribePreferenceChoice.All,
    });
  });

  test("an unticked box with nothing picked under it is none", () => {
    for (const picks of [undefined, null, [], "checkout"]) {
      expect(
        getSubscribePreferenceChoices({
          ...BOTH,
          values: values({
            isSubscribedToAllResources: false,
            statusPageResources: picks,
            isSubscribedToAllEventTypes: false,
            statusPageEventTypes: picks,
          }),
        }),
      ).toEqual({
        resources: SubscribePreferenceChoice.None,
        eventTypes: SubscribePreferenceChoice.None,
      });
    }
  });

  test("picks of either shape the form holds count: ids, or picked options", () => {
    expect(
      getSubscribePreferenceChoices({
        ...BOTH,
        values: values({
          isSubscribedToAllResources: false,
          statusPageResources: ["checkout", "website"],
          isSubscribedToAllEventTypes: false,
          statusPageEventTypes: [{ label: "Incident", value: "Incident" }],
        }),
      }),
    ).toEqual({
      resources: SubscribePreferenceChoice.Picked,
      eventTypes: SubscribePreferenceChoice.Picked,
    });
  });

  test("a kind the page offers no choice of is everything, whatever the values say", () => {
    const narrowed: FormValues<StatusPageSubscriber> = values({
      isSubscribedToAllResources: false,
      isSubscribedToAllEventTypes: false,
    });

    expect(
      getSubscribePreferenceChoices({ ...NEITHER, values: narrowed }),
    ).toEqual({
      resources: SubscribePreferenceChoice.All,
      eventTypes: SubscribePreferenceChoice.All,
    });
    expect(
      getSubscribePreferenceChoices({ ...RESOURCES_ONLY, values: narrowed })
        .eventTypes,
    ).toBe(SubscribePreferenceChoice.All);
    expect(
      getSubscribePreferenceChoices({ ...EVENT_TYPES_ONLY, values: narrowed })
        .resources,
    ).toBe(SubscribePreferenceChoice.All);
  });
});

describe("the line folded Preferences shows", () => {
  const cases: Array<{
    name: string;
    options: SubscribePreferenceOptions;
    values: Record<string, unknown>;
    keys: Array<string>;
  }> = [
    {
      name: "every update, as the form starts",
      options: BOTH,
      values: {
        isSubscribedToAllResources: true,
        isSubscribedToAllEventTypes: true,
      },
      keys: [SUMMARY.everything],
    },
    {
      name: "every update, on a page that lets subscribers choose resources only",
      options: RESOURCES_ONLY,
      values: { isSubscribedToAllResources: true },
      keys: [SUMMARY.everything],
    },
    {
      name: "every update, on a page that lets subscribers choose event types only",
      options: EVENT_TYPES_ONLY,
      values: { isSubscribedToAllEventTypes: true },
      keys: [SUMMARY.everything],
    },
    {
      name: "the resources picked",
      options: BOTH,
      values: {
        isSubscribedToAllResources: false,
        statusPageResources: ["checkout"],
        isSubscribedToAllEventTypes: true,
      },
      keys: [SUMMARY.pickedResources],
    },
    {
      name: "the resources picked, on a page that offers no choice of event types",
      options: RESOURCES_ONLY,
      values: {
        isSubscribedToAllResources: false,
        statusPageResources: ["checkout"],
      },
      keys: [SUMMARY.pickedResources],
    },
    {
      name: "the event types picked",
      options: BOTH,
      values: {
        isSubscribedToAllResources: true,
        isSubscribedToAllEventTypes: false,
        statusPageEventTypes: ["Incident"],
      },
      keys: [SUMMARY.pickedEventTypes],
    },
    {
      name: "the event types picked, on a page that offers no choice of resources",
      options: EVENT_TYPES_ONLY,
      values: {
        isSubscribedToAllEventTypes: false,
        statusPageEventTypes: ["Incident", "Announcement"],
      },
      keys: [SUMMARY.pickedEventTypes],
    },
    {
      name: "both picked",
      options: BOTH,
      values: {
        isSubscribedToAllResources: false,
        statusPageResources: ["checkout"],
        isSubscribedToAllEventTypes: false,
        statusPageEventTypes: ["Incident"],
      },
      keys: [SUMMARY.pickedResourcesAndEventTypes],
    },
    {
      name: "no resources picked yet",
      options: BOTH,
      values: {
        isSubscribedToAllResources: false,
        statusPageResources: [],
        isSubscribedToAllEventTypes: true,
      },
      keys: [SUMMARY.noResources],
    },
    {
      name: "no event types picked yet, whatever the resources",
      options: BOTH,
      values: {
        isSubscribedToAllResources: false,
        statusPageResources: ["checkout"],
        isSubscribedToAllEventTypes: false,
      },
      keys: [SUMMARY.noEventTypes],
    },
    {
      name: "neither picked yet: both said, resources first",
      options: BOTH,
      values: {
        isSubscribedToAllResources: false,
        isSubscribedToAllEventTypes: false,
      },
      keys: [SUMMARY.noResources, SUMMARY.noEventTypes],
    },
  ];

  test.each(cases)("says $name", (row: (typeof cases)[number]) => {
    expect(
      getSubscribePreferencesSummaryKeys({
        ...row.options,
        values: values(row.values),
      }),
    ).toEqual(row.keys);
  });

  test("is one sentence whenever something is picked", () => {
    for (const row of cases) {
      const keys: Array<string> = getSubscribePreferencesSummaryKeys({
        ...row.options,
        values: values(row.values),
      });

      if (
        !keys.includes(SUMMARY.noResources) &&
        !keys.includes(SUMMARY.noEventTypes)
      ) {
        expect(keys).toHaveLength(1);
      }
    }
  });
});

describe("the Preferences section", () => {
  test("is not there on a page that lets subscribers choose nothing", () => {
    expect(
      getSubscribePreferencesSection({ ...NEITHER, translate }),
    ).toBeUndefined();
  });

  test.each([
    ["resources and event types", BOTH],
    ["resources", RESOURCES_ONLY],
    ["event types", EVENT_TYPES_ONLY],
  ])(
    "is the shared folded section on a page that lets subscribers choose %s",
    (_name: string, options: SubscribePreferenceOptions) => {
      const section: FormFieldCollapsibleSection<StatusPageSubscriber> =
        getSubscribePreferencesSection({ ...options, translate })!;

      expect(section.id).toBe(SUBSCRIBE_PREFERENCES_SECTION_ID);
      // The page's own words, in the visitor's language.
      expect(section.title).toBe(`[${SUBSCRIBE_PREFERENCES_COPY.title}]`);
      expect(section.description).toBe(
        `[${SUBSCRIBE_PREFERENCES_COPY.description}]`,
      );
      expect(section.icon).toBe(IconProp.Bell);
      /*
       * Named for what it holds, it says its line while folded, not a list
       * of field names (that is More fields), and it is not one: it starts
       * folded because nothing in it is set, and opens on an error inside.
       */
      expect(section.listFieldsWhileFolded).toBeUndefined();
      expect(section.openWhenConfigured).toBeUndefined();
      expect(section.isConfigured).toBeUndefined();
      expect(section.title).not.toMatch(/advanced|more fields/i);
    },
  );

  test("folded, says the line in the visitor's language, following the values", () => {
    const section: FormFieldCollapsibleSection<StatusPageSubscriber> =
      getSubscribePreferencesSection({ ...BOTH, translate })!;

    expect(section.getSummary?.(UNTOUCHED)).toEqual([
      `[${SUMMARY.everything}]`,
    ]);
    expect(
      section.getSummary?.(
        values({
          isSubscribedToAllResources: false,
          statusPageResources: ["checkout"],
          isSubscribedToAllEventTypes: true,
        }),
      ),
    ).toEqual([`[${SUMMARY.pickedResources}]`]);
    expect(
      section.getSummary?.(
        values({
          isSubscribedToAllResources: false,
          isSubscribedToAllEventTypes: false,
        }),
      ),
    ).toEqual([`[${SUMMARY.noResources}]`, `[${SUMMARY.noEventTypes}]`]);
  });

  test("judges the values by what the page lets subscribers choose", () => {
    const section: FormFieldCollapsibleSection<StatusPageSubscriber> =
      getSubscribePreferencesSection({ ...RESOURCES_ONLY, translate })!;

    // An event type box the page never showed cannot narrow anything.
    expect(
      section.getSummary?.(
        values({
          isSubscribedToAllResources: true,
          isSubscribedToAllEventTypes: false,
        }),
      ),
    ).toEqual([`[${SUMMARY.everything}]`]);
  });
});

describe("the preference fields", () => {
  const resourceOptions: {
    categories: Array<{ id: string; title: string }>;
    options: Array<{ value: string; label: string; categoryId: string }>;
  } = {
    categories: [],
    options: [{ value: "checkout", label: "Checkout API", categoryId: "" }],
  };

  const eventTypeOptions: Array<{ value: string; label: string }> = [
    { value: "Incident", label: "Incident" },
  ];

  function fieldsFor(
    options: SubscribePreferenceOptions,
  ): Array<Field<StatusPageSubscriber>> {
    return getSubscribePreferenceFields({
      ...options,
      translate,
      resourceOptions,
      eventTypeOptions,
    });
  }

  test("are none on a page that lets subscribers choose nothing", () => {
    expect(fieldsFor(NEITHER)).toEqual([]);
  });

  test("ask about resources, then event types, each 'all' box ticked", () => {
    const fields: Array<Field<StatusPageSubscriber>> = fieldsFor(BOTH);

    expect(fields.map(fieldKey)).toEqual([
      "isSubscribedToAllResources",
      "statusPageResources",
      "isSubscribedToAllEventTypes",
      "statusPageEventTypes",
    ]);
    expect(
      fields.map((field: Field<StatusPageSubscriber>): string => {
        return field.title || "";
      }),
    ).toEqual([
      "[subscribe.resources.all]",
      "[subscribe.resources.select]",
      "[subscribe.eventTypes.all]",
      "[subscribe.eventTypes.select]",
    ]);
    expect(fields[0]!.fieldType).toBe(FormFieldSchemaType.Checkbox);
    expect(fields[0]!.defaultValue).toBe(true);
    expect(fields[1]!.fieldType).toBe(FormFieldSchemaType.CategoryCheckbox);
    expect(fields[1]!.categoryCheckboxProps).toBe(resourceOptions);
    expect(fields[2]!.fieldType).toBe(FormFieldSchemaType.Checkbox);
    expect(fields[2]!.defaultValue).toBe(true);
    expect(fields[3]!.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(fields[3]!.dropdownOptions).toBe(eventTypeOptions);

    // Nothing is required: Subscribe works with the address alone.
    for (const field of fields) {
      expect(field.required).toBe(false);
      expect(field.stepId).toBeUndefined();
    }
  });

  test("all sit in the one Preferences section", () => {
    const fields: Array<Field<StatusPageSubscriber>> = fieldsFor(BOTH);
    const section: FormFieldCollapsibleSection<StatusPageSubscriber> =
      fields[0]!.collapsibleSection!;

    expect(section.id).toBe(SUBSCRIBE_PREFERENCES_SECTION_ID);

    for (const field of fields) {
      // One object: BasicForm draws fields next to each other in one section.
      expect(field.collapsibleSection).toBe(section);
    }
  });

  test("show each picker only once its 'all' box is unticked", () => {
    const fields: Array<Field<StatusPageSubscriber>> = fieldsFor(BOTH);
    const resources: Field<StatusPageSubscriber> = fields[1]!;
    const eventTypes: Field<StatusPageSubscriber> = fields[3]!;

    expect(resources.showIf?.(UNTOUCHED)).toBe(false);
    expect(eventTypes.showIf?.(UNTOUCHED)).toBe(false);
    expect(
      resources.showIf?.(values({ isSubscribedToAllResources: false })),
    ).toBe(true);
    expect(
      eventTypes.showIf?.(values({ isSubscribedToAllEventTypes: false })),
    ).toBe(true);
  });

  test("ask only about what the page lets subscribers choose", () => {
    expect(fieldsFor(RESOURCES_ONLY).map(fieldKey)).toEqual([
      "isSubscribedToAllResources",
      "statusPageResources",
    ]);
    expect(fieldsFor(EVENT_TYPES_ONLY).map(fieldKey)).toEqual([
      "isSubscribedToAllEventTypes",
      "statusPageEventTypes",
    ]);
  });
});

describe("the status page's locales", () => {
  type LocaleFile = {
    subscribe: {
      steps?: unknown;
      preferences?: {
        title?: string;
        description?: string;
        summary?: Record<string, string>;
      };
    };
  };

  const english: LocaleFile = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
  );

  const files: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    });

  test("are really read", () => {
    expect(files.length).toBe(17);
  });

  test.each(files)(
    "%s says Preferences and every line of it",
    (file: string) => {
      const locale: LocaleFile = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
      );

      const preferences: LocaleFile["subscribe"]["preferences"] =
        locale.subscribe.preferences;

      expect(preferences?.title).toBeTruthy();
      expect(preferences?.description).toBeTruthy();

      for (const key of Object.keys(SUMMARY)) {
        const sentence: string | undefined = preferences?.summary?.[key];

        expect(sentence).toBeTruthy();

        if (file !== "en.json") {
          // Translated, not left in English.
          expect(sentence).not.toBe(
            english.subscribe.preferences?.summary?.[key],
          );
        }
      }

      // Each line says something different.
      expect(new Set(Object.values(preferences?.summary || {})).size).toBe(
        Object.keys(SUMMARY).length,
      );

      // No step titles are left: the form has no steps.
      expect(locale.subscribe.steps).toBeUndefined();
    },
  );

  test("hold every key the code looks up", () => {
    const lookUp: (key: string) => unknown = (key: string): unknown => {
      let node: unknown = english;

      for (const part of key.split(".")) {
        node =
          node !== null && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined;
      }

      return node;
    };

    for (const key of [
      SUBSCRIBE_PREFERENCES_COPY.title,
      SUBSCRIBE_PREFERENCES_COPY.description,
      ...Object.values(SUMMARY),
    ]) {
      expect(typeof lookUp(key)).toBe("string");
    }
  });
});

interface SubscribeFormCase {
  page: string;
  contactKeys: Array<string>;
}

const SUBSCRIBE_FORMS: Array<SubscribeFormCase> = [
  { page: "EmailSubscribe.tsx", contactKeys: ["subscriberEmail"] },
  { page: "SmsSubscribe.tsx", contactKeys: ["subscriberPhone"] },
  { page: "WebhookSubscribe.tsx", contactKeys: ["subscriberWebhook"] },
  {
    page: "SlackSubscribe.tsx",
    contactKeys: ["slackWorkspaceName", "slackIncomingWebhookUrl"],
  },
  {
    page: "MicrosoftTeamsSubscribe.tsx",
    contactKeys: [
      "microsoftTeamsWorkspaceName",
      "microsoftTeamsIncomingWebhookUrl",
    ],
  },
];

describe.each(SUBSCRIBE_FORMS)("$page", (formCase: SubscribeFormCase) => {
  const source: string = squash(
    fs.readFileSync(path.join(SUBSCRIBE_DIR, formCase.page), "utf8"),
  );

  const newSubscriptionForm: string =
    source
      .split("getNewSubscriptionContentElement: GetReactElementFunction")[1]
      ?.split("</ModelForm>")[0] || "";

  test("asks where to send updates, then folds the preferences after it", () => {
    for (const key of formCase.contactKeys) {
      expect(source).toContain(squash(`field: { ${key}: true, }`));
    }

    expect(source).toContain(
      squash(`...getSubscribePreferenceFields({
      allowSubscribersToChooseResources: Boolean(
        props.allowSubscribersToChooseResources,
      ),
      allowSubscribersToChooseEventTypes: Boolean(
        props.allowSubscribersToChooseEventTypes,
      ),
      translate: (key: string): string => {
        return t(key);
      },
      resourceOptions: categoryCheckboxOptionsAndCategories,
      eventTypeOptions: SubscriberUtil.getDropdownPropsBasedOnEventTypes(),
    }),
  ];`),
    );
  });

  test("is one page: no steps, and the form's one button is Subscribe", () => {
    expect(newSubscriptionForm).toContain("fields={fields}");
    expect(newSubscriptionForm).toContain(
      'submitButtonText={t("subscribe.submit")}',
    );
    expect(newSubscriptionForm).not.toContain("steps=");
    expect(source).not.toContain("stepId");
    expect(source).not.toContain("getSubscribeFormSteps");
    expect(source).not.toContain("FormStep");
  });

  test("writes no preference field of its own", () => {
    for (const key of [
      "isSubscribedToAllResources",
      "statusPageResources",
      "isSubscribedToAllEventTypes",
      "statusPageEventTypes",
    ]) {
      expect(source).not.toContain(`${key}: true`);
    }
  });

  test("keeps the manage-subscription form a single field, with no steps", () => {
    const manageForm: string =
      source.split("getManageExistingSubscriptionContentElement")[1] || "";

    if (manageForm) {
      expect(manageForm.split("</ModelForm>")[0] || "").not.toContain("steps=");
    }
  });
});

/*
 * The Update Subscription page, opened from a link in a message, is where a
 * subscriber comes to change exactly these choices - or to unsubscribe - so
 * they stay open there, on one page, not folded.
 */
describe("UpdateSubscription.tsx", () => {
  const source: string = squash(
    fs.readFileSync(path.join(SUBSCRIBE_DIR, "UpdateSubscription.tsx"), "utf8"),
  );

  test("shows the preferences open, beside Unsubscribe", () => {
    expect(source).not.toContain("collapsibleSection");
    expect(source).not.toContain("getSubscribePreferenceFields");
    expect(source).not.toContain("steps=");

    for (const key of [
      "isSubscribedToAllResources",
      "statusPageResources",
      "isSubscribedToAllEventTypes",
      "statusPageEventTypes",
      "isUnsubscribed",
    ]) {
      expect(source).toContain(`${key}: true`);
    }
  });
});
