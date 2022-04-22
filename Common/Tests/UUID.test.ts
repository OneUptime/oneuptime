import UUID from '../Utils/UUID';

describe('UUID', () => {
    test('UUID.generate() should generate a valid UUID', () => {
        const uuid: string = UUID.generate();
        expect(uuid).toBeDefined();
        expect(uuid).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
        expect(uuid.length).toBe(36);
    });
});
