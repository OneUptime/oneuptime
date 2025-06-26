export default class Text {
  public static convertBase64ToHex(textInBase64: string): string {
    if (!textInBase64) {
      return textInBase64;
    }

    if (!this.isBase64(textInBase64)) {
      return textInBase64;
    }

    const hex: string = Buffer.from(textInBase64, "base64").toString("hex");
    return hex;
  }

  public static getLetterFromAByNumber(number: number): string {
    return String.fromCharCode("a".charCodeAt(0) + number);
  }

  public static getNextLowercaseLetter(letter: string): string {
    const charCode: number = letter.charCodeAt(0);
    const nextLetter: string = String.fromCharCode(charCode + 1).toString();
    return nextLetter;
  }

  public static fromPascalCaseToDashes(text: string): string {
    let result: string = text.replace(/([A-Z])/g, " $1");
    result = result.trim();
    result = result.replace(/\s+/g, "-");
    return result.toLowerCase();
  }

  public static getFirstWord(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const textArr: Array<string> = text.split(" ");

    let firstIndex: number = 0;

    while (firstIndex < textArr.length && !textArr[firstIndex]) {
      firstIndex++;
    }

    return textArr[firstIndex] || text;
  }

  public static getLastWord(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const textArr: Array<string> = text.split(" ");

    let lastIndex: number = textArr.length - 1;

    while (lastIndex >= 0 && !textArr[lastIndex]) {
      lastIndex--;
    }

    return textArr[lastIndex] || text;
  }

  public static trimStartUntilThisWord(text: string, word: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const index: number = text.indexOf(word);
    if (index === -1) {
      return text;
    }

    return text.substring(index);
  }

  public static trimUpQuotesFromStartAndEnd(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    if (text.startsWith('"') && !text.endsWith('"')) {
      text = text.substring(1);
    }

    if (text.endsWith('"') && !text.startsWith('"')) {
      text = text.substring(0, text.length - 1);
    }

    // check for single quotes

    if (text.startsWith("'") && !text.endsWith("'")) {
      text = text.substring(1);
    }

    if (text.endsWith("'") && !text.startsWith("'")) {
      text = text.substring(0, text.length - 1);
    }

    return text;
  }

  public static trimEndUntilThisWord(text: string, word: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const index: number = text.lastIndexOf(word);
    if (index === -1) {
      return text;
    }

    return text.substring(0, index + word.length);
  }

  public static isBase64(text: string): boolean {
    if (!text || typeof text !== "string") {
      return false;
    }

    // Remove data URI prefix if present (e.g., data:image/jpeg;base64,)
    const base64String: string = text.replace(/^data:[^;]+;base64,/, "");

    // Check if string is empty after removing prefix
    if (!base64String) {
      return false;
    }

    // Base64 string length should be a multiple of 4
    if (base64String.length % 4 !== 0) {
      return false;
    }

    // Improved regex for Base64 validation
    const regex: RegExp = /^[A-Za-z0-9+/]*={0,2}$/;
    return regex.test(base64String);
  }

  public static extractBase64FromDataUri(text: string): string {
    if (!text || typeof text !== "string") {
      return text;
    }

    // Check if it's a data URI
    if (text.startsWith("data:")) {
      const base64Index: number = text.indexOf(";base64,");
      if (base64Index !== -1) {
        return text.substring(base64Index + 8); // 8 is length of ';base64,'
      }
    }

    // Return original string if not a data URI
    return text;
  }

  public static extractMimeTypeFromDataUri(text: string): string | null {
    if (!text || typeof text !== "string") {
      return null;
    }

    // Check if it's a data URI
    if (text.startsWith("data:")) {
      const mimeTypeEnd: number = text.indexOf(";");
      if (mimeTypeEnd !== -1) {
        return text.substring(5, mimeTypeEnd); // 5 is length of 'data:'
      }
    }

    return null;
  }

  public static generateRandomText(length?: number): string {
    if (!length) {
      length = 10;
    }

    let result: string = "";
    const characters: string =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const charactersLength: number = characters.length;
    for (let i: number = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  public static trimLines(text: string): string {
    return text
      .split("\n")
      .map((line: string) => {
        return line.trim();
      })
      .join("\n");
  }

  public static generateRandomNumber(length?: number): string {
    if (!length) {
      length = 10;
    }

    let result: string = "";
    const characters: string = "12134567890";
    const charactersLength: number = characters.length;
    for (let i: number = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  public static convertNumberToWords(num: number): string {
    const words: Array<string> = [
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth",
      "tenth",
      "eleventh",
      "twelfth",
      "thirteenth",
      "fourteenth",
      "fifteenth",
      "sixteenth",
      "seventeenth",
      "eighteenth",
      "nineteenth",
      "twentieth",
    ];

    if (num <= 20) {
      return words[num - 1]!;
    }

    if (num % 10 === 0) {
      return `${words[19]} ${words[num / 10 - 2]}`;
    }

    return `${words[19]} ${words[Math.floor(num / 10) - 2]}-${
      words[(num % 10) - 1]
    }`;
  }

  public static uppercaseFirstLetter(word: string): string {
    if (word.length > 0) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }

  public static fromDashesToPascalCase(word: string): string {
    let tempWord: string = word.replace(/-/g, " ");
    tempWord = tempWord.replace(/\b\w/g, (m: string): string => {
      return m.toUpperCase();
    });
    return tempWord;
  }

  public static pascalCaseToDashes(word: string): string {
    let tempWord: string = word.replace(/[A-Z]/g, (m: string): string => {
      return "-" + m.toLowerCase();
    });
    while (tempWord.includes(" ")) {
      tempWord = tempWord.replace(" ", "-");
    }

    if (tempWord.startsWith("-")) {
      tempWord = this.replaceAt(0, tempWord, " ");
    }

    if (tempWord.endsWith("-")) {
      tempWord = this.replaceAt(tempWord.length - 1, tempWord, " ");
    }

    return tempWord.toLowerCase().trim();
  }

  public static replaceAt(
    index: number,
    word: string,
    replacement: string,
  ): string {
    return (
      word.substring(0, index) +
      replacement +
      word.substring(index + replacement.length)
    );
  }

  public static replaceAll(
    sentence: string,
    search: string,
    replaceBy: string,
  ): string {
    return sentence.split(search).join(replaceBy);
  }
}
