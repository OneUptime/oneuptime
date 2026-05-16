import SnmpMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SnmpMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import SnmpDataType from "../../../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";

const PSU_OID: string = "1.3.6.1.4.1.674.10892.5.4.600.12.1.5.1.2";

function buildDataToProcess(input: {
  oidResponses: Array<SnmpOidResponse>;
  isOnline?: boolean;
  responseTimeInMs?: number;
}): ProbeMonitorResponse {
  const snmpResponse: SnmpMonitorResponse = {
    isOnline: input.isOnline ?? true,
    responseTimeInMs: input.responseTimeInMs ?? 42,
    failureCause: "",
    oidResponses: input.oidResponses,
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    snmpResponse,
    monitoredAt: new Date(),
  };
}

describe("SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("SnmpOidValue with Integer values (regression for issue #2439)", () => {
    test("Integer 3 equals 3 → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            name: "PSU2 Status",
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain(PSU_OID);
      expect(result).toContain("equal to 3");
    });

    test("Integer 3 equals 5 → criteria is not met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "5",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("Integer 3 not-equal 6 → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.NotEqualTo,
        value: "6",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("not equal to 6");
    });

    test("Integer 3 contains '3' → criteria is met (string fallback path)", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.Contains,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("contains 3");
    });

    test("Integer 3 greater-than-or-equal 3 → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.GreaterThanOrEqualTo,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
    });
  });

  describe("SnmpOidValue with string (OctetString) values", () => {
    test("'OK' equals 'OK' → criteria is met", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "OK",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: "OK",
            type: SnmpDataType.OctetString,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("equal to OK");
    });
  });

  describe("SnmpOidValue guards", () => {
    test("returns null when no OID is configured on the criteria filter", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "3",
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });

    test("returns null when the configured OID is not in the SNMP response", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidValue,
        filterType: FilterType.EqualTo,
        value: "3",
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: "1.3.6.1.2.1.1.1.0",
            value: "Linux server",
            type: SnmpDataType.OctetString,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeNull();
    });
  });

  describe("SnmpOidExists", () => {
    test("True filter matches when OID is present and has a value", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidExists,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [
          {
            oid: PSU_OID,
            value: 3,
            type: SnmpDataType.Integer,
          },
        ],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("exists");
    });

    test("False filter matches when OID is absent", async () => {
      const criteriaFilter: CriteriaFilter = {
        checkOn: CheckOn.SnmpOidExists,
        filterType: FilterType.False,
        value: undefined,
        snmpMonitorOptions: { oid: PSU_OID },
      };

      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
        oidResponses: [],
      });

      const result: string | null =
        await SnmpMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess,
          criteriaFilter,
        });

      expect(result).toBeTruthy();
      expect(result).toContain("does not exist");
    });
  });
});
