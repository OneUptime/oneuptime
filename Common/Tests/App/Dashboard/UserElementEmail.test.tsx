import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * The bundler turns an .svg import into a URL string; jest's asset mapper
 * turns it into {}, which UserElement then feeds to Route.fromString and
 * which throws. Hand it the string shape the browser actually gets.
 */
const BLANK_PROFILE_PIC: string = "/blank-profile.svg";

jest.mock("../../../UI/Images/users/blank-profile.svg", () => {
  return BLANK_PROFILE_PIC;
});

/*
 * UserElement is the one user row the dashboard renders everywhere - tables,
 * logs, on-call surfaces, "archived by" cells - so it is the single place the
 * email had to be added. The email was already on the wire at almost every
 * call site; the component simply dropped it, using it only as a stand-in when
 * the name was missing.
 *
 * What these pin: the email is a line of its own beneath the name, it is never
 * printed twice, and neither the avatar nor the "OneUptime" automation row
 * regressed while adding it.
 */

import UserElement from "../../../../App/FeatureSet/Dashboard/src/Components/User/User";
import UsersElement from "../../../../App/FeatureSet/Dashboard/src/Components/User/Users";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";

const USER_ID: string = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID: string = "00000000-0000-4000-8000-000000000002";

type BuildUserModelFunction = (spec: {
  id?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
}) => User;

const buildUserModel: BuildUserModelFunction = (spec: {
  id?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
}): User => {
  const user: User = new User();

  if (spec.id) {
    user._id = spec.id;
  }

  if (spec.name) {
    user.name = new Name(spec.name);
  }

  if (spec.email) {
    user.email = new Email(spec.email);
  }

  return user;
};

type AvatarFunction = () => HTMLImageElement;

const avatar: AvatarFunction = (): HTMLImageElement => {
  const images: Array<HTMLElement> = screen.getAllByRole("img");
  return images[0] as HTMLImageElement;
};

