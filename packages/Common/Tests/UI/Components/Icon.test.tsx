import Icon from "../../../UI/Components/Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import ProviderLogo from "../../../Types/ProviderLogo/ProviderLogo";
import ALL_PROVIDER_LOGO_MARKS from "../../../Types/ProviderLogo/AllProviderLogoMarks";
import { PROVIDER_LOGO_MARK_BOXES } from "../../../Types/ProviderLogo/ProviderLogoMarks";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";

type GetIconPathFunction = (icon: IconProp) => string;

const getIconPath: GetIconPathFunction = (icon: IconProp): string => {
  const { container } = render(<Icon icon={icon} />);
  return container.querySelector("path")?.getAttribute("d") || "";
};

/*
 * The chevrons are the whole vocabulary of the pagination arrows and of every
 * "back" button in the dashboard, and they are picked out of one long
 * if/else chain of hand-written path data - which is exactly how ChevronLeft
 * came to be drawing the bulleted-list glyph.
 */
describe("Icon chevrons", () => {
  it("draws a left-pointing chevron for ChevronLeft", () => {
    expect(getIconPath(IconProp.ChevronLeft)).toBe(
      "M15.75 19.5L8.25 12l7.5-7.5",
    );
  });

  it("draws a right-pointing chevron for ChevronRight", () => {
    expect(getIconPath(IconProp.ChevronRight)).toBe(
      "M8.25 4.5l7.5 7.5-7.5 7.5",
    );
  });

  it("draws a down-pointing chevron for ChevronDown", () => {
    expect(getIconPath(IconProp.ChevronDown)).toBe(
      "M19.5 8.25l-7.5 7.5-7.5-7.5",
    );
  });

  it("does not draw a list where a chevron was asked for", () => {
    const listPath: string = getIconPath(IconProp.List);

    expect(getIconPath(IconProp.ChevronLeft)).not.toBe(listPath);
    expect(getIconPath(IconProp.ChevronRight)).not.toBe(listPath);
    expect(getIconPath(IconProp.ChevronDown)).not.toBe(listPath);
  });

  it("gives each chevron its own direction", () => {
    const paths: Array<string> = [
      getIconPath(IconProp.ChevronLeft),
      getIconPath(IconProp.ChevronRight),
      getIconPath(IconProp.ChevronDown),
    ];

    expect(new Set(paths).size).toBe(paths.length);
  });
});

/*
 * The right-sizing card shows over- and under-provisioned containers with
 * these two (and the feed's old Filter & Sort button showed Newest first /
 * Oldest first with them). BarsArrowUp used to be a copy of BarsArrowDown's path,
 * so both pairs read as the same thing.
 */
describe("Icon bars-and-arrow sort glyphs", () => {
  it("draws the arrow pointing down for BarsArrowDown", () => {
    expect(getIconPath(IconProp.BarsArrowDown)).toBe(
      "M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0l-3.75-3.75M17.25 21L21 17.25",
    );
  });

  it("draws the arrow pointing up for BarsArrowUp", () => {
    expect(getIconPath(IconProp.BarsArrowUp)).toBe(
      "M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v12",
    );
  });

  it("does not draw the same glyph for both directions", () => {
    expect(getIconPath(IconProp.BarsArrowUp)).not.toBe(
      getIconPath(IconProp.BarsArrowDown),
    );
  });
});

/*
 * The markdown editor's Indent and Outdent buttons show nothing but these
 * glyphs, so each has to draw its own arrow -- in for Indent, out for
 * Outdent -- and neither may fall through to an empty icon.
 */
