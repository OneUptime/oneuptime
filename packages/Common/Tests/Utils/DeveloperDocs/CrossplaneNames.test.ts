import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  CROSSPLANE_GROUP,
  CROSSPLANE_PROVIDER_CONFIG_API_VERSION,
  CROSSPLANE_RESOURCE_API_VERSION,
  getCrossplaneFieldName,
  getCrossplaneKind,
  getCrossplaneReferenceFieldName,
  getCrossplaneSecretRefFieldName,
  getCrossplaneSelectorFieldName,
  splitCamelCase,
  strcaseToCamel,
  upjetNameFromCamel,
  upjetNameFromSnake,
} from "../../../Utils/DeveloperDocs/CrossplaneNames";

/*
 * The names the dashboard's Developer > Crossplane pages write are the
 * generated provider's: the kinds internal/kinds names, the fields Upjet's
 * pkg/types/name makes from the Terraform attributes. The provider's own Go
 * test pins its naming with a table of cases (internal/kinds/kinds_test.go,
 * copied into every generated provider as it is): this reads that table,
 * so the two can never disagree on a case either has.
 */

const STATIC_FILES: string = path.resolve(
  __dirname,
  "../../../../../Scripts/CrossplaneProvider/StaticFiles",
);

function readStatic(file: string): string {
  return fs.readFileSync(path.join(STATIC_FILES, file), "utf8");
}

/*
 * The `"input": "output",` pairs of one Go test's `cases` map, by the
 * test's name.
 */
function goCases(source: string, testName: string): Array<[string, string]> {
  const start: number = source.indexOf(`func ${testName}(`);

  if (start < 0) {
    throw new Error(`kinds_test.go has no ${testName}`);
  }

  const body: string = source.slice(start, source.indexOf("\n}\n", start));
  const cases: Array<[string, string]> = Array.from(
    body.matchAll(/^\s*"([a-z0-9_]+)":\s*"([A-Za-z0-9]+)",$/gm),
  ).map((match: RegExpMatchArray): [string, string] => {
    return [match[1] as string, match[2] as string];
  });

  if (cases.length === 0) {
    throw new Error(`${testName} has no cases`);
  }

  return cases;
}

const KINDS_TEST: string = readStatic("internal/kinds/kinds_test.go");

describe("kinds, as internal/kinds.Of names them", () => {
  test.each(goCases(KINDS_TEST, "TestOf"))(
    "%s is %s",
    (terraformName: string, kind: string) => {
      expect(getCrossplaneKind(terraformName)).toBe(kind);
    },
  );

  test("the Go test's table is the one read: it has the cases the issue names", () => {
    const cases: Map<string, string> = new Map(goCases(KINDS_TEST, "TestOf"));

    expect(cases.get("oneuptime_monitor_status")).toBe(
      "MonitorStatusDefinition",
    );
    expect(cases.get("oneuptime_api_key")).toBe("APIKey");
    expect(cases.size).toBeGreaterThanOrEqual(10);
  });

  test("a kind never ends in a word Upjet adds to a kind's own types", () => {
    for (const terraformName of [
      "oneuptime_x_spec",
      "oneuptime_x_status",
      "oneuptime_x_list",
      "oneuptime_incident_state_list",
    ]) {
      const kind: string = getCrossplaneKind(terraformName);

      expect(kind.endsWith("Definition")).toBe(true);
      expect(kind).not.toMatch(/(Spec|Status|List)$/);
    }
  });

  test("Upjet's acronyms are in capitals, wherever they are", () => {
    expect(getCrossplaneKind("oneuptime_ai_agent")).toBe("AIAgent");
    expect(getCrossplaneKind("oneuptime_slo_error_budget_policy")).toBe(
      "SLOErrorBudgetPolicy",
    );
    expect(getCrossplaneKind("oneuptime_status_page_sso")).toBe(
      "StatusPageSso",
    );
    expect(getCrossplaneKind("oneuptime_incident_sla")).toBe("IncidentSLA");
    expect(getCrossplaneKind("oneuptime_ip_address")).toBe("IPAddress");
    expect(getCrossplaneKind("oneuptime_dns_record")).toBe("DNSRecord");
    expect(getCrossplaneKind("oneuptime_sms_log")).toBe("SMSLog");
    expect(getCrossplaneKind("oneuptime_database_server")).toBe(
      "DatabaseServer",
    );
    expect(getCrossplaneKind("oneuptime_ipv4_range")).toBe("IPv4Range");
  });

  test("a word with a digit capitalises the letter after it, as strcase does", () => {
    expect(getCrossplaneKind("oneuptime_oauth2_client")).toBe("Oauth2Client");
    expect(getCrossplaneKind("oneuptime_e2e_test")).toBe("E2ETest");
  });
});

