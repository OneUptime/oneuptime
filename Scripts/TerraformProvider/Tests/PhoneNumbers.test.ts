import fs from "fs";
import os from "os";
import path from "path";
import Phone from "Common/Types/Phone";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import {
  PHONE_CASES_FILE,
  PhoneCase,
  PhoneCases,
  WRITTEN_PHONE_NUMBERS,
  buildPhoneCases,
  phoneCasesFile,
} from "../Core/PhoneCases";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../Core/Types";

/*
 * PHONE NUMBERS (OneUptime/oneuptime#7777).
 *
 * OneUptime keeps a phone number as written when Phone.ts's E.123 check
 * takes it, and any other as its digits: "+1 415 555 0100" is kept as
 * "+14155550100". The provider wrote a phone column as a JSON string compared
 * as written, so a number grouped the way people say it failed the apply
 * with "Provider produced inconsistent result after apply", and a number of
 * digits alone was sent as a JSON number.
 *
 * Now a phone column - the spec marks the Phone wrapper - is a plain string
 * of its own type (StaticFiles/phone.go): sent as the string a configuration
 * writes, read back from the wrapper, compared as OneUptime keeps it, kept in
 * the plan when the configuration writes the same number another way, and
 * refused at plan time when OneUptime would refuse it. The Go rule is checked
 * against cases the server's own code computes (Core/PhoneCases.ts).
 */

function phoneColumn(description: string, marked: boolean): any {
  return {
    type: "object",
    description: description,
    ...(marked ? { "x-oneuptime-type": "Phone" } : {}),
    example: { _type: "Phone", value: "+1-555-123-4567" },
  };
}

/*
 * A project's Twilio account, as the spec writes one: a phone number written
 * at create and update, one OneUptime sets, one from a spec without the
 * marker, and a Color - another wrapped value, which stays as it was.
 */
function buildPhoneSpec(): OpenAPISpec {
  const writable: Record<string, any> = {
    name: { type: "string", description: "Name of the config." },
    twilioPrimaryPhoneNumber: phoneColumn(
      "Primary Phone Number for your Twilio account.",
      true,
    ),
    twilioBackupPhoneNumber: phoneColumn("A number to fall back to.", false),
    color: {
      type: "object",
      description: "Color of the config.",
      example: { _type: "Color", value: "#ff0000" },
    },
  };
  const schemas: Record<string, any> = {
    ProjectCallSMSConfigCreateSchema: {
      type: "object",
      // A required number is in the docs' example.
      required: ["name", "twilioBackupPhoneNumber"],
      properties: writable,
    },
    ProjectCallSMSConfigUpdateSchema: {
      type: "object",
      properties: writable,
    },
    ProjectCallSMSConfig: {
      type: "object",
      properties: {
        _id: { type: "string", format: "uuid" },
        ...writable,
        routingPhoneNumber: phoneColumn("The number calls come in on.", true),
      },
    },
  };

  const reference: (name: string) => any = (name: string): any => {
    return { $ref: `#/components/schemas/${name}` };
  };
  const body: (name: string) => any = (name: string): any => {
    return {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: reference(name) } },
        },
      },
    };
  };
  const answer: any = {
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { data: reference("ProjectCallSMSConfig") },
          },
        },
      },
    },
  };
  const list: any = {
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: { type: "array", items: reference("ProjectCallSMSConfig") },
            },
          },
        },
      },
    },
  };
  const tag: string = "Call and SMS Config";
  const idParameter: any = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [{ name: tag, description: "A project's own Twilio account." }],
    paths: {
      "/call-sms-config": {
        post: {
          operationId: "createProjectCallSMSConfig",
          tags: [tag],
          requestBody: body("ProjectCallSMSConfigCreateSchema"),
          responses: answer,
        } as any,
      },
      "/call-sms-config/get-list": {
        post: {
          operationId: "listProjectCallSMSConfig",
          tags: [tag],
          responses: list,
        } as any,
      },
      "/call-sms-config/{id}/get-item": {
        post: {
          operationId: "getProjectCallSMSConfig",
          tags: [tag],
          parameters: [idParameter],
          responses: answer,
        } as any,
      },
      "/call-sms-config/{id}": {
        put: {
          operationId: "updateProjectCallSMSConfig",
          tags: [tag],
          parameters: [idParameter],
          requestBody: body("ProjectCallSMSConfigUpdateSchema"),
          responses: answer,
        } as any,
        delete: {
          operationId: "deleteProjectCallSMSConfig",
          tags: [tag],
          parameters: [idParameter],
          responses: answer,
        } as any,
      },
    },
    components: { schemas: schemas },
  };
}

