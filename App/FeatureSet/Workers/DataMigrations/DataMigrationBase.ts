import NotImplementedException from 'Common/Types/Exception/NotImplementedException';

export default class DataMigrationBase {
    private _name: string = '';
    public get name(): string {
        return this._name;
    }
    public set name(v: string) {
        this._name = v;
    }

    public constructor(name: string) {
        this.name = name;
    }

    public async migrate(): Promise<void> {
        throw new NotImplementedException();
    }

    public async rollback(): Promise<void> {
        throw new NotImplementedException();
    }
}
