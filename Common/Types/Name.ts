import { FindOperator } from 'typeorm';
import DatabaseProperty from './Database/DatabaseProperty';

export default class Name extends DatabaseProperty {
    private _title: string = '';
    public get title(): string {
        return this._title;
    }
    public set title(v: string) {
        this._title = v;
    }

    private _name: string = '';
    public get name(): string {
        return this._name;
    }
    public set name(v: string) {
        this._name = v;
    }

    public constructor(name: string) {
        super();
        this.name = name;
    }

    public getFirstName(): string {
        return this.name.split(' ')[0] || '';
    }

    public getLastName(): string {
        if (this.name.split(' ').length > 1) {
            return this.name.split(' ')[this.name.split(' ').length - 1] || '';
        }
        return '';
    }

    public getMiddleName(): string {
        if (this.name.split(' ').length > 2) {
            return this.name.split(' ')[1] || '';
        }
        return '';
    }

    public override toString(): string {
        return this.name;
    }

    public static override toDatabase(
        _value: Name | FindOperator<Name>
    ): string | null {
        if (_value) {
            return _value.toString();
        }

        return null;
    }

    public static override fromDatabase(_value: string): Name | null {
        if (_value) {
            return new Name(_value);
        }

        return null;
    }
}
