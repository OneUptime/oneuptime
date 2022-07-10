import { FindOperator } from "typeorm";
import DatabaseProperty from "./Database/DatabaseProperty";

export default class Color extends DatabaseProperty {
    private _color!: string;
    public get color(): string {
        return this._color;
    }
    public set color(v: string) {
        this._color = v;
    }

    public constructor(color: string) {
        super();
        this.color = color;
    }

    public override toString(): string {
        return this.color;
    }

    public static override toDatabase(
        value: Color | FindOperator<Color>
    ): string | null {
        if (value) {
            return value.toString();
        }

        return null;
    }

    public static override fromDatabase(_value: string): Color | null {
        if (_value) {
            return new Color(_value);
        }

        return null;
    }
}