// Printable ASCII and line breaks: a no-break space shows in a diff.
const PRINTABLE_ASCII: RegExp = /^[\x20-\x7e\n]*$/;

let outputDir: string;
let resource: TerraformResource;
let dataSource: TerraformDataSource;
let resourceGo: string;
let dataSourceGo: string;
let resourceDoc: string;

function attributeBlock(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);
  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }
  return source.substring(start, source.indexOf("\n            },\n", start));
}

function method(source: string, signature: string): string {
  const start: number = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`no ${signature}`);
  }
  return source.substring(start, source.indexOf("\n}\n", start));
}

beforeAll(async () => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildPhoneSpec());
  resource = parser.getResources()[0]!;
  dataSource = parser.getDataSources()[0]!;

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-phone-"));
  const config: any = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "14.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(config, buildPhoneSpec()).generateResources();
  await new DataSourceGenerator(config, buildPhoneSpec()).generateDataSources();
  await new DocumentationGenerator(
    config,
    buildPhoneSpec(),
  ).generateDocumentation();

  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(outputDir, file), "utf-8");
  };
  resourceGo = read("internal/provider/resource_call_and_sms_config.go");
  dataSourceGo = read("internal/provider/data_source_call_and_sms_config.go");
  resourceDoc = read("docs/resources/call_and_sms_config.md");
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("a phone column in the spec", () => {
  test("is a phone number: a plain string, not JSON", () => {
    for (const name of [
      "twilio_primary_phone_number",
      // A spec without the marker: the wrapper's example says it.
      "twilio_backup_phone_number",
      "routing_phone_number",
    ]) {
      const attribute: TerraformAttribute | undefined = resource.schema[name];

      expect([name, attribute?.type, attribute?.isPhone]).toEqual([
        name,
        "string",
        true,
      ]);
      expect([name, attribute?.isComplexObject]).toEqual([name, undefined]);
    }

    // Another wrapped value is JSON as it was.
    expect(resource.schema["color"]?.isPhone).toBeUndefined();
    expect(resource.schema["color"]?.isComplexObject).toBe(true);
  });

  test("is read by the data source, which looks nothing up by it", () => {
    for (const name of [
      "twilio_primary_phone_number",
      "twilio_backup_phone_number",
      "routing_phone_number",
    ]) {
      expect([name, dataSource.schema[name]?.isPhone]).toEqual([name, true]);
      expect([name, dataSource.schema[name]?.isLookupFilter]).toEqual([
        name,
        undefined,
      ]);

      const block: string = attributeBlock(dataSourceGo, name);
      expect(block).toContain("Computed: true");
      expect(block).not.toContain("Optional: true");
    }

    // A plain string looks a config up, as before.
    expect(dataSource.schema["name"]?.isLookupFilter).toBe(true);
  });
});

