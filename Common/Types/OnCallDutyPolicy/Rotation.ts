import DatabaseProperty from "../Database/DatabaseProperty";
import EventInterval from "../Events/EventInterval";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import PositiveNumber from "../PositiveNumber";


export interface RotationData extends JSONObject {
    rotationInterval: EventInterval;
    rotationIntervalCount: PositiveNumber;
}

export default class Rotation extends DatabaseProperty {


    public static getDefaultRotationData(): RotationData {
        return {
            rotationInterval: EventInterval.Day,
            rotationIntervalCount: new PositiveNumber(1),
        };
    }


    private data: RotationData = Rotation.getDefaultRotationData();


    public get rotationInterval(): EventInterval {
        return this.data.rotationInterval;
    }
    public set rotationInterval(v: EventInterval) {
        this.data.rotationInterval = v;
    }

    // rotationIntervalCount

    public get rotationIntervalCount(): PositiveNumber {
        return this.data.rotationIntervalCount;
    }

    public set rotationIntervalCount(v: PositiveNumber) {
        this.data.rotationIntervalCount = v;
    }


    public constructor() {
        super();

        this.data = Rotation.getDefaultRotationData();
    }

    public static getDefault() {
        return new Rotation();
    }


    public override toJSON(): JSONObject {
        return JSONFunctions.serialize({
            _type: ObjectType.Rotation,
            value: {
                rotationInterval: this.rotationInterval,
                rotationIntervalCount: this.rotationIntervalCount,
            },
        });
    }


    public static override fromJSON(json: JSONObject): Rotation {
        if (json instanceof Rotation) {
            return json;
        }

        if (!json || json['_type'] !== ObjectType.Rotation) {
            throw new BadDataException('Invalid Rotation');
        }

        if (!json['value']) {
            throw new BadDataException('Invalid Rotation');
        }

        json = json['value'] as JSONObject;


        let rotationInterval: EventInterval = EventInterval.Day;

        if (
            json &&
            json['rotationInterval']
        ) {
            rotationInterval = json['rotationInterval'] as EventInterval;
        }

        let rotationIntervalCount: PositiveNumber = new PositiveNumber(1);

        if (
            json &&
            json['rotationIntervalCount']
        ) {


            rotationIntervalCount = PositiveNumber.fromJSON(json['rotationIntervalCount']);
        }



        const rotation: Rotation = new Rotation();

        rotation.data = {
            rotationInterval,
            rotationIntervalCount,
        };

        return rotation;
    }
}