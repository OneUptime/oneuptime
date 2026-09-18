import { describe, expect, test } from "@jest/globals";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";

/*
 * getWorkspaceTypeDisplayName turns the WorkspaceType enum into the label shown
 * wherever a workspace integration is named in the UI. The only member whose
 * display name differs from its enum value is MicrosoftTeams ("Microsoft Teams"
 * with a space); the rest fall through to returning the raw value. The suite
 * pins that spacing and guards the fall-through: a new workspace type added to
 * the enum must still yield a non-empty label rather than undefined.
 */

describe("getWorkspaceTypeDisplayName", () => {
  test("renders Microsoft Teams with a space", () => {
    // The enum value is "MicrosoftTeams"; the label must be human-spaced.
    expect(getWorkspaceTypeDisplayName(WorkspaceType.MicrosoftTeams)).toBe(
      "Microsoft Teams",
    );
  });

  test("renders Slack as-is", () => {
    expect(getWorkspaceTypeDisplayName(WorkspaceType.Slack)).toBe("Slack");
  });

  test("every workspace type yields a non-empty display name", () => {
    for (const type of Object.values(WorkspaceType)) {
      const label: string = getWorkspaceTypeDisplayName(type);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test("display names are unique across workspace types", () => {
    const labels: Array<string> = Object.values(WorkspaceType).map(
      (type: WorkspaceType) => {
        return getWorkspaceTypeDisplayName(type);
      },
    );
    expect(new Set<string>(labels).size).toBe(labels.length);
  });

  test("an unknown value falls back to the raw string it was given", () => {
    /*
     * The function's default arm returns its argument unchanged. Persisted or
     * mistyped data must therefore round-trip rather than become undefined.
     */
    expect(getWorkspaceTypeDisplayName("Discord" as WorkspaceType)).toBe(
      "Discord",
    );
  });
});
