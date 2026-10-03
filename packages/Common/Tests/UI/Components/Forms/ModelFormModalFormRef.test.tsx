import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { MutableRefObject, ReactElement } from "react";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { FormProps } from "../../../../UI/Components/Forms/BasicForm";
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import ModelFormModal from "../../../../UI/Components/ModelFormModal/ModelFormModal";
import IncidentNoteTemplate from "../../../../Models/DatabaseModels/IncidentNoteTemplate";
import getJestMockFunction from "../../../MockType";

/*
 * ModelFormModal hands its form a ref: the caller's, when it passes one
 * (ModelTable's createEditFromRef, the Billing page's), or one of its own.
 * Its own was made with `props.formRef || useRef(...)`, a hook called only
 * when the prop was missing, so the number of hooks the dialog called
 * depended on a prop. A dialog whose caller's ref came or went between two
 * renders made React throw "Rendered fewer hooks than expected" (or "more
 * hooks") and lost the dialog. The dialog now makes its own ref on every
 * render and uses it only when the caller passes none.
 */

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

type TemplateFormRef = MutableRefObject<
  FormProps<FormValues<IncidentNoteTemplate>>
>;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: { de: { translation: {} } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

function dialog(formRef: TemplateFormRef | undefined): ReactElement {
  return (
    <ModelFormModal<IncidentNoteTemplate>
      title="Create New Incident Note Template"
      modelType={IncidentNoteTemplate}
      onClose={getJestMockFunction()}
      onSuccess={getJestMockFunction()}
      submitButtonText="Create Incident Note Template"
      formRef={formRef}
      formProps={{
        id: "create-IncidentNoteTemplate-from",
        name: "create-IncidentNoteTemplate-from",
        modelType: IncidentNoteTemplate,
        formType: FormType.Create,
        fields: [
          {
            field: { templateName: true },
            title: "Template Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
        ],
      }}
    />
  );
}

function newFormRef(): TemplateFormRef {
  return { current: null } as unknown as TemplateFormRef;
}

describe("ModelFormModal", () => {
  test("a caller's form ref that arrives after the first render is used, and the dialog keeps drawing", async () => {
    const { rerender } = render(dialog(undefined));
    expect(await screen.findByText("Template Name")).toBeInTheDocument();

    const callerRef: TemplateFormRef = newFormRef();
    rerender(dialog(callerRef));

    expect(screen.getByText("Template Name")).toBeInTheDocument();
    await waitFor(() => {
      expect(typeof callerRef.current?.submitForm).toBe("function");
    });
  });

  test("a caller's form ref that goes away leaves the dialog on its own ref", async () => {
    const callerRef: TemplateFormRef = newFormRef();
    const { rerender } = render(dialog(callerRef));
    expect(await screen.findByText("Template Name")).toBeInTheDocument();
    await waitFor(() => {
      expect(typeof callerRef.current?.submitForm).toBe("function");
    });

    rerender(dialog(undefined));

    expect(screen.getByText("Template Name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Incident Note Template" }),
    ).toBeInTheDocument();
  });
});