describe("the resource's phone number", () => {
  test("is a PhoneValue of PhoneType", () => {
    expect(resourceGo).toContain(
      'TwilioPrimaryPhoneNumber PhoneValue `tfsdk:"twilio_primary_phone_number"`',
    );
    expect(resourceGo).toContain(
      'RoutingPhoneNumber PhoneValue `tfsdk:"routing_phone_number"`',
    );

    for (const name of [
      "twilio_primary_phone_number",
      "twilio_backup_phone_number",
      "routing_phone_number",
    ]) {
      const block: string = attributeBlock(resourceGo, name);
      expect(block).toContain("CustomType: PhoneType{}");
      expect(block).not.toContain("JSONSubsetType");
      expect(block).not.toContain("JSONEnvelopeValidator()");
    }
    expect(attributeBlock(resourceGo, "color")).toContain(
      "CustomType: JSONSubsetType{}",
    );
  });

  test("a configuration writes is refused at plan time when OneUptime would refuse it", () => {
    const block: string = attributeBlock(
      resourceGo,
      "twilio_primary_phone_number",
    );
    expect(block).toContain("Validators: []validator.String{");
    expect(block).toContain("PhoneValidator()");
    expect(resourceGo).toContain(
      '"github.com/hashicorp/terraform-plugin-framework/schema/validator"',
    );

    // What only OneUptime sets is not validated.
    expect(attributeBlock(resourceGo, "routing_phone_number")).not.toContain(
      "PhoneValidator()",
    );
  });

  test("keeps the state's number in the plan when the configuration writes the same number another way", () => {
    const block: string = attributeBlock(
      resourceGo,
      "twilio_primary_phone_number",
    );
    expect(block).toContain("PhoneKeepSameNumber()");
    // First, so a modifier after it sees the number it kept.
    expect(block.indexOf("PhoneKeepSameNumber()")).toBeLessThan(
      block.indexOf("UseStateForUnknown()"),
    );

    expect(attributeBlock(resourceGo, "routing_phone_number")).not.toContain(
      "PhoneKeepSameNumber()",
    );
    expect(
      ResourceGenerator.getImportSettleModifier({
        type: "string",
        isPhone: true,
      }),
    ).toBe("PhoneKeepSameNumber()");
  });

  test("is sent as the string the configuration writes", () => {
    const create: string = method(
      resourceGo,
      "func (r *CallAndSmsConfigResource) Create",
    );
    expect(create).toContain(
      'requestDataMap["twilioPrimaryPhoneNumber"] = data.TwilioPrimaryPhoneNumber.ValueString()',
    );
    expect(create).not.toContain(
      "r.parseJSONField(data.TwilioPrimaryPhoneNumber)",
    );
    // A Color is sent as it was.
    expect(create).toContain("r.parseJSONField(data.Color)");

    const update: string = method(
      resourceGo,
      "func (r *CallAndSmsConfigResource) Update",
    );
    expect(update).toContain(
      'requestDataMap["twilioPrimaryPhoneNumber"] = data.TwilioPrimaryPhoneNumber.ValueString()',
    );
    expect(update).not.toContain(
      "json.Unmarshal([]byte(data.TwilioPrimaryPhoneNumber.ValueString())",
    );
  });

  test("is read from the wrapper OneUptime answers", () => {
    for (const signature of [
      "func (r *CallAndSmsConfigResource) Create",
      "func (r *CallAndSmsConfigResource) Read",
      "func (r *CallAndSmsConfigResource) Update",
    ]) {
      const body: string = method(resourceGo, signature);
      expect([signature, body]).toEqual([
        signature,
        expect.stringContaining(
          "data.TwilioPrimaryPhoneNumber = NewPhoneValue(val)",
        ),
      ]);
      expect(body).toContain("data.TwilioPrimaryPhoneNumber = NewPhoneNull()");
      expect(body).not.toContain(
        "data.TwilioPrimaryPhoneNumber = NewJSONSubsetValue",
      );
    }
  });

  test("is written as a plain number in the docs' example", () => {
    expect(resourceDoc).toMatch(
      /twilio_backup_phone_number\s+= "\+1-555-123-4567"/,
    );
    expect(resourceDoc).not.toContain('jsonencode({\n    "_type": "Phone"');
  });
});

