import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How a SQL Query or Database Health monitor signs in to Microsoft SQL
 * Server, as two plain choices.
 *
 * It used to be a switch, "Use Windows Integrated Authentication", whose help
 * explained the other mode as well ("... Username and password are
 * ignored."): the maintainer's example of a switch that should have been two
 * choices, with the simpler one first. A username and a password is what
 * every engine uses and what a new monitor starts on; Windows Integrated
 * Authentication is the other choice, for a probe that runs as a domain
 * account.
 *
 * Nothing stored changes: the choice reads and writes the step's
 * useWindowsIntegratedAuthentication boolean, which the probe and the API
 * read as before. Only SQL Server offers it; the other engines always sign
 * in with a username and a password.
 *
 * Kept free of React so the forms and App/Tests read these exact words.
 */

export enum DatabaseAuthentication {
  UsernameAndPassword = "username-and-password",
  WindowsIntegrated = "windows-integrated",
}

export interface DatabaseAuthenticationOption {
  value: DatabaseAuthentication;
  // English, looked up where it is drawn.
  title: string;
  // One line: what picking it means.
  description: string;
}

export const DATABASE_AUTHENTICATION_TITLE: string =
  translationKey("Authentication");

// The simpler choice first: it is the one a new monitor starts on.
export const DATABASE_AUTHENTICATION_OPTIONS: Array<DatabaseAuthenticationOption> =
  [
    {
      value: DatabaseAuthentication.UsernameAndPassword,
      title: translationKey("Username and password"),
      description: translationKey("Sign in with a SQL Server login."),
    },
    {
      value: DatabaseAuthentication.WindowsIntegrated,
      title: translationKey("Windows Integrated Authentication"),
      description: translationKey(
        "Sign in as the account the probe runs as. No password needed.",
      ),
    },
  ];

// The data-testid of the choice (its radios are found by their labels).
export const DATABASE_AUTHENTICATION_TEST_ID: string = "database-authentication";

// Whether the engine offers a choice at all: only SQL Server does.
export const isDatabaseAuthenticationOffered: (
  databaseType: SqlDatabaseType | undefined,
) => boolean = (databaseType: SqlDatabaseType | undefined): boolean => {
  return databaseType === SqlDatabaseType.MicrosoftSqlServer;
};

/*
 * The choice a stored step reads as. Any engine other than SQL Server signs in
 * with a username and a password, whatever the boolean holds.
 */
export const getDatabaseAuthentication: (data: {
  databaseType: SqlDatabaseType | undefined;
  useWindowsIntegratedAuthentication: boolean | undefined;
}) => DatabaseAuthentication = (data: {
  databaseType: SqlDatabaseType | undefined;
  useWindowsIntegratedAuthentication: boolean | undefined;
}): DatabaseAuthentication => {
  if (
    isDatabaseAuthenticationOffered(data.databaseType) &&
    data.useWindowsIntegratedAuthentication === true
  ) {
    return DatabaseAuthentication.WindowsIntegrated;
  }

  return DatabaseAuthentication.UsernameAndPassword;
};

// What a choice writes to the step's boolean.
export const usesWindowsIntegratedAuthentication: (
  choice: DatabaseAuthentication,
) => boolean = (choice: DatabaseAuthentication): boolean => {
  return choice === DatabaseAuthentication.WindowsIntegrated;
};

/*
 * A radio value the choice understands: anything else is the default, so a
 * stray value never turns Windows Integrated Authentication on.
 */
export const toDatabaseAuthentication: (value: unknown) => DatabaseAuthentication =
  (value: unknown): DatabaseAuthentication => {
    return value === DatabaseAuthentication.WindowsIntegrated
      ? DatabaseAuthentication.WindowsIntegrated
      : DatabaseAuthentication.UsernameAndPassword;
  };
