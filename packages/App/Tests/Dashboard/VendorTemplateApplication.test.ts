import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import { SnmpTableDefinition } from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
  SnmpVendorTemplates,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "Common/Types/ObjectID";
import {
  MATCH_EACH_DEVICE_LABEL,
  MATCH_EACH_DEVICE_VALUE,
  VendorTemplateChoice,
  VendorTemplateChoiceKind,
  VendorTemplateDecision,
  VendorTemplateDeviceFacts,
  VendorTemplateMerge,
  VendorTemplateOption,
  VendorTemplatePlanSummary,
  VendorTemplateSkip,
  decideVendorTemplate,
  getGenericVendorTemplateLabel,
  getVendorTemplateOptions,
  mergeVendorTemplate,
  readVendorTemplateChoice,
  summarizeVendorTemplatePlan,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/VendorTemplateApplication";

/*
 * What "Apply Vendor Template" does to one device, without the network: the
 * dialog's preview and the action itself both read this, so these are the
 * rules the customer's thirty Cambium switches are held to.
 *
 *   - the options are "Match each device's vendor" and then EVERY template
 *     SnmpVendorTemplateUtil knows - a template added there appears here;
 *   - a monitor-backed device and one linked to an OID Collection Template
 *     are left alone, whatever was picked;
 *   - "match" uses the device's own SNMP identity (sysObjectID, and sysDescr
 *     where one enterprise arc hosts two systems), and leaves a device it
 *     cannot identify, or has no template for, alone;
 *   - applying merges into what the device has: its own entries first and
 *     untouched, nothing twice, nothing removed.
 */

function template(id: string): SnmpVendorTemplate {
  const found: SnmpVendorTemplate | undefined =
    SnmpVendorTemplateUtil.getById(id);

  if (!found) {
    throw new Error(`No vendor template "${id}".`);
  }

  return found;
}

const MATCH: VendorTemplateChoice = {
  kind: VendorTemplateChoiceKind.MatchEachDevice,
};

function pick(id: string): VendorTemplateChoice {
  return { kind: VendorTemplateChoiceKind.Template, template: template(id) };
}

// sysObjectIDs the shipped rules know.
const CAMBIUM_CNMATRIX_OID: string = "1.3.6.1.4.1.17713.24.1.2";
const CAMBIUM_WIFI_OID: string = "1.3.6.1.4.1.17713.22.1.5";
const CISCO_OID: string = "1.3.6.1.4.1.9.1.1208";
const EXTREME_OID: string = "1.3.6.1.4.1.1916.2.400";
const UNKNOWN_ENTERPRISE_OID: string = "1.3.6.1.4.1.987654.1";

function device(
  overrides: Partial<VendorTemplateDeviceFacts>,
): VendorTemplateDeviceFacts {
  return {
    monitoringMethod: "Probe",
    oidTemplateId: null,
    sysObjectId: undefined,
    sysDescr: undefined,
    ...overrides,
  };
}

function applied(decision: VendorTemplateDecision): string {
  if (decision.kind !== "apply") {
    throw new Error(`Expected a template, got skip "${decision.skip}".`);
  }

  return decision.template.id;
}

function skipped(decision: VendorTemplateDecision): VendorTemplateSkip {
  if (decision.kind !== "skip") {
    throw new Error(`Expected a skip, got "${decision.template.id}".`);
  }

  return decision.skip;
}

describe("Apply Vendor Template: the options", () => {
  test("start with matching each device's vendor, then list every vendor template in the Settings order", () => {
    const options: Array<VendorTemplateOption> = getVendorTemplateOptions(
      (english: string): string => {
        return english;
      },
    );

    expect(options[0]).toEqual({
      label: MATCH_EACH_DEVICE_LABEL,
      value: MATCH_EACH_DEVICE_VALUE,
    });

    expect(options.slice(1)).toEqual(
      SnmpVendorTemplateUtil.getAll().map((entry: SnmpVendorTemplate) => {
        return { label: entry.label, value: entry.id };
      }),
    );
  });

  test("the customer's Cambium switches have their template on the list", () => {
    const values: Array<string> = getVendorTemplateOptions(
      (english: string): string => {
        return english;
      },
    ).map((option: VendorTemplateOption): string => {
      return option.value;
    });

    expect(values).toContain("cambium-cnmatrix");
    expect(values).toContain("cambium-wifi-ap");
  });

  test("translates the match option and leaves the template names - product names - as they are", () => {
    const options: Array<VendorTemplateOption> = getVendorTemplateOptions(
      (english: string): string => {
        return `[de] ${english}`;
      },
    );

    expect(options[0]!.label).toBe(`[de] ${MATCH_EACH_DEVICE_LABEL}`);
    expect(options[1]!.label).toBe(SnmpVendorTemplateUtil.getAll()[0]!.label);
  });

  /*
   * The handoff to whoever adds vendor templates next: a template appended
   * to SnmpVendorTemplates is offered by the bulk action, and can be picked,
   * with no change to the action.
   */
  test("a template added to the shared list appears in the dialog and can be picked", () => {
    const added: SnmpVendorTemplate = {
      id: "test-only-vendor",
      label: "Test Only Vendor",
      description: "Added by a test.",
      oids: [{ oid: "1.3.6.1.4.1.424242.1.0", name: "CPU %" }],
    };

    SnmpVendorTemplates.push(added);

    try {
      const options: Array<VendorTemplateOption> = getVendorTemplateOptions(
        (english: string): string => {
          return english;
        },
      );

      expect(options).toContainEqual({
        label: "Test Only Vendor",
        value: "test-only-vendor",
      });

      const choice: VendorTemplateChoice | null =
        readVendorTemplateChoice("test-only-vendor");

      expect(choice).toEqual({
        kind: VendorTemplateChoiceKind.Template,
        template: added,
      });
    } finally {
      SnmpVendorTemplates.splice(SnmpVendorTemplates.indexOf(added), 1);
    }
  });
});

describe("Apply Vendor Template: reading the dropdown", () => {
  test("the match value is matching each device", () => {
    expect(readVendorTemplateChoice(MATCH_EACH_DEVICE_VALUE)).toEqual(MATCH);
  });

  test("a template id is that template", () => {
    expect(readVendorTemplateChoice("cambium-cnmatrix")).toEqual(
      pick("cambium-cnmatrix"),
    );
  });

  test("surrounding whitespace does not matter", () => {
    expect(readVendorTemplateChoice("  cisco-ios ")).toEqual(pick("cisco-ios"));
  });

  test.each([undefined, null, "", "   ", "no-such-template", 42])(
    "%p is no choice at all, so nothing is written",
    (value: unknown) => {
      expect(readVendorTemplateChoice(value)).toBeNull();
    },
  );
});

describe("Apply Vendor Template: which devices are left alone", () => {
  test("a monitor-backed device - nothing polls it - whatever was picked", () => {
    for (const choice of [MATCH, pick("cisco-ios")]) {
      expect(
        skipped(
          decideVendorTemplate(
            device({ monitoringMethod: "Monitor", sysObjectId: CISCO_OID }),
            choice,
          ),
        ),
      ).toBe(VendorTemplateSkip.MonitorBacked);
    }
  });

  test("monitor-backed wins over being linked, so the reason given is the first one that applies", () => {
    expect(
      skipped(
        decideVendorTemplate(
          device({
            monitoringMethod: "Monitor",
            oidTemplateId: ObjectID.generate(),
          }),
          pick("cisco-ios"),
        ),
      ),
    ).toBe(VendorTemplateSkip.MonitorBacked);
  });

  test("a device linked to an OID Collection Template, by id or by its string, whatever was picked", () => {
    for (const linked of [ObjectID.generate(), "a-template-id"]) {
      for (const choice of [MATCH, pick("cambium-cnmatrix")]) {
        expect(
          skipped(
            decideVendorTemplate(
              device({
                oidTemplateId: linked,
                sysObjectId: CAMBIUM_CNMATRIX_OID,
              }),
              choice,
            ),
          ),
        ).toBe(VendorTemplateSkip.LinkedToOidTemplate);
      }
    }
  });

  test("an empty template id is not a link", () => {
    expect(
      applied(
        decideVendorTemplate(
          device({ oidTemplateId: "", sysObjectId: CISCO_OID }),
          MATCH,
        ),
      ),
    ).toBe("cisco-ios");
  });

  test.each([null, undefined, "", "SNMP", "Probe", "probe"])(
    "a device whose monitoring method is %p is probe-polled, not skipped",
    (method: string | null | undefined) => {
      expect(
        applied(
          decideVendorTemplate(
            device({ monitoringMethod: method, sysObjectId: CISCO_OID }),
            MATCH,
          ),
        ),
      ).toBe("cisco-ios");
    },
  );
});

describe("Apply Vendor Template: matching each device's vendor", () => {
  test("Cambium cnMatrix switches get the cnMatrix template", () => {
    expect(
      applied(
        decideVendorTemplate(
          device({ sysObjectId: CAMBIUM_CNMATRIX_OID }),
          MATCH,
        ),
      ),
    ).toBe("cambium-cnmatrix");
  });

  test("Cambium Wi-Fi access points get the Wi-Fi template, not the switch one", () => {
    expect(
      applied(
        decideVendorTemplate(device({ sysObjectId: CAMBIUM_WIFI_OID }), MATCH),
      ),
    ).toBe("cambium-wifi-ap");
  });

  test("the device's sysDescr tells Fabric Engine from EXOS on the same enterprise arc", () => {
    expect(
      applied(
        decideVendorTemplate(
          device({
            sysObjectId: EXTREME_OID,
            sysDescr: "7520-48Y-8C-FabricEngine (9.0.4.0)",
          }),
          MATCH,
        ),
      ),
    ).toBe("extreme-fabric-engine");

    expect(
      applied(
        decideVendorTemplate(
          device({
            sysObjectId: EXTREME_OID,
            sysDescr: "ExtremeXOS (X465-24W) version 32.1",
          }),
          MATCH,
        ),
      ),
    ).toBe("extreme-exos");
  });

  test("a sysObjectID written with a leading dot still matches", () => {
    expect(
      applied(
        decideVendorTemplate(device({ sysObjectId: `.${CISCO_OID}` }), MATCH),
      ),
    ).toBe("cisco-ios");
  });

  test.each([undefined, null, "", "   "])(
    "a device with no sysObjectID (%p) is not identified yet",
    (sysObjectId: string | null | undefined) => {
      expect(
        skipped(decideVendorTemplate(device({ sysObjectId }), MATCH)),
      ).toBe(VendorTemplateSkip.NotIdentified);
    },
  );

  test("a device whose vendor has no template is left alone, not given the generic one", () => {
    expect(
      skipped(
        decideVendorTemplate(
          device({ sysObjectId: UNKNOWN_ENTERPRISE_OID }),
          MATCH,
        ),
      ),
    ).toBe(VendorTemplateSkip.NoMatchingTemplate);
  });

  test("an OID outside the enterprises arc matches nothing", () => {
    expect(
      skipped(
        decideVendorTemplate(device({ sysObjectId: "1.3.6.1.2.1.1" }), MATCH),
      ),
    ).toBe(VendorTemplateSkip.NoMatchingTemplate);
  });
});

describe("Apply Vendor Template: a template the operator picked", () => {
  test("applies to a device that has not been identified yet - its OIDs wait for its first walk", () => {
    expect(
      applied(decideVendorTemplate(device({}), pick("cambium-cnmatrix"))),
    ).toBe("cambium-cnmatrix");
  });

  test("applies over what the device's own identity would have matched - the operator knows their gear", () => {
    expect(
      applied(
        decideVendorTemplate(
          device({ sysObjectId: CISCO_OID }),
          pick("host-resources-mib"),
        ),
      ),
    ).toBe("host-resources-mib");
  });

  test("applies to a device no template matches", () => {
    expect(
      applied(
        decideVendorTemplate(
          device({ sysObjectId: UNKNOWN_ENTERPRISE_OID }),
          pick("host-resources-mib"),
        ),
      ),
    ).toBe("host-resources-mib");
  });
});

describe("Apply Vendor Template: merging into what the device has", () => {
  test("a device with nothing gets the template's OIDs and tables, in the template's order", () => {
    const cnMatrix: SnmpVendorTemplate = template("cambium-cnmatrix");

    const merge: VendorTemplateMerge = mergeVendorTemplate({
      snmpOids: [],
      snmpTables: [],
      template: cnMatrix,
    });

    expect(merge.snmpOids).toEqual(cnMatrix.oids);
    expect(merge.snmpTables).toEqual(cnMatrix.tables);
    expect(merge.addedOidCount).toBe(cnMatrix.oids.length);
    expect(merge.addedTableCount).toBe((cnMatrix.tables || []).length);
  });

  test("missing lists are read as empty ones", () => {
    const cisco: SnmpVendorTemplate = template("cisco-ios");

    for (const lists of [
      { snmpOids: null, snmpTables: null },
      { snmpOids: undefined, snmpTables: undefined },
    ]) {
      const merge: VendorTemplateMerge = mergeVendorTemplate({
        ...lists,
        template: cisco,
      });

      expect(merge.snmpOids).toEqual(cisco.oids);
      expect(merge.snmpTables).toEqual([]);
    }
  });

  test("the device's own OIDs stay first and untouched, and an OID it already has is not added twice", () => {
    const cisco: SnmpVendorTemplate = template("cisco-ios");
    const firstTemplateOid: SnmpOid = cisco.oids[0]!;

    const ownOids: Array<SnmpOid> = [
      { oid: "1.3.6.1.4.1.9.2.1.58.0", name: "Busy Per (legacy)" },
      // The same OID as the template's first, under the operator's own name.
      { oid: firstTemplateOid.oid, name: "My CPU name" },
    ];

    const merge: VendorTemplateMerge = mergeVendorTemplate({
      snmpOids: ownOids,
      snmpTables: [],
      template: cisco,
    });

    expect(merge.snmpOids.slice(0, 2)).toEqual(ownOids);
    expect(merge.addedOidCount).toBe(cisco.oids.length - 1);
    expect(
      merge.snmpOids.filter((entry: SnmpOid): boolean => {
        return entry.oid === firstTemplateOid.oid;
      }),
    ).toHaveLength(1);
  });

  test("a table the device already has, by key, is kept as the device has it", () => {
    const cnMatrix: SnmpVendorTemplate = template("cambium-cnmatrix");
    const templateTable: SnmpTableDefinition = cnMatrix.tables![0]!;

    const ownTable: SnmpTableDefinition = {
      ...templateTable,
      name: "Operator's own copy",
    };

    const merge: VendorTemplateMerge = mergeVendorTemplate({
      snmpOids: [],
      snmpTables: [ownTable],
      template: cnMatrix,
    });

    expect(merge.snmpTables[0]).toEqual(ownTable);
    expect(merge.addedTableCount).toBe((cnMatrix.tables || []).length - 1);
  });

  test("a device that already collects everything in the template needs nothing written", () => {
    const cnMatrix: SnmpVendorTemplate = template("cambium-cnmatrix");

    const merge: VendorTemplateMerge = mergeVendorTemplate({
      snmpOids: [...cnMatrix.oids],
      snmpTables: [...(cnMatrix.tables || [])],
      template: cnMatrix,
    });

    expect(merge.addedOidCount).toBe(0);
    expect(merge.addedTableCount).toBe(0);
  });

  test("a template without tables leaves the device's tables alone", () => {
    const ownTable: SnmpTableDefinition =
      template("cambium-cnmatrix").tables![0]!;

    const merge: VendorTemplateMerge = mergeVendorTemplate({
      snmpOids: [],
      snmpTables: [ownTable],
      template: template("cisco-ios"),
    });

    expect(merge.snmpTables).toEqual([ownTable]);
    expect(merge.addedTableCount).toBe(0);
  });

  test("never changes the lists it was handed", () => {
    const ownOids: Array<SnmpOid> = [{ oid: "1.3.6.1.4.1.9.2.1.58.0" }];
    const ownTables: Array<SnmpTableDefinition> = [];

    mergeVendorTemplate({
      snmpOids: ownOids,
      snmpTables: ownTables,
      template: template("cambium-cnmatrix"),
    });

    expect(ownOids).toEqual([{ oid: "1.3.6.1.4.1.9.2.1.58.0" }]);
    expect(ownTables).toEqual([]);
  });
});

describe("Apply Vendor Template: the dialog's preview", () => {
  const FLEET: Array<VendorTemplateDeviceFacts> = [
    device({ sysObjectId: CAMBIUM_CNMATRIX_OID }),
    device({ sysObjectId: CAMBIUM_CNMATRIX_OID }),
    device({ sysObjectId: CAMBIUM_CNMATRIX_OID }),
    device({ sysObjectId: CISCO_OID }),
    device({ sysObjectId: undefined }),
    device({ sysObjectId: undefined }),
    device({ sysObjectId: UNKNOWN_ENTERPRISE_OID }),
    device({ oidTemplateId: "linked", sysObjectId: CISCO_OID }),
    device({ monitoringMethod: "Monitor" }),
  ];

  test("matching: each template with how many devices get it, most first, then why the rest are left alone", () => {
    const plan: VendorTemplatePlanSummary = summarizeVendorTemplatePlan(
      FLEET,
      MATCH,
    );

    expect(
      plan.applying.map(
        (entry: { template: SnmpVendorTemplate; deviceCount: number }) => {
          return [entry.template.id, entry.deviceCount];
        },
      ),
    ).toEqual([
      ["cambium-cnmatrix", 3],
      ["cisco-ios", 1],
    ]);

    expect(plan.skipped).toEqual([
      { skip: VendorTemplateSkip.NotIdentified, deviceCount: 2 },
      { skip: VendorTemplateSkip.NoMatchingTemplate, deviceCount: 1 },
      { skip: VendorTemplateSkip.LinkedToOidTemplate, deviceCount: 1 },
      { skip: VendorTemplateSkip.MonitorBacked, deviceCount: 1 },
    ]);
  });

  test("a picked template: every device that can take it, and only the two real reasons to leave one alone", () => {
    const plan: VendorTemplatePlanSummary = summarizeVendorTemplatePlan(
      FLEET,
      pick("cambium-cnmatrix"),
    );

    expect(
      plan.applying.map(
        (entry: { template: SnmpVendorTemplate; deviceCount: number }) => {
          return [entry.template.id, entry.deviceCount];
        },
      ),
    ).toEqual([["cambium-cnmatrix", 7]]);

    expect(plan.skipped).toEqual([
      { skip: VendorTemplateSkip.LinkedToOidTemplate, deviceCount: 1 },
      { skip: VendorTemplateSkip.MonitorBacked, deviceCount: 1 },
    ]);
  });

  test("templates with as many devices each are listed by name", () => {
    const plan: VendorTemplatePlanSummary = summarizeVendorTemplatePlan(
      [
        device({ sysObjectId: CISCO_OID }),
        device({ sysObjectId: CAMBIUM_CNMATRIX_OID }),
      ],
      MATCH,
    );

    expect(
      plan.applying.map(
        (entry: { template: SnmpVendorTemplate; deviceCount: number }) => {
          return entry.template.label;
        },
      ),
    ).toEqual([
      template("cambium-cnmatrix").label,
      template("cisco-ios").label,
    ]);
  });

  test("nothing selected, nothing planned", () => {
    expect(summarizeVendorTemplatePlan([], MATCH)).toEqual({
      applying: [],
      skipped: [],
    });
  });
});

describe("Apply Vendor Template: the advice for a device nothing matches", () => {
  test("names the generic template by its own label", () => {
    expect(getGenericVendorTemplateLabel()).toBe(
      template("host-resources-mib").label,
    );
  });
});
