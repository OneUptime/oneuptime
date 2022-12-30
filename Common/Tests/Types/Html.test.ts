import HTML from '../../Types/Html';

describe('class HTML', () => {
    test('new HTML should return a valid html object a valid html is given', () => {
        const html: HTML = new HTML('<!DOCTYPE><head><title></head>');
        expect(html.html).toBe('<!DOCTYPE><head><title></head>');
    });
});
