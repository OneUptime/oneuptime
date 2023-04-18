import BadDataException from '../../Types/Exception/BadDataException';
import PositiveNumber from '../../Types/PositiveNumber';

describe('PositiveNumber constructor', () => {
    test('should create PositiveNumber', () => {
        const value: number = 42;
        const n: PositiveNumber = new PositiveNumber(value);

        expect(n).toBeInstanceOf(PositiveNumber);
        expect(n.positiveNumber).toBe(value);
    });

    const validNumbers: Array<[number | string, number]> = [
        [0, 0],
        [1, 1],
        [Infinity, Infinity],
        [NaN, NaN],
        ['255.0', 255],
    ];

    test.each(validNumbers)(
        '(new PositiveNumber(%p)).positiveNumber == %p',
        (value: number | string, expected: number) => {
            const n: PositiveNumber = new PositiveNumber(value);

            expect(n).toBeInstanceOf(PositiveNumber);
            expect(n.positiveNumber).toBe(expected);
        }
    );

    const invalidNumbers: Array<number | string> = ['', 'hello', -1, 'NaN'];

    test.each(invalidNumbers)(
        'should throw error for new PositiveNumber(%p)',
        (value: number | string) => {
            expect(() => {
                new PositiveNumber(value);
            }).toThrowError(BadDataException);
        }
    );
});

interface TestCase {
    value: number | string;
    stringValue: string;
    numberValue: number;
    isZero: boolean;
    isOne: boolean;
}

const tests: Array<TestCase> = [
    {
        value: 0,
        stringValue: '0',
        numberValue: 0,
        isZero: true,
        isOne: false,
    },
    {
        value: 1,
        stringValue: '1',
        numberValue: 1,
        isZero: false,
        isOne: true,
    },
    {
        value: 42,
        stringValue: '42',
        numberValue: 42,
        isZero: false,
        isOne: false,
    },
    {
        value: Infinity,
        stringValue: 'Infinity',
        numberValue: Infinity,
        isZero: false,
        isOne: false,
    },
    {
        value: NaN,
        stringValue: 'NaN',
        numberValue: NaN,
        isZero: false,
        isOne: false,
    },
    {
        value: '255.0',
        stringValue: '255',
        numberValue: 255,
        isZero: false,
        isOne: false,
    },
];

describe('PositiveNumber.toString', () => {
    test.each(tests)(
        `(new PositiveNumber($value)).toString() == $stringValue`,
        ({ value, stringValue }: TestCase) => {
            const n: PositiveNumber = new PositiveNumber(value);

            expect(n).toBeInstanceOf(PositiveNumber);
            expect(n.toString()).toBe(stringValue);
        }
    );
});

describe('PositiveNumber.isZero', () => {
    test.each(tests)(
        `(new PositiveNumber($value)).isZero() == $isZero`,
        ({ value, isZero }: TestCase) => {
            const n: PositiveNumber = new PositiveNumber(value);

            expect(n).toBeInstanceOf(PositiveNumber);
            expect(n.isZero()).toBe(isZero);
        }
    );
});

describe('PositiveNumber.isOne', () => {
    test.each(tests)(
        `(new PositiveNumber($value)).isOne() == $isOne`,
        ({ value, isOne }: TestCase) => {
            const n: PositiveNumber = new PositiveNumber(value);

            expect(n).toBeInstanceOf(PositiveNumber);
            expect(n.isOne()).toBe(isOne);
        }
    );
});

describe('PositiveNumber.toNumber', () => {
    test.each(tests)(
        `(new PositiveNumber($value)).toNumber() == $numberValue`,
        ({ value, numberValue }: TestCase) => {
            const n: PositiveNumber = new PositiveNumber(value);

            expect(n).toBeInstanceOf(PositiveNumber);
            expect(n.toNumber()).toBe(numberValue);
        }
    );
});
