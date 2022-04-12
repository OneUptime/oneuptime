import Email from './Email';

export default class EmailWithName {
    private _email: Email = new Email('noreply@oneuptime.com');
    public get email(): Email {
        return this._email;
    }
    public set email (v: Email):void {
        this._email = v;
    }

    private _name: string = '';
    public get name(): string {
        return this._name;
    }
    public set name (v: string):void {
        this._name = v;
    }

    constructor (name: string, email: string | Email):void {
        if  (typeof email === 'string'):void {
            this.email = new Email(email);
        }

        if  (email instanceof Email):void {
            this.email = email;
        }

        this.name = name;
    }

    toString(): string {
        return `"${this.name}" <${this.email}>`;
    }
}
