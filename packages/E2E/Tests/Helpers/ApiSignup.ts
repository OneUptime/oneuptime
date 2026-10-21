import { E2E_SIGNUP_PASSWORD } from "../../Config";
import { stackUrl } from "./SsoRoutes";
import { APIRequestContext, APIResponse, expect } from "@playwright/test";
import Faker from "Common/Utils/Faker";

/*
 * A brand new project owner, over the API alone.
 *
 * The shared onboarding helper (Tests/Dashboard/Helpers/ProductOnboarding.ts)
 * drives the register form and the project modal in a browser, which is right
 * for a spec about onboarding and far too expensive for a spec that only
 * needs a signed-in owner: these are the same two requests that flow ends in.
 *
 * The session is a cookie the sign-up answer sets, and the APIRequestContext
 * passed in keeps it - a page's `page.request` or a context of its own - so
 * every later call through the same context is this owner's.
 *
 * Billing-off stacks only: with billing on the sign-up also needs company
 * details and a project needs a plan.
 */

export interface SignedUpOwner {
  ownerEmail: string;
  // The project the sign-up created, owned by this user.
  projectId: string;
}

type ReadCreatedIdFunction = (body: string) => string;

/*
 * The id a CRUD create answered with: bare or wrapped in `data`, as a string
 * or as { _type: "ObjectID", value }.
 */
const readCreatedId: ReadCreatedIdFunction = (body: string): string => {
  try {
    const parsed: Record<string, unknown> = JSON.parse(body) as Record<
      string,
      unknown
    >;
    const data: Record<string, unknown> =
      (parsed["data"] as Record<string, unknown>) || parsed;
    const id: unknown = data["_id"];

    if (typeof id === "string") {
      return id;
    }

    if (id && typeof id === "object") {
      return String((id as Record<string, unknown>)["value"] || "");
    }

    return "";
  } catch {
    return "";
  }
};

type CreateProjectAsOwnerFunction = (data: {
  request: APIRequestContext;
  name: string;
}) => Promise<string>;

/*
 * Creates a project as the signed-in user, which makes them its owner, and
 * returns its id. Creating a project is core, so it works on every stack and
 * whatever the Enterprise licence says.
 */
export const createProjectAsOwner: CreateProjectAsOwnerFunction = async (data: {
  request: APIRequestContext;
  name: string;
}): Promise<string> => {
  const url: string = stackUrl("/api/project");
  const response: APIResponse = await data.request.post(url, {
    headers: { "content-type": "application/json" },
    data: { data: { name: data.name } },
  });
  const status: number = response.status();
  const body: string = await response.text();
  const found: string = `HTTP ${status} from POST ${url}: ${body.slice(0, 300)}`;

  expect(status, `Creating a project failed. ${found}`).toBe(200);

  const projectId: string = readCreatedId(body);

  expect(projectId, `The project create answered no id. ${found}`).not.toBe("");

  return projectId;
};

type SignUpOwnerWithProjectFunction = (data: {
  request: APIRequestContext;
  // The new user's display name, which also prefixes the project's name.
  name: string;
}) => Promise<SignedUpOwner>;

/*
 * Signs a brand new user up and creates a project for them.
 *
 * The bodies are the envelopes the Dashboard's model forms send
 * (JSONFunctions.serialize), because that is what the API deserializes back
 * into Email, Name and HashedString before the User row is built.
 */
export const signUpOwnerWithProject: SignUpOwnerWithProjectFunction =
  async (data: {
    request: APIRequestContext;
    name: string;
  }): Promise<SignedUpOwner> => {
    const ownerEmail: string = Faker.generateEmail().toString();
    const url: string = stackUrl("/api/identity/signup");

    const response: APIResponse = await data.request.post(url, {
      headers: { "content-type": "application/json" },
      data: {
        data: {
          email: { _type: "Email", value: ownerEmail },
          name: { _type: "Name", value: data.name },
          password: { _type: "HashedString", value: E2E_SIGNUP_PASSWORD },
        },
      },
    });

    expect(
      response.status(),
      `Signing up failed: HTTP ${response.status()} from POST ${url}: ${(
        await response.text()
      ).slice(0, 300)}`,
    ).toBe(200);

    /*
     * The session cookie the answer above set is in this context now, so the
     * project is created BY this user - which is what makes them its owner
     * and gives every later call its permissions.
     */
    const projectId: string = await createProjectAsOwner({
      request: data.request,
      name: `${data.name} ${Faker.generateName().toString()}`,
    });

    return { ownerEmail, projectId };
  };
