import AlertAISettings from "../../FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings";
import IncidentAISettings from "../../FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
import AIGuardrails from "../../FeatureSet/Dashboard/src/Pages/Settings/AIGuardrails";
import DashboardSideMenu from "../../FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import { describe, expect, test, jest } from "@jest/globals";

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("Common/UI/Components/SideMenu/SideMenu", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock("Common/UI/Config", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      process: {
        env: {},
      },
    },
  });

  return jest.requireActual("Common/UI/Config");
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
    },
  };
});

type ConfiguredField = {
  field: Record<string, unknown>;
  stepId?: string | undefined;
};

type SettingsCardProps = {
  formFields: Array<ConfiguredField>;
  modelDetailProps: {
    fields: Array<ConfiguredField>;
  };
};

type SettingsPageElement = {
  props: {
    children: {
      props: SettingsCardProps;
    };
  };
};

type SideMenuElement = {
  props: {
    sections: Array<{
      title: string;
      items: Array<{
        link: {
          title: string;
          to: string;
        };
      }>;
    }>;
  };
};

const cardPropsFor: (
  component: (props: never) => SettingsPageElement,
) => SettingsCardProps = (
  component: (props: never) => SettingsPageElement,
): SettingsCardProps => {
  const page: SettingsPageElement = component({} as never);

  return page.props.children.props;
};

const fieldNames: (fields: Array<ConfiguredField>) => Array<string> = (
  fields: Array<ConfiguredField>,
): Array<string> => {
  return fields.map((field: ConfiguredField): string => {
    return Object.keys(field.field)[0]!;
  });
};

const INCIDENT_FIELDS: Array<string> = [
  "enableAutomaticIncidentInvestigation",
  "incidentInvestigationMinimumSeverity",
  "incidentInvestigationDedupeWindowMinutes",
  "incidentAiMaxConcurrentInvestigations",
  "incidentAiDailyAutonomousTokenLimit",
  "enableIncidentInstrumentationFixTasks",
  "enableAutomaticIncidentCodeFixes",
  "incidentAiDailyFixTaskLimit",
];

const ALERT_FIELDS: Array<string> = [
  "enableAutomaticAlertInvestigation",
  "alertInvestigationMinimumSeverity",
  "alertInvestigationDedupeWindowMinutes",
  "alertAiMaxConcurrentInvestigations",
  "alertAiDailyAutonomousTokenLimit",
  "enableAlertInstrumentationFixTasks",
  "enableAutomaticAlertCodeFixes",
  "alertAiDailyFixTaskLimit",
];

const OTHER_AI_GUARDRAIL_FIELDS: Array<string> = [
  "aiMaxConcurrentInvestigations",
  "aiDailyAutonomousTokenLimit",
  "aiDailyFixTaskLimit",
];

const LEGACY_SHARED_FIELDS: Array<string> = [
  "aiMaxConcurrentInvestigations",
  "aiDailyAutonomousTokenLimit",
  "enableInstrumentationFixTasks",
  "enableAutomaticCodeFixes",
  "aiDailyFixTaskLimit",
];

describe("incident and alert AI settings separation", () => {
  test("incident card edits and displays only incident settings", () => {
    const props: SettingsCardProps = cardPropsFor(
      IncidentAISettings as unknown as (props: never) => SettingsPageElement,
    );

    expect(fieldNames(props.formFields)).toEqual(INCIDENT_FIELDS);
    expect(fieldNames(props.modelDetailProps.fields)).toEqual(INCIDENT_FIELDS);
  });

  test("alert card edits and displays only alert settings", () => {
    const props: SettingsCardProps = cardPropsFor(
      AlertAISettings as unknown as (props: never) => SettingsPageElement,
    );

    expect(fieldNames(props.formFields)).toEqual(ALERT_FIELDS);
    expect(fieldNames(props.modelDetailProps.fields)).toEqual(ALERT_FIELDS);
  });

  test("the two update payloads have no fields in common", () => {
    const incident: Set<string> = new Set(
      fieldNames(
        cardPropsFor(
          IncidentAISettings as unknown as (
            props: never,
          ) => SettingsPageElement,
        ).formFields,
      ),
    );
    const alert: Set<string> = new Set(
      fieldNames(
        cardPropsFor(
          AlertAISettings as unknown as (props: never) => SettingsPageElement,
        ).formFields,
      ),
    );

    expect(
      [...incident].filter((field: string) => {
        return alert.has(field);
      }),
    ).toEqual([]);
  });

  test("neither page can write a legacy shared setting", () => {
    const allPageFields: Array<string> = [
      ...fieldNames(
        cardPropsFor(
          IncidentAISettings as unknown as (
            props: never,
          ) => SettingsPageElement,
        ).formFields,
      ),
      ...fieldNames(
        cardPropsFor(
          AlertAISettings as unknown as (props: never) => SettingsPageElement,
        ).formFields,
      ),
    ];

    for (const legacyField of LEGACY_SHARED_FIELDS) {
      expect(allPageFields).not.toContain(legacyField);
    }
  });

  test("each lane's follow-up PR controls stay on its Fix Tasks step", () => {
    const assertFixTaskStep: (
      props: SettingsCardProps,
      fields: Array<string>,
    ) => void = (props: SettingsCardProps, fields: Array<string>): void => {
      for (const configuredField of props.formFields) {
        const name: string = fieldNames([configuredField])[0]!;

        if (fields.includes(name)) {
          expect(configuredField.stepId).toBe("fix-tasks");
        }
      }
    };

    assertFixTaskStep(
      cardPropsFor(
        IncidentAISettings as unknown as (props: never) => SettingsPageElement,
      ),
      [
        "enableIncidentInstrumentationFixTasks",
        "enableAutomaticIncidentCodeFixes",
        "incidentAiDailyFixTaskLimit",
      ],
    );
    assertFixTaskStep(
      cardPropsFor(
        AlertAISettings as unknown as (props: never) => SettingsPageElement,
      ),
      [
        "enableAlertInstrumentationFixTasks",
        "enableAutomaticAlertCodeFixes",
        "alertAiDailyFixTaskLimit",
      ],
    );
  });

  test("subjectless AI work keeps its three fallback limits on the dedicated guardrails page", () => {
    const props: SettingsCardProps = (
      AIGuardrails({} as never) as unknown as { props: SettingsCardProps }
    ).props;

    expect(fieldNames(props.formFields)).toEqual(OTHER_AI_GUARDRAIL_FIELDS);
    expect(fieldNames(props.modelDetailProps.fields)).toEqual(
      OTHER_AI_GUARDRAIL_FIELDS,
    );
  });

  test("AI Guardrails is in the always-visible AI menu section", () => {
    const menu: SideMenuElement =
      DashboardSideMenu() as unknown as SideMenuElement;
    const aiSection: SideMenuElement["props"]["sections"][number] | undefined =
      menu.props.sections.find((section: { title: string }): boolean => {
        return section.title === "AI";
      });

    expect(
      aiSection?.items.map((item: { link: { title: string } }) => {
        return item.link.title;
      }),
    ).toContain("AI Guardrails");
  });
});
