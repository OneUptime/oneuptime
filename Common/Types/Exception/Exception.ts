import ExceptionCode from './ExceptionCode';

type ExceptionRule = {
    id: number;
};
export default class Exception extends Error {
    private _code: ExceptionCode = ExceptionCode.GeneralException;

    public get code(): ExceptionCode {
        return this._code;
    }

    public set code(value: ExceptionCode) {
        if (Exception.isValidCode(value)) {
            this._code = value;
        } else {
            throw new Exception(400, 'Invalid error code');
        }
    }

    public constructor(code: ExceptionCode, message: string) {
        super(message);
        this.code = code;
    }

    private static enumToArray(enumme: any): ExceptionRule[] {
        const map: ExceptionRule[] = [];
        for (const n in enumme) {
            if (typeof enumme[n] === 'number') {
                map.push({ id: <number>enumme[n] });
            }
        }
        return map;
    }

    private static isValidCode(code: number): boolean {
        const rules: Array<ExceptionRule> = this.enumToArray(ExceptionCode);
        for (let i: number = 0; i < rules.length; i++) {
            if (code === rules[i]!['id']) {
                return true;
            }
        }
        return false;
    }
}
