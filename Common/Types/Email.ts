import { FindOperator } from 'typeorm';
import Hostname from './API/Hostname';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';

const nonBusinessEmailDomains: Array<string> = [
    'gmail',
    'yahoo',
    'yahoomail',
    'googlemail',
    'ymail',
    'icloud',
    'aol',
    'hotmail',
    'outlook',
    'msn',
    'wanadoo',
    'orange',
    'comcast',
    'facebook',
    'hey.com',
    'protonmail',
    'inbox.com',
    'mail.com',
    'zoho',
    'yandex',
];

export default class Email extends DatabaseProperty {
    private _email: string = '';
    public get email(): string {
        return this._email;
    }
    public set email(value: string) {
        if (Email.isValid(value)) {
            this._email = value;
        } else {
            throw new BadDataException('Email is not in valid format.');
        }
    }

    public constructor(email: string) {
        super();
        this.email = email;
    }

    public static isValid(value: string): boolean {
        const re: RegExp = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,4}$/i;
        const isValid: boolean = re.test(value);
        if (!isValid) {
            return false;
        }
        return true;
    }

    public override toString(): string {
        return this.email;
    }

    public getEmailDomain(): Hostname {
        return new Hostname(this.email!.split('@')[1]!);
    }

    public isBusinessEmail(): boolean {
        const domain: string = this.getEmailDomain().hostname || '';
        if (domain) {
            for (let i: number = 0; i < nonBusinessEmailDomains.length; i++) {
                if (domain.includes(nonBusinessEmailDomains[i]!)) {
                    return false;
                }
            }
        }

        return true;
    }

    public static override toDatabase(
        _value: Email | FindOperator<Email>
    ): string | null {
        if (_value) {
            return _value.toString();
        }

        return null;
    }

    public static override fromDatabase(_value: string): Email | null {
        if (_value) {
            return new Email(_value);
        }

        return null;
    }
}
