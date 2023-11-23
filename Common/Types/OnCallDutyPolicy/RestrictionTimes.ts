import DatabaseProperty from '../Database/DatabaseProperty';
import Dictionary from '../Dictionary';
import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';
import JSONFunctions from '../JSONFunctions';
import StartAndEndTime from '../Time/StartAndEndTime';

export enum RestrictionType {
    Daily = 'Daily',
    Weekly = 'Weekly',
    None = 'None',
}

export interface RestrictionTimesData extends JSONObject {
    restictionType: RestrictionType;
    dayRestrictionTimes: StartAndEndTime | null;
    weeklyRestrictionTime: Dictionary<StartAndEndTime>;
}

export default class RestrictionTimes extends DatabaseProperty {
    private data: RestrictionTimesData =
        RestrictionTimes.getDefaultRestrictonTimeData();

    public get restictionType(): RestrictionType {
        return this.data.restictionType;
    }
    public set restictionType(v: RestrictionType) {
        this.data.restictionType = v;
    }

    // dayRestrictionTimes

    public get dayRestrictionTimes(): StartAndEndTime | null {
        return this.data.dayRestrictionTimes;
    }

    public set dayRestrictionTimes(v: StartAndEndTime | null) {
        this.data.dayRestrictionTimes = v;
    }

    // weeklyRestrictionTime

    public get weeklyRestrictionTime(): Dictionary<StartAndEndTime> {
        return this.data.weeklyRestrictionTime;
    }

    public set weeklyRestrictionTime(v: Dictionary<StartAndEndTime>) {
        this.data.weeklyRestrictionTime = v;
    }

    public constructor() {
        super();

        this.data = RestrictionTimes.getDefaultRestrictonTimeData();
    }

    public static getDefaultRestrictonTimeData(): RestrictionTimesData {
        return {
            restictionType: RestrictionType.None,
            dayRestrictionTimes: null,
            weeklyRestrictionTime: {},
        };
    }

    public static getDefault(): RestrictionTimes {
        return new RestrictionTimes();
    }

    public override toJSON(): JSONObject {
        return JSONFunctions.serialize({
            _type: ObjectType.RestrictionTimes,
            value: {
                restictionType: this.restictionType,
                dayRestrictionTimes: this.dayRestrictionTimes,
                weeklyRestrictionTime: this.weeklyRestrictionTime,
            },
        });
    }

    public static override fromJSON(json: JSONObject): RestrictionTimes {
        if (json instanceof RestrictionTimes) {
            return json;
        }

        if (!json || json['_type'] !== ObjectType.RestrictionTimes) {
            throw new BadDataException('Invalid Restriction Times');
        }

        if (!json['value']) {
            throw new BadDataException('Invalid Restriction Times');
        }

        const data: JSONObject = json['value'] as JSONObject;

        const restrictionTimes: RestrictionTimes = new RestrictionTimes();

        restrictionTimes.restictionType = data[
            'restictionType'
        ] as RestrictionType;

        restrictionTimes.dayRestrictionTimes = data[
            'dayRestrictionTimes'
        ] as StartAndEndTime | null;

        const weeklyRestrictionTime: Dictionary<StartAndEndTime> =
            (data['weeklyRestrictionTime'] as Dictionary<StartAndEndTime>) ||
            {};

        restrictionTimes.weeklyRestrictionTime = weeklyRestrictionTime;

        return restrictionTimes;
    }
}
