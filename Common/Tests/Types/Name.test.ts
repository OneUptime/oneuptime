import Name from '../../Types/Name';


describe('class Name', () =>{
    test('new Name() should return a valid object if valid name is given', () =>{
        expect(new Name('Dua Lipa').toString()).toBe('Dua Lipa');
    });
    test('should return the First Name', () => {
        expect(new Name('Louis Harry Liam').getFirstName()).toBe(
            'Louis'
        );
    });
    test('should return the Last Name', () => {
        expect(new Name('Louis Harry Liam').getLastName()).toBe(
            'Liam'
        );
    });
     test('should return the Midlle Name', () => {
        expect(new Name('Louis Harry Liam').getMiddleName()).toBe(
            'Harry'
        );
    });
    test('Name should return String',()=>{
        const name: Name = new Name('Taylor Swift');
        expect(Name.toDatabase(name)).toBe('Taylor Swift');
    });
    test('should read the value of Name instance', () => {
        expect(new Name('Kriti Sanon').name).toBe('Kriti Sanon');
    });
     test('should not create an instance of Name', () => {
        expect(Name.fromDatabase('')).toBeNull();
    });
})