import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Nobody could invite a user.
 *
 * Type a valid email into the invite form, press Tab, and the email vanished -
 * placeholder and all. Type again and characters disappeared as they were
 * entered; the reporter's recording ends with a lone "@" in an otherwise empty
 * box.
 *
 * The form was not losing the value. It was being destroyed and rebuilt:
 *
 *   1. The Email field calls back into the page on every keystroke so the page
 *      can check whether that address already has a OneUptime account.
 *   2. When the check resolves, the page sets state and re-renders - and its
 *      `fields` array is an inline literal in JSX, so ModelForm sees a brand
 *      new array identity.
 *   3. ModelForm's field-preparation effect is keyed on that identity, so it
 *      re-ran and re-fetched the Team dropdown's options.
 *   4. While that request was in flight ModelForm returned <Loader/> INSTEAD OF
 *      the form. A different element in the same position unmounts the subtree,
 *      and a form's values live in that subtree - in BasicForm's refs and in
 *      each Input's own state, because Input is DOM-uncontrolled.
 *   5. The request finished, the form remounted from empty initial values, and
 *      everything typed in the meantime was gone.
 *
 * Nothing here is specific to the invite form. Practically every ModelForm in
 * the product writes its fields as an inline literal, so any page that changes
 * state while someone types into its form had the same bug waiting.
 *
 * These tests drive the real ModelForm against the real TeamMember/Team models
 * and assert on the DOM the user is actually looking at.
 */

let permissionsForTest: Array<unknown> = [];

/*
 * ModelForm reads the merged list for its model-level gate but the global and
 * project snapshots directly for per-column checks, so all three have to agree
 * or fields get stripped for reasons unrelated to what is being tested.
 */
jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: permissionsForTest };
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

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

/*
 * Every list request the form makes, and how it is allowed to finish.
 *
 * "deferred" hands back a promise the test resolves by hand, which is the only
 * way to observe the window the bug lived in. "immediate" still crosses a
 * macrotask boundary, because React 18 batches everything inside one task -
 * resolving synchronously would hide the very loading render being tested.
 */
interface ListRequest {
  tableName: string;
  resolve: () => void;
}

