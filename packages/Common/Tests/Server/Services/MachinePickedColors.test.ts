import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import LabelService from "../../../Server/Services/LabelService";
import ServiceService from "../../../Server/Services/ServiceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Label from "../../../Models/DatabaseModels/Label";
import Service from "../../../Models/DatabaseModels/Service";
import {
  Black,
  BrightColors,
  Gray500,
  Moroon500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import {
  DISTINCT_COLORS,
  getColorHue,
  pickColorForName,
} from "../../../Utils/DistinctColor";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The colours the server picks for records nobody coloured: a label promoted
 * from a telemetry attribute (oneuptime.label.<dim>=<value>), and a service
 * whose API caller sent no colour. Both came from BrightColors, whose first
 * colour is black and which holds grey and maroon: a black service vanished
 * against the dark theme, a grey label looked switched off. They come from
 * the palette a Create form picks a new record's colour from now
 * (Utils/DistinctColor): no black, white or grey, every colour visible on
 * both themes.
 *
 * Only the database calls are stubbed.
 */

const PALETTE: Array<string> = DISTINCT_COLORS.map((color: Color): string => {
  return color.toString();
});

const PROJECT_ID: ObjectID = ObjectID.generate();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a label created from telemetry", () => {
  let created: Array<Label> = [];

  const stubDatabase: () => void = (): void => {
    created = [];

    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
    // No label of that name yet.
    jest.spyOn(LabelService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(LabelService, "create")
      .mockImplementation(async (createBy: CreateBy<Label>) => {
        const label: Label = createBy.data;
        label._id = ObjectID.generate().toString();
        created.push(label);
        return label;
      });
  };

  test("is coloured from the palette, the same colour for the same name", async () => {
    stubDatabase();

    const names: Array<string> = [
      "production",
      "staging",
      "team:payments",
      "region:eu-west-1",
      "k8s",
      "canary",
    ];

    const ids: Array<ObjectID> = await LabelService.findOrCreateLabelsByNames({
      projectId: PROJECT_ID,
      labelNames: names,
    });

    expect(ids).toHaveLength(names.length);
    expect(created).toHaveLength(names.length);

    for (const label of created) {
      expect(label.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(label.color).toBeInstanceOf(Color);
      expect(PALETTE).toContain(label.color!.toString());
      // The same in every worker that creates it.
      expect(label.color!.toString()).toBe(
        pickColorForName(label.name!).toString(),
      );
    }
  });

  test("is never black, grey or maroon, whatever its name", async () => {
    stubDatabase();

    const names: Array<string> = [];

    for (let index: number = 0; index < 120; index++) {
      names.push(`attribute-value-${index}`);
    }

    await LabelService.findOrCreateLabelsByNames({
      projectId: PROJECT_ID,
      labelNames: names,
    });

    expect(created).toHaveLength(names.length);

    for (const label of created) {
      const color: string = label.color!.toString();

      expect(getColorHue(color)).not.toBeNull();

      for (const retired of [Black, Gray500, Moroon500]) {
        expect(color).not.toBe(retired.toString());
      }
    }

    // BrightColors still holds them: why it is not where these come from.
    expect(BrightColors[0]!.toString()).toBe(Black.toString());
  });
});

describe("a service created without a colour", () => {
  type OnBeforeCreate = (
    createBy: CreateBy<Service>,
  ) => Promise<OnCreate<Service>>;

  const onBeforeCreate: OnBeforeCreate = (
    createBy: CreateBy<Service>,
  ): Promise<OnCreate<Service>> => {
    return (
      ServiceService as unknown as { onBeforeCreate: OnBeforeCreate }
    ).onBeforeCreate(createBy);
  };

  const newService: (color?: Color) => Service = (color?: Color): Service => {
    const service: Service = new Service();
    service.projectId = PROJECT_ID;
    service.name = "checkout";

    if (color) {
      service.serviceColor = color;
    }

    return service;
  };

  test("gets a colour from the palette - every one of them, never black or grey", async () => {
    const seen: Set<string> = new Set<string>();
    const random: SpyInstance<() => number> = jest.spyOn(Math, "random");

    // Walk Math.random across [0, 1) so every palette slot is landed on.
    for (let index: number = 0; index < PALETTE.length; index++) {
      random.mockReturnValue((index + 0.5) / PALETTE.length);

      const result: OnCreate<Service> = await onBeforeCreate({
        data: newService(),
        props: { isRoot: true },
      });

      const color: Color | undefined = result.createBy.data.serviceColor;

      expect(color).toBeInstanceOf(Color);
      seen.add(color!.toString());
    }

    expect(Array.from(seen).sort()).toEqual([...PALETTE].sort());

    for (const color of Array.from(seen)) {
      expect(color).not.toBe(Black.toString());
      expect(color).not.toBe(Gray500.toString());
    }
  });

  test("hands out a colour of its own, not the palette's shared one", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0);

    const result: OnCreate<Service> = await onBeforeCreate({
      data: newService(),
      props: { isRoot: true },
    });

    result.createBy.data.serviceColor!.color = "#000000";

    expect(DISTINCT_COLORS[0]!.toString()).toBe(PALETTE[0]);
  });

  test("keeps the colour an API caller (Terraform) sent", async () => {
    const result: OnCreate<Service> = await onBeforeCreate({
      data: newService(new Color("#123456")),
      props: { isRoot: true },
    });

    expect(result.createBy.data.serviceColor!.toString()).toBe("#123456");
  });
});
