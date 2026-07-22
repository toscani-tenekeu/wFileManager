export const ADMIN_PASSWORD_POLICY_TEXT =
  "Use at least 12 characters with uppercase and lowercase letters and a number. Special characters and identical consecutive characters are not allowed.";

export function administratorPasswordError(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (!/^[A-Za-z0-9]+$/.test(password)) return "Use letters and numbers only; special characters are not allowed.";
  if (!/[A-Z]/.test(password)) return "Add at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Add at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Add at least one number.";
  if (/(.)\1/.test(password)) return "Do not repeat the same character consecutively.";
  return null;
}

export function isValidAdministratorPassword(password: string) {
  return administratorPasswordError(password) === null;
}
