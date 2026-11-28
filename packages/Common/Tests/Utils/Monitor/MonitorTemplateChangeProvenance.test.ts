import ObjectID from "../../../Types/ObjectID";
import MonitorTemplateChangeProvenance, {
  TemplateChangeProvenancePatch,
} from "../../../Utils/Monitor/MonitorTemplateChangeProvenance";
import { describe, expect, it } from "@jest/globals";

/*
 * WHAT A MONITOR KEEPS WHEN ITS TEMPLATE CHANGES (issues #11260, #11266).
 *
 * The import, the auto import rule or the alert policy that made a
 * device's monitor knows it by the template it was created from, so a move
 * to another template, or an unlink, keeps that template on the monitor -
 * once, the first time it moves - and a person's move takes the monitor
 * from the policy that owned it, which would otherwise delete it.
 */

const WAREHOUSE_TEMPLATE: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const BETTER_TEMPLATE: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const FIRST_TEMPLATE: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const POLICY: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

describe("what a change of a monitor's template keeps", () => {
  it("keeps the template a monitor made before it was recorded leaves", () => {
    const patch: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: { monitorTemplateId: WAREHOUSE_TEMPLATE },
        writtenMonitorTemplateId: BETTER_TEMPLATE,
        isOneUptimesOwnWrite: false,
      });

    expect(patch.createdFromMonitorTemplateId?.toString()).toBe(
      WAREHOUSE_TEMPLATE.toString(),
    );
    expect(Object.keys(patch)).toEqual(["createdFromMonitorTemplateId"]);
  });

  it("keeps it on an unlink too", () => {
    const patch: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: { monitorTemplateId: WAREHOUSE_TEMPLATE },
        writtenMonitorTemplateId: null,
        isOneUptimesOwnWrite: false,
      });

    expect(patch.createdFromMonitorTemplateId?.toString()).toBe(
      WAREHOUSE_TEMPLATE.toString(),
    );
  });

  it("never moves a template it was created from that is recorded already", () => {
    expect(
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: BETTER_TEMPLATE,
          createdFromMonitorTemplateId: FIRST_TEMPLATE,
        },
        writtenMonitorTemplateId: WAREHOUSE_TEMPLATE,
        isOneUptimesOwnWrite: false,
      }),
    ).toEqual({});
  });

  it("keeps nothing for a monitor linked to no template that is linked to one now", () => {
    expect(
      MonitorTemplateChangeProvenance.getPatch({
        stored: {},
        writtenMonitorTemplateId: BETTER_TEMPLATE,
        isOneUptimesOwnWrite: false,
      }),
    ).toEqual({});
  });

  it("keeps nothing when the monitor stays on its template, whatever the case of its id", () => {
    expect(
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: WAREHOUSE_TEMPLATE.toString().toUpperCase(),
          networkAlertPolicyId: POLICY,
        },
        writtenMonitorTemplateId: WAREHOUSE_TEMPLATE,
        isOneUptimesOwnWrite: false,
      }),
    ).toEqual({});
  });

  it("lets the alert policy go when a person moves the monitor", () => {
    const patch: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: WAREHOUSE_TEMPLATE,
          createdFromMonitorTemplateId: WAREHOUSE_TEMPLATE,
          networkAlertPolicyId: POLICY,
        },
        writtenMonitorTemplateId: BETTER_TEMPLATE,
        isOneUptimesOwnWrite: false,
      });

    expect(patch).toEqual({ networkAlertPolicyId: null });
  });

  it("lets the alert policy go when a person unlinks the monitor", () => {
    const patch: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: WAREHOUSE_TEMPLATE,
          networkAlertPolicyId: POLICY,
        },
        writtenMonitorTemplateId: undefined,
        isOneUptimesOwnWrite: false,
      });

    expect(patch.networkAlertPolicyId).toBeNull();
    expect(patch.createdFromMonitorTemplateId?.toString()).toBe(
      WAREHOUSE_TEMPLATE.toString(),
    );
  });

  /*
   * OneUptime's own write of a policy's monitor to another template is the
   * policy moving it to the template it was pointed at (#11452): it stays
   * the policy's, and is the policy's monitor from that template now - so a
   * person who later moves it off that one has moved the policy's monitor.
   */
  it("keeps the policy on OneUptime's own write, and records the template the policy moved it to", () => {
    const patch: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: WAREHOUSE_TEMPLATE,
          networkAlertPolicyId: POLICY,
        },
        writtenMonitorTemplateId: BETTER_TEMPLATE,
        isOneUptimesOwnWrite: true,
      });

    expect(patch.networkAlertPolicyId).toBeUndefined();
    expect(patch.createdFromMonitorTemplateId?.toString()).toBe(
      BETTER_TEMPLATE.toString(),
    );
  });

  it("moves the recorded template on with the policy's every move, and writes nothing when it is that one already", () => {
    const moved: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: BETTER_TEMPLATE,
          createdFromMonitorTemplateId: WAREHOUSE_TEMPLATE,
          networkAlertPolicyId: POLICY,
        },
        writtenMonitorTemplateId: WAREHOUSE_TEMPLATE,
        isOneUptimesOwnWrite: true,
      });

    expect(moved).toEqual({});

    const movedOn: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: WAREHOUSE_TEMPLATE,
          createdFromMonitorTemplateId: WAREHOUSE_TEMPLATE,
          networkAlertPolicyId: POLICY,
        },
        writtenMonitorTemplateId: BETTER_TEMPLATE,
        isOneUptimesOwnWrite: true,
      });

    expect(movedOn.createdFromMonitorTemplateId?.toString()).toBe(
      BETTER_TEMPLATE.toString(),
    );
  });

  it("keeps the template it was created from on OneUptime's own unlink of a policy's monitor", () => {
    const patch: TemplateChangeProvenancePatch =
      MonitorTemplateChangeProvenance.getPatch({
        stored: {
          monitorTemplateId: WAREHOUSE_TEMPLATE,
          networkAlertPolicyId: POLICY,
        },
        writtenMonitorTemplateId: null,
        isOneUptimesOwnWrite: true,
      });

    expect(patch.networkAlertPolicyId).toBeUndefined();
    expect(patch.createdFromMonitorTemplateId?.toString()).toBe(
      WAREHOUSE_TEMPLATE.toString(),
    );
  });
});

