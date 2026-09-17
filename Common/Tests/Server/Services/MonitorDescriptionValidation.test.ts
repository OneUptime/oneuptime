import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ColumnLength from "../../../Types/Database/ColumnLength";
import PartialEntity from "../../../Types/Database/PartialEntity";
import {
  getKubernetesAlertTemplateById,
  KubernetesAlertTemplate,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(Monitor);
const templateService: DatabaseService<MonitorTemplate> =
  new DatabaseService<MonitorTemplate>(MonitorTemplate);

const markdownDescription: string = [
  "# Pod CPU Saturating Container Limit",
  "",
  "Investigate CPU throttling before changing the container resource limits.",
  "",
  "- Namespace: `production`",
  "- Runbook: https://example.com/runbooks/cpu-throttling",
  "- Escalation: Platform team — investigate sustained saturation 🔍",
  "",
  "```sh",
  "kubectl top pods --namespace production",
  "```",
]
  .join("\n")
  .repeat(1000);

/*
 * Both monitor create and update call this shared sanitizer. Exercise the
 * real length validation so changing only the form, or increasing its limit
 * to another fixed value, cannot reintroduce failed monitor saves.
 */
describe.each([
  { operation: "create", isUpdate: false },
  { operation: "update", isUpdate: true },
])(
  "Monitor description validation on $operation",
  ({ isUpdate }: { isUpdate: boolean }): void => {
    it.each([
      { label: "an empty description", description: "" },
      {
        label: "the previous 500-character boundary",
        description: "a".repeat(500),
      },
      { label: "501 characters", description: "a".repeat(501) },
      { label: "a long Markdown runbook", description: markdownDescription },
    ])(
      "preserves $label without truncation",
      async ({ description }: { description: string }): Promise<void> => {
        const result: Monitor | PartialEntity<Monitor> = await service[
          "sanitizeCreateOrUpdate"
        ]({ description: description }, { isRoot: true }, isUpdate);

        expect(result.description).toBe(description);
      },
    );

    it("allows the optional description to be omitted", async () => {
      const result: Monitor | PartialEntity<Monitor> = await service[
        "sanitizeCreateOrUpdate"
      ]({ name: "Pod CPU" }, { isRoot: true }, isUpdate);

      expect(result.description).toBeUndefined();
    });

    it("accepts the built-in Pod CPU Saturating Container Limit recommendation", async () => {
      const template: KubernetesAlertTemplate | undefined =
        getKubernetesAlertTemplateById("k8s-pod-cpu-limit-saturation");

      expect(template).toBeDefined();
      expect(template!.description.length).toBeGreaterThan(500);

      const result: Monitor | PartialEntity<Monitor> = await service[
        "sanitizeCreateOrUpdate"
      ](
        { name: template!.name, description: template!.description },
        { isRoot: true },
        isUpdate,
      );

      expect(result.description).toBe(template!.description);
    });

    it("still enforces the monitor name length", async () => {
      await expect(
        service["sanitizeCreateOrUpdate"](
          {
            name: "a".repeat(ColumnLength.ShortText + 1),
            description: markdownDescription,
          },
          { isRoot: true },
          isUpdate,
        ),
      ).rejects.toThrow(
        `name length cannot be more than ${ColumnLength.ShortText} characters`,
      );
    });
  },
);

describe.each([
  { operation: "create", isUpdate: false },
  { operation: "update", isUpdate: true },
])(
  "Template monitor description validation on $operation",
  ({ isUpdate }: { isUpdate: boolean }): void => {
    it.each([
      { label: "501 characters", description: "a".repeat(501) },
      { label: "a long Markdown runbook", description: markdownDescription },
    ])(
      "preserves $label for generated monitors",
      async ({ description }: { description: string }): Promise<void> => {
        const result: MonitorTemplate | PartialEntity<MonitorTemplate> =
          await templateService["sanitizeCreateOrUpdate"](
            { monitorDescription: description },
            { isRoot: true },
            isUpdate,
          );

        expect(result.monitorDescription).toBe(description);
      },
    );

    it("allows the optional monitor description to be omitted", async () => {
      const result: MonitorTemplate | PartialEntity<MonitorTemplate> =
        await templateService["sanitizeCreateOrUpdate"](
          { templateName: "Pod CPU template" },
          { isRoot: true },
          isUpdate,
        );

      expect(result.monitorDescription).toBeUndefined();
    });

    it("still enforces the separate template description length", async () => {
      await expect(
        templateService["sanitizeCreateOrUpdate"](
          {
            templateDescription: "a".repeat(ColumnLength.LongText + 1),
            monitorDescription: markdownDescription,
          },
          { isRoot: true },
          isUpdate,
        ),
      ).rejects.toThrow(
        `templateDescription length cannot be more than ${ColumnLength.LongText} characters`,
      );
    });
  },
);

describe.each([
  { modelType: Monitor, columnName: "description" },
  { modelType: MonitorTemplate, columnName: "monitorDescription" },
])(
  "$modelType.name.$columnName storage",
  ({
    modelType,
    columnName,
  }: {
    modelType: typeof Monitor | typeof MonitorTemplate;
    columnName: string;
  }): void => {
    it("uses text without a database character limit", () => {
      const column: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (metadata: ColumnMetadataArgs) => {
            return (
              metadata.target === modelType &&
              metadata.propertyName === columnName
            );
          },
        );

      expect(column).toBeDefined();
      expect(column?.options.type).toBe("text");
      expect(column?.options.length).toBeUndefined();
      expect(column?.options.nullable).toBe(true);
      expect(new modelType().getTableColumnMetadata(columnName).required).toBe(
        false,
      );
    });
  },
);

describe("Clearing monitor descriptions", () => {
  it("allows an existing description to be cleared", async () => {
    const result: Monitor | PartialEntity<Monitor> = await service[
      "sanitizeCreateOrUpdate"
    ]({ description: null }, { isRoot: true }, true);

    expect(result.description).toBeNull();
  });

  it("allows an existing template monitor description to be cleared", async () => {
    const result: MonitorTemplate | PartialEntity<MonitorTemplate> =
      await templateService["sanitizeCreateOrUpdate"](
        { monitorDescription: null },
        { isRoot: true },
        true,
      );

    expect(result.monitorDescription).toBeNull();
  });
});
