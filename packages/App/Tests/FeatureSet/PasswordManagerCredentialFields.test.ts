import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Which password fields across the frontends password managers may fill.
 *
 * A Password or EncryptedText form field is a stored secret by default -
 * autocomplete "new-password" and the attributes that send password managers
 * away (Common/UI/Components/Input) - because nearly all of them hold a
 * secret the product keeps for something else, and treating them as sign-in
 * fields is what put 1Password's "Sign in" prompt over Dashboard pages. The
 * pages where a person really signs in, signs up or sets their own password
 * mark those fields isOwnCredential, with the matching autocomplete, so their
 * autofill keeps working. This pins that list, and that nothing else claims to
 * be a sign-in password. The App suite runs in plain Node, so the pages are
 * read through the TypeScript AST rather than rendered; the rendered
 * behaviour is covered by Common/Tests/UI/Components/Forms/
 * FormFieldPasswordManagers.test.tsx.
 */

const PACKAGES_DIR: string = path.join(__dirname, "..", "..", "..");
const FEATURE_SET_DIR: string = path.join(PACKAGES_DIR, "App", "FeatureSet");

const FRONTENDS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "PublicDashboard",
  "Accounts",
];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "dist",
  "build",
]);

const PASSWORD_FIELD_TYPES: ReadonlySet<string> = new Set<string>([
  "Password",
  "EncryptedText",
]);

interface PasswordFieldDefinition {
  file: string;
  line: number;
  fieldType: string;
  // The literal autoComplete, "<none>" when absent, "<dynamic>" otherwise.
  autoComplete: string;
  // true, false, or null when the property is absent.
  isOwnCredential: boolean | null;
}

interface RawPasswordInput {
  file: string;
  line: number;
  setsIsOwnCredential: boolean;
}

function toRelative(file: string): string {
  return path.relative(PACKAGES_DIR, file).split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listSourceFiles(fullPath));
      }
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(fullPath);
    }
  }

  return found;
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return literal.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === name
      );
    },
  ) as ts.PropertyAssignment | undefined;
}

function passwordFieldTypeOf(
  literal: ts.ObjectLiteralExpression,
): string | null {
  const fieldType: ts.PropertyAssignment | undefined = propertyNamed(
    literal,
    "fieldType",
  );

  if (
    fieldType &&
    ts.isPropertyAccessExpression(fieldType.initializer) &&
    ts.isIdentifier(fieldType.initializer.expression) &&
    fieldType.initializer.expression.text === "FormFieldSchemaType" &&
    PASSWORD_FIELD_TYPES.has(fieldType.initializer.name.text)
  ) {
    return fieldType.initializer.name.text;
  }

  return null;
}

interface FileScan {
  fields: Array<PasswordFieldDefinition>;
  rawInputs: Array<RawPasswordInput>;
}

