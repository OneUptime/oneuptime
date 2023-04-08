import ArrayUtil from '../../Types/ArrayUtil';

describe('ArrayUtil', () => {
    describe('isEqual', () => {
        describe('should return true for equal arrays', () => {
            const equalArrays: Array<[Array<any>, Array<any>]> = [
                [[], []],
                [[1], [1]],
                [
                    [1, 2],
                    [1, 2],
                ],
                [
                    [1, 2, 3],
                    [3, 2, 1],
                ], // different order
                [
                    [undefined, function () {}],
                    [null, null],
                ],
                [
                    [true, true, false],
                    [true, false, true],
                ],
                [[new Map([['foo', 'bar']])], [{}]],
                [[[1]], [[1]]],
                [[{ a: 1 }], [{ a: 1 }]],
                [[{ a: undefined, b: function () {} }], [{}]],
                [[new Date(2000, 1, 1)], [new Date(2000, 1, 1)]],
            ];

            it.each(equalArrays)('%p != %p', (a: any[], b: any[]) => {
                expect(ArrayUtil.isEqual(a, b)).toBe(true);
                expect(ArrayUtil.isEqual(b, a)).toBe(true);
            });
        });

        describe('should return false for non-equal arrays', () => {
            const nonEqualArrays: Array<[Array<any>, Array<any>]> = [
                [[1], []],
                [[1], [2]],
                [
                    [1, 2],
                    [2, 3],
                ],
                [[[1]], [[2]]],
                [
                    [true, true, false],
                    [true, false, false],
                ],
                [[{ a: 1 }], [{ a: 2 }]],
                [[{ a: 1, b: 2 }], [{ b: 2, a: 1 }]], // JSON.stringify maintains key order
                [[new Date(2000, 1, 1)], [new Date(2000, 1, 2)]],
            ];

            it.each(nonEqualArrays)('%p != %p', (a: any[], b: any[]) => {
                expect(ArrayUtil.isEqual(a, b)).toBe(false);
                expect(ArrayUtil.isEqual(b, a)).toBe(false);
            });
        });

        it('should not mutate arguments', () => {
            const a: Array<number> = [3, 1, 2];
            const b: Array<number> = [1, 3, 2];

            expect(ArrayUtil.isEqual(a, b)).toBe(true);

            // Jest does not sort elements before performing the equality test
            expect(a).toEqual([3, 1, 2]);
            expect(b).toEqual([1, 3, 2]);
        });
    });

    describe('sortByFieldName', () => {
        type compareFn = (a: any, b: any) => number;

        it('should return a compare function that sorts an array of objects by field name', () => {
            const sortByFoo: compareFn = ArrayUtil.sortByFieldName('foo');
            type Foo = {
                foo: number;
            };

            const items: Array<Foo> = [{ foo: 42 }, { foo: 1 }, { foo: 13 }];
            items.sort(sortByFoo);

            expect(
                items.map((v: Foo) => {
                    return v.foo;
                })
            ).toEqual([1, 13, 42]);
        });
    });
});