describe("Icon indent and outdent", () => {
  it("draws lines of text with an arrow pointing in for Indent", () => {
    expect(getIconPath(IconProp.Indent)).toBe(
      "M3.75 5.25h16.5M11.25 9.75h9M11.25 14.25h9M3.75 18.75h16.5M3.75 9l3 3-3 3",
    );
  });

  it("draws the same lines with the arrow pointing out for Outdent", () => {
    expect(getIconPath(IconProp.Outdent)).toBe(
      "M3.75 5.25h16.5M11.25 9.75h9M11.25 14.25h9M3.75 18.75h16.5M6.75 9l-3 3 3 3",
    );
  });

  it("draws two glyphs that differ from each other and from the list icons", () => {
    const paths: Array<string> = [
      getIconPath(IconProp.Indent),
      getIconPath(IconProp.Outdent),
      getIconPath(IconProp.ListBullet),
      getIconPath(IconProp.List),
    ];

    expect(paths[0]).not.toBe(paths[1]);
    expect(paths.slice(2)).not.toContain(paths[0]);
    expect(paths.slice(2)).not.toContain(paths[1]);
  });
});

/*
 * A stopped AI answer is marked with StopCircle (the Ask AI panel and the AI
 * Investigation card's conversation). It used to draw the circle alone: an
 * empty ring, which reads as an unticked radio button.
 */
