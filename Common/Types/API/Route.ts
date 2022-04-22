export default class Route {
    private _route: string = '';
    public get route(): string {
        return this._route;
    }
    public set route(v: string) {
        this._route = v;
    }

    public constructor(route?: string) {
        if (route) {
            this.route = route;
        }
    }

    public toString(): string {
        return this.route;
    }
}
