import Dictionary from '../Types/Dictionary';
describe('Dictionary', () => {
    test('should allow basic types   compile', () => {
        const user: Dictionary<string> = {
            user: 'test',
        };
        expect(user).toBeTruthy();
    });
    test('should compile', () => {
        const user: Dictionary<{ [x: string]: string }> = {
            user: { use: 'welcome' },
        };
        expect(user).toBeTruthy();
    });
});
