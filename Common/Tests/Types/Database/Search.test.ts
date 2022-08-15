import Search from '../../../Types/Database/Search';

describe('Search', () => {
    test('new Search() should return a valid object', () => {
        expect(new Search('Demo').toString()).toBe('Demo');
    });
    test('value should return a valid string', () => {
        expect(new Search('Item1').value).toBe('Item1');
    });
});
