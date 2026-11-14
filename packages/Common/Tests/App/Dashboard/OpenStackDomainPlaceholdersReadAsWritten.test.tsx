import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { JSONObject } from "../../../Types/JSON";

/*
 * AN OPENSTACK DOMAIN FIELD'S PLACEHOLDER IS KEYSTONE'S OWN NAME FOR THE
 * DEFAULT DOMAIN, IN EVERY LANGUAGE (#7663).
 *
 * A login's User Domain and Project Domain start as the domain Keystone
 * calls "Default", which their placeholder shows; a rule scoped to a domain
 * names it by its ID, and the default domain's is "default". The form
 * looked the placeholders up as words: German read "Normal" ("Default" is
 * "Standard", and "Standard" a word of its own), Spanish "Predeterminado",
 * and an admin who typed what the placeholder showed named a domain no
 * cloud has, so the connection failed.
 *
 * Every OpenStack form that asks for a domain - Connect Cloud, Edit
 * Connection, the API and lifecycle checks, a rule's scope - as its code
 * builds it, each domain field drawn the way a form draws it (FormField,
 * then Input), with the Dashboard's own locale files: the placeholder reads
 * as Keystone names it.
 */

import {
  getOpenStackApiCheckFormFields,
  getOpenStackLifecycleCheckFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackCheckFormFields";
import {
  getOpenStackConnectFormFields,
  getOpenStackConnectionFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackConnectionFormFields";
import { getOpenStackRuleScopeFields } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRuleScope";
import FormField from "../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const LANGUAGES: Array<string> = ["de", "es"];

// Keystone's default domain: its name, and its ID.
const DOMAIN_NAME: string = "Default";
const DOMAIN_ID: string = "default";

type AnyField = Field<JSONObject>;

const ENGLISH: Translator = createTranslator(undefined, "en");

// A word as a shared component looks it up (UI/Utils/Translation).
function word(text: string): string {
  return i18next.t(text, {
    defaultValue: text,
    keySeparator: false,
    nsSeparator: false,
  });
}

function keyOf(field: AnyField): string {
  return Object.keys(field.field || {})[0] || "";
}

// Each OpenStack form that asks for a domain, as its code builds it.
function forms(): Array<[string, Array<AnyField>]> {
  const options: {
    probes: [];
    isBillingEnabled: boolean;
    translator: Translator;
  } = { probes: [], isBillingEnabled: true, translator: ENGLISH };

  return [
    [
      "Connect Cloud",
      getOpenStackConnectFormFields(options) as unknown as Array<AnyField>,
    ],
    [
      "Edit Connection",
      getOpenStackConnectionFormFields(options) as unknown as Array<AnyField>,
    ],
    [
      "API checks",
      getOpenStackApiCheckFormFields({
        ...options,
        isConnectionNeeded: true,
        isCredentialSaved: false,
      }) as unknown as Array<AnyField>,
    ],
    [
      "Lifecycle check",
      getOpenStackLifecycleCheckFormFields({
        ...options,
        isConnectionNeeded: false,
        isCredentialSaved: false,
      }) as unknown as Array<AnyField>,
    ],
    [
      "A rule's scope",
      getOpenStackRuleScopeFields<JSONObject>("owners") as Array<AnyField>,
    ],
  ];
}

// The fields of a form whose placeholder names the default domain.
function domainFields(fields: Array<AnyField>): Array<AnyField> {
  return fields.filter((field: AnyField): boolean => {
    return field.placeholder === DOMAIN_NAME || field.placeholder === DOMAIN_ID;
  });
}

// A login by user name and password: the one that asks for its domains.
const PASSWORD_LOGIN: JSONObject = { credentialKind: "password" };

async function drawnPlaceholder(field: AnyField): Promise<string> {
  // Asked for, as the form asks for it.
  expect(
    !field.showIf || field.showIf(PASSWORD_LOGIN as FormValues<JSONObject>),
  ).toBe(true);

  const view: ReturnType<typeof render> = render(
    <FormField<JSONObject>
      field={field}
      fieldName={keyOf(field)}
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={PASSWORD_LOGIN as FormValues<JSONObject>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
      disableAutofocus={true}
    />,
  );

  await act(async () => {
    await Promise.resolve();
  });

  const input: HTMLInputElement | null = view.container.querySelector("input");

  expect(input).not.toBeNull();

  const placeholder: string = input!.placeholder;

  cleanup();

  return placeholder;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readDashboardLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("the OpenStack forms that ask for a domain", () => {
  test("are these, and each names the default domain in its placeholder", () => {
    expect(
      forms().map(([form, fields]: [string, Array<AnyField>]) => {
        return [
          form,
          domainFields(fields).map((field: AnyField) => {
            return [keyOf(field), field.placeholder];
          }),
        ];
      }),
    ).toEqual([
      [
        "Connect Cloud",
        [
          ["userDomainName", DOMAIN_NAME],
          ["projectDomainName", DOMAIN_NAME],
        ],
      ],
      [
        "Edit Connection",
        [
          ["userDomainName", DOMAIN_NAME],
          ["projectDomainName", DOMAIN_NAME],
        ],
      ],
      [
        "API checks",
        [
          ["userDomainName", DOMAIN_NAME],
          ["credentialProjectDomainName", DOMAIN_NAME],
        ],
      ],
      [
        "Lifecycle check",
        [
          ["userDomainName", DOMAIN_NAME],
          ["credentialProjectDomainName", DOMAIN_NAME],
        ],
      ],
      ["A rule's scope", [["openStackDomainId", DOMAIN_ID]]],
    ]);
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  test("the default domain's name and ID are words the language translates", async () => {
    await act(async () => {
      await i18next.changeLanguage(language);
    });

    expect(word(DOMAIN_NAME)).not.toBe(DOMAIN_NAME);
    expect(word(DOMAIN_ID)).not.toBe(DOMAIN_ID);
  });

  test("each domain field's placeholder reads as Keystone names the domain", async () => {
    await act(async () => {
      await i18next.changeLanguage(language);
    });

    const drawn: Array<[string, string, string]> = [];
    const written: Array<[string, string, string]> = [];

    for (const [form, fields] of forms()) {
      for (const field of domainFields(fields)) {
        written.push([form, keyOf(field), field.placeholder || ""]);
        drawn.push([form, keyOf(field), await drawnPlaceholder(field)]);
      }
    }

    expect(drawn.length).toBe(9);
    expect(drawn).toEqual(written);
  });
});
