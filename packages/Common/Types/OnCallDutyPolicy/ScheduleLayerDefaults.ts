import OnCallDutyPolicyScheduleLayer from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OneUptimeDate from "../Date";
import EventInterval from "../Events/EventInterval";
import Recurring from "../Events/Recurring";
import ObjectID from "../ObjectID";
import PositiveNumber from "../PositiveNumber";
import RestrictionTimes from "./RestrictionTimes";

/*
 * A NEW LAYER OF AN ON-CALL SCHEDULE, AS IT STARTS.
 *
 * One builder for every layer OneUptime adds on someone's behalf, so they
 * all start the same way:
 *
 *   - the first layer of a schedule created with "Who takes turns?"
 *     (OnCallDutyPolicyScheduleService.create), and
 *   - a layer added with "Add Layer" on a schedule's Layers page.
 *
 * A new layer:
 *
 *   - is on call from now: the first person in it is on call at once;
 *   - hands off once a week, the rotation most on-call teams run, unless the
 *     caller picks another;
 *   - hands off for the first time one rotation after it starts, at the same
 *     time of day in the schedule's time zone;
 *   - is on call around the clock (no restriction times).
 *
 * Everything can be changed on the layer afterwards. A layer created through
 * the API with no rotation still gets its column's own default (a day), as it
 * always did: this is what the product picks, not the API contract.
 *
 * Server-safe and React-free: the server, the dashboard and their tests use it.
 */

// How long each turn of a new layer lasts, unless someone picks another.
export const DEFAULT_LAYER_ROTATION_INTERVAL_TYPE: EventInterval =
  EventInterval.Week;

export const DEFAULT_LAYER_ROTATION_INTERVAL_COUNT: number = 1;

export const getDefaultLayerRotation: () => Recurring = (): Recurring => {
  const rotation: Recurring = new Recurring();
  rotation.intervalType = DEFAULT_LAYER_ROTATION_INTERVAL_TYPE;
  rotation.intervalCount = new PositiveNumber(
    DEFAULT_LAYER_ROTATION_INTERVAL_COUNT,
  );
  return rotation;
};

// "Layer 2": the name a layer is given after its place in the schedule.
export const getLayerName: (position: number) => string = (
  position: number,
): string => {
  return `Layer ${position}`;
};

/*
 * The name of a layer added at `order`: "Layer <order>", or the next number
 * up that no layer of the schedule is called yet. The order alone is not
 * enough: deleting a layer in the middle moves the ones below it up but
 * leaves their names, so "Layer 3" can still exist on a schedule of two.
 */
export const getNewLayerName: (data: {
  order: number;
  existingNames: Array<string>;
}) => string = (data: {
  order: number;
  existingNames: Array<string>;
}): string => {
  const taken: Set<string> = new Set<string>(data.existingNames);

  let position: number = Math.max(1, Math.floor(data.order) || 1);

  while (taken.has(getLayerName(position))) {
    position++;
  }

  return getLayerName(position);
};

/*
 * When a layer that starts at `startsAt` first hands off: one rotation
 * later, counted in calendar units in the schedule's time zone, so a weekly
 * layer started on a Tuesday at 14:30 hands off the next Tuesday at 14:30 -
 * across a daylight saving change too. Hourly rotations are counted in
 * absolute hours, as the layer engine counts them.
 */
export const getFirstHandOffTime: (data: {
  startsAt: Date;
  rotation: Recurring;
  timezone?: string | undefined;
}) => Date = (data: {
  startsAt: Date;
  rotation: Recurring;
  timezone?: string | undefined;
}): Date => {
  const rotation: Recurring = Recurring.fromJSON(data.rotation);

  const count: number = Math.max(
    1,
    Math.floor(rotation.intervalCount.toNumber()) || 1,
  );

  return OneUptimeDate.addRemoveCalendarUnits(
    data.startsAt,
    Recurring.toCalendarUnit(rotation.intervalType),
    count,
    data.timezone || undefined,
  );
};

export interface NewScheduleLayerData {
  onCallDutyPolicyScheduleId: ObjectID;
  projectId: ObjectID;
  name: string;
  // Left out, the layer service puts the layer last.
  order?: number | undefined;
  // How long each turn lasts. Default: getDefaultLayerRotation (a week).
  rotation?: Recurring | undefined;
  // When the first turn starts. Default: now.
  startsAt?: Date | undefined;
  // The schedule's time zone, which hand-off times are kept in.
  timezone?: string | undefined;
}

// A new layer, ready to be created (see the note at the top).
export const buildNewScheduleLayer: (
  data: NewScheduleLayerData,
) => OnCallDutyPolicyScheduleLayer = (
  data: NewScheduleLayerData,
): OnCallDutyPolicyScheduleLayer => {
  const startsAt: Date = data.startsAt || OneUptimeDate.getCurrentDate();

  // A copy: the layer must not share a rotation the caller may change.
  const rotation: Recurring = data.rotation
    ? Recurring.fromJSON(Recurring.fromJSON(data.rotation).toJSON())
    : getDefaultLayerRotation();

  const layer: OnCallDutyPolicyScheduleLayer =
    new OnCallDutyPolicyScheduleLayer();

  layer.onCallDutyPolicyScheduleId = data.onCallDutyPolicyScheduleId;
  layer.projectId = data.projectId;
  layer.name = data.name;

  if (data.order !== undefined) {
    layer.order = data.order;
  }

  layer.startsAt = startsAt;
  layer.rotation = rotation;
  layer.handOffTime = getFirstHandOffTime({
    startsAt: startsAt,
    rotation: rotation,
    timezone: data.timezone,
  });
  layer.restrictionTimes = RestrictionTimes.getDefault();

  return layer;
};
