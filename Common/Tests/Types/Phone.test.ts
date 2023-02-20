import BadDataException from '../../Types/Exception/BadDataException';
import Phone from '../../Types/Phone';

describe('Testing Class Phone', () => {
    test('Should create a phone if the phone is valid phone number', () => {
        expect(new Phone('+251912974103').toString()).toEqual('+251912974103');
        expect(new Phone('961-770-7727').phone).toEqual('961-770-7727');
        expect(new Phone('943-627-0355').phone).toEqual('943-627-0355');
        expect(new Phone('282.652.3201').phone).toEqual('282.652.3201');
    });

    test('Phone.phone should be mutatable', () => {
        const value: Phone = new Phone('+251912974103');
        value.phone = '+251925974121';
        expect(value.phone).toEqual('+251925974121');
        expect(value.toString()).toEqual('+251925974121');
    });

    test('Creating phone number with invalid format should throw BadDataException', () => {
        expect(() => {
            new Phone('25192599879079074121');
        }).toThrowError(BadDataException);
    });

    test('try to mutating Phone.phone with invalid value should throw an BadDataExcepection', () => {
        const valid: string = '+251912974103';
        const invalid: string = '278@$90> ';
        const value: Phone = new Phone(valid);
        expect(() => {
            value.phone = invalid;
        }).toThrowError(BadDataException);
        expect(() => {
            value.phone = '278@$90> ';
        }).toThrow('Phone is not in valid format: 278@$90>');
        expect(value.phone).toBe(valid);
        expect(() => {
            value.phone = 'hgjuit879';
        }).toThrowError(BadDataException);
    });
});
