import User from "Common/UI/Utils/User";

// Two-letter avatar initials for the signed-in user, falling back to "U".
export default function getUserInitials(): string {
  try {
    const name: string = User.getName().toString().trim();
    if (!name) {
      return "U";
    }
    const parts: Array<string> = name.split(/\s+/);
    const first: string = parts[0]?.charAt(0) || "";
    const second: string = parts[1]?.charAt(0) || "";
    return (first + second).toUpperCase() || "U";
  } catch {
    return "U";
  }
}
