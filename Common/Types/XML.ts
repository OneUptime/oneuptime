export default class XML {
    private _xml: string = '';
    public get xml(): string {
        return this._xml;
    }
    public set xml(v: string) {
        this._xml = v;
    }

    public constructor(xml: string) {
        this.xml = xml;
    }

    public toString(): string {
        return this.xml;
    }
}
