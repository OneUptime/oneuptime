import ServiceLanguageUtil from "../../Utils/TechStack";
import TechStack from "../../Types/Service/TechStack";

describe("ServiceLanguageUtil.getLanguageByFileExtension", () => {
  const cases: Array<[string, TechStack]> = [
    ["js", TechStack.JavaScript],
    ["ts", TechStack.TypeScript],
    ["py", TechStack.Python],
    ["rb", TechStack.Ruby],
    ["java", TechStack.Java],
    ["php", TechStack.PHP],
    ["cs", TechStack.CSharp],
    ["cpp", TechStack.CPlusPlus],
    ["rs", TechStack.Rust],
    ["swift", TechStack.Swift],
    ["kt", TechStack.Kotlin],
    ["go", TechStack.Go],
    ["sh", TechStack.Shell],
  ];

  test.each(cases)(
    "should map .%s to %s",
    (fileExtension: string, expected: TechStack) => {
      expect(
        ServiceLanguageUtil.getLanguageByFileExtension({ fileExtension }),
      ).toEqual(expected);
    },
  );

  test("should return Other for unknown extensions", () => {
    expect(
      ServiceLanguageUtil.getLanguageByFileExtension({ fileExtension: "md" }),
    ).toEqual(TechStack.Other);
    expect(
      ServiceLanguageUtil.getLanguageByFileExtension({ fileExtension: "" }),
    ).toEqual(TechStack.Other);
  });

  test("should be case sensitive and return Other for upper case extensions", () => {
    expect(
      ServiceLanguageUtil.getLanguageByFileExtension({ fileExtension: "TS" }),
    ).toEqual(TechStack.Other);
  });

  test("should return Other when the extension includes the leading dot", () => {
    expect(
      ServiceLanguageUtil.getLanguageByFileExtension({ fileExtension: ".ts" }),
    ).toEqual(TechStack.Other);
  });
});
