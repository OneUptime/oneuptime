import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import {
  DEVICE_ADDRESS_CHECK_KEY,
  DeviceMonitorCandidate,
  DeviceMonitorFacts,
  NTP_DEFAULT_PORT,
  findDuplicateDeviceMonitor,
  getDeviceMonitorCheckKeys,
  toDeviceMonitorCandidate,
  toDeviceMonitorFacts,
} from "../../../Utils/Monitor/DeviceMonitorDuplicates";
import { describe, expect, it } from "@jest/globals";

/*
 * WHEN A MONITOR FOR A NETWORK DEVICE IS A DUPLICATE (OneUptime issues #9509
 * and #9510).
 *
 * The customer's screenshot: two Ping monitors called WB1567KSK02, the same
 * labels on both, and one device. Each path that gives a discovered device a
 * monitor asked only "is there one from THIS template?", so a second Ping
 * template - or the same template after its first monitor lost its link to
 * it - made a second. These pin the rule every path now asks instead: the
 * same template, or the same kind of check on the same thing, is a
 * duplicate; another kind of check, or the same kind on another port, is a
 * monitor in its own right.
 */

const ONLINE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const KIOSK_PING_TEMPLATE: string = "44444444-4444-4444-8444-444444444444";
const OTHER_PING_TEMPLATE: string = "55555555-5555-4555-8555-555555555555";
const ALERT_PACK_TEMPLATE: string = "66666666-6666-4666-8666-666666666666";
const CPU_TEMPLATE: string = "77777777-7777-4777-8777-777777777777";

function steps(
  monitorType: MonitorType,
  ports: Array<number | undefined> = [undefined],
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: ports.map(
      (port: number | undefined, index: number): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: "WB1567KSK02",
          monitorType: monitorType,
          onlineMonitorStatusId: ONLINE_ID,
          offlineMonitorStatusId: OFFLINE_ID,
          defaultIncidentSeverityId: SEVERITY_ID,
          defaultAlertSeverityId: SEVERITY_ID,
        });
        step.data!.id = `step-${index + 1}`;
        step.setMonitorDestination(IP.fromString("10.40.12.7"));
        step.setPort(port ? new Port(port) : undefined);
        return step;
      },
    ),
    defaultMonitorStatusId: ONLINE_ID,
  };
  return monitorSteps;
}

function facts(data: {
  id?: string;
  monitorType: MonitorType;
  monitorTemplateId?: string | undefined;
  checkKeys?: Array<string> | undefined;
}): DeviceMonitorFacts {
  return {
    id: data.id || ObjectID.generate().toString(),
    name: "WB1567KSK02",
    monitorType: data.monitorType,
    monitorTemplateId: data.monitorTemplateId,
    checkKeys:
      data.checkKeys ||
      getDeviceMonitorCheckKeys({
        monitorType: data.monitorType,
        monitorSteps: steps(data.monitorType),
      }),
  };
}

function candidate(data: {
  monitorType: MonitorType;
  monitorTemplateId: string;
  ports?: Array<number | undefined> | undefined;
}): DeviceMonitorCandidate {
  return toDeviceMonitorCandidate({
    monitorType: data.monitorType,
    monitorTemplateId: data.monitorTemplateId,
    monitorSteps: steps(data.monitorType, data.ports),
  });
}