function scanSource(file: string, source: string): FileScan {
  const scan: FileScan = { fields: [], rawInputs: [] };

  if (
    !source.includes("FormFieldSchemaType") &&
    !source.includes("InputType.PASSWORD")
  ) {
    return scan;
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const fieldType: string | null = passwordFieldTypeOf(node);

      if (fieldType) {
        const autoComplete: ts.PropertyAssignment | undefined = propertyNamed(
          node,
          "autoComplete",
        );
        const isOwnCredential: ts.PropertyAssignment | undefined =
          propertyNamed(node, "isOwnCredential");

        scan.fields.push({
          file: file,
          line: lineOf(node),
          fieldType: fieldType,
          autoComplete: !autoComplete
            ? "<none>"
            : ts.isStringLiteral(autoComplete.initializer)
              ? autoComplete.initializer.text
              : "<dynamic>",
          isOwnCredential: !isOwnCredential
            ? null
            : isOwnCredential.initializer.kind === ts.SyntaxKind.TrueKeyword,
        });
      }
    }

    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const attributes: ts.NodeArray<ts.JsxAttributeLike> =
        node.attributes.properties;

      const typeAttribute: ts.JsxAttributeLike | undefined = attributes.find(
        (attribute: ts.JsxAttributeLike): boolean => {
          return (
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(sourceFile) === "type"
          );
        },
      );

      if (
        typeAttribute &&
        typeAttribute.getText(sourceFile).includes("InputType.PASSWORD")
      ) {
        scan.rawInputs.push({
          file: file,
          line: lineOf(node),
          setsIsOwnCredential: attributes.some(
            (attribute: ts.JsxAttributeLike): boolean => {
              return (
                ts.isJsxAttribute(attribute) &&
                attribute.name.getText(sourceFile) === "isOwnCredential"
              );
            },
          ),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return scan;
}

function scanFrontends(): FileScan {
  const scan: FileScan = { fields: [], rawInputs: [] };

  for (const frontend of FRONTENDS) {
    for (const file of listSourceFiles(
      path.join(FEATURE_SET_DIR, frontend, "src"),
    )) {
      const fileScan: FileScan = scanSource(
        toRelative(file),
        fs.readFileSync(file, "utf8"),
      );

      scan.fields.push(...fileScan.fields);
      scan.rawInputs.push(...fileScan.rawInputs);
    }
  }

  return scan;
}

const SCAN: FileScan = scanFrontends();

function ownCredentialAutoCompletesByFile(
  fields: Array<PasswordFieldDefinition>,
): Record<string, Array<string>> {
  const byFile: Record<string, Array<string>> = {};

  for (const field of fields) {
    if (field.isOwnCredential !== true) {
      continue;
    }

    (byFile[field.file] = byFile[field.file] || []).push(field.autoComplete);
  }

  return byFile;
}

describe("password fields across the frontends", () => {
  test("the scan read the frontends' forms", () => {
    // Guards the guard: a broken walk must not pass over nothing.
    expect(SCAN.fields.length).toBeGreaterThan(20);
    expect(
      SCAN.fields.some((field: PasswordFieldDefinition): boolean => {
        return field.file.startsWith("App/FeatureSet/Dashboard/");
      }),
    ).toBe(true);
    expect(SCAN.rawInputs.length).toBeGreaterThan(0);
  });

  test("exactly the sign-in, sign-up and own-password fields are left to password managers, each with the right autocomplete", () => {
    expect(ownCredentialAutoCompletesByFile(SCAN.fields)).toEqual({
      "App/FeatureSet/Accounts/src/Pages/Login.tsx": ["current-password"],
      "App/FeatureSet/Accounts/src/Pages/Register.tsx": [
        "new-password",
        "new-password",
      ],
      "App/FeatureSet/Accounts/src/Pages/ResetPassword.tsx": [
        "new-password",
        "new-password",
      ],
      "App/FeatureSet/StatusPage/src/Pages/Accounts/Login.tsx": [
        "current-password",
      ],
      "App/FeatureSet/StatusPage/src/Pages/Accounts/MasterPassword.tsx": [
        "current-password",
      ],
      "App/FeatureSet/StatusPage/src/Pages/Accounts/ResetPassword.tsx": [
        "new-password",
        "new-password",
      ],
      "App/FeatureSet/PublicDashboard/src/Pages/MasterPassword/MasterPassword.tsx":
        ["current-password"],
      "App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Password.tsx": [
        "new-password",
        "new-password",
      ],
    });
  });

  test("no field claims to be the password someone signs in with unless it is their own", () => {
    const impostors: Array<string> = SCAN.fields
      .filter((field: PasswordFieldDefinition): boolean => {
        return (
          field.autoComplete === "current-password" &&
          field.isOwnCredential !== true
        );
      })
      .map((field: PasswordFieldDefinition): string => {
        return `${field.file}:${field.line}`;
      });

    expect(impostors).toEqual([]);
  });

  test("the Dashboard and the Admin Dashboard sign nobody in: no field there is a current-password", () => {
    const signInFields: Array<string> = SCAN.fields
      .filter((field: PasswordFieldDefinition): boolean => {
        return (
          (field.file.startsWith("App/FeatureSet/Dashboard/") ||
            field.file.startsWith("App/FeatureSet/AdminDashboard/")) &&
          field.autoComplete === "current-password"
        );
      })
      .map((field: PasswordFieldDefinition): string => {
        return `${field.file}:${field.line}`;
      });

    expect(signInFields).toEqual([]);
  });

  test("the secrets the Dashboard stores stay hidden from password managers", () => {
    const dashboardSecrets: Array<PasswordFieldDefinition> = SCAN.fields.filter(
      (field: PasswordFieldDefinition): boolean => {
        return (
          field.file.startsWith("App/FeatureSet/Dashboard/") &&
          !field.file.endsWith("Pages/Global/UserProfile/Password.tsx")
        );
      },
    );

    expect(dashboardSecrets.length).toBeGreaterThan(10);
    expect(
      dashboardSecrets
        .filter((field: PasswordFieldDefinition): boolean => {
          return field.isOwnCredential === true;
        })
        .map((field: PasswordFieldDefinition): string => {
          return `${field.file}:${field.line}`;
        }),
    ).toEqual([]);
  });

  test("no hand-built password Input (workflow secrets, SNMP credentials) claims to be someone's own", () => {
    expect(
      SCAN.rawInputs
        .filter((input: RawPasswordInput): boolean => {
          return input.setsIsOwnCredential;
        })
        .map((input: RawPasswordInput): string => {
          return `${input.file}:${input.line}`;
        }),
    ).toEqual([]);
  });
});

describe("the field reader itself", () => {
  test("reads a field's fieldType, autoComplete and isOwnCredential", () => {
    const scan: FileScan = scanSource(
      "Page.tsx",
      `
        const fields = [
          { field: { a: true }, fieldType: FormFieldSchemaType.Password },
          {
            field: { b: true },
            fieldType: FormFieldSchemaType.Password,
            autoComplete: "current-password",
            isOwnCredential: true,
          },
          {
            field: { c: true },
            fieldType: FormFieldSchemaType.EncryptedText,
            autoComplete: kind,
            isOwnCredential: false,
          },
          { field: { d: true }, fieldType: FormFieldSchemaType.Email },
        ];
      `,
    );

    expect(
      scan.fields.map(
        (
          field: PasswordFieldDefinition,
        ): Omit<PasswordFieldDefinition, "file" | "line"> => {
          return {
            fieldType: field.fieldType,
            autoComplete: field.autoComplete,
            isOwnCredential: field.isOwnCredential,
          };
        },
      ),
    ).toEqual([
      { fieldType: "Password", autoComplete: "<none>", isOwnCredential: null },
      {
        fieldType: "Password",
        autoComplete: "current-password",
        isOwnCredential: true,
      },
      {
        fieldType: "EncryptedText",
        autoComplete: "<dynamic>",
        isOwnCredential: false,
      },
    ]);
  });

  test("finds hand-built password Inputs and whether they claim to be someone's own", () => {
    const scan: FileScan = scanSource(
      "Editor.tsx",
      `
        const a = <Input type={InputType.PASSWORD} />;
        const b = <Input type={secret ? InputType.PASSWORD : InputType.TEXT} isOwnCredential={true} />;
        const c = <Input type={InputType.TEXT} />;
      `,
    );

    expect(
      scan.rawInputs.map((input: RawPasswordInput): boolean => {
        return input.setsIsOwnCredential;
      }),
    ).toEqual([false, true]);
  });

  test("a sign-in field that loses isOwnCredential is reported as an impostor by the check above", () => {
    const login: string = fs.readFileSync(
      path.join(FEATURE_SET_DIR, "Accounts", "src", "Pages", "Login.tsx"),
      "utf8",
    );
    const reverted: FileScan = scanSource(
      "Login.tsx",
      login.replace("isOwnCredential: true,", ""),
    );

    expect(
      reverted.fields.filter((field: PasswordFieldDefinition): boolean => {
        return (
          field.autoComplete === "current-password" &&
          field.isOwnCredential !== true
        );
      }),
    ).toHaveLength(1);
  });
});