describe("fields, as internal/kinds.FieldName names them", () => {
  test.each(goCases(KINDS_TEST, "TestFieldName"))(
    "%s is %s",
    (attribute: string, field: string) => {
      expect(getCrossplaneFieldName(attribute)).toBe(field);
    },
  );

  test("no acronym is written in capitals in a field", () => {
    expect(getCrossplaneFieldName("api_key_id")).toBe("apiKeyId");
    expect(getCrossplaneFieldName("monitor_destination_type")).toBe(
      "monitorDestinationType",
    );
    expect(getCrossplaneFieldName("request_timeout_in_ms")).toBe(
      "requestTimeoutInMs",
    );
    expect(getCrossplaneFieldName("is_slo")).toBe("isSlo");
    expect(getCrossplaneFieldName("ipv4_address")).toBe("ipv4Address");
  });

  test("a name Terraform reserves keeps the _value the provider gives it", () => {
    expect(getCrossplaneFieldName("provider_value")).toBe("providerValue");
  });
});

describe("references and secrets", () => {
  test("a field that holds an ID takes <field>Ref, a list of IDs <field>Refs", () => {
    expect(getCrossplaneReferenceFieldName("monitor_status_id", false)).toBe(
      "monitorStatusIdRef",
    );
    expect(getCrossplaneReferenceFieldName("labels", true)).toBe("labelsRefs");
    expect(getCrossplaneReferenceFieldName("label_ids", true)).toBe(
      "labelIdsRefs",
    );
    expect(getCrossplaneReferenceFieldName("owner_team_ids", true)).toBe(
      "ownerTeamIdsRefs",
    );
    expect(getCrossplaneSelectorFieldName("labels")).toBe("labelsSelector");
    expect(getCrossplaneSelectorFieldName("incident_severity_id")).toBe(
      "incidentSeverityIdSelector",
    );
  });

  test("a secret takes <field>SecretRef, its name split back into words", () => {
    expect(getCrossplaneSecretRefFieldName("tls_client_key_passphrase")).toBe(
      "tlsClientKeyPassphraseSecretRef",
    );
    expect(getCrossplaneSecretRefFieldName("tls_client_key")).toBe(
      "tlsClientKeySecretRef",
    );
    expect(getCrossplaneSecretRefFieldName("password")).toBe(
      "passwordSecretRef",
    );
    expect(getCrossplaneSecretRefFieldName("api_key")).toBe("apiKeySecretRef");
    expect(getCrossplaneSecretRefFieldName("client_secret")).toBe(
      "clientSecretSecretRef",
    );
  });

  test("an acronym with a digit splits as Upjet splits it, not as the field does", () => {
    // IPv4Address splits into I, Pv, 4, Address.
    expect(getCrossplaneSecretRefFieldName("ipv4_address")).toBe(
      "iPv4AddressSecretRef",
    );
    expect(getCrossplaneSecretRefFieldName("oauth2_client_secret")).toBe(
      "oauth2ClientSecretSecretRef",
    );
  });
});

