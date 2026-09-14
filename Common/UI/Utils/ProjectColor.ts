export interface ProjectColor {
  /** The colour marking the current page: the project's own, or the default. */
  color: string | null;
  /**
   * The instance-wide default on its own. Kept alongside the resolved colour
   * because the project picker needs it: a project that has not chosen a
   * colour still shows the default's dot, so the list agrees with the button
   * rather than leaving that row blank.
   */
  defaultColor: string | null;
}

const PROJECT_COLOR_STORAGE_KEY: string = "oneuptime-project-color";

/** Set on <html> so the stylesheet can paint the bar and the picker dot. */
const HAS_COLOR_CLASS: string = "ou-has-project-color";

const COLOR_TOKEN: string = "--ou-project-color";

/** Plain six-digit hex. Anything else never reaches the stylesheet. */
const HEX_COLOR: RegExp = /^#[0-9a-f]{6}$/;

export default class ProjectColorUtil {
  private static applied: string | null = null;
  private static defaultColor: string | null = null;

  /**
   * Reject anything that is not a plain hex colour. These values reach a CSS
   * custom property and an inline style, so refusing unexpected input here
   * keeps it out of the stylesheet rather than relying on the browser to
   * ignore it.
   */
  public static normalize(color: string | null | undefined): string | null {
    if (!color) {
      return null;
    }

    const trimmed: string = color.trim().toLowerCase();

    return HEX_COLOR.test(trimmed) ? trimmed : null;
  }

  /**
   * Read the colour cached from the last session.
   *
   * The real value arrives from the API once the project list has loaded,
   * which is several hundred milliseconds after first paint. Applying the
   * cached value up front is what stops the bar appearing late — the same
   * trick the light/dark toggle already uses for its own preference.
   */
  private static getStoredColor(): ProjectColor | null {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      const raw: string | null = window.localStorage.getItem(
        PROJECT_COLOR_STORAGE_KEY,
      );

      if (!raw) {
        return null;
      }

      const parsed: Partial<ProjectColor> = JSON.parse(raw);

      return {
        color: ProjectColorUtil.normalize(parsed.color),
        defaultColor: ProjectColorUtil.normalize(parsed.defaultColor),
      };
    } catch {
      // A malformed or inaccessible cache just means no colour.
      return null;
    }
  }

  private static store(projectColor: ProjectColor): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        PROJECT_COLOR_STORAGE_KEY,
        JSON.stringify(projectColor),
      );
    } catch {
      // The colour still applies for this page load when storage is unavailable.
    }
  }

  /**
   * Resolve the colour that should be showing, from the project the user is
   * in and the instance-wide default. A project overrides the default;
   * neither set means no colour, which is how every installation that never
   * opens the Appearance page looks.
   */
  public static resolve(data: {
    projectColor?: string | null | undefined;
    defaultProjectColor?: string | null | undefined;
  }): ProjectColor {
    return {
      color: data.projectColor || data.defaultProjectColor || null,
      defaultColor: data.defaultProjectColor || null,
    };
  }

  /**
   * The instance-wide default, for rows of the project picker whose project
   * has not chosen a colour. Falls back to the cached value so the list is
   * correct on the first paint after a reload, before the API answers.
   */
  public static getDefaultProjectColor(): string | null {
    if (ProjectColorUtil.defaultColor) {
      return ProjectColorUtil.defaultColor;
    }

    return ProjectColorUtil.getStoredColor()?.defaultColor || null;
  }

  /** Apply the cached colour, if any. Safe to call before the API responds. */
  public static initialize(): void {
    const stored: ProjectColor | null = ProjectColorUtil.getStoredColor();

    if (stored) {
      ProjectColorUtil.applyColor(stored);
    }
  }

  /** Apply a colour and remember it. A null colour removes it. */
  public static setColor(projectColor: ProjectColor): void {
    ProjectColorUtil.store(projectColor);
    ProjectColorUtil.applyColor(projectColor);
  }

  private static applyColor(projectColor: ProjectColor): void {
    if (typeof document === "undefined") {
      return;
    }

    const color: string | null = ProjectColorUtil.normalize(projectColor.color);

    ProjectColorUtil.defaultColor = ProjectColorUtil.normalize(
      projectColor.defaultColor,
    );

    const signature: string = color || "none";

    if (ProjectColorUtil.applied === signature) {
      return;
    }

    ProjectColorUtil.applied = signature;

    const root: HTMLElement = document.documentElement;

    if (color) {
      root.style.setProperty(COLOR_TOKEN, color);
    } else {
      root.style.removeProperty(COLOR_TOKEN);
    }

    root.classList.toggle(HAS_COLOR_CLASS, Boolean(color));
  }
}
