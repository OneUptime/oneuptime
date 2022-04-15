export default class HTML {
    private _html: string = '';
    public get html(): string {
        return this._html;
    }
    public set html(v: string) {
        this._html = v;
    }

    public constructor(html: string) {
        this.html = html;
    }

    public toString(): string {
        return this.html;
    }
}
