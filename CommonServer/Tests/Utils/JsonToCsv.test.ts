import csvConverter from '../../Utils/JsonToCsv';
import { JSONArray } from 'Common/Types/JSON';

describe('CSV Converter', () => {
    it('throws an error when the input JSON array is empty', () => {
        const emptyJson: JSONArray = [];
        expect(() => {
            return csvConverter.ToCsv(emptyJson);
        }).toThrowError('Cannot convert to CSV when the object length is 0');
    });

    it('converts a JSON array to CSV', () => {
        const json: JSONArray = [
            {
                id: '1',
                name: 'test1',
            },
            {
                id: '2',
                name: 'test2',
            },
        ];

        const csv: string = csvConverter.ToCsv(json);

        const headerRow: string = csv.split('\n')[0]!;
        expect(headerRow).toBe(`"id","name"`);

        const dataRows: string[] = csv.split('\n').slice(1);
        expect(dataRows.length).toBe(2);

        expect(dataRows[0]).toBe(`"1","test1"`);
        expect(dataRows[1]).toBe(`"2","test2"`);
    });

    it('handles an empty JSON object', () => {
        const json: JSONArray = [{}];

        const csv: string = csvConverter.ToCsv(json);

        expect(csv).toBe('');
    });

    it('handles large JSON arrays', () => {
        const json: JSONArray = [];

        for (let i: number = 0; i < 100; i++) {
            json.push({
                id: i.toString(),
                name: `test${i}`,
            });
        }

        const csv: string = csvConverter.ToCsv(json);

        const headerRow: string = csv.split('\n')[0]!;
        expect(headerRow).toBe(`"id","name"`);

        const dataRows: string[] = csv.split('\n').slice(1);
        expect(dataRows.length).toBe(100);

        for (let i: number = 0; i < 100; i++) {
            expect(dataRows[i]).toBe(`"${i}","test${i}"`);
        }
    });

    it('handles a JSON object with an array', () => {
        const json: JSONArray = [
            {
                id: '1',
                name: 'test1',
                array: [1, 2, 3],
            },
        ];

        const csv: string = csvConverter.ToCsv(json);

        const headerRow: string = csv.split('\n')[0]!;
        expect(headerRow).toBe(`"id","name","array"`);

        const dataRows: string[] = csv.split('\n').slice(1);
        expect(dataRows.length).toBe(1);

        expect(dataRows[0]).toBe(`"1","test1","[1,2,3]"`);
    });

    it('handles a JSON object with an object', () => {
        const json: JSONArray = [
            {
                id: '1',
                name: 'test1',
                object: { test: 'test' },
            },
        ];

        const csv: string = csvConverter.ToCsv(json);

        const headerRow: string = csv.split('\n')[0]!;
        expect(headerRow).toBe(`"id","name","object"`);

        const dataRows: string[] = csv.split('\n').slice(1);
        expect(dataRows.length).toBe(1);

        expect(dataRows[0]).toBe(`"1","test1","{""test"":""test""}"`);
    });

    it('handles a JSON object with an empty array', () => {
        const json: JSONArray = [
            {
                id: '1',
                name: 'test1',
                array: [],
            },
        ];

        const csv: string = csvConverter.ToCsv(json);

        const headerRow: string = csv.split('\n')[0]!;
        expect(headerRow).toBe(`"id","name","array"`);

        const dataRows: string[] = csv.split('\n').slice(1);
        expect(dataRows.length).toBe(1);

        expect(dataRows[0]).toBe(`"1","test1","[]"`);
    });

    it('handles a JSON object with an empty object', () => {
        const json: JSONArray = [
            {
                id: '1',
                name: 'test1',
                object: {},
            },
        ];

        const csv: string = csvConverter.ToCsv(json);

        const headerRow: string = csv.split('\n')[0]!;
        expect(headerRow).toBe(`"id","name","object"`);

        const dataRows: string[] = csv.split('\n').slice(1);
        expect(dataRows.length).toBe(1);

        expect(dataRows[0]).toBe(`"1","test1","{}"`);
    });
});
