import { describe, expect, test } from "@jest/globals";
import {
  getMonitorAddressFormFields,
  getMonitorAddressSeed,
  getMonitorAddressValues,
  getMonitorNameFromAddress,
  MONITOR_ADDRESS_FIELD_KEY,
  MONITOR_ADDRESS_PORT_FIELD_KEY,
  MONITOR_ADDRESS_WORDS,
  parseMonitorAddress,
  parseMonitorPort,
  readMonitorAddress,
  withMonitorAddress,
  withMonitorAddressValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorAddressField";
import { MonitorStepSeed } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorSteps";
import {
  hasMonitorAddress,
  MONITOR_TYPES_WITH_ADDRESS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitorDestinationFieldCopy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Port from "../../../Types/Port";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { MONITOR_NAME_MAX_LENGTH } from "../../../Utils/GuidedSetup/WebsiteMonitorRecords";

/*
 * CREATE MONITOR ASKS WHERE TO CHECK WITH THE TYPE (#7463).
 *
 * The address - a website's or an API's URL, a host to ping, an IP address,
 * a host and its port, an NTP server - is asked on the first step, right
 * after the type, and the name follows it until the person writes one of
 * their own. These are the rules behind the two fields, apart from the form
 * that draws them (MonitorCreateFlow walks the form itself).
 */

function stepsWithDestination(data: {
  destination?: URL | IP | Hostname | undefined;
  port?: Port | undefined;
  extraSteps?: number;
}): MonitorSteps {
  const first: MonitorStep = new MonitorStep();

  if (data.destination) {
    first.setMonitorDestination(data.destination);
  }

  if (data.port) {
    first.setPort(data.port);
  }

  const extra: Array<MonitorStep> = [];

  for (let i: number = 0; i < (data.extraSteps || 0); i++) {
    const step: MonitorStep = new MonitorStep();
    step.setMonitorDestination(Hostname.fromString(`extra-${i}.example.com`));
    extra.push(step);
  }

  const steps: MonitorSteps = new MonitorSteps();
  steps.setMonitorStepsInstanceArray([first, ...extra]);
  return steps;
}

function firstDestination(steps: MonitorSteps | undefined): string {
  return (
    steps?.data?.monitorStepsInstanceArray[0]?.data?.monitorDestination?.toString() ||
    ""
  );
}

function firstPort(steps: MonitorSteps | undefined): string {
  return (
    steps?.data?.monitorStepsInstanceArray[0]?.data?.monitorDestinationPort?.toString() ||
    ""
  );
}

describe("the types whose check is of one address", () => {
  test("are the probe checks of a URL, a host or an IP address", () => {
    expect([...MONITOR_TYPES_WITH_ADDRESS]).toEqual([
      MonitorType.Website,
      MonitorType.API,
      MonitorType.SSLCertificate,
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
    ]);
  });

  test.each([
    MonitorType.DNS,
    MonitorType.DNSSEC,
    MonitorType.Domain,
    MonitorType.Manual,
    MonitorType.IncomingRequest,
    MonitorType.Logs,
    MonitorType.Kubernetes,
    MonitorType.SQLQuery,
  ])("%s says where to look on its own Criteria step", (type: MonitorType) => {
    expect(hasMonitorAddress(type)).toBe(false);
  });

  test("no type is none", () => {
    expect(hasMonitorAddress(undefined)).toBe(false);
    expect(hasMonitorAddress(null)).toBe(false);
  });
});

describe("parseMonitorAddress", () => {
  test.each(["", "   ", undefined, null])(
    "%p is asked for, in the field's own words",
    (address: string | undefined | null) => {
      expect(
        parseMonitorAddress({ monitorType: MonitorType.Website, address }),
      ).toEqual({
        destination: undefined,
        error: MONITOR_ADDRESS_WORDS.required,
      });
    },
  );

  test("a website's URL is a URL", () => {
    const parsed: ReturnType<typeof parseMonitorAddress> = parseMonitorAddress({
      monitorType: MonitorType.Website,
      address: "  https://example.com/pricing ",
    });

    expect(parsed.error).toBeNull();
    expect(parsed.destination).toBeInstanceOf(URL);
    expect(parsed.destination!.toString()).toContain("example.com/pricing");
  });

  test("a host to ping is a host name or an IP address", () => {
    expect(
      parseMonitorAddress({
        monitorType: MonitorType.Ping,
        address: "example.com",
      }).destination,
    ).toBeInstanceOf(Hostname);
    expect(
      parseMonitorAddress({
        monitorType: MonitorType.Ping,
        address: "192.168.1.1",
      }).destination,
    ).toBeInstanceOf(IP);
  });

  test("an IP monitor takes an address in brackets, and refuses a host name", () => {
    const bracketed: ReturnType<typeof parseMonitorAddress> =
      parseMonitorAddress({
        monitorType: MonitorType.IP,
        address: "[2001:db8::1]",
      });

    expect(bracketed.error).toBeNull();
    expect(bracketed.destination!.toString()).toBe("2001:db8::1");

    const name: ReturnType<typeof parseMonitorAddress> = parseMonitorAddress({
      monitorType: MonitorType.IP,
      address: "example.com",
    });

    expect(name.destination).toBeUndefined();
    expect(name.error).toBeTruthy();
  });

  test("an NTP server is a host", () => {
    expect(
      parseMonitorAddress({
        monitorType: MonitorType.NTP,
        address: "time.example.com",
      }).destination!.toString(),
    ).toBe("time.example.com");
  });
});

describe("parseMonitorPort", () => {
  test.each([
    ["443", "443"],
    [" 5432 ", "5432"],
    [22, "22"],
    ["1", "1"],
    ["65535", "65535"],
  ])("%p is a port", (typed: string | number, expected: string) => {
    expect(parseMonitorPort(typed)?.toString()).toBe(expected);
  });

  test.each([
    "",
    "  ",
    undefined,
    null,
    "0",
    "65536",
    "12a",
    "1e3",
    "-1",
    "4.5",
  ])("%p is not a port", (typed: string | undefined | null) => {
    expect(parseMonitorPort(typed)).toBeUndefined();
  });
});

describe("getMonitorNameFromAddress", () => {
  test("a website is named by its host and path, as the guided setup names it", () => {
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.Website,
        address: "https://www.example.com/shop/",
      }),
    ).toBe("example.com/shop");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.Website,
        address: "https://example.com",
      }),
    ).toBe("example.com");
  });

  test("an API by its host and path, an SSL certificate by its host and port", () => {
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.API,
        address: "https://api.example.com/health",
      }),
    ).toBe("api.example.com/health");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.SSLCertificate,
        address: "https://example.com:8443",
      }),
    ).toBe("example.com:8443");
  });

  test("a host to ping, an IP address and an NTP server by themselves", () => {
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.Ping,
        address: "example.com",
      }),
    ).toBe("example.com");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.IP,
        address: "[2001:db8::1]",
      }),
    ).toBe("2001:db8::1");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.NTP,
        address: " time.example.com ",
      }),
    ).toBe("time.example.com");
  });

  test("a Port monitor by its host and port, and its host alone until the port is one", () => {
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.Port,
        address: "db.example.com",
        port: "5432",
      }),
    ).toBe("db.example.com:5432");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.Port,
        address: "db.example.com",
        port: "54x",
      }),
    ).toBe("db.example.com");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.Port,
        address: "db.example.com",
      }),
    ).toBe("db.example.com");
  });

  test("nothing, for no type, a type of no address, or an address that is not one yet", () => {
    expect(
      getMonitorNameFromAddress({ monitorType: undefined, address: "a.com" }),
    ).toBe("");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.DNS,
        address: "example.com",
      }),
    ).toBe("");
    expect(
      getMonitorNameFromAddress({ monitorType: MonitorType.Ping, address: "" }),
    ).toBe("");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.IP,
        address: "not an address",
      }),
    ).toBe("");
    expect(
      getMonitorNameFromAddress({
        monitorType: MonitorType.Website,
        address: "example",
      }),
    ).toBe("");
  });

  test("a name never runs past what a monitor's name may hold", () => {
    const host: string = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.example.com`;
    const name: string = getMonitorNameFromAddress({
      monitorType: MonitorType.Ping,
      address: host,
    });

    expect(name.length).toBeLessThanOrEqual(MONITOR_NAME_MAX_LENGTH);
    expect(host.startsWith(name)).toBe(true);
  });
});

describe("withMonitorAddress", () => {
  test("puts the address in the first step, as it reads for the type", () => {
    const steps: MonitorSteps = stepsWithDestination({});
    const result: MonitorSteps | undefined = withMonitorAddress({
      monitorSteps: steps,
      monitorType: MonitorType.Ping,
      address: "192.168.1.1",
    });

    expect(
      result!.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination,
    ).toBeInstanceOf(IP);
    expect(firstDestination(result)).toBe("192.168.1.1");
  });

  test("never changes the steps the form holds, and keeps the other steps", () => {
    const steps: MonitorSteps = stepsWithDestination({
      destination: Hostname.fromString("old.example.com"),
      extraSteps: 2,
    });
    const result: MonitorSteps | undefined = withMonitorAddress({
      monitorSteps: steps,
      monitorType: MonitorType.Ping,
      address: "new.example.com",
    });

    expect(firstDestination(steps)).toBe("old.example.com");
    expect(firstDestination(result)).toBe("new.example.com");
    expect(
      result!
        .data!.monitorStepsInstanceArray.slice(1)
        .map((step: MonitorStep) => {
          return step.data?.monitorDestination?.toString();
        }),
    ).toEqual(["extra-0.example.com", "extra-1.example.com"]);
  });

  test("a Port monitor's port goes with it; another type's port is left alone", () => {
    const portSteps: MonitorSteps | undefined = withMonitorAddress({
      monitorSteps: stepsWithDestination({}),
      monitorType: MonitorType.Port,
      address: "db.example.com",
      port: "5432",
    });

    expect(firstDestination(portSteps)).toBe("db.example.com");
    expect(firstPort(portSteps)).toBe("5432");

    const ntpSteps: MonitorSteps | undefined = withMonitorAddress({
      monitorSteps: stepsWithDestination({ port: new Port(1123) }),
      monitorType: MonitorType.NTP,
      address: "time.example.com",
      port: "5432",
    });

    expect(firstPort(ntpSteps)).toBe("1123");
  });

  test("an address that is not one leaves the step without one, not with the last that was", () => {
    const result: MonitorSteps | undefined = withMonitorAddress({
      monitorSteps: stepsWithDestination({
        destination: IP.fromString("10.0.0.1"),
      }),
      monitorType: MonitorType.IP,
      address: "example.com",
    });

    expect(firstDestination(result)).toBe("");
  });

  test("reads the steps a link seeded, as JSON", () => {
    const json: JSONObject = stepsWithDestination({}).toJSON();
    const result: MonitorSteps | undefined = withMonitorAddress({
      monitorSteps: json,
      monitorType: MonitorType.NTP,
      address: "time.example.com",
    });

    expect(firstDestination(result)).toBe("time.example.com");
  });

  test("nothing, with no steps yet or a type of no address", () => {
    expect(
      withMonitorAddress({
        monitorSteps: undefined,
        monitorType: MonitorType.Website,
        address: "https://example.com",
      }),
    ).toBeUndefined();
    expect(
      withMonitorAddress({
        monitorSteps: stepsWithDestination({}),
        monitorType: MonitorType.DNS,
        address: "example.com",
      }),
    ).toBeUndefined();
    const noStep: MonitorSteps = new MonitorSteps();
    noStep.setMonitorStepsInstanceArray([]);

    expect(
      withMonitorAddress({
        monitorSteps: noStep,
        monitorType: MonitorType.Website,
        address: "https://example.com",
      }),
    ).toBeUndefined();
  });
});

describe("getMonitorAddressSeed", () => {
  const linkSeed: MonitorStepSeed = {
    monitorType: MonitorType.Website,
    monitorDestination: URL.fromString("https://10.0.0.5"),
    allowSelfSignedCertificates: true,
  };

  test("the address typed goes over the one a link brought, and keeps what else the link asked", () => {
    const seed: MonitorStepSeed | undefined = getMonitorAddressSeed({
      monitorType: MonitorType.Website,
      address: "https://router.example.com",
      linkSeed,
    });

    expect(seed!.monitorDestination.toString()).toContain("router.example.com");
    expect(seed!.allowSelfSignedCertificates).toBe(true);
  });

  test("a link made for another type lends nothing", () => {
    const seed: MonitorStepSeed | undefined = getMonitorAddressSeed({
      monitorType: MonitorType.Ping,
      address: "router.example.com",
      linkSeed,
    });

    expect(seed!.monitorType).toBe(MonitorType.Ping);
    expect(seed!.allowSelfSignedCertificates).toBeUndefined();
  });

  test("a Port monitor's seed has its port", () => {
    const seed: MonitorStepSeed | undefined = getMonitorAddressSeed({
      monitorType: MonitorType.Port,
      address: "db.example.com",
      port: "5432",
    });

    expect(seed!.monitorDestinationPort!.toString()).toBe("5432");
  });

  test("the link's own seed while nothing typed is an address, or for a type of no address", () => {
    expect(
      getMonitorAddressSeed({
        monitorType: MonitorType.Website,
        address: "",
        linkSeed,
      }),
    ).toBe(linkSeed);
    expect(
      getMonitorAddressSeed({
        monitorType: MonitorType.DNS,
        address: "example.com",
        linkSeed,
      }),
    ).toBe(linkSeed);
    expect(
      getMonitorAddressSeed({
        monitorType: undefined,
        address: "example.com",
      }),
    ).toBeUndefined();
  });
});

describe("the values a form opens with", () => {
  test("a template's or a saved form's steps fill the address and the port in", () => {
    const values: JSONObject = withMonitorAddressValues({
      values: {
        monitorType: MonitorType.Port,
        monitorSteps: stepsWithDestination({
          destination: Hostname.fromString("db.example.com"),
          port: new Port(5432),
        }).toJSON(),
      },
    });

    expect(getMonitorAddressValues(values)).toEqual({
      address: "db.example.com",
      port: "5432",
    });
  });

  test("a link's address fills it in when no steps hold one", () => {
    const values: JSONObject = withMonitorAddressValues({
      values: { monitorType: MonitorType.Website },
      linkSeed: {
        monitorType: MonitorType.Website,
        monitorDestination: URL.fromString("https://10.0.0.5"),
      },
    });

    expect(values[MONITOR_ADDRESS_FIELD_KEY]).toContain("10.0.0.5");
  });

  test("values that already hold an address keep it", () => {
    const values: JSONObject = {
      [MONITOR_ADDRESS_FIELD_KEY]: "https://mine.example.com",
      monitorSteps: stepsWithDestination({
        destination: URL.fromString("https://a.com"),
      }).toJSON(),
    };

    expect(withMonitorAddressValues({ values })).toBe(values);
  });

  test("steps with no address read as empty fields", () => {
    expect(readMonitorAddress(undefined)).toEqual({ address: "", port: "" });
    expect(readMonitorAddress(stepsWithDestination({}))).toEqual({
      address: "",
      port: "",
    });
  });
});

describe("the fields on What to Monitor", () => {
  const fields: Array<ModelField<Monitor>> = getMonitorAddressFormFields({
    stepId: "monitor-info",
  });
  const address: ModelField<Monitor> = fields[0]!;
  const port: ModelField<Monitor> = fields[1]!;

  function values(data: JSONObject): FormValues<Monitor> {
    return data as FormValues<Monitor>;
  }

  test("sit on the first step, and are never sent themselves", () => {
    expect(fields).toHaveLength(2);

    for (const field of fields) {
      expect(field.stepId).toBe("monitor-info");
      expect(field.formOnly).toBe(true);
      expect(field.required).toBe(true);
    }

    expect(address.overrideFieldKey).toBe(MONITOR_ADDRESS_FIELD_KEY);
    expect(port.overrideFieldKey).toBe(MONITOR_ADDRESS_PORT_FIELD_KEY);
    expect(port.title).toBe("Port");
  });

  test("the address shows for a type of one address, the port for a Port monitor only", () => {
    for (const type of Object.values(MonitorType)) {
      expect({
        type,
        address: address.showIf!(values({ monitorType: type })),
        port: port.showIf!(values({ monitorType: type })),
      }).toEqual({
        type,
        address: hasMonitorAddress(type),
        port: type === MonitorType.Port,
      });
    }

    expect(address.showIf!(values({}))).toBe(false);
  });

  test("the address is asked for, and checked as the type reads it", () => {
    expect(
      address.customValidation!(values({ monitorType: MonitorType.Website })),
    ).toBe(MONITOR_ADDRESS_WORDS.required);
    expect(
      address.customValidation!(
        values({
          monitorType: MonitorType.IP,
          [MONITOR_ADDRESS_FIELD_KEY]: "example.com",
        }),
      ),
    ).toBeTruthy();
    expect(
      address.customValidation!(
        values({
          monitorType: MonitorType.IP,
          [MONITOR_ADDRESS_FIELD_KEY]: "192.168.1.1",
        }),
      ),
    ).toBeNull();
    // Before a type is picked there is nothing to check it against.
    expect(address.customValidation!(values({}))).toBeNull();
  });

  test("the port is asked for, and must be one", () => {
    expect(port.customValidation!(values({}))).toBe(
      MONITOR_ADDRESS_WORDS.portRequired,
    );
    expect(
      port.customValidation!(
        values({ [MONITOR_ADDRESS_PORT_FIELD_KEY]: "70000" }),
      ),
    ).toBe(MONITOR_ADDRESS_WORDS.portInvalid);
    expect(
      port.customValidation!(
        values({ [MONITOR_ADDRESS_PORT_FIELD_KEY]: "443" }),
      ),
    ).toBeNull();
  });

  /*
   * What the form holds after a keystroke in a field: the field's onChange
   * is handed the values as they were (FormField), then the form sets the
   * field's own value.
   */
  function typeInto(
    field: ModelField<Monitor>,
    typed: string,
    current: JSONObject,
  ): JSONObject {
    let next: JSONObject = current;

    field.onChange!(
      typed,
      values(current),
      (newValues: FormValues<Monitor>) => {
        next = newValues as JSONObject;
      },
    );

    return { ...next, [field.overrideFieldKey as string]: typed };
  }

  test("the name follows the address while nobody has named the monitor", () => {
    let current: JSONObject = { monitorType: MonitorType.Website, name: "" };

    current = typeInto(address, "https://example.com/sh", current);
    expect(current["name"]).toBe("example.com/sh");

    current = typeInto(address, "https://example.com/shop", current);
    expect(current["name"]).toBe("example.com/shop");
  });

  test("a name of the person's own is theirs", () => {
    const current: JSONObject = typeInto(address, "https://example.com", {
      monitorType: MonitorType.Website,
      name: "Marketing site",
      [MONITOR_ADDRESS_FIELD_KEY]: "https://example.co",
    });

    expect(current["name"]).toBe("Marketing site");
  });

  test("a Port monitor's name follows its port too", () => {
    let current: JSONObject = { monitorType: MonitorType.Port, name: "" };

    current = typeInto(address, "db.example.com", current);
    expect(current["name"]).toBe("db.example.com");

    current = typeInto(port, "5432", current);
    expect(current["name"]).toBe("db.example.com:5432");
  });
});
