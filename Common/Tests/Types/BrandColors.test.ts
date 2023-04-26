import Color from '../../Types/Color';
import {
    Black,
    White,
    slate,
    Purple,
    Pink,
    Red,
    Orange,
    Yellow,
    Green,
    Teal,
    Cyan,
    VeryLightGrey,
    Grey,
    LightGrey,
    Moroon,
    Blue,
} from '../../Types/BrandColors';

describe('Color', () => {
    describe('Verify color hex', () => {
        it('should create a new instance with the given hex code', () => {
            const color: Color = new Color('#123456');
            expect(color).toBe(color);
        });
    });
    describe('Black', () => {
        it('should be an instance with the hex code of Black', () => {
            const color: Color = Black;
            expect(Black).toBe(color);
        });
    });
    describe('White', () => {
        it('should be an instance with the hex code of White', () => {
            const color: Color = White;
            expect(White).toBe(color);
        });
    });
    describe('slate', () => {
        it('should be an instance with the hex code of slate', () => {
            const color: Color = slate;
            expect(slate).toBe(color);
        });
    });
    describe('Purple', () => {
        it('should be an instance with the hex code of Purple', () => {
            const color: Color = Purple;
            expect(Purple).toBe(color);
        });
    });
    describe('Pink', () => {
        it('should be an instance with the hex code of Pink', () => {
            const color: Color = Pink;
            expect(Pink).toBe(color);
        });
    });
    describe('Red', () => {
        it('should be an instance with the hex code of Red', () => {
            const color: Color = Red;
            expect(Red).toBe(color);
        });
    });
    describe('Orange', () => {
        it('should be an instance with the hex code of Orange', () => {
            const color: Color = Orange;
            expect(Orange).toBe(color);
        });
    });
    describe('Yellow', () => {
        it('should be an instance with the hex code of Yellow', () => {
            const color: Color = Yellow;
            expect(Yellow).toBe(color);
        });
    });
    describe('Green', () => {
        it('should be an instance with the hex code of Green', () => {
            const color: Color = Green;
            expect(Green).toBe(color);
        });
    });
    describe('Teal', () => {
        it('should be an instance with the hex code of Teal', () => {
            const color: Color = Teal;
            expect(Teal).toBe(color);
        });
    });
    describe('Cyan', () => {
        it('should be an instance with the hex code of Cyan', () => {
            const color: Color = Cyan;
            expect(Cyan).toBe(color);
        });
    });
    describe('VeryLightGrey', () => {
        it('should be an instance with the hex code of VeryLightGrey', () => {
            const color: Color = VeryLightGrey;
            expect(VeryLightGrey).toBe(color);
        });
    });
    describe('Grey', () => {
        it('should be an instance with the hex code of Grey', () => {
            const color: Color = Grey;
            expect(Grey).toBe(color);
        });
    });
    describe('LightGrey', () => {
        it('should be an instance with the hex code of LightGrey', () => {
            const color: Color = LightGrey;
            expect(LightGrey).toBe(color);
        });
    });
    describe('Moroon', () => {
        it('should be an instance with the hex code of Moroon', () => {
            const color: Color = Moroon;
            expect(Moroon).toBe(color);
        });
    });
    describe('Blue', () => {
        it('should be an instance with the hex code of Blue', () => {
            const color: Color = Blue;
            expect(Blue).toBe(color);
        });
    });
});
