export default class Color {
    
    private _color!: string;
    public get color(): string {
        return this._color;
    }
    public set color(v: string) {
        this._color = v;
    }

    public constructor(color: string) {
        this.color = color;
    }

    public toString(): string {
        return this.color;
    }
}
