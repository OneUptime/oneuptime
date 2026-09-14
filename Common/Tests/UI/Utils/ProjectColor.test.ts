import ProjectColorUtil, { ProjectColor } from "../../../UI/Utils/ProjectColor";

describe("ProjectColorUtil.resolve", () => {
  it("has no colour when neither the project nor the default is set", () => {
    const resolved: ProjectColor = ProjectColorUtil.resolve({});

    expect(resolved.color).toBeNull();
    expect(resolved.defaultColor).toBeNull();
  });

  it("keeps the default alongside the resolved colour", () => {
    /*
     * The picker needs both: the resolved colour marks the page, the default
     * colours the rows of projects that have not chosen one of their own.
     */
    const resolved: ProjectColor = ProjectColorUtil.resolve({
      projectColor: "#059669",
      defaultProjectColor: "#7c3aed",
    });

    expect(resolved.color).toBe("#059669");
    expect(resolved.defaultColor).toBe("#7c3aed");
  });

  it("reports the default as the resolved colour when the project has none", () => {
    const resolved: ProjectColor = ProjectColorUtil.resolve({
      defaultProjectColor: "#7c3aed",
    });

    expect(resolved.color).toBe("#7c3aed");
    expect(resolved.defaultColor).toBe("#7c3aed");
  });

  it("falls back to the instance default when the project has none", () => {
    const resolved: ProjectColor = ProjectColorUtil.resolve({
      projectColor: null,
      defaultProjectColor: "#dc2626",
    });

    expect(resolved.color).toBe("#dc2626");
  });

  it("lets the project override the default", () => {
    const resolved: ProjectColor = ProjectColorUtil.resolve({
      projectColor: "#059669",
      defaultProjectColor: "#dc2626",
    });

    expect(resolved.color).toBe("#059669");
  });

  it("treats an empty colour string as unset", () => {
    const resolved: ProjectColor = ProjectColorUtil.resolve({
      projectColor: "",
      defaultProjectColor: "#dc2626",
    });

    expect(resolved.color).toBe("#dc2626");
  });
});

describe("ProjectColorUtil.normalize", () => {
  it("accepts plain six-digit hex, case-insensitively", () => {
    expect(ProjectColorUtil.normalize("#dc2626")).toBe("#dc2626");
    expect(ProjectColorUtil.normalize("#DC2626")).toBe("#dc2626");
    expect(ProjectColorUtil.normalize("  #dc2626  ")).toBe("#dc2626");
  });

  it("rejects anything else, so it never reaches the stylesheet", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "red",
      "#fff",
      "#dc26266",
      "rgb(220,38,38)",
      "#dc2626; background: url(x)",
      "var(--something)",
    ]) {
      expect(ProjectColorUtil.normalize(bad)).toBeNull();
    }
  });
});
