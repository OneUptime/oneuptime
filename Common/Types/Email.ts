import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';

export default class Email extends DatabaseProperty {
    private _email: string = '';
    public get email(): string {
        return this._email;
    }
    public set email(v: string) {
        this._email = v;
    }

    public constructor(email: string) {
        super();
        const re: RegExp =
            /^(([^<>()[\].,;:\s@"]+(.[^<>()[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+.)+[^<>()[\].,;:\s@"]{2,})$/i;
        const isValid: boolean = re.test(email);
        if (!isValid) {
            throw new BadDataException('Email is not in valid format.');
        }
        this.email = email;
    }

    public override toString(): string {
        return this.email;
    }
}
