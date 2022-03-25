export default class URL {
    private _path: string = '';
    public get path(): string {
        return this._path;
    }
    public set path(v: string) {
        this._path = v;
    }

    private _baseUrl: string = '';
    public get baseUrl(): string {
        return this._baseUrl;
    }
    public set baseUrl(v: string) {
        this._baseUrl = v;
    }

    constructor(baseUrl?: string, path?: string) {
        if (baseUrl) {
            this.baseUrl = baseUrl;
        }

        if (path) {
            this.path = path;
        }
    }

    isHttps(): boolean {
        return this.baseUrl.startsWith('https://');
    }

    toString(): string {
        return `${this.baseUrl}${this.path}`;
    }
}
