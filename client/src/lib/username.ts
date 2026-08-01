export const MAX_USERNAME_LENGTH = 24;
export const MIN_USERNAME_LENGTH = 1;

export type UsernameValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate a raw username string.
 *
 * Rules (agreed for CrushedPlay_ participant model):
 *  - Trim leading/trailing whitespace.
 *  - Length must be between MIN_USERNAME_LENGTH and MAX_USERNAME_LENGTH (inclusive) after trimming.
 *  - Only printable Unicode characters allowed (control characters are rejected).
 *  - No uniqueness check — two participants may share a display name.
 *
 * No storage is performed here. The caller owns the resulting value.
 */
export function validateUsername(raw: unknown): UsernameValidationResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Please enter a username.' };
  }

  const trimmed = raw.trim();

  if (trimmed.length < MIN_USERNAME_LENGTH) {
    return { ok: false, error: 'Please enter a username.' };
  }

  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return { ok: false, error: `Username must be ${MAX_USERNAME_LENGTH} characters or fewer.` };
  }

  if (containsControlCharacters(trimmed)) {
    return { ok: false, error: 'Username contains invalid characters.' };
  }

  return { ok: true, value: trimmed };
}

function containsControlCharacters(value: string) {
  // Reject C0 controls (0x00–0x1F), DEL (0x7F), and C1 controls (0x80–0x9F).
  // Everything else (letters, digits, punctuation, emoji, CJK, RTL, etc.) is allowed.
  for (const char of value) {
    const code = char.codePointAt(0);

    if (code === undefined) {
      continue;
    }

    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      return true;
    }
  }

  return false;
}
