import type Char from '../../Types/Char';
import type Dictionary from '../../Types/Dictionary';

describe('type Char', () => {
    test('Char can used be type', () => {
        let char: Char;
        expect((char = 'a')).toBe('a');
        expect((char = 'b')).toBe('b');
        expect((char = 'c')).toBe('c');
        expect((char = 'd')).toEqual('d');
        expect((char = 'e')).toEqual('e');
        expect((char = 'f')).toEqual('f');
        expect((char = 'g')).toEqual('g');
        expect((char = 'h')).toEqual('h');
        expect((char = 'i')).toEqual('i');
        expect((char = 'j')).toEqual('j');
        expect((char = 'k')).toEqual('k');
        expect((char = 'l')).toEqual('l');
        expect((char = 'm')).toEqual('m');
        expect((char = 'n')).toEqual('n');
        expect((char = 'o')).toEqual('o');
        expect((char = 'p')).toEqual('p');
        expect((char = 'q')).toEqual('q');
        expect((char = 'r')).toEqual('r');
        expect((char = 's')).toEqual('s');
        expect((char = 't')).toEqual('t');
        expect((char = 'u')).toEqual('u');
        expect((char = 'v')).toEqual('v');
        expect((char = 'w')).toEqual('w');
        expect((char = 'x')).toEqual('x');
        expect((char = 'y')).toEqual('y');
        expect((char = 'z')).toEqual('z');
        expect((char = 'A')).toEqual('A');
        expect((char = 'B')).toEqual('B');
        expect((char = 'C')).toEqual('C');
        expect((char = 'D')).toEqual('D');
        expect((char = 'E')).toEqual('E');
        expect((char = 'F')).toEqual('F');
        expect((char = 'G')).toEqual('G');
        expect((char = 'H')).toEqual('H');
        expect((char = 'I')).toEqual('I');
        expect((char = 'J')).toEqual('J');
        expect((char = 'K')).toEqual('K');
        expect((char = 'L')).toEqual('L');
        expect((char = 'M')).toEqual('M');
        expect((char = 'N')).toEqual('N');
        expect((char = 'O')).toEqual('O');
        expect((char = 'P')).toEqual('P');
        expect((char = 'Q')).toEqual('Q');
        expect((char = 'R')).toEqual('R');
        expect((char = 'S')).toEqual('S');
        expect((char = 'T')).toEqual('T');
        expect((char = 'U')).toEqual('U');
        expect((char = 'V')).toEqual('V');
        expect((char = 'W')).toEqual('W');
        expect((char = 'X')).toEqual('X');
        expect((char = 'Y')).toEqual('Y');
        expect((char = 'Z')).toEqual('Z');
        expect((char = '0')).toEqual('0');
        expect((char = '1')).toEqual('1');
        expect((char = '2')).toEqual('2');
        expect((char = '3')).toEqual('3');
        expect((char = '4')).toEqual('4');
        expect((char = '5')).toEqual('5');
        expect((char = '6')).toEqual('6');
        expect((char = '7')).toEqual('7');
        expect((char = '8')).toEqual('8');
        expect((char = '9')).toEqual('9');
        expect(char).toEqual('9');
    });
    test('type Char can be used in array', () => {
        const characters: Array<Char> = ['a', 'A', '1'];
        expect(characters).toBeDefined();
        expect(characters).toEqual(['a', 'A', '1']);
    });
    test('type Char to be used in dictionary', () => {
        const characterDictonary: Dictionary<Char> = {
            a: 'a',
            A: 'A',
        };
        expect(characterDictonary['a']).toEqual('a');
    });
});