describe("what a device's monitor checks", () => {
  it("is the device itself for a Ping or an IP monitor, whatever their steps say", () => {
    for (const monitorType of [MonitorType.Ping, MonitorType.IP]) {
      expect(
        getDeviceMonitorCheckKeys({
          monitorType: monitorType,
          monitorSteps: steps(monitorType, [undefined, undefined]),
        }),
      ).toEqual([DEVICE_ADDRESS_CHECK_KEY]);
      expect(
        getDeviceMonitorCheckKeys({
          monitorType: monitorType,
          monitorSteps: undefined,
        }),
      ).toEqual([DEVICE_ADDRESS_CHECK_KEY]);
    }
  });

  it("is each port a Port monitor asks on, once each, in step order", () => {
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.Port,
        monitorSteps: steps(MonitorType.Port, [443, 22, 443]),
      }),
    ).toEqual(["443", "22"]);
  });

  it("is each port an NTP monitor asks on, 123 for a step that names none", () => {
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.NTP,
        monitorSteps: steps(MonitorType.NTP, [undefined]),
      }),
    ).toEqual([String(NTP_DEFAULT_PORT)]);
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.NTP,
        monitorSteps: steps(MonitorType.NTP, [1123, undefined]),
      }),
    ).toEqual(["1123", "123"]);
  });

  it("reads steps as the database stores them, as JSON", () => {
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.Port,
        monitorSteps: steps(MonitorType.Port, [8443]).toJSON() as JSONObject,
      }),
    ).toEqual(["8443"]);
  });

  it("is nothing for a Network Device or any other kind: only its template tells it apart", () => {
    for (const monitorType of [
      MonitorType.NetworkDevice,
      MonitorType.DNS,
      MonitorType.Manual,
    ]) {
      expect(
        getDeviceMonitorCheckKeys({
          monitorType: monitorType,
          monitorSteps: steps(MonitorType.Port, [22]),
        }),
      ).toEqual([]);
    }
  });

  it("is nothing for a Port monitor whose steps cannot be read, so it can only duplicate by its template", () => {
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.Port,
        monitorSteps: { not: "steps" } as JSONObject,
      }),
    ).toEqual([]);
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.Port,
        monitorSteps: null,
      }),
    ).toEqual([]);
  });
});

describe("a duplicate of a device's monitor", () => {
  /*
   * The issue's own case: the device already has the import's Ping monitor
   * from "Kiosk Ping", and the same template is asked for again.
   */
  it("is one made from the same template", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
      monitorTemplateId: KIOSK_PING_TEMPLATE,
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  it("is one made from the same template for a Network Device monitor too", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.NetworkDevice,
      monitorTemplateId: ALERT_PACK_TEMPLATE,
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.NetworkDevice,
          monitorTemplateId: ALERT_PACK_TEMPLATE,
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  it("matches a template id however its case is written", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
      monitorTemplateId: KIOSK_PING_TEMPLATE.toUpperCase(),
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  /*
   * What the (device, template) index could never see: a second Ping
   * template gave the device a second Ping monitor.
   */
  it("is a Ping monitor from another template", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
      monitorTemplateId: OTHER_PING_TEMPLATE,
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  /*
   * A monitor whose template was deleted (the link is set to null) or that
   * was unlinked from it, or the Ping monitor bound to a monitor-backed
   * device: no template, the same check.
   */
  it("is a Ping monitor that came from no template at all", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  it("is an IP monitor beside an IP monitor", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.IP,
      monitorTemplateId: OTHER_PING_TEMPLATE,
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.IP,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  it("is a Port monitor that asks on one of the same ports", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Port,
      checkKeys: ["443"],
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Port,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
          ports: [22, 443],
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  it("is an NTP monitor on port 123 when the template's names no port", () => {
    const existing: DeviceMonitorFacts = facts({
      monitorType: MonitorType.NTP,
      checkKeys: ["123"],
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.NTP,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
          ports: [undefined],
        }),
        monitors: [existing],
      }),
    ).toBe(existing);
  });

  it("is the one from the same template when another only checks the same thing", () => {
    const sameKind: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
      monitorTemplateId: OTHER_PING_TEMPLATE,
    });
    const sameTemplate: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
      monitorTemplateId: KIOSK_PING_TEMPLATE,
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [sameKind, sameTemplate],
      }),
    ).toBe(sameTemplate);
  });

  it("is the first, oldest, of two that check the same thing", () => {
    const older: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
    });
    const newer: DeviceMonitorFacts = facts({
      monitorType: MonitorType.Ping,
    });

    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [older, newer],
      }),
    ).toBe(older);
  });
});