describe("telling templates and patches apart", () => {
  it("two ids name the same template whatever their case, and two empties name none", () => {
    expect(
      MonitorTemplateChangeProvenance.isSameTemplate(
        WAREHOUSE_TEMPLATE,
        WAREHOUSE_TEMPLATE.toString().toUpperCase(),
      ),
    ).toBe(true);
    expect(
      MonitorTemplateChangeProvenance.isSameTemplate(null, undefined),
    ).toBe(true);
    expect(
      MonitorTemplateChangeProvenance.isSameTemplate(WAREHOUSE_TEMPLATE, null),
    ).toBe(false);
  });

  it("an empty patch writes nothing", () => {
    expect(MonitorTemplateChangeProvenance.isEmpty({})).toBe(true);
    expect(
      MonitorTemplateChangeProvenance.isEmpty({ networkAlertPolicyId: null }),
    ).toBe(false);
  });

  it("two patches are equal when they write the same columns with the same values", () => {
    expect(
      MonitorTemplateChangeProvenance.areEqual(
        { createdFromMonitorTemplateId: WAREHOUSE_TEMPLATE },
        {
          createdFromMonitorTemplateId: new ObjectID(
            WAREHOUSE_TEMPLATE.toString(),
          ),
        },
      ),
    ).toBe(true);
    expect(
      MonitorTemplateChangeProvenance.areEqual(
        { createdFromMonitorTemplateId: WAREHOUSE_TEMPLATE },
        { createdFromMonitorTemplateId: BETTER_TEMPLATE },
      ),
    ).toBe(false);
    expect(
      MonitorTemplateChangeProvenance.areEqual(
        { createdFromMonitorTemplateId: WAREHOUSE_TEMPLATE },
        {
          createdFromMonitorTemplateId: WAREHOUSE_TEMPLATE,
          networkAlertPolicyId: null,
        },
      ),
    ).toBe(false);
    expect(MonitorTemplateChangeProvenance.areEqual({}, {})).toBe(true);
  });
});
