import Includes from "../../../Types/BaseDatabase/Includes";
import Dictionary from "../../../Types/Dictionary";
import DeviceManagementProvider, {
  DEVICE_MANAGEMENT_PROVIDERS,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInAttributes,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import {
  ManagedDeviceAlertTemplate,
  ManagedDeviceAlertTemplateArgs,
  getAllManagedDeviceAlertTemplates,
  getManagedDeviceAlertTemplateById,
  getManagedDeviceAlertTemplatesFor,
} from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * EACH SERVICE'S DEVICE TEMPLATES READ ITS SERVICE, AND THE MONITORS MADE
 * BEFORE THEY DID STILL COUNT AS MADE.
 *
 * A device manager's check-in and security patch templates (#9835, #9837,
 * #10086, #10087, #10098) read their connection's readings by its id alone,
 * so two services' templates of one metric - Esper's and SOTI's Apple
 * check-ins, Intune's and Workspace ONE's day-long check-ins, the four
 * services' Security Patch Out of Date - built the same step and shared one
 * fingerprint (MonitorRecommendationCoverage). Their queries now read the
 * service as well, as the battery, storage and connection templates do
 * (#10006, #10008), which picks the same readings: every reading names its
 * connection's service. A monitor made before, whose query reads the
 * connection alone, is still the recommendation it was made from
 * (getEarlierMonitorSteps): it is never offered a second time.
 */

const CONNECTION_ID: string = "8a4e1c2d-3b5f-4a6c-9d7e-0f1a2b3c4d5e";
const OTHER_CONNECTION_ID: string = "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b";

// Every template whose query read its connection alone before.
const DEVICE_TEMPLATE_IDS: Array<string> = [
  "esper-device-stopped-checking-in",
  "esper-apple-device-stopped-checking-in",
  "esper-security-patch-out-of-date",
  "intune-device-stopped-checking-in",
  "intune-security-patch-out-of-date",
  "workspace-one-device-stopped-checking-in",
  "workspace-one-security-patch-out-of-date",
  "soti-device-stopped-checking-in",
  "soti-apple-device-stopped-checking-in",
  "soti-security-patch-out-of-date",
];

function recommendationArgs(
  overrides: Partial<MonitorRecommendationArgs> = {},
): MonitorRecommendationArgs {
  return {
    resourceIdentifier: CONNECTION_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Stores West",
    ...overrides,
  };
}

function templateArgs(
  connectionId: string = CONNECTION_ID,
): ManagedDeviceAlertTemplateArgs {
  return {
    deviceManagementConnectionId: connectionId,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Stores West",
  };
}

function queryOf(step: MonitorStep): MetricQueryConfigData {
  return MonitorStep.getMetricsViewConfig(step)!.queryConfigs[0]!;
}

function attributesOf(step: MonitorStep): Dictionary<unknown> {
  return (queryOf(step).metricQueryData.filterData.attributes ||
    {}) as Dictionary<unknown>;
}

/*
 * The step a monitor made before the templates read their service has, as
 * Postgres hands it back: today's step, its query's service taken out,
 * through the JSON the monitor's steps are stored as - so an Includes of
 * platforms comes back from JSON, as it does from the database.
 */
function storedEarlierStep(
  template: ManagedDeviceAlertTemplate,
  connectionId: string = CONNECTION_ID,
): MonitorStep {
  const step: MonitorStep = template.getMonitorStep(templateArgs(connectionId));
  const attributes: Dictionary<unknown> = attributesOf(step);

  delete attributes[ManagedDeviceCheckInAttribute.Provider];

  return storedStep(step);
}

function storedStep(step: MonitorStep): MonitorStep {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };

  // As the column stores it (MonitorSteps.toDatabase), and reads it back.
  const stored: JSONObject = JSON.parse(
    JSON.stringify(MonitorSteps.toDatabaseJSON(steps.toJSON())),
  ) as JSONObject;

  return MonitorSteps.fromJSON(stored).data!.monitorStepsInstanceArray[0]!;
}

function recommendationsOf(
  provider: DeviceManagementProvider,
): Array<MonitorRecommendation> {
  return MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.DeviceManagementConnection,
    { deviceManagementProvider: provider },
  );
}

function recommendationIdOf(templateId: string): string {
  return `${MonitorRecommendationResourceType.DeviceManagementConnection}:${templateId}`;
}

function fingerprintOf(step: MonitorStep): string {
  return MonitorRecommendationUtil.serializeFingerprint(
    MonitorRecommendationUtil.getFingerprintFromMonitorStep(step)!,
  );
}