describe("a monitor in its own right, on purpose", () => {
  // The brief's own example: a Ping monitor alongside an SNMP one.
  it("is a Ping monitor beside a Network Device monitor", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [
          facts({
            monitorType: MonitorType.NetworkDevice,
            monitorTemplateId: ALERT_PACK_TEMPLATE,
          }),
        ],
      }),
    ).toBeNull();
  });

  it("is a Network Device monitor beside a Ping monitor", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.NetworkDevice,
          monitorTemplateId: ALERT_PACK_TEMPLATE,
        }),
        monitors: [
          facts({
            monitorType: MonitorType.Ping,
            monitorTemplateId: KIOSK_PING_TEMPLATE,
          }),
        ],
      }),
    ).toBeNull();
  });

  /*
   * Two alert sets: an alert policy gives a device a monitor for each policy
   * that covers it, each from its own template.
   */
  it("is a Network Device monitor from another template", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.NetworkDevice,
          monitorTemplateId: CPU_TEMPLATE,
        }),
        monitors: [
          facts({
            monitorType: MonitorType.NetworkDevice,
            monitorTemplateId: ALERT_PACK_TEMPLATE,
          }),
          facts({ monitorType: MonitorType.NetworkDevice }),
        ],
      }),
    ).toBeNull();
  });

  it("is an IP monitor beside a Ping monitor: two kinds of check", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.IP,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [facts({ monitorType: MonitorType.Ping })],
      }),
    ).toBeNull();
  });

  it("is a Port monitor on another port: SSH beside HTTPS", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Port,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
          ports: [22],
        }),
        monitors: [
          facts({ monitorType: MonitorType.Port, checkKeys: ["443"] }),
        ],
      }),
    ).toBeNull();
  });

  it("is an NTP monitor on another port", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.NTP,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
          ports: [1123],
        }),
        monitors: [facts({ monitorType: MonitorType.NTP, checkKeys: ["123"] })],
      }),
    ).toBeNull();
  });

  it("is any monitor of a device that has none", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [],
      }),
    ).toBeNull();
  });

  it("is a monitor from a template when the existing one names no template and checks something else", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: candidate({
          monitorType: MonitorType.Ping,
          monitorTemplateId: KIOSK_PING_TEMPLATE,
        }),
        monitors: [facts({ monitorType: MonitorType.Website, checkKeys: [] })],
      }),
    ).toBeNull();
  });
});

describe("a monitor read for the rule", () => {
  it("carries its id, name, kind, template and what it checks", () => {
    const monitor: Monitor = new Monitor();
    monitor.id = new ObjectID("88888888-8888-4888-8888-888888888888");
    monitor.name = "WB1567KSK02";
    monitor.monitorType = MonitorType.Port;
    monitor.monitorTemplateId = new ObjectID(KIOSK_PING_TEMPLATE);
    monitor.monitorSteps = steps(MonitorType.Port, [22]);

    expect(toDeviceMonitorFacts(monitor)).toEqual({
      id: "88888888-8888-4888-8888-888888888888",
      name: "WB1567KSK02",
      monitorType: MonitorType.Port,
      monitorTemplateId: KIOSK_PING_TEMPLATE,
      checkKeys: ["22"],
    });
  });

  it("names no template when it came from none", () => {
    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.monitorType = MonitorType.Ping;

    const read: DeviceMonitorFacts = toDeviceMonitorFacts(monitor);

    expect(read.monitorTemplateId).toBeUndefined();
    expect(read.name).toBe("");
    expect(read.checkKeys).toEqual([DEVICE_ADDRESS_CHECK_KEY]);
  });

  it("reads a template as the monitor it would make", () => {
    expect(
      toDeviceMonitorCandidate({
        monitorType: MonitorType.Port,
        monitorTemplateId: new ObjectID(KIOSK_PING_TEMPLATE),
        monitorSteps: steps(MonitorType.Port, [5432]),
      }),
    ).toEqual({
      monitorType: MonitorType.Port,
      monitorTemplateId: KIOSK_PING_TEMPLATE,
      checkKeys: ["5432"],
    });

    expect(
      toDeviceMonitorCandidate({
        monitorType: MonitorType.Ping,
        monitorTemplateId: null,
        monitorSteps: undefined,
      }).monitorTemplateId,
    ).toBeUndefined();
  });
});

