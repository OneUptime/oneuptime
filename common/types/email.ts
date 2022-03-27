export default class Email {
    private _email: string = '';
    public get email(): string {
        return this._email;
    }
    public set email(v: string) {
        this._email = v;
    }

    constructor(email: string) {
        this.email = email;
    }

    toString(): string {
        return this.email;
    }
}
