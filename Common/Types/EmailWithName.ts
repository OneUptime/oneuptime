import Email from './Email';

export default class EmailWithName {
    private _email: Email = new Email('noreply@oneuptime.com');
    public get email(): Email {
        return this._email;
    }
    public set email(v: Email | string) {
        if (typeof v === 'string') {
            this._email = new Email(v);
        }

        if (v instanceof Email) {
            this._email = v;
        }
    }

    private _name: string = '';
    public get name(): string {
        return this._name;
    }
    public set name(v: string) {
        this._name = v;
    }

    public constructor(name: string, email: string | Email) {
        this.email = email;
        this.name = name;
    }

    public toString(): string {
        return `"${this.name}" <${this.email}>`;
    }
}
