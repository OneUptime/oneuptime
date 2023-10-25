import InBetween from '../../../Types/Database/InBetween';
import BadDataException from '../../../Types/Exception/BadDataException';
import { JSONObject } from '../../../Types/JSON';

describe('InBetween', () => {
    it('should create an InBetween object with valid start and end values', () => {
        const startValue: number = 10;
        const endValue: number = 20;
        const betweenObj: InBetween = new InBetween(startValue, endValue);
        expect(betweenObj.startValue).toBe(10);
        expect(betweenObj.endValue).toBe(20);
    });

    it('should generate the correct JSON representation using toJSON method', () => {
        const startValue: number = 10;
        const endValue: number = 20;
        const betweenObj: InBetween = new InBetween(startValue, endValue);
        const expectedJSON: JSONObject = {
            _type: 'InBetween',
            startValue: 10,
            endValue: 20,
        };
        expect(betweenObj.toJSON()).toEqual(expectedJSON);
    });

    it('should create an InBetween object from valid JSON input', () => {
        const jsonInput: JSONObject = {
            _type: 'InBetween',
            startValue: 10,
            endValue: 20,
        };
        const betweenObj: InBetween = InBetween.fromJSON(jsonInput);
        expect(betweenObj.startValue).toBe(10);
        expect(betweenObj.endValue).toBe(20);
    });

    it('should throw a BadDataException when using invalid JSON input', () => {
        const jsonInput: JSONObject = {
            _type: 'InvalidType',
            startValue: 10,
            endValue: 20,
        };
        expect(() => {
            return InBetween.fromJSON(jsonInput);
        }).toThrow(BadDataException);
    });

    it('should return a string with start and end values matching', () => {
        const startValue: number = 15;
        const endValue: number = 15;
        const betweenObj: InBetween = new InBetween(startValue, endValue);
        expect(betweenObj.toString()).toBe('15');
    });

    it('should return a string with start and end values different', () => {
        const startValue: number = 10;
        const endValue: number = 20;
        const betweenObj: InBetween = new InBetween(startValue, endValue);
        expect(betweenObj.toString()).toBe('10 - 20');
    });

    it('should return the start value as a string', () => {
        const startValue: number = 10;
        const endValue: number = 20;
        const betweenObj: InBetween = new InBetween(startValue, endValue);
        expect(betweenObj.toStartValueString()).toBe('10');
    });

    it('should return the end value as a string', () => {
        const startValue: number = 10;
        const endValue: number = 20;
        const betweenObj: InBetween = new InBetween(startValue, endValue);
        expect(betweenObj.toEndValueString()).toBe('20');
    });

    it('should be a type of InBetween', () => {
        const inBetweenObj: InBetween = new InBetween(10, 15);
        expect(inBetweenObj).toBeInstanceOf(InBetween);
    });
});