let listRequests: Array<ListRequest> = [];
let listMode: "immediate" | "deferred" = "immediate";
let listRowsByTableName: Record<string, Array<unknown>> = {};

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (data: {
        modelType: { new (): { tableName: string | null } };
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        const tableName: string = new data.modelType().tableName || "";

        let releaseRequest: () => void = (): void => {};

        const requestFinished: Promise<void> = new Promise<void>(
          (innerResolve: () => void) => {
            releaseRequest = innerResolve;
          },
        );

        listRequests.push({ tableName: tableName, resolve: releaseRequest });

        if (listMode === "immediate") {
          setTimeout(releaseRequest, 0);
        }

        await requestFinished;

        const rows: Array<unknown> = listRowsByTableName[tableName] || [];

        return { data: rows, count: rows.length, skip: 0, limit: 50 };
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import Team from "../../../../Models/DatabaseModels/Team";
import Label from "../../../../Models/DatabaseModels/Label";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../../MockType";

const EMAIL_PLACEHOLDER: string = "member@company.com";
const TEAM_PLACEHOLDER: string = "Select a team";
const VALID_EMAIL: string = "member@company.com";

type SetRegisteredStatusFunction = (value: boolean | null) => void;

interface InviteFormHarnessProps {
  onReady: (setRegisteredStatus: SetRegisteredStatusFunction) => void;
  // Mirrors the real page adding a second entity dropdown to the same form.
  showLabelField?: boolean | undefined;
}

/*
 * As close to App/FeatureSet/Dashboard/src/Pages/Users/Index.tsx as a test can
 * get: page-level state, a `fields` array written inline in JSX so it is a new
 * identity on every render, an Email field that reports every keystroke back to
 * the page, and a required Team dropdown whose options come from the API.
 *
 * The real page debounces the account check by 400ms; here it resolves
 * synchronously so the test pins the behaviour rather than the timing.
 */
const InviteFormHarness: React.FunctionComponent<InviteFormHarnessProps> = (
  props: InviteFormHarnessProps,
): React.ReactElement => {
  const [isEmailRegistered, setIsEmailRegistered] = React.useState<
    boolean | null
  >(null);

  const { onReady } = props;

  React.useEffect(() => {
    onReady(setIsEmailRegistered);
  }, [onReady]);

  return (
    <ModelForm<TeamMember>
      modelType={TeamMember}
      name="Invite New User"
      id="invite-user-form"
      formType={FormType.Create}
      submitButtonText="Invite"
      onSuccess={() => {}}
      fields={[
        {
          field: { user: true },
          title: "Email",
          fieldType: FormFieldSchemaType.Email,
          required: true,
          placeholder: EMAIL_PLACEHOLDER,
          overrideFieldKey: "email",
          onChange: (value: string) => {
            setIsEmailRegistered(Email.isValid(value) ? true : null);
          },
        },
        {
          field: { user: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "John Smith",
          overrideFieldKey: "name",
          showIf: (): boolean => {
            return isEmailRegistered === false;
          },
        },
        ...(props.showLabelField
          ? [
              {
                field: { team: true },
                title: "Label",
                fieldType: FormFieldSchemaType.Dropdown,
                required: false,
                overrideFieldKey: "labelPicker",
                dropdownModal: {
                  type: Label,
                  labelField: "name",
                  valueField: "_id",
                },
                placeholder: "Select a label",
              },
            ]
          : []),
        {
          field: { team: true },
          title: "Team",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownModal: {
            type: Team,
            labelField: "name",
            valueField: "_id",
          },
          placeholder: TEAM_PLACEHOLDER,
        },
      ]}
    />
  );
};

/*
 * Page state changes are driven through waitFor rather than act on purpose.
 * act() flushes the whole cascade in one go, which batches the unmount and the
 * remount into a single commit - the form never actually leaves the DOM, and
 * the bug these tests exist for becomes invisible. waitFor yields between
 * attempts, so the intermediate commits (and the timers the option fetch waits
 * on) land the way they do in a browser.
 */
type SettleFunction = (change: () => void) => Promise<void>;

const settle: SettleFunction = async (change: () => void): Promise<void> => {
  await waitFor(() => {
    change();
  });
};

type GetEmailInputFunction = () => HTMLInputElement;

const getEmailInput: GetEmailInputFunction = (): HTMLInputElement => {
  return screen.getByPlaceholderText(EMAIL_PLACEHOLDER) as HTMLInputElement;
};

type MakeTeamFunction = (name: string) => Team;

const makeTeam: MakeTeamFunction = (name: string): Team => {
  const team: Team = new Team();
  team._id = ObjectID.generate().toString();
  team.name = name;
  return team;
};

describe("ModelForm preserves what the user typed while inviting a user", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner, Permission.ProjectAdmin];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();

    listRequests = [];
    listMode = "immediate";
    listRowsByTableName = {
      Team: [makeTeam("Owners"), makeTeam("Engineering")],
      Label: [],
    };
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  /*
   * The bug exactly as reported. The email is typed, the page's own state flips
   * when the address becomes valid, and the field must still hold what was
   * typed. Before the fix the whole form was unmounted at that moment and the
   * input came back empty.
   */
  test("keeps the typed email when the page re-renders mid-typing", async () => {
    const user: UserEvent = userEvent.setup();

    render(<InviteFormHarness onReady={() => {}} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    await user.type(getEmailInput(), VALID_EMAIL);

    // Whatever the page did with that keystroke, the field still reads back.
    await waitFor(() => {
      expect(getEmailInput().value).toBe(VALID_EMAIL);
    });

    expect(getEmailInput().value).toBe(VALID_EMAIL);
  });

  /*
   * Tab is what the reporter pressed. It only marks the field touched, but it
   * is also roughly when the account check came back - so the sequence is worth
   * pinning end to end.
   */
  test("keeps the typed email across a Tab out of the field", async () => {
    const user: UserEvent = userEvent.setup();

    let setRegisteredStatus: SetRegisteredStatusFunction = () => {};

    render(
      <InviteFormHarness
        onReady={(setter: SetRegisteredStatusFunction) => {
          setRegisteredStatus = setter;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    await user.type(getEmailInput(), VALID_EMAIL);
    await user.tab();

    /*
     * The account check resolving is a page-level state change, exactly as in
     * useUserEmailRegistrationStatus once the debounce fires.
     */
    await settle(() => {
      setRegisteredStatus(true);
    });

    await waitFor(() => {
      expect(getEmailInput().value).toBe(VALID_EMAIL);
    });
  });

  /*
   * The second half of the report: after the first wipe the user retyped, and
   * the very first character flipped the page's state back (true -> null),
   * which wiped the field again. Retyping has to work.
   */
  test("keeps every character while the page state flips back and forth", async () => {
    const user: UserEvent = userEvent.setup();

    let setRegisteredStatus: SetRegisteredStatusFunction = () => {};

    render(
      <InviteFormHarness
        onReady={(setter: SetRegisteredStatusFunction) => {
          setRegisteredStatus = setter;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    await user.type(getEmailInput(), VALID_EMAIL);

    await settle(() => {
      setRegisteredStatus(true);
    });

    // Now edit the address, which makes it briefly invalid: true -> null.
    await user.type(getEmailInput(), ".uk");

    await waitFor(() => {
      expect(getEmailInput().value).toBe(`${VALID_EMAIL}.uk`);
    });

    await settle(() => {
      setRegisteredStatus(false);
    });

    /*
     * The conditional Name field appears - which changes the rendered field
     * list - and the email must still survive that.
     */
    await waitFor(() => {
      expect(screen.getByPlaceholderText("John Smith")).toBeTruthy();
    });

    expect(getEmailInput().value).toBe(`${VALID_EMAIL}.uk`);
  });

  /*
   * The field list legitimately changes when the account check resolves - the
   * Name field is only asked for when the address has no account yet. Values
   * already entered must survive that too.
   */
  test("keeps the typed email when a conditional field appears", async () => {
    const user: UserEvent = userEvent.setup();

    let setRegisteredStatus: SetRegisteredStatusFunction = () => {};

    render(
      <InviteFormHarness
        onReady={(setter: SetRegisteredStatusFunction) => {
          setRegisteredStatus = setter;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    await user.type(getEmailInput(), VALID_EMAIL);

    expect(screen.queryByPlaceholderText("John Smith")).toBeNull();

    await settle(() => {
      setRegisteredStatus(false);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("John Smith")).toBeTruthy();
    });

    expect(getEmailInput().value).toBe(VALID_EMAIL);
  });

  /*
   * The mechanism, asserted directly: once the form is on screen, nothing may
   * put a loader in its place. That swap is what threw the input away.
   */
  test("never replaces a form the user is filling in with a loader", async () => {
    const user: UserEvent = userEvent.setup();

    let setRegisteredStatus: SetRegisteredStatusFunction = () => {};

    render(
      <InviteFormHarness
        onReady={(setter: SetRegisteredStatusFunction) => {
          setRegisteredStatus = setter;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    const inputBeforeRerender: HTMLInputElement = getEmailInput();

    await user.type(getEmailInput(), VALID_EMAIL);

    await settle(() => {
      setRegisteredStatus(true);
    });

    expect(screen.queryByTestId("bar-loader")).toBeNull();

    /*
     * The strongest form of the assertion: it is the same DOM node. A remount
     * would hand back a different element even if it happened to be refilled.
     */
    expect(getEmailInput()).toBe(inputBeforeRerender);
  });

  /*
   * The loader is still right when there is genuinely nothing to show. Losing
   * it entirely would flash an empty form before the Team list arrives.
   */
  test("still shows the loader while the form is loading for the first time", async () => {
    listMode = "deferred";

    render(<InviteFormHarness onReady={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("bar-loader")).toBeTruthy();
    });

    expect(screen.queryByPlaceholderText(EMAIL_PLACEHOLDER)).toBeNull();

    await waitFor(() => {
      expect(listRequests.length).toBe(1);
    });

    await settle(() => {
      listRequests.forEach((request: ListRequest) => {
        request.resolve();
      });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });

  /*
   * The re-run was not only destructive, it was expensive: the invite form
   * issued a Team list request per keystroke. Options for a dropdown depend on
   * the model and its label/value columns and nothing else, so they are fetched
   * once.
   */
  test("does not re-request dropdown options when the page re-renders", async () => {
    const user: UserEvent = userEvent.setup();

    let setRegisteredStatus: SetRegisteredStatusFunction = () => {};

    render(
      <InviteFormHarness
        onReady={(setter: SetRegisteredStatusFunction) => {
          setRegisteredStatus = setter;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    expect(listRequests.length).toBe(1);

    await user.type(getEmailInput(), VALID_EMAIL);

    const flipStatus: SetRegisteredStatusFunction = setRegisteredStatus;

    for (const status of [true, null, false, true]) {
      await settle(() => {
        flipStatus(status);
      });
    }

    await waitFor(() => {
      expect(getEmailInput().value).toBe(VALID_EMAIL);
    });

    expect(listRequests.length).toBe(1);
  });

  /*
   * The options still have to arrive, and they still have to arrive after the
   * page has re-rendered a few times - caching that served a stale or empty
   * list would turn a data-loss bug into a cannot-pick-a-team bug.
   */
  test("still offers the teams after the page has re-rendered", async () => {
    const user: UserEvent = userEvent.setup();

    let setRegisteredStatus: SetRegisteredStatusFunction = () => {};

    render(
      <InviteFormHarness
        onReady={(setter: SetRegisteredStatusFunction) => {
          setRegisteredStatus = setter;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    await user.type(getEmailInput(), VALID_EMAIL);

    await settle(() => {
      setRegisteredStatus(true);
    });

    const teamDropdown: HTMLElement =
      screen.getByPlaceholderText(TEAM_PLACEHOLDER);

    fireEvent.focus(teamDropdown);

    expect(await screen.findByText("Engineering")).toBeTruthy();
    expect(screen.getByText("Owners")).toBeTruthy();

    // And the email the user was in the middle of typing is untouched by it.
    expect(getEmailInput().value).toBe(VALID_EMAIL);
  });

  /*
   * The cache is keyed on what the request actually depends on, so a second
   * dropdown over a DIFFERENT model must still fetch its own options rather
   * than inheriting the first one's.
   */
  test("fetches separately for each distinct dropdown model", async () => {
    render(<InviteFormHarness onReady={() => {}} showLabelField={true} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    await waitFor(() => {
      expect(listRequests.length).toBe(2);
    });

    const tableNames: Array<string> = listRequests
      .map((request: ListRequest) => {
        return request.tableName;
      })
      .sort();

    expect(tableNames).toEqual(["Label", "Team"]);
  });

  /*
   * A slow first run must not be able to come back and undo a newer one. The
   * effect is re-entrant by construction - it re-runs on every parent render -
   * so without a generation guard an older in-flight request can clear a
   * loading flag the newer run still owns and leave the form half-built.
   */
  test("ignores a stale field-preparation run that finishes late", async () => {
    listMode = "deferred";

    let setRegisteredStatus: SetRegisteredStatusFunction = () => {};

    render(
      <InviteFormHarness
        onReady={(setter: SetRegisteredStatusFunction) => {
          setRegisteredStatus = setter;
        }}
      />,
    );

    await waitFor(() => {
      expect(listRequests.length).toBe(1);
    });

    // Re-render the page while the very first options request is still open.
    await settle(() => {
      setRegisteredStatus(false);
    });

    // Let every request that was opened finish, oldest first.
    await settle(() => {
      listRequests.forEach((request: ListRequest) => {
        request.resolve();
      });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(EMAIL_PLACEHOLDER)).toBeTruthy();
    });

    // The form settles on the newest field list, not the stale one.
    await waitFor(() => {
      expect(screen.getByPlaceholderText("John Smith")).toBeTruthy();
    });

    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });
});

/*
 * BasicForm is where the values actually live, so the guarantee is asserted at
 * that level too - independently of how ModelForm happens to drive it today.
 */
describe("BasicForm never re-seeds a form the user has edited", () => {
  afterEach(() => {
    cleanup();
  });

  const NAME_PLACEHOLDER: string = "Enter a name";

  type BuildFieldsFunction = () => Fields<FormValues<any>>;

  const buildFields: BuildFieldsFunction = (): Fields<FormValues<any>> => {
    return [
      {
        field: { name: true },
        title: "Name",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        placeholder: NAME_PLACEHOLDER,
      },
    ];
  };

  /*
   * Both props change identity on every render at almost every call site - the
   * fields because they are written inline, and initialValues because
   * BasicModelForm spreads them into a fresh object each time. Neither may
   * disturb a form in progress.
   */
  test("keeps typed values when fields and initialValues change identity", async () => {
    const user: UserEvent = userEvent.setup();

    let rerender: () => void = () => {};

    const Harness: React.FunctionComponent = (): React.ReactElement => {
      const [, setTick] = React.useState<number>(0);

      rerender = () => {
        setTick((tick: number) => {
          return tick + 1;
        });
      };

      return (
        <BasicForm
          id="identity-churn-form"
          initialValues={{}}
          fields={buildFields()}
          onSubmit={() => {}}
          footer={<></>}
        />
      );
    };

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toBeTruthy();
    });

    const input: HTMLInputElement = screen.getByPlaceholderText(
      NAME_PLACEHOLDER,
    ) as HTMLInputElement;

    await user.type(input, "Engineering");

    const triggerRerender: () => void = rerender;

    for (let i: number = 0; i < 5; i++) {
      await settle(() => {
        triggerRerender();
      });
    }

    expect(
      (screen.getByPlaceholderText(NAME_PLACEHOLDER) as HTMLInputElement).value,
    ).toBe("Engineering");
  });

  /*
   * A third way keystrokes went missing, on a different path to the one above:
   * while ANY dropdown in the form was fetching its options, every field in the
   * form was disabled - and Input renders `disabled` as `readOnly`, so a text
   * box stayed focusable and simply ate what was typed into it, with nothing on
   * screen to say why. Only the dropdowns waiting on those options should wait.
   */
  test("keeps text fields usable while a dropdown re-fetches its options", async () => {
    const user: UserEvent = userEvent.setup();

    /*
     * Resolves the first time so the form gets on screen, then hangs - which is
     * the window that matters. A refetch happens on top of an already-rendered
     * form, so the fields the user can see are the ones that used to go
     * read-only.
     */
    let fetchCount: number = 0;

    const fetchDropdownOptions: () => Promise<Array<never>> = (): Promise<
      Array<never>
    > => {
      fetchCount++;

      if (fetchCount === 1) {
        return Promise.resolve([]);
      }

      return new Promise<Array<never>>(() => {});
    };

    let rerender: () => void = () => {};

    const Harness: React.FunctionComponent = (): React.ReactElement => {
      const [, setTick] = React.useState<number>(0);

      rerender = () => {
        setTick((tick: number) => {
          return tick + 1;
        });
      };

      return (
        <BasicForm
          id="options-loading-form"
          initialValues={{}}
          fields={[
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              placeholder: NAME_PLACEHOLDER,
            },
            {
              field: { team: true },
              title: "Team",
              fieldType: FormFieldSchemaType.Dropdown,
              required: false,
              placeholder: "Select a team",
              fetchDropdownOptions: fetchDropdownOptions,
            },
          ]}
          onSubmit={() => {}}
          footer={<></>}
        />
      );
    };

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toBeTruthy();
    });

    // A new inline fields array sends the dropdown back to fetch, and it hangs.
    await settle(() => {
      rerender();
    });

    await waitFor(() => {
      expect(fetchCount).toBeGreaterThan(1);
    });

    const input: HTMLInputElement = screen.getByPlaceholderText(
      NAME_PLACEHOLDER,
    ) as HTMLInputElement;

    await user.type(input, "Engineering");

    expect(
      (screen.getByPlaceholderText(NAME_PLACEHOLDER) as HTMLInputElement).value,
    ).toBe("Engineering");
  });

  /*
   * The other side of the same guard. formFields starts empty and is filled in
   * by an effect, so the initial-values pass must not latch before the field
   * list arrives - or every default value and every dropdown/date
   * normalisation would be skipped.
   */
  test("still applies default values once the field list arrives", async () => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="default-value-form"
        initialValues={{}}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: NAME_PLACEHOLDER,
            defaultValue: "Default Team",
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Describe it",
            getDefaultValue: (): string => {
              return "Derived default";
            },
          },
        ]}
        onSubmit={(values: FormValues<any>) => {
          onSubmit(values);
        }}
        submitButtonText="Save"
        footer={<></>}
      />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toBeTruthy();
    });

    await userEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    const submitted: FormValues<any> = onSubmit.mock.calls[0]![0];

    expect(submitted["name"]).toBe("Default Team");
    expect(submitted["description"]).toBe("Derived default");
  });
});
