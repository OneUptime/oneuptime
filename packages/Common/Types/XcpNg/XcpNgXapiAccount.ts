/*
 * Which account an XAPI connection (#10999) holds, as the probe finds it on
 * every test and collection and XcpNgConnection.xapiAccountKind stores it.
 *
 * XAPI has a read-only role, but only for Active Directory users: a pool
 * that is not joined to a domain has one account, root, which can do
 * anything to the pool. XCP-ng 8.3 advises against joining hosts to a
 * domain and recommends managing users in Xen Orchestra instead. So a
 * connection says plainly which account it holds, and what that means.
 *
 *   Root      the pool's local superuser. OneUptime holds the pool's root
 *             password; only the probe's code keeps it to reads.
 *   ReadOnly  an Active Directory user whose only role is read-only: XAPI
 *             itself refuses it anything but reads.
 *   Elevated  an Active Directory user with a role beyond read-only
 *             (vm-operator, pool-admin ...): XAPI would let it change the
 *             pool; only the probe's code keeps it to reads.
 *
 * Stored strings: never rename one, only add.
 */
enum XcpNgXapiAccountKind {
  Root = "Root",
  ReadOnly = "ReadOnly",
  Elevated = "Elevated",
}

export default XcpNgXapiAccountKind;

// XAPI's name for its read-only role (role.name_label).
export const XAPI_READ_ONLY_ROLE_NAME: string = "read-only";

export class XcpNgXapiAccountKindUtil {
  public static getAll(): Array<XcpNgXapiAccountKind> {
    return [
      XcpNgXapiAccountKind.Root,
      XcpNgXapiAccountKind.ReadOnly,
      XcpNgXapiAccountKind.Elevated,
    ];
  }

  public static isValid(value: unknown): value is XcpNgXapiAccountKind {
    return (
      typeof value === "string" &&
      (XcpNgXapiAccountKindUtil.getAll() as Array<string>).includes(value)
    );
  }

  /*
   * The kind of an account from what XAPI says of its session: the local
   * superuser is root; an Active Directory subject is read-only when
   * read-only is its only role, and elevated otherwise. Role names are
   * compared as XAPI writes them, lower case.
   */
  public static fromSession(data: {
    isLocalSuperuser: boolean;
    roleNames: Array<string>;
  }): XcpNgXapiAccountKind {
    if (data.isLocalSuperuser) {
      return XcpNgXapiAccountKind.Root;
    }

    const roles: Array<string> = data.roleNames
      .map((role: string): string => {
        return role.trim().toLowerCase();
      })
      .filter((role: string): boolean => {
        return role.length > 0;
      });

    if (
      roles.length > 0 &&
      roles.every((role: string): boolean => {
        return role === XAPI_READ_ONLY_ROLE_NAME;
      })
    ) {
      return XcpNgXapiAccountKind.ReadOnly;
    }

    return XcpNgXapiAccountKind.Elevated;
  }

  // Whether XAPI itself keeps the account to reads.
  public static isReadOnly(kind: XcpNgXapiAccountKind | null | undefined): boolean {
    return kind === XcpNgXapiAccountKind.ReadOnly;
  }
}