/*
 * WEB MONITORS OF A DEVICE (issue #9546). A Website, API or SSL Certificate
 * template gives each device a monitor of a URL on its own address. A second
 * of the same kind on the same scheme, port and path - or, for a
 * certificate, the same port - checks the same thing on the device, whatever
 * template it came from or none, so it is a duplicate the way a second Ping
 * monitor is. Another path, another port or another kind is a monitor in its
 * own right.
 */
function urlSteps(monitorType: MonitorType, urls: Array<string>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: urls.map(
      (url: string, index: number): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: "PRN-0024",
          monitorType: monitorType,
          onlineMonitorStatusId: ONLINE_ID,
          offlineMonitorStatusId: OFFLINE_ID,
          defaultIncidentSeverityId: SEVERITY_ID,
          defaultAlertSeverityId: SEVERITY_ID,
        });
        step.data!.id = `step-${index + 1}`;
        step.setMonitorDestination(URL.fromString(url));
        return step;
      },
    ),
    defaultMonitorStatusId: ONLINE_ID,
  };
  return monitorSteps;
}

function webFacts(
  monitorType: MonitorType,
  urls: Array<string>,
  monitorTemplateId?: string | undefined,
): DeviceMonitorFacts {
  return {
    id: ObjectID.generate().toString(),
    name: "PRN-0024",
    monitorType: monitorType,
    monitorTemplateId: monitorTemplateId,
    checkKeys: getDeviceMonitorCheckKeys({
      monitorType: monitorType,
      monitorSteps: urlSteps(monitorType, urls),
    }),
  };
}

function webCandidate(
  monitorType: MonitorType,
  urls: Array<string>,
  monitorTemplateId: string = KIOSK_PING_TEMPLATE,
): DeviceMonitorCandidate {
  return toDeviceMonitorCandidate({
    monitorType: monitorType,
    monitorTemplateId: monitorTemplateId,
    monitorSteps: urlSteps(monitorType, urls),
  });
}

describe("what a device's web monitor checks", () => {
  it("is each URL's scheme, port and path for a Website or API monitor, never its host", () => {
    for (const monitorType of [MonitorType.Website, MonitorType.API]) {
      expect(
        getDeviceMonitorCheckKeys({
          monitorType: monitorType,
          monitorSteps: urlSteps(monitorType, [
            "https://10.40.12.7:8443/status",
            "https://printer.example.com:8443/status",
            "http://10.40.12.7/",
          ]),
        }),
      ).toEqual(["https:8443/status", "http:80/"]);
    }
  });

  it("is each port an SSL Certificate monitor's URLs ask on", () => {
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.SSLCertificate,
        monitorSteps: urlSteps(MonitorType.SSLCertificate, [
          "https://10.40.12.7/",
          "https://10.40.12.7/admin",
          "https://10.40.12.7:8443/",
        ]),
      }),
    ).toEqual(["tls:443", "tls:8443"]);
  });

  it("reads steps stored as JSON, and nothing from a step that checks no URL", () => {
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.Website,
        monitorSteps: urlSteps(MonitorType.Website, [
          "https://10.40.12.7/",
        ]).toJSON(),
      }),
    ).toEqual(["https:443/"]);
    expect(
      getDeviceMonitorCheckKeys({
        monitorType: MonitorType.Website,
        // A step on an address, which a Website monitor cannot check.
        monitorSteps: steps(MonitorType.Port, [22]),
      }),
    ).toEqual([]);
  });
});

