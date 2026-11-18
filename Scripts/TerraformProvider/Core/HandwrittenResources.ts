import type { SchemaDumpBlock } from "./DocumentationGenerator";

/*
 * THE RESOURCES WRITTEN BY HAND (StaticFiles/), BESIDE THE ONES THE API'S
 * SPEC GIVES.
 *
 * `oneuptime_on_call_schedule_layers` (OneUptime/oneuptime#9038): who takes
 * turns in each layer of an on-call schedule, and the layers' order, saved
 * in one call - POST /on-call-duty-policy-schedule/:id/save-layers, read back
 * with GET .../:id/layers - so an apply writes all of a change or none of
 * it. No record of the API is it, so the spec gives no resource for it.
 *
 * Each is copied in with its tests, registered beside the generated ones
 * (resources.go), and documented from the built provider's schema, with the
 * page's own example and guide (DocumentationGenerator).
 */

export interface HandwrittenResource {
  // The resource's name after the provider's: on_call_schedule_layers.
  name: string;
  // Its constructor in the Go file, as resources.go registers it.
  goConstructor: string;
  // The Go files that make it, and its tests, in StaticFiles/.
  staticFiles: Array<string>;
  /*
   * Its schema, as the docs describe it when generation stopped before the
   * provider was built and its schema could be read.
   */
  schema: SchemaDumpBlock;
}

export const ON_CALL_SCHEDULE_LAYERS: HandwrittenResource = {
  name: "on_call_schedule_layers",
  goConstructor: "NewOnCallScheduleLayersResource",
  staticFiles: [
    "resource_on_call_schedule_layers.go",
    "resource_on_call_schedule_layers_test.go",
  ],
  schema: {
    description:
      "Who takes turns in each layer of an on-call schedule, in turn order, and the order of the layers, saved all at once.",
    attributes: {
      id: {
        type: "String",
        description: "The schedule's ID: a schedule has one of these.",
        computed: true,
      },
      on_call_duty_policy_schedule_id: {
        type: "String",
        description:
          "ID of the `oneuptime_on_call_policy_schedule` whose layers these are. Changing it replaces the resource.",
        required: true,
      },
      layers: {
        type: "Attributes List",
        description:
          "Layers of the schedule, the highest priority first: the layer on top is the one that pages while someone in it is on call. Each layer once. The layers listed take the places they have in the schedule between them, in this order.",
        required: true,
        nested: {
          layer_id: {
            type: "String",
            description:
              "ID of the `oneuptime_on_call_schedule_layer`: a layer of this schedule.",
            required: true,
          },
          user_ids: {
            type: "List of String",
            description:
              "User IDs of the people who take turns in the layer, in turn order: `[]` for nobody. Someone in the project, or invited to it - `oneuptime_team_member`'s `user_id`, or `data.oneuptime_user`'s `id` for someone named by email address.",
            required: true,
          },
        },
      },
    },
  },
};

export const HANDWRITTEN_RESOURCES: ReadonlyArray<HandwrittenResource> = [
  ON_CALL_SCHEDULE_LAYERS,
];
