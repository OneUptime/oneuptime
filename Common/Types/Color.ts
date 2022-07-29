import { FindOperator } from 'typeorm';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';

export interface RGB {
    red: number;
    green: number;
    blue: number;
}

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

    public static colorToRgb(color: Color): RGB {
        const result = (/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i).exec(
            color.toString()
        );

        if (!result) {
            throw new BadDataException('Invalid color: ' + color.toString());
        }

        return {
            red: parseInt(result[1] ? result[1] : '0', 16),
            green: parseInt(result[2] ? result[2] : '0', 16),
            blue: parseInt(result[3] ? result[3] : '0', 16),
        };
    }

    private static _componentToHex(c: number): string {
        const hex = c.toString(16);
        return hex.length == 1 ? '0' + hex : hex;
    }

    public static rgbToColor(rgb: RGB): Color {
        return new Color(
            '#' +
                this._componentToHex(rgb.red) +
                this._componentToHex(rgb.green) +
                this._componentToHex(rgb.blue)
        );
    }
}
