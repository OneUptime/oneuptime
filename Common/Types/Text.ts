export default class Text {
    uppercaseFirstLetter(word: string): string {
        if (word.length > 0) {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
    }
}