describe("each service's device templates read its service", () => {
  test.each(DEVICE_TEMPLATE_IDS)(
    "%s reads its connection and its own service",
    (templateId: string) => {
      const template: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(templateId)!;
      const attributes: Dictionary<unknown> = attributesOf(
        template.getMonitorStep(templateArgs()),
      );

      expect(attributes[ManagedDeviceCheckInAttribute.ConnectionId]).toBe(
        CONNECTION_ID,
      );
      expect(attributes[ManagedDeviceCheckInAttribute.Provider]).toBe(
        template.provider,
      );
      expect(attributes[ManagedDeviceCheckInAttribute.IsHost]).toBe("false");
    },
  );

  test("every template of every service reads its own service", () => {
    for (const template of getAllManagedDeviceAlertTemplates()) {
      expect({
        id: template.id,
        provider: attributesOf(template.getMonitorStep(templateArgs()))[
          ManagedDeviceCheckInAttribute.Provider
        ],
      }).toEqual({ id: template.id, provider: template.provider });
    }
  });

  /*
   * The collisions MonitorRecommendationCoverage found on main, named: the
   * same metric, the same platforms and the same threshold, told apart by
   * their service alone.
   */
  test.each([
    [
      "esper-apple-device-stopped-checking-in",
      "soti-apple-device-stopped-checking-in",
    ],
    [
      "intune-device-stopped-checking-in",
      "workspace-one-device-stopped-checking-in",
    ],
    [
      "esper-security-patch-out-of-date",
      "intune-security-patch-out-of-date",
      "workspace-one-security-patch-out-of-date",
      "soti-security-patch-out-of-date",
    ],
  ])(
    "%s and the others of its metric fingerprint apart",
    (...templateIds: Array<string>) => {
      const fingerprints: Set<string> = new Set<string>(
        templateIds.map((templateId: string): string => {
          return fingerprintOf(
            getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep(
              templateArgs(),
            ),
          );
        }),
      );

      expect(fingerprints.size).toBe(templateIds.length);

      // Before, their queries read the connection alone: one fingerprint.
      const earlier: Set<string> = new Set<string>(
        templateIds.map((templateId: string): string => {
          return fingerprintOf(
            storedEarlierStep(getManagedDeviceAlertTemplateById(templateId)!),
          );
        }),
      );

      expect(earlier.size).toBe(1);
    },
  );

  /*
   * What the service changes: nothing a connection's readings say. Every
   * reading a read writes names its connection's service, so the query
   * that reads the service picks exactly the rows the one before did.
   */
  test.each(DEVICE_TEMPLATE_IDS)(
    "%s reads the same readings as its query did before",
    (templateId: string) => {
      const template: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(templateId)!;
      const platform: ManagedDevicePlatform =
        template.platforms?.[0] || ManagedDevicePlatform.Android;
      const reading: ManagedDeviceCheckInReading = {
        deviceName: "STORE-0412-TC52",
        hostName: "store-0412-tc52",
        alias: "Store 412 scanner",
        group: "Stores/West/0412",
        platform,
        ageInMinutes: 75,
        isHost: false,
      };
      // Each reading's attributes, as the read writes them on its row.
      const rows: Array<JSONObject> = [CONNECTION_ID, OTHER_CONNECTION_ID].map(
        (connectionId: string): JSONObject => {
          return {
            name: template.metricName,
            attributes: getManagedDeviceCheckInAttributes({
              reading,
              connectionId,
              provider: template.provider,
            }),
          } as JSONObject;
        },
      );

      const readBy: (step: MonitorStep) => Array<JSONObject> = (
        step: MonitorStep,
      ): Array<JSONObject> => {
        const wanted: Dictionary<unknown> = attributesOf(step);

        return rows.filter((row: JSONObject): boolean => {
          const attributes: Dictionary<unknown> = row[
            "attributes"
          ] as Dictionary<unknown>;

          return Object.entries(wanted).every(
            ([key, value]: [string, unknown]): boolean => {
              if (key === ManagedDeviceCheckInAttribute.Platform) {
                return true;
              }

              if (value instanceof Includes) {
                return value.values.includes(attributes[key] as string);
              }

              return attributes[key] === value;
            },
          );
        });
      };

      // The check-in rows stand in for a patch template's: they carry the same attributes.
      const now: Array<JSONObject> = readBy(
        template.getMonitorStep(templateArgs()),
      );
      const before: Array<JSONObject> = readBy(storedEarlierStep(template));

      expect(now).toHaveLength(1);
      expect(now).toEqual(before);
      expect(
        (now[0]!["attributes"] as Dictionary<string>)[
          ManagedDeviceCheckInAttribute.ConnectionId
        ],
      ).toBe(CONNECTION_ID);
      expect([
        MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
        MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
      ]).toContain(template.metricName);
    },
  );
});

