import BadDataException from '../../Types/Exception/BadDataException';
import XML from '../../Types/XML';

describe('class XML', () => {
    test('new XML should return valid object if it is valid', () => {
        const xmlString = '<test> <info>Test</info></test>';
        const xml: XML = new XML(xmlString);
        expect(xml.toString()).toEqual(xmlString);
        expect(xml.xml).toEqual(xmlString);
    });
    test('XML.xml should be mutable', () => {
        const xmlNewString = '<new> <info>Test</info></new>';
        const xml: XML = new XML('<test> <info>Test</info></test>');
        xml.xml = xmlNewString;
        expect(xml.toString()).toEqual(xmlNewString);
        expect(xml.xml).toEqual(xmlNewString);
    });
    test('mutating XML.xml with empty string should throw BadDataException', () => {
        const xml: XML = new XML('<test> <info>Test</info></test>');
        expect(() => {
            xml.xml = '';
        }).toThrowError(BadDataException);
        expect(() => {
            xml.xml = '';
        }).toThrow('XML is not in valid format.');
    });

    test('new should throw BadDataException if empty string is given', () => {
        expect(() => {
            new XML('');
        }).toThrowError(BadDataException);
        expect(() => {
            new XML('');
        }).toThrow('XML is not in valid format.');
    });
});