describe("Upjet's name package", () => {
  // Its own test's cases (pkg/types/name/name_test.go, upjet v2.5.1).
  test.each([
    ["some_snake", "SomeSnake", "SomeSnake", "someSnake", "someSnake"],
    ["id_setting", "IDSetting", "IdSetting", "idSetting", "idSetting"],
    [
      "some_api_param",
      "SomeAPIParam",
      "SomeApiParam",
      "someAPIParam",
      "someApiParam",
    ],
    ["subnet_id", "SubnetID", "SubnetId", "subnetID", "subnetId"],
    ["ip", "IP", "Ip", "ip", "ip"],
  ])(
    "NewFromSnake(%s)",
    (
      snake: string,
      camel: string,
      camelComputed: string,
      lowerCamel: string,
      lowerCamelComputed: string,
    ) => {
      expect(upjetNameFromSnake(snake)).toEqual({
        snake,
        camel,
        camelComputed,
        lowerCamel,
        lowerCamelComputed,
      });
    },
  );

  test.each([
    ["SomeCamel", "some_camel"],
    ["IDSetting", "id_setting"],
    ["SomeAPIParam", "some_api_param"],
    ["SubnetID", "subnet_id"],
    ["IP", "ip"],
  ])("NewFromCamel(%s)", (camel: string, snake: string) => {
    expect(upjetNameFromCamel(camel).snake).toBe(snake);
  });

  // fatih/camelcase's own examples.
  test.each([
    ["lowercase", ["lowercase"]],
    ["Class", ["Class"]],
    ["MyClass", ["My", "Class"]],
    ["MyC", ["My", "C"]],
    ["HTML", ["HTML"]],
    ["PDFLoader", ["PDF", "Loader"]],
    ["AString", ["A", "String"]],
    ["SimpleXMLParser", ["Simple", "XML", "Parser"]],
    ["vimRPCPlugin", ["vim", "RPC", "Plugin"]],
    ["GL11Version", ["GL", "11", "Version"]],
    ["99Bottles", ["99", "Bottles"]],
    ["May5", ["May", "5"]],
    ["BFG9000", ["BFG", "9000"]],
    ["BöseÜberraschung", ["Böse", "Überraschung"]],
    ["Two  spaces", ["Two", "  ", "spaces"]],
  ])("camelcase.Split(%s)", (value: string, words: Array<string>) => {
    expect(splitCamelCase(value)).toEqual(words);
  });

  test("strcase.ToCamel as Upjet calls it on each word", () => {
    expect(strcaseToCamel("monitor")).toBe("Monitor");
    expect(strcaseToCamel("oauth2")).toBe("Oauth2");
    expect(strcaseToCamel("e2e")).toBe("E2E");
    expect(strcaseToCamel("a.b-c d")).toBe("ABCD");
    expect(strcaseToCamel(" padded ")).toBe("Padded");
    expect(strcaseToCamel("")).toBe("");
  });
});

describe("the API group and versions", () => {
  test("are the ones config/provider.go and apis/v1beta1 register", () => {
    const providerGo: string = readStatic("config/provider.go");
    const registerGo: string = readStatic("apis/v1beta1/register.go");
    const shortGroup: string = providerGo.match(
      /^\s*ShortGroup\s*=\s*"([^"]+)"/m,
    )![1] as string;
    const rootGroup: string = providerGo.match(
      /^\s*RootGroup\s*=\s*"([^"]+)"/m,
    )![1] as string;
    const version: string = providerGo.match(
      /^\s*Version\s*=\s*"([^"]+)"/m,
    )![1] as string;
    const configVersion: string = registerGo.match(
      /^\s*Version\s*=\s*"([^"]+)"/m,
    )![1] as string;

    expect(CROSSPLANE_GROUP).toBe(`${shortGroup}.${rootGroup}`);
    expect(CROSSPLANE_RESOURCE_API_VERSION).toBe(
      `${CROSSPLANE_GROUP}/${version}`,
    );
    expect(CROSSPLANE_PROVIDER_CONFIG_API_VERSION).toBe(
      `${CROSSPLANE_GROUP}/${configVersion}`,
    );
  });
});
