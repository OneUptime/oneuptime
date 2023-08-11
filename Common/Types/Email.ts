import { FindOperator } from 'typeorm';
import Hostname from './API/Hostname';
import DatabaseProperty from './Database/DatabaseProperty';
import BadDataException from './Exception/BadDataException';
import { JSONObject, ObjectType } from './JSON';

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
        value = value.trim();
        value = value.toLowerCase();
        if (Email.isValid(value)) {
            this._email = value;
        } else {
            throw new BadDataException(
                `Email ${value} is not in valid format.`
            );
        }
    }

    public constructor(email: string) {
        super();
        this.email = email;
    }

    public static isValid(value: string): boolean {
        const re: RegExp = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,9}$/i;
        const isValid: boolean = re.test(value);
        if (!isValid) {
            return false;
        }
        return true;
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.Email,
            value: (this as Email).toString(),
        };
    }

    public static override fromJSON(json: JSONObject): Email {
        if (json['_type'] === ObjectType.Email) {
            return new Email((json['value'] as string) || '');
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
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
        value: Email | FindOperator<Email>
    ): string | null {
        if (value) {
            return value.toString();
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
