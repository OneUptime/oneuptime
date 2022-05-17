import Email from '../../../Types/Email';

describe('Email()', () => {
    test('should create an email instance', () => {
        expect(new Email('test@test.com')).toBeInstanceOf(Email);
    });

    test('should not create an email with invalid credentials', () => {
        expect(() => {
            new Email('invalid email address');
        }).toThrow('Email is not in valid format.');
    });

    test('value of email instance should be mutable', () => {
        const email: Email = new Email('test@test.com');
        email.email = 'new@test.com';
        expect(email.toString()).toBe('new@test.com');
    });

    test('should read the value of email instance', () => {
        expect(new Email('test@test.com').email).toBe('test@test.com');
    });

    test('value of email instance should of type string', () => {
        expect(typeof new Email('test@test.com').email).toBe('string');
    });

    test('should return a string', () => {
        const email: Email = new Email('test@test.com');
        expect(Email.toDatabase(email)).toBe('test@test.com');
    });

    test('should be an instance Email', () => {
        expect(Email.fromDatabase('test@gmail.com')).toBeInstanceOf(Email);
    });

    test('should not create an instance of Email', () => {
        expect(Email.fromDatabase('')).toBeNull();
    });

    test('should return a string from the transformers to function', () => {
        expect(Email.getDatabaseTransformer().to('test@gmail.com')).toBe(
            'test@gmail.com'
        );
    });

    test('should create an instance of Email through the transformer', () => {
        expect(
            Email.getDatabaseTransformer().from(new Email('test@test.com'))
        ).toBeInstanceOf(Email);
    });
});