describe("Icon stop circle", () => {
  it("draws the square inside the circle", () => {
    const path: string = getIconPath(IconProp.StopCircle);

    // The circle...
    expect(path.startsWith("M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z")).toBe(true);
    // ...and a second, closed shape inside it, from (9,9) to (15,15).
    expect(path).toContain("M9 9.563");
    expect(path.match(/Z/g)).toHaveLength(2);
  });

  it("is not the bare circle PauseCircle and friends are built on", () => {
    expect(getIconPath(IconProp.StopCircle)).not.toBe(
      "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    );
    expect(getIconPath(IconProp.StopCircle)).not.toBe(
      getIconPath(IconProp.PauseCircle),
    );
  });
});

/*
 * Eye marks "read-only" and "viewer" (the AI permission picker, the team
 * permission table, show/hide toggles). It used to draw the outline of the
 * eye without its pupil: an empty almond next to EyeSlash's full glyph.
 */
describe("Icon eye", () => {
  it("draws the pupil inside the outline", () => {
    const path: string = getIconPath(IconProp.Eye);

    // The outline...
    expect(path.startsWith("M2.036 12.322")).toBe(true);
    // ...and the pupil, a circle of radius 3 around the centre.
    expect(path).toContain("M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z");
    expect(path.match(/Z/g)).toHaveLength(2);
  });
});

/*
 * MapPin marks a place: the site map's pins, a session replay's location, the
 * part of a cluster behind most of the trouble on an AI Insights page. It
 * used to draw the pin's inner dot alone, a small empty ring.
 */
describe("Icon map pin", () => {
  it("draws the pin around the dot", () => {
    const path: string = getIconPath(IconProp.MapPin);

    // The dot...
    expect(path.startsWith("M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z")).toBe(true);
    // ...and the pin's outline, from its round head down to its point.
    expect(path).toContain("M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25");
    expect(path.match(/Z/g)).toHaveLength(2);
  });

  it("is not the bare dot", () => {
    expect(getIconPath(IconProp.MapPin)).not.toBe(
      "M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    );
  });
});

/*
 * BellAlert says "this rings": a critical alert's pill on On-Call Rules, the
 * "On" of a phone's critical alerts on the push devices card, the alert roles
 * and alert feed items. It used to draw Heroicons' bell-snooze - the bell with
 * a "Z" inside it - so all of them showed a snoozed bell.
 */
describe("Icon bell alert", () => {
  const BELL: string =
    "M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0";

  it("draws the bell ringing: the two strokes at its shoulders", () => {
    expect(getIconPath(IconProp.BellAlert)).toBe(
      `${BELL}M3.124 7.5A8.969 8.969 0 0 1 5.292 3m13.416 0a8.969 8.969 0 0 1 2.168 4.5`,
    );
  });

  it("is not the snoozed bell, with a Z drawn inside it", () => {
    expect(getIconPath(IconProp.BellAlert)).not.toBe(
      `${BELL}M10.5 8.25h3l-3 4.5h3`,
    );
  });

  it("is neither the plain bell nor the silenced one", () => {
    const alert: string = getIconPath(IconProp.BellAlert);

    expect(alert).not.toBe(getIconPath(IconProp.Bell));
    expect(alert).not.toBe(getIconPath(IconProp.BellSlash));
  });
});

/*
 * Every item in a menu of the product has an icon, and an item names its
 * icon with an IconProp - so an IconProp that Icon does not draw would put an
 * empty slot back in the menu, the very gap that was closed. ClockIcon,
 * CubeTransparent, TableCellsIcon and UserIcon used to draw nothing at all;
 * they are older names for Clock, TransparentCube, TableCells and User.
 */
describe("Icon draws every IconProp", () => {
  const getGlyph: (icon: IconProp) => string = (icon: IconProp): string => {
    const { container } = render(<Icon icon={icon} />);
    const svg: SVGElement | null = container.querySelector("svg");

    if (!svg) {
      return "";
    }

    return Array.from(svg.querySelectorAll("*"))
      .map((shape: Element) => {
        return `${shape.tagName}:${shape.getAttribute("d") || ""}`;
      })
      .join("|");
  };

  it("draws a glyph for every value", () => {
    const blank: Array<string> = Object.values(IconProp).filter(
      (icon: IconProp) => {
        const { container } = render(<Icon icon={icon} />);
        const svg: SVGElement | null = container.querySelector("svg");

        return !svg || svg.querySelectorAll("*").length === 0;
      },
    );

    expect(blank).toEqual([]);
  });

  it("draws each older name as the name it duplicates", () => {
    expect(getGlyph(IconProp.ClockIcon)).toBe(getGlyph(IconProp.Clock));
    expect(getGlyph(IconProp.CubeTransparent)).toBe(
      getGlyph(IconProp.TransparentCube),
    );
    expect(getGlyph(IconProp.TableCellsIcon)).toBe(
      getGlyph(IconProp.TableCells),
    );
    expect(getGlyph(IconProp.UserIcon)).toBe(getGlyph(IconProp.User));
  });
});

/*
 * Official logos audit: where the icon set stands for another company's
 * product - Slack in a side menu, Kubernetes on a resource, Terraform on a
 * Developer page - it draws that product's official one-colour mark, filled
 * in the current colour as such marks are, not an outline of the designers'
 * own. Since icons-svg-one-color the shapes are the logo registry's
 * (Common/Types/ProviderLogo/Marks), the same every tile and list draws, so
 * Slack is the same Slack in a side menu and on a card. Its shapes are the
 * brand's, so they are pinned here by their first strokes too.
 */
// A colour written into a drawing, as a brand's colour logo has.
const HEX_COLOUR: RegExp = /#[0-9a-fA-F]{3,8}\b/;

describe("Icon brand marks", () => {
  type BrandMark = { icon: IconProp; logo: ProviderLogo; pathStart: string };

  const BRAND_MARKS: Array<BrandMark> = [
    {
      icon: IconProp.Slack,
      logo: ProviderLogo.Slack,
      pathStart: "M53.841 161.32",
    },
    {
      icon: IconProp.MicrosoftTeams,
      logo: ProviderLogo.MicrosoftTeams,
      pathStart: "M1760 704q-47 0-87-17",
    },
    {
      icon: IconProp.WhatsApp,
      logo: ProviderLogo.WhatsApp,
      pathStart: "M17.472 14.382",
    },
    {
      icon: IconProp.Telegram,
      logo: ProviderLogo.Telegram,
      pathStart: "M11.944 0A12",
    },
    {
      icon: IconProp.Kubernetes,
      logo: ProviderLogo.Kubernetes,
      pathStart: "M10.204 14.35",
    },
    {
      icon: IconProp.Docker,
      logo: ProviderLogo.Docker,
      pathStart: "M13.983 11.078",
    },
    {
      icon: IconProp.Discord,
      logo: ProviderLogo.Discord,
      pathStart: "M20.317 4.3698",
    },
    {
      icon: IconProp.Mattermost,
      logo: ProviderLogo.Mattermost,
      pathStart: "M12.081 0C7.048",
    },
    {
      icon: IconProp.Terraform,
      logo: ProviderLogo.Terraform,
      pathStart: "M1.44 0v7.575",
    },
    {
      icon: IconProp.GitHub,
      logo: ProviderLogo.GitHub,
      pathStart: "M12 .297c-6.63",
    },
    {
      icon: IconProp.Proxmox,
      logo: ProviderLogo.Proxmox,
      pathStart: "M4.928 1.825",
    },
    {
      icon: IconProp.Ceph,
      logo: ProviderLogo.Ceph,
      pathStart: "M11.959.257",
    },
  ];

  const draw: (icon: IconProp) => SVGElement = (icon: IconProp): SVGElement => {
    const { container } = render(<Icon icon={icon} />);
    return container.querySelector("svg") as SVGElement;
  };

  it.each(BRAND_MARKS)(
    "$icon is the registry's mark of the brand, filled, with no outline",
    (mark: BrandMark) => {
      const svg: SVGElement = draw(mark.icon);
      const paths: Array<Element> = Array.from(svg.querySelectorAll("path"));

      expect(svg.getAttribute("viewBox")).toBe(
        PROVIDER_LOGO_MARK_BOXES[mark.logo],
      );
      expect(
        paths.map((path: Element): string => {
          return path.getAttribute("d") || "";
        }),
      ).toEqual(
        (ALL_PROVIDER_LOGO_MARKS[mark.logo] || []).map(
          (shape: { d: string }): string => {
            return shape.d;
          },
        ),
      );
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]!.getAttribute("d")?.startsWith(mark.pathStart)).toBe(
        true,
      );

      for (const path of paths) {
        expect(path.getAttribute("fill")).toBe("currentColor");
        expect(path.getAttribute("stroke")).toBe("none");
      }
    },
  );

  it("Slack is all four of its shapes", () => {
    expect(draw(IconProp.Slack).querySelectorAll("path")).toHaveLength(4);
  });

  it("no two brands share a mark", () => {
    const glyphs: Array<string> = BRAND_MARKS.map((mark: BrandMark): string => {
      return draw(mark.icon).innerHTML;
    });

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("the Developer pages' Terraform is no longer the cube it was", () => {
    expect(draw(IconProp.Terraform).innerHTML).not.toBe(
      draw(IconProp.Cube).innerHTML,
    );
  });

  it("Discord and Mattermost are no longer a chat bubble", () => {
    const chat: string = draw(IconProp.Chat).innerHTML;

    expect(draw(IconProp.Discord).innerHTML).not.toBe(chat);
    expect(draw(IconProp.Mattermost).innerHTML).not.toBe(chat);
  });

  /*
   * Teams was an outline the icon set drew itself (SVGRepo's, its T and its
   * people in strokes). It is now Microsoft's own one-colour Teams glyph,
   * from Fluent UI's Fabric icons, which Microsoft licenses for showing an
   * integration with its products - filled, as every other brand here is.
   */
  it("Microsoft Teams is Microsoft's own one-colour glyph, not a stroked outline", () => {
    const svg: SVGElement = draw(IconProp.MicrosoftTeams);

    expect(svg.querySelectorAll("circle, line, g")).toHaveLength(0);
    expect(svg.innerHTML).not.toContain("SVGRepo");
    expect(svg.getAttribute("viewBox")).toBe("0 85 2048 1899");
  });

  /*
   * Brands the icon set draws by a glyph of its own, on purpose: VMware's
   * only mark is its wordmark, which cannot be read at 16px; Podman's
   * artwork (a seal and two pups in an octagon) turns to mush below 48px;
   * Docker Swarm has no mark of its own. Each is one colour, as every icon.
   */
  it.each([IconProp.VMware, IconProp.Podman, IconProp.DockerSwarm])(
    "%s keeps the icon set's own one-colour glyph",
    (icon: IconProp) => {
      const svg: SVGElement = draw(icon);

      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.innerHTML).not.toMatch(HEX_COLOUR);
    },
  );
});
