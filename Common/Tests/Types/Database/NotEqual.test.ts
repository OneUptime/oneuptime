import NotEqual from '../../../Types/BaseDatabase/NotEqual';
import { describe, expect, it } from '@jest/globals';

describe('NotEqual', () => {
    describe('constructor', () => {
        it('should set the value property', () => {
            const value: string = 'test';
            const notEqual: NotEqual = new NotEqual(value);
            expect(notEqual.value).toBe(value);
        });
    });
    describe('toString', () => {
        it('should return the string value', () => {
            const value: string = 'test';
            const notEqual: NotEqual = new NotEqual(value);
            expect(notEqual.toString()).toBe(value);
        });
    });
});
