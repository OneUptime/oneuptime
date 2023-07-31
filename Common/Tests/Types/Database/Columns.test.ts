import Columns from '../../../Types/Database/Columns';

describe('class Columns', () => {
    test('it should return a valid object if Columns is valid', () => {
        expect(new Columns(['col1', 'col2'])).toBeInstanceOf(Columns);
        expect(new Columns(['col1', 'col2']).columns).toStrictEqual([
            'col1',
            'col2',
        ]);
    });

    test('it should add column', () => {
        const cols: Array<string> = ['col1', 'col2'];
        new Columns(cols).addColumn('col3');
        expect(new Columns(cols).columns).toContain('col3');
    });

    test('it should return true if column is included', () => {
        const cols: Array<string> = ['col1', 'col2'];
        expect(new Columns(cols).hasColumn('col2')).toBeTruthy();
    });
});
