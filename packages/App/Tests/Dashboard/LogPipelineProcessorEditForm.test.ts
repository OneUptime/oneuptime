import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source-pinning tests for the Edit / View functionality of LogPipelineProcessor
 * in the Dashboard, addressing Issue #2516.
 *
 * These tests ensure:
 * 1. PipelineView wires an "Edit" action button in the processors table.
 * 2. PipelineView maintains editingProcessor state and passes it to ProcessorForm.
 * 3. ProcessorForm supports existingProcessor and differentiates edit mode vs create mode.
 * 4. ProcessorForm updates via ModelAPI.update when editing and creates via ModelAPI.create when adding.
 */

const PROCESSOR_FORM_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "LogPipeline",
  "ProcessorForm.tsx",
);

const PIPELINE_VIEW_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Logs",
  "Settings",
  "PipelineView.tsx",
);

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const FORM_SOURCE: string = stripComments(
  fs.readFileSync(PROCESSOR_FORM_PATH, "utf8"),
);

const VIEW_SOURCE: string = stripComments(
  fs.readFileSync(PIPELINE_VIEW_PATH, "utf8"),
);

describe("LogPipeline ProcessorForm edit mode (Issue #2516)", () => {
  test("ProcessorForm accepts existingProcessor and onProcessorSaved props", () => {
    expect(FORM_SOURCE).toMatch(/existingProcessor\?:\s*LogPipelineProcessor/);
    expect(FORM_SOURCE).toMatch(/onProcessorSaved\?:\s*\(\)\s*=>\s*void/);
  });

  test("ProcessorForm detects edit mode and reads existing configuration", () => {
    expect(FORM_SOURCE).toMatch(
      /isEditMode:\s*boolean\s*=\s*Boolean\(props\.existingProcessor\)/,
    );
    expect(FORM_SOURCE).toMatch(
      /existingConfig:\s*JSONObject\s*=\s*\(props\.existingProcessor\?\.configuration as JSONObject\)/,
    );
  });

  test("ProcessorForm initializes fields from existing processor when present", () => {
    expect(FORM_SOURCE).toMatch(
      /useState<string>\(props\.existingProcessor\?\.name\s*\|\|\s*["']["']\)/,
    );
    expect(FORM_SOURCE).toMatch(/useState<ProcessorType>\(existingType\)/);
    expect(FORM_SOURCE).toMatch(
      /useState<boolean>\(\s*props\.existingProcessor\?\.isEnabled\s*\?\?\s*true,?\s*\)/,
    );
  });

  test("modal title and submit button text adapt to edit mode", () => {
    expect(FORM_SOURCE).toMatch(
      /title=\{\s*isEditMode\s*\?\s*["']Edit Processor["']\s*:\s*["']Add Processor["']\s*\}/,
    );
    expect(FORM_SOURCE).toMatch(
      /submitButtonText=\{\s*isEditMode\s*\?\s*["']Save Changes["']\s*:\s*["']Create Processor["']\s*\}/,
    );
  });

  test("handleSave updates via ModelAPI.update in edit mode, and creates via ModelAPI.create when adding", () => {
    expect(FORM_SOURCE).toMatch(
      /if\s*\(\s*isEditMode\s*&&\s*props\.existingProcessor\s*&&\s*props\.existingProcessor\._id\s*\)/,
    );
    expect(FORM_SOURCE).toMatch(/ModelAPI\.update\(\{/);
    expect(FORM_SOURCE).toMatch(/ModelAPI\.create\(\{/);
  });

  test("invokes onProcessorSaved callback upon saving", () => {
    expect(FORM_SOURCE).toMatch(/if\s*\(props\.onProcessorSaved\)\s*\{/);
    expect(FORM_SOURCE).toMatch(/props\.onProcessorSaved\(\);/);
  });
});

describe("LogPipeline PipelineView table actions (Issue #2516)", () => {
  test("PipelineView maintains editingProcessor state", () => {
    expect(VIEW_SOURCE).toMatch(
      /\[editingProcessor,\s*setEditingProcessor\]\s*=\s*useState<\s*LogPipelineProcessor\s*\|\s*undefined\s*>\(undefined\)/,
    );
  });

  test("Add Processor button clears editingProcessor before opening form", () => {
    expect(VIEW_SOURCE).toMatch(
      /onClick:\s*\(\)\s*=>\s*\{\s*setEditingProcessor\(undefined\);\s*setShowProcessorForm\(true\);\s*\}/,
    );
  });

  test("ModelTable includes an Edit action button in each row", () => {
    expect(VIEW_SOURCE).toMatch(/actionButtons=\{/);
    expect(VIEW_SOURCE).toMatch(/title:\s*["']Edit["']/);
    expect(VIEW_SOURCE).toMatch(/icon:\s*IconProp\.Edit/);
    expect(VIEW_SOURCE).toMatch(/setEditingProcessor\(item\)/);
  });

  test("ProcessorForm receives existingProcessor from state", () => {
    expect(VIEW_SOURCE).toMatch(
      /<ProcessorForm[\s\S]*?existingProcessor=\{editingProcessor\}[\s\S]*?\/>/,
    );
  });
});
