class ApiBaseConstant {
    private _name: string;

    public get name(): string {
        return this._name;
    }

    public constructor(name: string) {
        this._name = name;
        this.REQUEST += name;
        this.ERROR += name;
        this.SUCCESS += name;
        this.RESET += name;
    }

    public REQUEST: string = 'Request';
    public ERROR: string = 'Error';
    public SUCCESS: string = 'Success';
    public RESET: string = 'Reset';
}

export default ApiBaseConstant;