describe("a duplicate of a device's web monitor", () => {
  it("is a Website monitor of the same page from another template, or from none", () => {
    const existing: DeviceMonitorFacts = webFacts(MonitorType.Website, [
      "https://printer-01.example.net/hp/device/",
    ]);

    expect(
      findDuplicateDeviceMonitor({
        candidate: webCandidate(MonitorType.Website, [
          "https://10.40.12.7/hp/device/",
        ]),
        monitors: [existing],
      })?.id,
    ).toBe(existing.id);
  });

  it("is an API monitor of the same endpoint, and an SSL Certificate monitor on the same port", () => {
    const api: DeviceMonitorFacts = webFacts(MonitorType.API, [
      "https://10.40.12.7:8443/api/health",
    ]);
    const certificate: DeviceMonitorFacts = webFacts(
      MonitorType.SSLCertificate,
      ["https://10.40.12.7/"],
    );

    expect(
      findDuplicateDeviceMonitor({
        candidate: webCandidate(MonitorType.API, [
          "https://device:8443/api/health",
        ]),
        monitors: [api, certificate],
      })?.id,
    ).toBe(api.id);
    expect(
      findDuplicateDeviceMonitor({
        candidate: webCandidate(MonitorType.SSLCertificate, [
          "https://device/login",
        ]),
        monitors: [api, certificate],
      })?.id,
    ).toBe(certificate.id);
  });

  it("is the one from the same template, whatever URL it checks now", () => {
    const fromTemplate: DeviceMonitorFacts = webFacts(
      MonitorType.Website,
      ["https://10.40.12.7/old"],
      OTHER_PING_TEMPLATE,
    );

    expect(
      findDuplicateDeviceMonitor({
        candidate: webCandidate(
          MonitorType.Website,
          ["https://device/new"],
          OTHER_PING_TEMPLATE,
        ),
        monitors: [fromTemplate],
      })?.id,
    ).toBe(fromTemplate.id);
  });
});

describe("a web monitor in its own right, on purpose", () => {
  it("is a Website monitor of another path, another port or another scheme", () => {
    const existing: DeviceMonitorFacts = webFacts(MonitorType.Website, [
      "https://10.40.12.7/status",
    ]);

    for (const url of [
      "https://device/other",
      "https://device:8443/status",
      "http://device/status",
    ]) {
      expect(
        findDuplicateDeviceMonitor({
          candidate: webCandidate(MonitorType.Website, [url]),
          monitors: [existing],
        }),
      ).toBeNull();
    }
  });

  it("is a Website monitor beside an SSL Certificate or an API monitor of the same URL: other kinds of check", () => {
    const monitors: Array<DeviceMonitorFacts> = [
      webFacts(MonitorType.SSLCertificate, ["https://10.40.12.7/"]),
      webFacts(MonitorType.API, ["https://10.40.12.7/"]),
    ];

    expect(
      findDuplicateDeviceMonitor({
        candidate: webCandidate(MonitorType.Website, ["https://device/"]),
        monitors: monitors,
      }),
    ).toBeNull();
  });

  it("is an SSL Certificate monitor on another port", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: webCandidate(MonitorType.SSLCertificate, [
          "https://device:8443/",
        ]),
        monitors: [
          webFacts(MonitorType.SSLCertificate, ["https://10.40.12.7/"]),
        ],
      }),
    ).toBeNull();
  });

  it("is a Website monitor beside a Ping monitor of the device", () => {
    expect(
      findDuplicateDeviceMonitor({
        candidate: webCandidate(MonitorType.Website, ["https://device/"]),
        monitors: [facts({ monitorType: MonitorType.Ping })],
      }),
    ).toBeNull();
  });
});
