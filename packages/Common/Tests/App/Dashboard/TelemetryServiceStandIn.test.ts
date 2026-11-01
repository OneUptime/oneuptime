import { beforeAll, describe, expect, test } from "@jest/globals";
import Service from "../../../Models/DatabaseModels/Service";
import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryServiceUtil, {
  ResolvedTelemetryResource,
  UNKNOWN_RESOURCE_LABEL,
  UNKNOWN_SERVICE_NAME,
} from "../../../UI/Utils/TelemetryService";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  ENGLISH,
  LANGUAGES,
  OTHER_LANGUAGES,
  createLanguageInstances,
  hasOwnWording,
  translatorFor,
  word,
} from "./TracesLanguageHarness";

/*
 * ---------------------------------------------------------------------------
 * What telemetry that names no service is called, rule by rule
 * ---------------------------------------------------------------------------
 *
 * TraceSharedWordsInEveryLanguage.test.tsx mounts the views that draw the
 * "Unknown Service" stand-in. These are the rules those views lean on, on far
 * more shapes than a mount can reach:
 *
 * - only the stand-in itself is looked up. Everything a person's telemetry
 *   calls a service stays as written, including names that are words of the
 *   Dashboard, near misses of the stand-in, and what another language calls it;
 * - the English name stays on the loaded Service, because the reader can switch
 *   language while it is loaded. What is drawn is built from it, never over it;
 * - a Service row of that name is still a row: ingest writes the same word
 *   when a request names no service, and only the name is the stand-in's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const CHECKOUT_ID: string = "20000000-0000-4000-8000-000000000002";
const NAMED_ROW_ID: string = "30000000-0000-4000-8000-000000000003";

const ROW_COLOR: Color = new Color("#7c3aed");

const makeService: (
  id: string,
  name: string | undefined,
  color?: Color | undefined,
) => Service = (
  id: string,
  name: string | undefined,
  color?: Color | undefined,
): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(id);

  if (name !== undefined) {
    service.name = name;
  }

  if (color) {
    service.serviceColor = color;
  }

  return service;
};

const STAND_IN: string = "Unknown Service";

// Pieces of the stand-in and of what names go wrong on.
const NAME_PIECES: ReadonlyArray<string> = [
  "Unknown",
  "Service",
  "unknown",
  "service",
  " ",
  "  ",
  "\t",
  "-",
  "_",
  ".",
  "{{count}}",
  "$&",
  "<b>",
  "Dienst",
  "未知",
  "ناشناخته",
  "‏",
];

beforeAll(async () => {
  await createLanguageInstances();
});

describe("the stand-in's own words", () => {
  test("are keys of the Dashboard's English, drawn as themselves", () => {
    expect(UNKNOWN_SERVICE_NAME).toBe(STAND_IN);
    expect(ENGLISH[UNKNOWN_SERVICE_NAME]).toBe(STAND_IN);
    expect(ENGLISH[UNKNOWN_RESOURCE_LABEL]).toBe("Unknown");
  });

  test.each(OTHER_LANGUAGES)(
    "%s words the stand-in and the fallback itself",
    (language: string) => {
      expect(hasOwnWording(language, UNKNOWN_SERVICE_NAME)).toBe(true);
      expect(hasOwnWording(language, UNKNOWN_RESOURCE_LABEL)).toBe(true);
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s tells the stand-in from the fallback",
    (language: string) => {
      expect(word(language, UNKNOWN_SERVICE_NAME)).not.toBe(
        word(language, UNKNOWN_RESOURCE_LABEL),
      );
    },
  );
});

describe.each(LANGUAGES)("a service's name in %s", (language: string) => {
  const translator: () => Translator = (): Translator => {
    return translatorFor(language);
  };

  test("the stand-in reads in the language's words", () => {
    expect(
      TelemetryServiceUtil.getServiceDisplayName(STAND_IN, translator()),
    ).toBe(word(language, STAND_IN));
  });

  test("no name stays no name", () => {
    expect(
      TelemetryServiceUtil.getServiceDisplayName(undefined, translator()),
    ).toBeUndefined();
    expect(TelemetryServiceUtil.getServiceDisplayName("", translator())).toBe(
      "",
    );
  });

  test.each([
    "unknown service",
    "Unknown service",
    "UNKNOWN SERVICE",
    " Unknown Service",
    "Unknown Service ",
    "Unknown  Service",
    "Unknown Service\n",
    "unknown_service",
    "unknown_service:node",
    "Unknown",
    "Service",
  ])("%j is not the stand-in, and stays as written", (name: string) => {
    expect(TelemetryServiceUtil.getServiceDisplayName(name, translator())).toBe(
      name,
    );
  });

  test("a service called after any word of the Dashboard stays as written", () => {
    const changed: Array<string> = Object.keys(ENGLISH).filter(
      (key: string): boolean => {
        return (
          key !== STAND_IN &&
          TelemetryServiceUtil.getServiceDisplayName(key, translator()) !== key
        );
      },
    );

    expect(changed).toEqual([]);
  });

  test("a name built from the stand-in's own pieces changes only when it is the stand-in", () => {
    const expected: string = word(language, STAND_IN);

    for (const name of generatedTexts(4000, 5473, NAME_PIECES, 4)) {
      const drawn: string | undefined =
        TelemetryServiceUtil.getServiceDisplayName(name, translator());

      if (drawn !== (name === STAND_IN ? expected : name)) {
        throw new Error(`${JSON.stringify(name)} drew ${String(drawn)}`);
      }
    }
  });

  test("a service called what any language calls the stand-in stays as written", () => {
    for (const other of OTHER_LANGUAGES) {
      const name: string = word(other, STAND_IN);

      expect(
        TelemetryServiceUtil.getServiceDisplayName(name, translator()),
      ).toBe(name);
    }
  });
});

describe.each(LANGUAGES)("a map of services in %s", (language: string) => {
  const translator: () => Translator = (): Translator => {
    return translatorFor(language);
  };

  const loaded: () => Record<string, Service> = (): Record<string, Service> => {
    return {
      [CHECKOUT_ID]: makeService(CHECKOUT_ID, "checkout-api", ROW_COLOR),
      [PROJECT_ID.toString()]:
        TelemetryServiceUtil.getUnknownService(PROJECT_ID),
    };
  };

  test("an empty map stays empty", () => {
    expect(
      TelemetryServiceUtil.withUnknownServiceNamed({}, translator()),
    ).toEqual({});
  });

  test("the stand-in is named, under its own id", () => {
    const named: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(loaded(), translator());
    const standIn: Service = named[PROJECT_ID.toString()] as Service;

    expect(standIn.name).toBe(word(language, STAND_IN));
    expect(standIn.id?.toString()).toBe(PROJECT_ID.toString());
  });

  test("every other service is handed on as it is", () => {
    const services: Record<string, Service> = loaded();
    const named: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(services, translator());

    expect(named[CHECKOUT_ID]).toBe(services[CHECKOUT_ID]);
  });

  test("the ids keep their order", () => {
    const services: Record<string, Service> = loaded();

    expect(
      Object.keys(
        TelemetryServiceUtil.withUnknownServiceNamed(services, translator()),
      ),
    ).toEqual(Object.keys(services));
  });

  test("the loaded map is not changed: its stand-in stays English", () => {
    const services: Record<string, Service> = loaded();
    const loadedStandIn: Service = services[PROJECT_ID.toString()] as Service;

    const named: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(services, translator());

    expect(named).not.toBe(services);
    expect(services[PROJECT_ID.toString()]).toBe(loadedStandIn);
    expect(loadedStandIn.name).toBe(STAND_IN);
  });

  test("the synthetic stand-in keeps its gray", () => {
    const named: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(loaded(), translator());

    expect(named[PROJECT_ID.toString()]?.serviceColor?.toString()).toBe(
      Gray500.toString(),
    );
  });

  test("REGRESSION: a Service row of that name keeps its own color", () => {
    const named: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(
        { [NAMED_ROW_ID]: makeService(NAMED_ROW_ID, STAND_IN, ROW_COLOR) },
        translator(),
      );
    const row: Service = named[NAMED_ROW_ID] as Service;

    expect(row.name).toBe(word(language, STAND_IN));
    expect(row.id?.toString()).toBe(NAMED_ROW_ID);
    expect(row.serviceColor?.toString()).toBe(ROW_COLOR.toString());
  });

  test("a Service row of that name with no color reads as the stand-in does", () => {
    const named: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(
        { [NAMED_ROW_ID]: makeService(NAMED_ROW_ID, STAND_IN) },
        translator(),
      );

    expect(named[NAMED_ROW_ID]?.serviceColor?.toString()).toBe(
      Gray500.toString(),
    );
  });

  test("a service with no name is handed on as it is", () => {
    const nameless: Service = makeService(NAMED_ROW_ID, undefined, ROW_COLOR);

    expect(
      TelemetryServiceUtil.withUnknownServiceNamed(
        { [NAMED_ROW_ID]: nameless },
        translator(),
      )[NAMED_ROW_ID],
    ).toBe(nameless);
  });

  test("naming a map twice reads the same as naming it once", () => {
    const once: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(loaded(), translator());
    const twice: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(once, translator());

    expect(twice[PROJECT_ID.toString()]?.name).toBe(
      once[PROJECT_ID.toString()]?.name,
    );
    expect(twice[CHECKOUT_ID]?.name).toBe("checkout-api");
  });
});

describe("a reader who switches language while the map is loaded", () => {
  test("reads every language in turn off one map, which ends as it began", () => {
    const services: Record<string, Service> = {
      [PROJECT_ID.toString()]:
        TelemetryServiceUtil.getUnknownService(PROJECT_ID),
    };

    for (const language of [...LANGUAGES, ...[...LANGUAGES].reverse()]) {
      expect(
        TelemetryServiceUtil.withUnknownServiceNamed(
          services,
          translatorFor(language),
        )[PROJECT_ID.toString()]?.name,
      ).toBe(word(language, STAND_IN));
    }

    expect(services[PROJECT_ID.toString()]?.name).toBe(STAND_IN);
  });
});

describe("the synthetic Service", () => {
  test("is English until a translator names it: it is a key, and what a typed search finds", () => {
    const service: Service = TelemetryServiceUtil.getUnknownService(PROJECT_ID);

    expect(service.name).toBe(STAND_IN);
    expect(service.id?.toString()).toBe(PROJECT_ID.toString());
    expect(service.serviceColor?.toString()).toBe(Gray500.toString());
  });

  test.each(LANGUAGES)("is named for a reader in %s", (language: string) => {
    const service: Service = TelemetryServiceUtil.getUnknownService(
      PROJECT_ID,
      translatorFor(language),
    );

    expect(service.name).toBe(word(language, STAND_IN));
    expect(service.id?.toString()).toBe(PROJECT_ID.toString());
    expect(service.serviceColor?.toString()).toBe(Gray500.toString());
  });

  test.each(LANGUAGES)(
    "named for a reader in %s it is still the unattributed bucket",
    (language: string) => {
      const service: Service = TelemetryServiceUtil.getUnknownService(
        PROJECT_ID,
        translatorFor(language),
      );

      expect(
        TelemetryServiceUtil.isUnknownServiceId(service.id, PROJECT_ID),
      ).toBe(true);
    },
  );
});

describe("what a telemetry resource is called", () => {
  const LABELS: Array<[ServiceType, string]> = [
    [ServiceType.Host, "Host telemetry"],
    [ServiceType.DockerHost, "Docker host telemetry"],
    [ServiceType.PodmanHost, "Podman host telemetry"],
    [ServiceType.KubernetesCluster, "Kubernetes telemetry"],
    [ServiceType.ProxmoxCluster, "Proxmox Cluster"],
    [ServiceType.CephCluster, "Ceph Cluster"],
    [ServiceType.StorageArray, "Storage Array"],
    [ServiceType.VMwareVCenter, "vCenter"],
    [ServiceType.DatabaseServer, "Database telemetry"],
  ];

  const resolved: (
    primaryEntityId: string | undefined,
    primaryEntityType: ServiceType | undefined,
    services?: Array<Service>,
  ) => ResolvedTelemetryResource = (
    primaryEntityId: string | undefined,
    primaryEntityType: ServiceType | undefined,
    services: Array<Service> = [],
  ): ResolvedTelemetryResource => {
    return TelemetryServiceUtil.resolveTelemetryResource({
      primaryEntityId,
      primaryEntityType,
      services,
      projectId: PROJECT_ID,
    });
  };

  test.each(LABELS)(
    "%s has a label, and it is a key of the Dashboard's English",
    (type: ServiceType, label: string) => {
      expect(resolved(CHECKOUT_ID, type)).toEqual({ label });
      expect(ENGLISH[label]).toBe(label);
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s has wording for every label",
    (language: string) => {
      const missing: Array<string> = LABELS.map(
        (entry: [ServiceType, string]): string => {
          return entry[1];
        },
      ).filter((label: string): boolean => {
        return !hasOwnWording(language, label);
      });

      expect(missing).toEqual([]);
    },
  );

  test("a type with no label of its own falls back to the word for Unknown", () => {
    expect(resolved(CHECKOUT_ID, ServiceType.Monitor)).toEqual({
      label: UNKNOWN_RESOURCE_LABEL,
    });
    expect(resolved(CHECKOUT_ID, undefined)).toEqual({
      label: UNKNOWN_RESOURCE_LABEL,
    });
  });

  test("nothing to go on falls back to the word for Unknown", () => {
    expect(resolved(undefined, undefined)).toEqual({
      label: UNKNOWN_RESOURCE_LABEL,
    });
  });

  test("a loaded Service wins, whatever the type says", () => {
    const service: Service = makeService(CHECKOUT_ID, "checkout-api");

    expect(resolved(CHECKOUT_ID, ServiceType.Host, [service])).toEqual({
      service,
    });
  });

  test("the unattributed bucket is the stand-in, in English, for its view to name", () => {
    expect(resolved(PROJECT_ID.toString(), undefined).service?.name).toBe(
      STAND_IN,
    );
    expect(resolved(CHECKOUT_ID, ServiceType.Unknown).service?.name).toBe(
      STAND_IN,
    );
  });
});
