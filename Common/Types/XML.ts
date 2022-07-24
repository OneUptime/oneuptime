import BadDataException from './Exception/BadDataException';
export default class XML {
    private _xml = '';
    public get xml(): string {
        return this._xml;
    }
    public set xml(v: string) {
        if (!v) {
            throw new BadDataException('XML is not in valid format.');
        }
        this._xml = v;
    }

    public constructor(xml: string) {
        this.xml = xml;
    }

    public toString(): string {
        return this.xml;
    }
}