describe("UserElement", () => {
  describe("showing the email", () => {
    /*
     * The whole point of the change. If this fails, every user row in the
     * dashboard is back to a bare name with no way to tell two people with the
     * same name apart.
     */
    test("shows the email underneath the name", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
        />,
      );

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "jane@acme.com",
      );
    });

    test("puts the email on a line of its own, not inside the name", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
        />,
      );

      expect(screen.getByText("Jane Doe")).not.toHaveTextContent(
        "jane@acme.com",
      );
    });

    test("reads the email off a User model, not just a plain object", () => {
      render(
        <UserElement
          user={buildUserModel({
            id: USER_ID,
            name: "Jane Doe",
            email: "jane@acme.com",
          })}
        />,
      );

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "jane@acme.com",
      );
    });

    /*
     * Callers that hand-build a user out of an API response pass the
     * serialized form of an Email. toString() on that shape yields
     * "[object Object]", which is what the reader would otherwise see.
     */
    test("unwraps a serialized Email rather than printing [object Object]", () => {
      render(
        <UserElement
          user={{
            _id: USER_ID,
            name: "Jane Doe",
            email: { _type: "Email", value: "jane@acme.com" },
          }}
        />,
      );

      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "jane@acme.com",
      );
      expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    });

    test("unwraps a serialized Name the same way", () => {
      render(
        <UserElement
          user={{
            _id: USER_ID,
            name: { _type: "Name", value: "Jane Doe" },
            email: "jane@acme.com",
          }}
        />,
      );

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    });
  });

  describe("not showing it twice", () => {
    /*
     * The name line already falls back to the email. Rendering the subline
     * unconditionally would print the address twice on every user who has not
     * set a name - which is most users right after they are invited.
     */
    test("keeps an email-only user to a single line", () => {
      render(<UserElement user={{ _id: USER_ID, email: "jane@acme.com" }} />);

      expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    test("adds no empty line for a user with a name but no email", () => {
      render(<UserElement user={{ _id: USER_ID, name: "Jane Doe" }} />);

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    test("does not repeat an address stored as both the name and the email", () => {
      render(
        <UserElement
          user={{
            _id: USER_ID,
            name: "jane@acme.com",
            email: "jane@acme.com",
          }}
        />,
      );

      expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    test("treats an empty-string name as no name", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "", email: "jane@acme.com" }}
        />,
      );

      expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    test("treats an empty-string email as no email", () => {
      render(
        <UserElement user={{ _id: USER_ID, name: "Jane Doe", email: "" }} />,
      );

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });
  });

  describe("the profile picture", () => {
    test("points the avatar at the user's own picture", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
        />,
      );

      expect(avatar()).toHaveAttribute(
        "src",
        `/api/user/profile-picture/${USER_ID}`,
      );
    });

    test("builds the avatar from a User model's id", () => {
      render(
        <UserElement
          user={buildUserModel({
            id: OTHER_USER_ID,
            name: "John Roe",
            email: "john@acme.com",
          })}
        />,
      );

      expect(avatar()).toHaveAttribute(
        "src",
        `/api/user/profile-picture/${OTHER_USER_ID}`,
      );
    });

    test("accepts `id` as well as `_id`", () => {
      render(
        <UserElement
          user={{ id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
        />,
      );

      expect(avatar()).toHaveAttribute(
        "src",
        `/api/user/profile-picture/${USER_ID}`,
      );
    });

    test("falls back to the blank picture, and still shows name and email, when there is no id", () => {
      render(
        <UserElement user={{ name: "Jane Doe", email: "jane@acme.com" }} />,
      );

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "jane@acme.com",
      );
      expect(avatar()).toHaveAttribute("src", BLANK_PROFILE_PIC);
    });

    test("survives an id that is not a valid ObjectID", () => {
      render(
        <UserElement
          user={{ _id: "not-an-id", name: "Jane Doe", email: "jane@acme.com" }}
        />,
      );

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "jane@acme.com",
      );
    });

    test("names the avatar after the user so it is not an unlabelled image", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
        />,
      );

      expect(avatar()).toHaveAttribute("alt", "Jane Doe");
    });
  });

  describe("callers that want the compact row back", () => {
    test("hideEmail drops the second line", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
          hideEmail={true}
        />,
      );

      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    test("emailClassName replaces the default styling", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
          emailClassName="text-sm text-red-500"
        />,
      );

      expect(screen.getByTestId("user-email")).toHaveClass("text-sm");
      expect(screen.getByTestId("user-email")).not.toHaveClass("text-xs");
    });

    test("keeps the default styling when no override is given", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
        />,
      );

      expect(screen.getByTestId("user-email")).toHaveClass("text-gray-500");
    });
  });

  describe("rows that are not a person", () => {
    /*
     * An empty user object means the action was taken by automation. That row
     * has no email and must not grow one.
     */
    test("still reads OneUptime for an automated action", () => {
      render(<UserElement user={{}} />);

      expect(screen.getByText("OneUptime")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    /*
     * A missing user reads as automation too - there is nobody to name and, in
     * particular, no email to invent.
     */
    test("reads OneUptime for a null user", () => {
      render(<UserElement user={null} />);

      expect(screen.getByText("OneUptime")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    test("reads OneUptime for an absent user", () => {
      render(<UserElement />);

      expect(screen.getByText("OneUptime")).toBeInTheDocument();
      expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
    });

    test("gives the automation avatar an alt so it is not unlabelled", () => {
      render(<UserElement user={{}} />);

      expect(avatar()).toHaveAttribute("alt", "Automation");
    });
  });

  describe("prefix and suffix", () => {
    test("keeps the prefix beside the name and the email below it", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
          prefix="Assigned to"
        />,
      );

      expect(screen.getByText("Assigned to")).toBeInTheDocument();
      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "jane@acme.com",
      );
    });

    test("keeps rendering the suffix alongside the email", () => {
      render(
        <UserElement
          user={{ _id: USER_ID, name: "Jane Doe", email: "jane@acme.com" }}
          suffix="(on call)"
        />,
      );

      expect(screen.getByText("(on call)")).toBeInTheDocument();
      expect(screen.getByTestId("user-email")).toBeInTheDocument();
    });
  });
});

describe("UsersElement", () => {
  test("shows the email for every user in the list", () => {
    render(
      <UsersElement
        users={[
          buildUserModel({
            id: USER_ID,
            name: "Jane Doe",
            email: "jane@acme.com",
          }),
          buildUserModel({
            id: OTHER_USER_ID,
            name: "John Roe",
            email: "john@acme.com",
          }),
        ]}
      />,
    );

    const emails: Array<HTMLElement> = screen.getAllByTestId("user-email");

    expect(emails).toHaveLength(2);
    expect(emails[0]).toHaveTextContent("jane@acme.com");
    expect(emails[1]).toHaveTextContent("john@acme.com");
  });

  test("forwards hideEmail down to each row", () => {
    render(
      <UsersElement
        users={[
          buildUserModel({
            id: USER_ID,
            name: "Jane Doe",
            email: "jane@acme.com",
          }),
        ]}
        hideEmail={true}
      />,
    );

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.queryByTestId("user-email")).not.toBeInTheDocument();
  });

  test("still says so when there is nobody to list", () => {
    render(<UsersElement users={[]} />);

    expect(screen.getByText("No users.")).toBeInTheDocument();
  });
});
