import type { RGB } from '../../Types/Color';
import Color from '../../Types/Color';
import BadDataException from '../../Types/Exception/BadDataException';

describe('Color', () => {
    test('should return the color string', () => {
        const color: Color = new Color('#807149');
        expect(color.toString()).toBe('#807149');
    });
    test('should return the string value of color  ', () => {
        const color: Color = new Color('#807149');
        expect(Color.toDatabase(color)).toBe('#807149');
    });
    test('should return instance of Color', () => {
        expect(Color.fromDatabase('#807149')).toBeInstanceOf(Color);
    });
    test('should return null', () => {
        expect(Color.fromDatabase('')).toBeNull();
    });
    test('should return object of type RGB', () => {
        const color: Color = new Color('#807149');
        const rgb: RGB = Color.colorToRgb(color);
        expect(typeof rgb.red).toEqual('number');
        expect(typeof rgb.green).toEqual('number');
        expect(typeof rgb.blue).toEqual('number');
    });
    test('should return correct RGB values ', () => {
        const color: Color = new Color('#807149');
        const rgb: RGB = Color.colorToRgb(color);
        expect(rgb.red).toEqual(128);
        expect(rgb.green).toEqual(113);
        expect(rgb.blue).toEqual(73);
    });
    test('should throw exception', () => {
        const color: Color = new Color('-1');
        expect(() => {
            Color.colorToRgb(color);
        }).toThrow(BadDataException);
    });
    test('should return instance of Color', () => {
        const color: Color = new Color('#807149');
        const rgb: RGB = Color.colorToRgb(color);
        expect(Color.rgbToColor(rgb)).toBeInstanceOf(Color);
    });
});