describe("a monitor made before its query read its service still counts as made", () => {
  test.each(DEVICE_TEMPLATE_IDS)(
    "%s's, on its own connection, covers its recommendation, and that one alone",
    (templateId: string) => {
      const template: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(templateId)!;
      const recommendations: Array<MonitorRecommendation> = recommendationsOf(
        template.provider,
      );
      const monitorId: ObjectID = ObjectID.generate();

      const covered: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations,
          existingMonitors: [
            { monitorId, monitorSteps: [storedEarlierStep(template)] },
          ],
          args: recommendationArgs(),
        });

      expect([...covered.keys()]).toEqual([recommendationIdOf(templateId)]);
      expect(covered.get(recommendationIdOf(templateId))).toBe(monitorId);

      // The side-menu badge counts the same diff, and agrees.
      expect([
        ...MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations,
          existingMonitorSteps: [storedEarlierStep(template)],
          args: recommendationArgs(),
        }),
      ]).toEqual([recommendationIdOf(templateId)]);
    },
  );

  test.each(DEVICE_TEMPLATE_IDS)(
    "%s's counts with the placeholder ids the side-menu badge reads with",
    (templateId: string) => {
      const template: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(templateId)!;

      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: recommendationsOf(template.provider),
          existingMonitorSteps: [storedEarlierStep(template)],
          args: recommendationArgs({
            onlineMonitorStatusId: ObjectID.getZeroObjectID(),
            offlineMonitorStatusId: ObjectID.getZeroObjectID(),
            defaultIncidentSeverityId: ObjectID.getZeroObjectID(),
            defaultAlertSeverityId: ObjectID.getZeroObjectID(),
          }),
        }).has(recommendationIdOf(templateId)),
      ).toBe(true);
    },
  );

  test.each(DEVICE_TEMPLATE_IDS)(
    "%s's, of another connection, covers nothing",
    (templateId: string) => {
      const template: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(templateId)!;

      expect(
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: recommendationsOf(template.provider),
          existingMonitorSteps: [
            storedEarlierStep(template, OTHER_CONNECTION_ID),
          ],
          args: recommendationArgs(),
        }).size,
      ).toBe(0);
    },
  );

  test("a monitor made now counts too, and the first of two monitors of one template is the one linked", () => {
    const template: ManagedDeviceAlertTemplate =
      getManagedDeviceAlertTemplateById(
        "esper-apple-device-stopped-checking-in",
      )!;
    const earlierMonitor: ObjectID = ObjectID.generate();
    const newMonitor: ObjectID = ObjectID.generate();
    const recommendationId: string = recommendationIdOf(template.id);

    const covered: (
      monitors: Array<{
        monitorId: ObjectID;
        monitorSteps: Array<MonitorStep>;
      }>,
    ) => ObjectID | undefined = (
      monitors: Array<{
        monitorId: ObjectID;
        monitorSteps: Array<MonitorStep>;
      }>,
    ): ObjectID | undefined => {
      return MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: recommendationsOf(DeviceManagementProvider.Esper),
        existingMonitors: monitors,
        args: recommendationArgs(),
      }).get(recommendationId);
    };

    expect(
      covered([
        {
          monitorId: newMonitor,
          monitorSteps: [storedStep(template.getMonitorStep(templateArgs()))],
        },
      ]),
    ).toBe(newMonitor);

    /*
     * Its own step is looked for first: a monitor made now wins over one
     * made before, whichever the list names first.
     */
    for (const order of [
      [earlierMonitor, newMonitor],
      [newMonitor, earlierMonitor],
    ]) {
      expect(
        covered(
          order.map((monitorId: ObjectID) => {
            return {
              monitorId,
              monitorSteps: [
                monitorId === newMonitor
                  ? storedStep(template.getMonitorStep(templateArgs()))
                  : storedEarlierStep(template),
              ],
            };
          }),
        ),
      ).toBe(newMonitor);
    }
  });

  /*
   * Two services' templates had one step before, so a monitor made then
   * from either is the other's step too. A connection reads one service
   * and is offered that service's templates alone, so on a connection it
   * covers that service's template: Esper's Apple check-ins on an Esper
   * connection, SOTI's on a SOTI one, and nothing on the others.
   */
  test("one made from a template two services shared covers its own service's, on its own connection", () => {
    const esperApple: ManagedDeviceAlertTemplate =
      getManagedDeviceAlertTemplateById(
        "esper-apple-device-stopped-checking-in",
      )!;

    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      const covered: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: recommendationsOf(provider),
          existingMonitorSteps: [storedEarlierStep(esperApple)],
          args: recommendationArgs(),
        });

      const expected: Array<string> =
        provider === DeviceManagementProvider.Esper
          ? [recommendationIdOf("esper-apple-device-stopped-checking-in")]
          : provider === DeviceManagementProvider.Soti
            ? [recommendationIdOf("soti-apple-device-stopped-checking-in")]
            : [];

      expect({ provider, covered: [...covered] }).toEqual({
        provider,
        covered: expected,
      });
    }
  });

  test("the templates that read their service from the start have no earlier step", () => {
    for (const provider of DEVICE_MANAGEMENT_PROVIDERS) {
      for (const template of getManagedDeviceAlertTemplatesFor(provider)) {
        const earlier: Array<MonitorStep> =
          template.getEarlierMonitorSteps?.(templateArgs()) || [];

        expect({
          id: template.id,
          earlier: earlier.length,
        }).toEqual({
          id: template.id,
          earlier: DEVICE_TEMPLATE_IDS.includes(template.id) ? 1 : 0,
        });

        for (const step of earlier) {
          expect(
            attributesOf(step)[ManagedDeviceCheckInAttribute.Provider],
          ).toBeUndefined();
        }
      }
    }
  });
});
