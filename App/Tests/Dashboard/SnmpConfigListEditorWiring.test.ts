import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
  MAX_SNMP_CONFIGS_PER_SCAN,
} from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import {
  SNMP_VERSION_DROPDOWN_OPTIONS,
  SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS,
  SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS,
  SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS,
  SnmpDropdownOption,
  isSnmpV3,
  isSnmpV3WithAuth,
  isSnmpV3WithPriv,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/SnmpConfigFormFields";

/*
 * "Add SNMP Config" — the discovery scan's repeated credential editor
 * (Components/NetworkDevice/SnmpConfigListEditor.tsx), for OneUptime issue
 * #3458.
 *
 * A scan used to carry ONE credential set. Real subnets are mixed — access
 * switches on v2c with one community, the core on v3, a printer block on the
 * factory default — so a single-credential scan silently missed everything
 * speaking anything else and reported a confident zero. The SNMP step now
 * collects an ordered LIST through this component.
 *
 * WHY THIS FILE READS THE COMPONENT AS TEXT
 *
 * App/tsconfig.json excludes FeatureSet/Dashboard: Dashboard is a separate
 * package with its own react, so anything App's tsc reaches inside a Dashboard
 * .tsx fails on "Cannot find module 'react'", and App/jest.config.json sets
 * testEnvironment "node" so there is no renderer to mount it in either. The
 * component's own exported helpers — buildEmptySnmpConfig and
 * toEditableConfigs — are therefore unreachable from here, and their BEHAVIOUR
 * is pinned against the source instead. Same technique as
 * AddNeighborToMonitoringWiring.test.ts and the source-scraping half of
 * SnmpConfigFormFields.test.ts.
 *
 * Everything that CAN be executed for real is, and against the real modules:
 * SnmpConfigFormFields is a plain .ts and imports fine, SnmpScanConfigUtil
 * lives in Common. So each scraped claim about the markup is paired, wherever
 * one exists, with an executed assertion about the rule that claim is serving
 * — "the editor reveals a privacy key box here" next to "and the shared
 * validator demands one for exactly that config". A test that only scraped
 * would pass forever while the two halves drifted apart.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const EDITOR_PATH: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "NetworkDevice",
  "SnmpConfigListEditor.tsx",
);

/*
 * Comments stripped, whitespace collapsed. The component explains most of the
 * rules below in prose that names the very identifiers being asserted on
 * (InputType.PASSWORD, MAX_SNMP_CONFIGS_PER_SCAN, onChange), so an assertion
 * about the code has to read the code rather than the commentary describing
 * it.
 */
function readEditorCode(): string {
  return fs
    .readFileSync(EDITOR_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const EDITOR: string = readEditorCode();

/*
 * The `<Input .../>` element that writes one config key.
 *
 * Sliced backwards from the field's own onChange rather than matched with a
 * regex, because a JSX element containing an arrow function has a `>` in the
 * middle of it and no attribute-level pattern survives that.
 */
function getInputElementFor(configKey: string): string {
  const writeIndex: number = EDITOR.indexOf(
    `updateField(index, "${configKey}"`,
  );

  if (writeIndex === -1) {
    throw new Error(`The editor no longer writes ${configKey}`);
  }

  const openIndex: number = EDITOR.lastIndexOf("<Input", writeIndex);

  if (openIndex === -1) {
    throw new Error(`${configKey} is no longer written by an <Input>`);
  }

  return EDITOR.slice(openIndex, writeIndex);
}

/*
 * The named-import block the editor pulls out of SnmpConfigFormFields —
 * whatever order the names happen to be written in.
 */
function getSharedFormFieldsImportBlock(): string {
  const fromIndex: number = EDITOR.indexOf(
    '} from "../../Pages/NetworkDevice/SnmpConfigFormFields"',
  );

  if (fromIndex === -1) {
    throw new Error(
      "The editor no longer imports anything from SnmpConfigFormFields",
    );
  }

  return EDITOR.slice(EDITOR.lastIndexOf("import {", fromIndex), fromIndex);
}

// A card the operator has filled in, used wherever the shape has to be legal.
function v2cConfig(id: string): DiscoveryScanSnmpConfig {
  return { id: id, snmpVersion: "V2c" };
}

/*
 * The names the editor must take from SnmpConfigFormFields rather than declare
 * for itself. Listed once, asserted twice: that the editor really imports each
 * of them, and that the module really exports each of them.
 */
const SHARED_OPTION_EXPORTS: Array<string> = [
  "SNMP_VERSION_DROPDOWN_OPTIONS",
  "SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS",
  "SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS",
  "SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS",
];

const SHARED_REVEAL_EXPORTS: Array<string> = [
  "isSnmpV3",
  "isSnmpV3WithAuth",
  "isSnmpV3WithPriv",
];

describe("the editor takes its dropdowns and v3 reveal rules from the flat SNMP form", () => {
  /*
   * The whole reason SnmpConfigFormFields grew these exports. The
   * NetworkDevice create/edit forms still build nine flat Fields from that
   * module; this editor builds a repeated card. If the two declared their own
   * option lists and their own "when do we ask for a privacy key?" rule, the
   * device form and the scan form would answer the same question differently
   * — which is how the v3 fields went missing from a form the first time
   * round.
   */
  test.each([...SHARED_OPTION_EXPORTS, ...SHARED_REVEAL_EXPORTS])(
    "imports %s rather than declaring it",
    (exportName: string) => {
      expect(getSharedFormFieldsImportBlock()).toContain(exportName);
    },
  );

  test("imports the option type itself, so an option shape cannot drift either", () => {
    expect(getSharedFormFieldsImportBlock()).toContain("SnmpDropdownOption");
  });

  /*
   * The other half of the same claim, executed rather than scraped: a scrape
   * of an import list would keep passing after the module stopped exporting
   * one of those names, because a stale import is a compile error somewhere
   * ELSE.
   */
  test("every name it imports is really exported by SnmpConfigFormFields", () => {
    const exported: Record<string, unknown> = {
      SNMP_VERSION_DROPDOWN_OPTIONS: SNMP_VERSION_DROPDOWN_OPTIONS,
      SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS:
        SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS,
      SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS:
        SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS,
      SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS:
        SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS,
      isSnmpV3: isSnmpV3,
      isSnmpV3WithAuth: isSnmpV3WithAuth,
      isSnmpV3WithPriv: isSnmpV3WithPriv,
    };

    for (const exportName of [
      ...SHARED_OPTION_EXPORTS,
      ...SHARED_REVEAL_EXPORTS,
    ]) {
      expect(exported[exportName]).toBeDefined();
    }
  });

  /*
   * The signature of a hand-rolled option list is a `{ label: ..., value: ...
   * }` literal, which is the shape of SnmpDropdownOption. The editor renders
   * dropdowns exclusively from the imported constants, so it has no reason to
   * write one — the same rule SnmpConfigFormFields.test.ts enforces on the
   * pages that spread the flat fields.
   */
  test("declares no dropdown options of its own", () => {
    expect(EDITOR).not.toContain("label:");
  });

  test("each dropdown is rendered from an imported constant", () => {
    for (const optionsExport of SHARED_OPTION_EXPORTS) {
      expect(EDITOR).toContain(`options: ${optionsExport},`);
    }
  });

  /*
   * The reveal chain, executed. `isSnmpV3` decides whether the card shows a
   * community string or the v3 block; the shared validator decides whether a
   * username is demanded. Those are two expressions of one rule, and a card
   * that hides the username box while the validator demands one is a form the
   * operator cannot satisfy.
   */
  test("hiding the community string and demanding a v3 username are one decision", () => {
    const v2c: DiscoveryScanSnmpConfig = { id: "a", snmpVersion: "V2c" };
    const v3: DiscoveryScanSnmpConfig = { id: "a", snmpVersion: "V3" };

    expect(isSnmpV3(v2c)).toBe(false);
    expect(SnmpScanConfigUtil.getValidationError([v2c])).toBeNull();

    expect(isSnmpV3(v3)).toBe(true);
    expect(SnmpScanConfigUtil.getValidationError([v3])).toContain("username");
  });

  /*
   * The same agreement for the two key boxes. For every security level the
   * dropdown offers: the editor reveals an authentication key box exactly when
   * the validator will refuse the card without one, and a privacy key box
   * exactly when it will refuse the card without THAT.
   */
  test.each(
    SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS.map(
      (option: SnmpDropdownOption): [string] => {
        return [option.value];
      },
    ),
  )(
    "at security level %s the editor reveals exactly the keys the validator demands",
    (securityLevel: string) => {
      const base: DiscoveryScanSnmpConfig = {
        id: "core",
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: securityLevel,
      };

      if (isSnmpV3WithAuth(base)) {
        expect(SnmpScanConfigUtil.getValidationError([base])).toContain(
          "authentication key",
        );
      }

      const withAuthKey: DiscoveryScanSnmpConfig = {
        ...base,
        snmpV3AuthKey: "authentication passphrase",
      };

      if (isSnmpV3WithPriv(base)) {
        expect(SnmpScanConfigUtil.getValidationError([withAuthKey])).toContain(
          "privacy key",
        );
      }

      const complete: DiscoveryScanSnmpConfig = isSnmpV3WithPriv(base)
        ? { ...withAuthKey, snmpV3PrivKey: "privacy passphrase" }
        : withAuthKey;

      // Everything the editor asks for, and nothing left to complain about.
      expect(SnmpScanConfigUtil.getValidationError([complete])).toBeNull();
    },
  );

  /*
   * The version dropdown writes the STORED spelling ("V1"/"V2c"/"V3"), not the
   * SnmpVersion enum values ("1"/"2c"/"3"). Reading the column by comparing it
   * to an enum member is the mistake that polls a v3 device in cleartext, so
   * the value the dropdown writes has to be the value the shared normalizer
   * hands back unchanged.
   */
  test.each(
    SNMP_VERSION_DROPDOWN_OPTIONS.map(
      (option: SnmpDropdownOption): [string] => {
        return [option.value];
      },
    ),
  )(
    "the version option %s round-trips through the shared normalizer",
    (value: string) => {
      expect(SnmpScanConfigUtil.toStoredVersion(value)).toBe(value);
    },
  );

  /*
   * And every protocol the two protocol dropdowns offer is one the shared
   * validator recognizes — an option the operator can pick that the validator
   * then calls unrecognized is a dead end with no way out of it.
   */
  test("every auth and privacy protocol the dropdowns offer is accepted", () => {
    for (const authProtocol of SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS) {
      for (const privProtocol of SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS) {
        const config: DiscoveryScanSnmpConfig = {
          id: "core",
          snmpVersion: "V3",
          snmpV3Username: "monitoring",
          snmpV3SecurityLevel: "authPriv",
          snmpV3AuthProtocol: authProtocol.value,
          snmpV3AuthKey: "authentication passphrase",
          snmpV3PrivProtocol: privProtocol.value,
          snmpV3PrivKey: "privacy passphrase",
        };

        expect(SnmpScanConfigUtil.getValidationError([config])).toBeNull();
      }
    }
  });
});

describe("the editor masks credentials without hashing them", () => {
  /*
   * The distinction this whole component would die on. InputType.PASSWORD is a
   * masked TEXT box: it round-trips its value, exactly like the EncryptedText
   * field type the flat SNMP form uses. FormFieldSchemaType.Password is a
   * one-way HASH — a community string saved through one can never be presented
   * to a device again, and the failure is silent: the scan runs and finds
   * nothing. That is the drift SnmpConfigFormFields.test.ts guards the flat
   * forms against, and it has to be guarded here too now that the scan page's
   * SNMP step is this component rather than those fields.
   */
  test.each([
    ["the community string", "snmpCommunityString"],
    ["the v3 authentication key", "snmpV3AuthKey"],
    ["the v3 privacy key", "snmpV3PrivKey"],
  ])("%s is masked but round-trips", (_label: string, configKey: string) => {
    const element: string = getInputElementFor(configKey);

    expect(element).toContain("type={InputType.PASSWORD}");
    expect(element).toContain(`initialValue={config.${configKey} || ""}`);
  });

  test("no SNMP credential goes through a one-way hash", () => {
    expect(EDITOR).not.toContain("FormFieldSchemaType");
  });

  /*
   * The username is a security NAME, not a secret — masking it would only stop
   * the operator from checking what they typed. Pinned so that a
   * well-intentioned "mask everything under v3" change has to be deliberate.
   */
  test("the v3 username is not masked, because it is not a secret", () => {
    expect(getInputElementFor("snmpV3Username")).not.toContain("InputType");
  });

  /*
   * The card header is rendered into the DOM and the same helper's output
   * reaches the probe's log and the scan's statusMessage, which a Viewer can
   * read. It is built from the operator's name and the version alone.
   */
  test("the card header names the config without quoting a credential", () => {
    const label: string = SnmpScanConfigUtil.getConfigLabel(
      {
        id: "core",
        name: "Core switches",
        snmpVersion: "V3",
        snmpCommunityString: "s3cret-community",
        snmpV3AuthKey: "s3cret-auth",
        snmpV3PrivKey: "s3cret-priv",
      },
      0,
    );

    expect(EDITOR).toContain(
      "SnmpScanConfigUtil.getConfigLabel(config, index)",
    );
    expect(label).toContain("Core switches");
    expect(label).not.toContain("s3cret");
  });
});

describe("the editor reports its value so the form can validate it at all", () => {
  /*
   * The subtlest wiring in the component, and the one nothing else would
   * catch.
   *
   * Validation.validate skips every rule for a key that is not PRESENT in the
   * form values, and a CustomComponent's value only becomes present once the
   * component reports one. Without a report on mount, a create form the
   * operator clicks straight through runs no validation on the credential list
   * whatsoever and posts a scan with no `snmpConfigs` — silently falling back
   * to flattened columns the operator never saw. Both halves of the bug are
   * invisible until a sweep finds nothing.
   */
  test("reports its seeded value from a mount effect", () => {
    const reportIndex: number = EDITOR.indexOf("props.onChange?.(configs);");

    expect(reportIndex).toBeGreaterThan(-1);

    const effectIndex: number = EDITOR.lastIndexOf("useEffect(", reportIndex);
    const effect: string = EDITOR.slice(
      effectIndex,
      EDITOR.indexOf("]);", reportIndex) + 3,
    );

    expect(effectIndex).toBeGreaterThan(-1);
    // An EMPTY dependency array: reported on mount, not on every render.
    expect(effect).toContain("}, []);");
  });

  /*
   * Guarded by a ref rather than by a dependency list. The parent's own
   * setState re-renders this component, and an unguarded report would feed
   * that back into the form on every pass.
   */
  test("the mount report cannot fire twice", () => {
    expect(EDITOR).toContain("useRef<boolean>(false)");
    expect(EDITOR).toContain(
      "if (hasReportedInitialValue.current) { return; }",
    );
    expect(EDITOR).toContain("hasReportedInitialValue.current = true;");
  });

  /*
   * Every later mutation goes through one helper that sets state AND reports.
   * A path that only called setConfigs would show the operator a change the
   * form never learned about, and the scan would save without it.
   */
  test("every mutation reports through the same helper", () => {
    expect(EDITOR).toContain(
      "const update: (next: Array<DiscoveryScanSnmpConfig>) => void = ( next: Array<DiscoveryScanSnmpConfig>, ): void => { setConfigs(next); props.onChange?.(next); };",
    );

    for (const mutation of [
      "update([...configs, buildEmptySnmpConfig()]);",
      "update( configs.filter(",
    ]) {
      expect(EDITOR).toContain(mutation);
    }
  });
});

describe("the editor caps the list at the shared ceiling", () => {
  /*
   * The cap is a time budget: the sweep tries configs in series, so every
   * extra one costs another full SNMP timeout on each address that answers
   * nothing, and a sweep that runs past the probe's deadline is reported
   * Failed with no results. The number belongs to the module that documents
   * that arithmetic, not to this component — and above all not to two places
   * that could disagree, because the editor would then let the operator build
   * a list the API refuses.
   */
  test("imports the ceiling rather than hardcoding a number", () => {
    expect(EDITOR).toContain(
      'import SnmpScanConfigUtil, { DiscoveryScanSnmpConfig, MAX_SNMP_CONFIGS_PER_SCAN, } from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";',
    );
  });

  /*
   * Asserted against every cap comparison in the file rather than against the
   * absence of the literal: the constant's value is a small number that could
   * legitimately appear in a class name or an index, so "does not contain 10"
   * would be the wrong test the day the ceiling moves.
   */
  test("every cap comparison names the constant", () => {
    const comparisons: Array<string> =
      EDITOR.match(/configs\.length >= [A-Za-z_0-9.]+/g) || [];

    expect(comparisons.length).toBeGreaterThanOrEqual(2);

    for (const comparison of comparisons) {
      expect(comparison).toBe("configs.length >= MAX_SNMP_CONFIGS_PER_SCAN");
    }
  });

  test("the Add button is disabled at the ceiling, and says why", () => {
    expect(EDITOR).toContain(
      "disabled={configs.length >= MAX_SNMP_CONFIGS_PER_SCAN}",
    );
    expect(EDITOR).toContain(
      "`A scan can try at most ${MAX_SNMP_CONFIGS_PER_SCAN} SNMP configs.",
    );
  });

  /*
   * And the ceiling the editor stops at is the ceiling the shared validator
   * refuses past — executed, so the two cannot be off by one.
   */
  test("a list at the ceiling saves and one past it does not", () => {
    const atCap: Array<DiscoveryScanSnmpConfig> = Array.from(
      { length: MAX_SNMP_CONFIGS_PER_SCAN },
      (_unused: unknown, index: number): DiscoveryScanSnmpConfig => {
        return v2cConfig(`config-${index}`);
      },
    );

    expect(SnmpScanConfigUtil.getValidationError(atCap)).toBeNull();
    expect(
      SnmpScanConfigUtil.getValidationError([...atCap, v2cConfig("one-more")]),
    ).not.toBeNull();
  });
});

describe("the editor refuses to leave the scan with no credentials", () => {
  /*
   * Not "refuses and complains" — the last card's delete button is not
   * rendered at all, so the operator is never offered an action the component
   * would then decline. The guard behind it is the belt to that braces, for a
   * remove triggered any other way.
   */
  test("the remove button appears only when there is more than one card", () => {
    expect(EDITOR).toContain("{configs.length > 1 && ( <Button");
    expect(EDITOR).toContain("dataTestId={`snmp-config-remove-${index}`}");
  });

  test("removing the last card is refused outright", () => {
    expect(EDITOR).toContain(
      "const removeConfig: (index: number) => void = (index: number): void => { if (configs.length <= 1) { return; }",
    );
  });

  /*
   * Why the floor is one rather than zero, executed: an empty list is not a
   * scan that falls back to the flattened columns, it is a scan the API
   * refuses. Letting the editor reach that state would produce a form that
   * cannot be submitted and gives no box to type a credential into.
   */
  test("an empty list would be refused by the rule the server enforces", () => {
    expect(SnmpScanConfigUtil.getValidationError([])).toBe(
      "Add at least one SNMP config, or the scan has no credentials to try.",
    );
  });

  /*
   * Order is meaningful — the sweep tries the list in order and stops at the
   * first credential that answers — so it has to be changeable without
   * deleting and retyping a card.
   */
  test("order is editable in place, because order is what the sweep follows", () => {
    expect(EDITOR).toContain("moveConfig(index, -1);");
    expect(EDITOR).toContain("moveConfig(index, 1);");
  });
});

describe("the Add SNMP Config button", () => {
  /*
   * The literal string from the issue, and the one thing an operator looks for
   * on the step. Pinned as text because it is also what the e2e and any manual
   * reproduction of #3458 reach for.
   */
  test('is titled "Add SNMP Config" and carries a stable test id', () => {
    expect(EDITOR).toContain('<Button title="Add SNMP Config"');
    expect(EDITOR).toContain('dataTestId="add-snmp-config"');
  });

  test("appends a card rather than replacing the list", () => {
    expect(EDITOR).toContain("update([...configs, buildEmptySnmpConfig()]);");
  });
});

/*
 * buildEmptySnmpConfig and toEditableConfigs are exported from the .tsx
 * precisely so they can be tested as pure functions — but they are exported
 * from a Dashboard .tsx, and an App test cannot import one (see the header
 * comment). So their behaviour is pinned against the source here, and every
 * CONSEQUENCE of that behaviour is asserted for real against
 * SnmpScanConfigUtil, which is the module those consequences land in.
 */
describe("buildEmptySnmpConfig — the card a fresh form starts on", () => {
  test("seeds v2c with an id and nothing else", () => {
    expect(EDITOR).toContain(
      'export function buildEmptySnmpConfig(): DiscoveryScanSnmpConfig { return { id: ObjectID.generate().toString(), snmpVersion: "V2c", }; }',
    );
  });

  /*
   * The consequence that matters: an operator who clicks straight through the
   * wizard without touching the SNMP step must still get a scan that saves and
   * sweeps. No community string is deliberate — the probe falls back to
   * "public", which is a real and very common answer for discovery.
   */
  test("the seeded card is savable exactly as it is", () => {
    const seeded: DiscoveryScanSnmpConfig = {
      id: "minted-by-the-editor",
      snmpVersion: "V2c",
    };

    expect(SnmpScanConfigUtil.getValidationError([seeded])).toBeNull();
  });

  /*
   * "V2c" is the STORED spelling, so the seed survives a round trip through
   * the normalizer the write hooks run. A seed of "2c" would be rewritten on
   * save and the dropdown would then match none of its own options.
   */
  test("the seeded version is the stored spelling, so it survives a save", () => {
    expect(SnmpScanConfigUtil.toStoredVersion("V2c")).toBe("V2c");
    expect(
      SNMP_VERSION_DROPDOWN_OPTIONS.some((option: SnmpDropdownOption) => {
        return option.value === "V2c";
      }),
    ).toBe(true);
  });
});

describe("toEditableConfigs — what the editor starts from", () => {
  /*
   * Three entry states, one rule. A create form is handed `""` (FormField
   * falls back to an empty string for every CustomComponent), an edit form is
   * handed the stored list, and a scan saved before this column existed is
   * handed an empty one. The first and the third must both become ONE card:
   * an empty editor is a step with nothing to type into.
   */
  test("anything that is not a non-empty list becomes exactly one seeded card", () => {
    expect(EDITOR).toContain(
      "if (!Array.isArray(value) || value.length === 0) { return [buildEmptySnmpConfig()]; }",
    );
  });

  test("a stored list is kept as it is, except that missing ids are minted", () => {
    expect(EDITOR).toContain(
      "return value.map((config: DiscoveryScanSnmpConfig) => { return config.id ? config : { ...config, id: ObjectID.generate().toString() }; });",
    );
  });

  /*
   * Why an id is minted rather than left blank, executed against the module
   * that depends on it. An id is how a discovered host records WHICH
   * credential set answered it, and how the import path looks those
   * credentials back up — so a config with no id cannot be found at all, and
   * the importer falls back to the FIRST config in the list.
   */
  test("a config with no id cannot be looked up, so a host imports on the first one", () => {
    const configs: Array<DiscoveryScanSnmpConfig> = [
      v2cConfig("first"),
      { snmpVersion: "V3", snmpV3Username: "monitoring" },
    ];

    expect(SnmpScanConfigUtil.findById(configs, undefined)).toBeUndefined();
    expect(
      SnmpScanConfigUtil.resolveForHost({ snmpConfigs: configs }, undefined).id,
    ).toBe("first");
  });

  /*
   * And why the minted ids have to be UNIQUE: two configs sharing one makes
   * findById ambiguous, so a host found by the second could be imported with
   * the first's community string — the precise bug the id scheme exists to
   * prevent. The shared validator refuses that outright, which is what makes
   * minting (rather than reusing an index) the only safe option.
   */
  test("duplicate ids are refused, which is why ids are minted rather than positional", () => {
    expect(
      SnmpScanConfigUtil.getValidationError([
        v2cConfig("same"),
        v2cConfig("same"),
      ]),
    ).toContain('Two SNMP configs share the id "same"');
  });

  /*
   * The edit form's case. A stored list resolves to itself — same ids, same
   * order — so re-opening a scan shows the operator the credential sets it
   * actually has, in the order the sweep tries them.
   */
  test("a stored list resolves back with its ids and order intact", () => {
    const stored: Array<DiscoveryScanSnmpConfig> = [
      { id: "access", name: "Access switches", snmpVersion: "V2c" },
      { id: "core", name: "Core", snmpVersion: "V3" },
    ];

    const resolved: Array<DiscoveryScanSnmpConfig> = SnmpScanConfigUtil.resolve(
      { snmpConfigs: stored },
    );

    expect(
      resolved.map((config: DiscoveryScanSnmpConfig): string | undefined => {
        return config.id;
      }),
    ).toEqual(["access", "core"]);
  });
});

/*
 * THE OTHER END OF THE LIST: the Discovery page's scans table.
 *
 * The editor above is only half the feature. What the operator typed into it
 * has to come BACK out of the database when they open "Review Results" and
 * import the hosts the sweep found — and a ModelTable only fetches the columns
 * a page asks for. `snmpConfigs` is not a displayed column, so nothing in the
 * table's own rendering needs it and nothing on screen changes if it is
 * dropped from the selection; the loss surfaces days later, on the imported
 * devices.
 *
 * Read as text for exactly the reason this whole file is: App/tsconfig.json
 * excludes FeatureSet/Dashboard, so Discovery.tsx cannot be imported from
 * here. As above, every scraped claim is paired with an executed assertion
 * about the rule it serves.
 */
const DISCOVERY_PAGE_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "Discovery.tsx",
);

/*
 * Comments stripped, whitespace collapsed — and the line-comment pattern
 * deliberately refuses to fire after a colon, so a `https://` inside the page
 * does not eat the rest of its line.
 */
function readDiscoveryPageCode(): string {
  return fs
    .readFileSync(DISCOVERY_PAGE_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

const DISCOVERY_PAGE: string = readDiscoveryPageCode();

/*
 * Only the object literal handed to the scans table's selectMoreFields.
 *
 * SLICED rather than searched, and that is the whole point of this helper:
 * `snmpConfigs: true` also appears on the page as the form field that BINDS
 * the editor to the column (`field: { snmpConfigs: true }`). A whole-file
 * `toContain` would be satisfied by that one and would keep passing with the
 * table's selection deleted — which is the defect, exactly.
 */
function getSelectMoreFieldsBlock(): string {
  const start: number = DISCOVERY_PAGE.indexOf("selectMoreFields={{");

  if (start === -1) {
    throw new Error(
      "The Discovery scans table no longer has a selectMoreFields block",
    );
  }

  const end: number = DISCOVERY_PAGE.indexOf("}}", start);

  if (end === -1) {
    throw new Error(
      "The Discovery scans table's selectMoreFields block is unterminated",
    );
  }

  return DISCOVERY_PAGE.slice(start, end);
}

describe("the Discovery scans table fetches the credential list the import reads", () => {
  /*
   * The guard every slicing test needs. A rename that lost the block would
   * make each assertion below throw rather than pass silently — but a slice
   * that merely landed in the wrong place would not, so its contents are
   * sampled against a field that has nothing to do with SNMP.
   */
  test("the slice this describe reads really is the table's selectMoreFields object", () => {
    const block: string = getSelectMoreFieldsBlock();

    expect(block.length).toBeGreaterThan("selectMoreFields={{".length);
    expect(block).toContain("scannedHostCount: true");
    expect(block).toContain("statusMessage: true");
  });

  /*
   * The defect this test exists for.
   *
   * With `snmpConfigs` unselected, a scan row reaches the Review Results
   * dialog with the column undefined — and SnmpScanConfigUtil.resolve then
   * describes that scan by its FLATTENED columns, which are the mirror of
   * config #1. So every host the probe found with config #2..N is imported
   * carrying the FIRST config's community string: a device that authenticates
   * against nothing, polls red forever, and carries no hint that the scan held
   * the credential it actually needed.
   *
   * Nothing on screen changes when the selection is dropped — the column is
   * not rendered in any cell — so this cannot be caught by looking at the
   * page. It has to be pinned here.
   */
  test("selectMoreFields selects snmpConfigs, or every host imports on the first credential set", () => {
    expect(getSelectMoreFieldsBlock()).toContain("snmpConfigs: true");
  });

  /*
   * Why the assertion above is sliced rather than made against the whole file:
   * the literal really does appear elsewhere on the page, so a whole-file
   * check would be vacuous. Asserted rather than left as a comment, because a
   * later refactor that moved the form field somewhere else would make the
   * slicing look like superstition and invite someone to simplify it away.
   */
  test("the same literal appears outside the block, so a whole-file check would prove nothing", () => {
    const outsideTheBlock: string = DISCOVERY_PAGE.split(
      getSelectMoreFieldsBlock(),
    ).join(" ");

    expect(outsideTheBlock).toContain("snmpConfigs: true");
  });

  /*
   * The flattened columns stay selected BESIDE the list rather than being
   * replaced by it. They are what a legacy scan carries, and what a scan
   * written by an API caller that only knows the old fields carries, and
   * SnmpScanConfigUtil.resolve falls back to them — so dropping them would
   * break the import for exactly the scans that predate this feature.
   */
  test("the flattened credential columns are still selected alongside the list", () => {
    const block: string = getSelectMoreFieldsBlock();

    for (const column of [
      "snmpVersion: true",
      "snmpCommunityString: true",
      "snmpPort: true",
      "snmpV3SecurityLevel: true",
      "snmpV3Username: true",
      "snmpV3AuthProtocol: true",
      "snmpV3AuthKey: true",
      "snmpV3PrivProtocol: true",
      "snmpV3PrivKey: true",
    ]) {
      expect(block).toContain(column);
    }
  });

  /*
   * The executed half: what an unselected column actually costs, run against
   * the real resolver the import path calls.
   *
   * Both rows below describe the SAME scan. One was fetched with the list and
   * one without, and a host the probe recorded as answered by config #2
   * resolves to two different community strings — the second of which is
   * config #1's, on a device that will never poll with it.
   */
  test("a row fetched without the list resolves every host onto the first credential set", () => {
    const storedList: Array<DiscoveryScanSnmpConfig> = [
      {
        id: "access",
        name: "Access switches",
        snmpVersion: "V2c",
        snmpCommunityString: "access-community",
      },
      {
        id: "core",
        name: "Core switches",
        snmpVersion: "V2c",
        snmpCommunityString: "core-community",
      },
    ];

    /*
     * The flattened columns are the server's mirror of config #1, which is
     * what makes the wrong answer below look so plausible: it is a real
     * credential off the real scan, just not the one that answered this host.
     */
    const flattenedMirrorOfFirstConfig: Record<string, string> = {
      snmpVersion: "V2c",
      snmpCommunityString: "access-community",
    };

    expect(
      SnmpScanConfigUtil.resolveForHost(
        { ...flattenedMirrorOfFirstConfig, snmpConfigs: storedList },
        "core",
      ).snmpCommunityString,
    ).toBe("core-community");

    expect(
      SnmpScanConfigUtil.resolveForHost(flattenedMirrorOfFirstConfig, "core")
        .snmpCommunityString,
    ).toBe("access-community");
  });
});