describe("the cases the provider's phone numbers are checked against", () => {
  const phoneCases: PhoneCases = buildPhoneCases();

  function storedFor(written: string): string | null {
    const found: PhoneCase | undefined = phoneCases.cases.find(
      (phoneCase: PhoneCase): boolean => {
        return phoneCase.written === written;
      },
    );
    if (!found) {
      throw new Error(`no case ${JSON.stringify(written)}`);
    }
    return found.stored;
  }

  test("are what the server keeps for each number", () => {
    expect(storedFor("+1 415 555 0100")).toBe("+14155550100");
    expect(storedFor("+44 20 7946 0958")).toBe("+442079460958");
    // The spec's own example, which the provider used to fail to apply.
    expect(storedFor("+1-555-123-4567")).toBe("+15551234567");
    expect(storedFor("(415) 555-0100")).toBe("(415) 555-0100");
    expect(storedFor("14155550100")).toBe("14155550100");
    expect(storedFor(" +14155550100 ")).toBe("+14155550100");
    expect(storedFor("1234567")).toBeNull();
    expect(storedFor("")).toBeNull();

    for (const phoneCase of phoneCases.cases) {
      let stored: string | null = null;
      try {
        stored = new Phone(phoneCase.written).toString();
      } catch {
        stored = null;
      }
      expect([phoneCase.written, phoneCase.stored]).toEqual([
        phoneCase.written,
        stored,
      ]);
    }
  });

  test("cover numbers kept as written, numbers kept as their digits, and numbers refused", () => {
    const keptAsWritten: Array<PhoneCase> = phoneCases.cases.filter(
      (phoneCase: PhoneCase): boolean => {
        return phoneCase.stored === phoneCase.written;
      },
    );
    const keptOtherwise: Array<PhoneCase> = phoneCases.cases.filter(
      (phoneCase: PhoneCase): boolean => {
        return (
          phoneCase.stored !== null && phoneCase.stored !== phoneCase.written
        );
      },
    );
    const refused: Array<PhoneCase> = phoneCases.cases.filter(
      (phoneCase: PhoneCase): boolean => {
        return phoneCase.stored === null;
      },
    );

    expect(keptAsWritten.length).toBeGreaterThanOrEqual(10);
    expect(keptOtherwise.length).toBeGreaterThanOrEqual(20);
    expect(refused.length).toBeGreaterThanOrEqual(10);
    expect(new Set(WRITTEN_PHONE_NUMBERS).size).toBe(
      WRITTEN_PHONE_NUMBERS.length,
    );
  });

  test("keep what the server keeps as it is: the server reads it so each time", () => {
    for (const phoneCase of phoneCases.cases) {
      if (phoneCase.stored === null) {
        continue;
      }
      expect([
        phoneCase.stored,
        new Phone(phoneCase.stored).toString(),
      ]).toEqual([phoneCase.stored, phoneCase.stored]);
    }
  });

  test("are written to a file, the same each time, one case a line, in printable ASCII", () => {
    const file: string = phoneCasesFile();

    expect(phoneCasesFile()).toBe(file);
    expect(JSON.parse(file)).toEqual(JSON.parse(JSON.stringify(phoneCases)));
    expect(file.endsWith("}\n")).toBe(true);
    expect(PRINTABLE_ASCII.test(file)).toBe(true);

    const lines: Array<string> = file.split("\n");
    for (const phoneCase of phoneCases.cases.slice(0, -1)) {
      expect(
        lines.some((line: string): boolean => {
          return (
            line.startsWith("    {") &&
            line.endsWith("},") &&
            JSON.stringify(JSON.parse(line.trim().slice(0, -1))) ===
              JSON.stringify(phoneCase)
          );
        }),
      ).toBe(true);
    }
  });

  test("are written where the provider's Go test reads them, with the type and its tests", () => {
    const provider: string = path.join(outputDir, "internal", "provider");

    expect(
      fs.readFileSync(path.join(provider, "phone_test.go"), "utf-8"),
    ).toContain(`filepath.Join("testdata", "${PHONE_CASES_FILE}")`);
    expect(
      fs.readFileSync(
        path.join(provider, "testdata", PHONE_CASES_FILE),
        "utf-8",
      ),
    ).toBe(phoneCasesFile());
    expect(fs.existsSync(path.join(provider, "phone.go"))).toBe(true);
  });
});
