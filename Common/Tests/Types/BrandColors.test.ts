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
            expect(Black.color).toBe('#000000');
        });
    });
    describe('White', () => {
        it('should be an instance with the hex code of White', () => {
            const color: Color = White;
            expect(White).toBe(color);
            expect(White.color).toBe('#ffffff');
        });
    });
    describe('slate', () => {
        it('should be an instance with the hex code of slate', () => {
            const color: Color = slate;
            expect(slate).toBe(color);
            expect(slate.color).toBe('#564ab1');
        });
    });
    describe('Purple', () => {
        it('should be an instance with the hex code of Purple', () => {
            const color: Color = Purple;
            expect(Purple).toBe(color);
            expect(Purple.color).toBe('#6f42c1');
        });
    });
    describe('Pink', () => {
        it('should be an instance with the hex code of Pink', () => {
            const color: Color = Pink;
            expect(Pink).toBe(color);
            expect(Pink.color).toBe('#e83e8c');
        });
    });
    describe('Red', () => {
        it('should be an instance with the hex code of Red', () => {
            const color: Color = Red;
            expect(Red).toBe(color);
            expect(Red.color).toBe('#fd625e');
        });
    });
    describe('Orange', () => {
        it('should be an instance with the hex code of Orange', () => {
            const color: Color = Orange;
            expect(Orange).toBe(color);
            expect(Orange.color).toBe('#f1734f');
        });
    });
    describe('Yellow', () => {
        it('should be an instance with the hex code of Yellow', () => {
            const color: Color = Yellow;
            expect(Yellow).toBe(color);
            expect(Yellow.color).toBe('#ffbf53');
        });
    });
    describe('Green', () => {
        it('should be an instance with the hex code of Green', () => {
            const color: Color = Green;
            expect(Green).toBe(color);
            expect(Green.color).toBe('#2ab57d');
        });
    });
    describe('Teal', () => {
        it('should be an instance with the hex code of Teal', () => {
            const color: Color = Teal;
            expect(Teal).toBe(color);
            expect(Teal.color).toBe('#050505');
        });
    });
    describe('Cyan', () => {
        it('should be an instance with the hex code of Cyan', () => {
            const color: Color = Cyan;
            expect(Cyan).toBe(color);
            expect(Cyan.color).toBe('#4ba6ef');
        });
    });
    describe('VeryLightGrey', () => {
        it('should be an instance with the hex code of VeryLightGrey', () => {
            const color: Color = VeryLightGrey;
            expect(VeryLightGrey).toBe(color);
            expect(VeryLightGrey.color).toBe('#c2c2c2');
        });
    });
    describe('Grey', () => {
        it('should be an instance with the hex code of Grey', () => {
            const color: Color = Grey;
            expect(Grey).toBe(color);
            expect(Grey.color).toBe('#575757');
        });
    });
    describe('LightGrey', () => {
        it('should be an instance with the hex code of LightGrey', () => {
            const color: Color = LightGrey;
            expect(LightGrey).toBe(color);
            expect(LightGrey.color).toBe('#908B8B');
        });
    });
    describe('Moroon', () => {
        it('should be an instance with the hex code of Moroon', () => {
            const color: Color = Moroon;
            expect(Moroon).toBe(color);
            expect(Moroon.color).toBe('#b70400');
        });
    });
    describe('Blue', () => {
        it('should be an instance with the hex code of Blue', () => {
            const color: Color = Blue;
            expect(Blue).toBe(color);
            expect(Blue.color).toBe('#3686be');
        });
    });
});
