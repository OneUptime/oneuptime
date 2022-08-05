import ColumnLength from "../../../Types/Database/ColumnLength";

describe('enum ColumnLength', () => {
    test('ColumnLength.Version', () => {
        expect(ColumnLength.Version).toEqual(30)
    })

    test('ColumnLength.Slug', () => {
        expect(ColumnLength.Slug).toEqual(100)
    })

    test('ColumnLength.Email', () => {
        expect(ColumnLength.Email).toEqual(100)
    })

    test('ColumnLength.Color', () => {
        expect(ColumnLength.Color).toEqual(6)
    })

    test('ColumnLength.Name', () => {
        expect(ColumnLength.Name).toEqual(50)
    })

    test('ColumnLength.Description', () => {
        expect(ColumnLength.Description).toEqual(500)
    })

    test('ColumnLength.LongText', () => {
        expect(ColumnLength.LongText).toEqual(500)
    })

    test('ColumnLength.Password', () => {
        expect(ColumnLength.Password).toEqual(500)
    })

    test('ColumnLength.ObjectID', () => {
        expect(ColumnLength.ObjectID).toEqual(50)
    })

    test('ColumnLength.ShortURL', () => {
        expect(ColumnLength.ShortURL).toEqual(100)
    })

    test('ColumnLength.ShortText', () => {
        expect(ColumnLength.ShortText).toEqual(100)
    })

    test('ColumnLength.HashedString', () => {
        expect(ColumnLength.HashedString).toEqual(64)
    })

    test('ColumnLength.Phone', () => {
        expect(ColumnLength.Phone).toEqual(30)
    })

    test('ColumnLength.OTP', () => {
        expect(ColumnLength.OTP).toEqual(8)
    })
})