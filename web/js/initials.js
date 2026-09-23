// Validation for the 3-character arcade-style initials shown on the endless leaderboard.
//
// Restricting to exactly 3 characters from [A-Z0-9] (like a classic arcade high-score entry) is what makes a
// profanity filter tractable at all: the space of meaningful bad combinations is small enough to actually
// enumerate, unlike free-text names. This list is deliberately a moderate, non-exhaustive denylist of the most
// common English profanity/slurs (and their obvious digit-for-letter substitutions, e.g. 4 for A, 1 for I, 5 for
// S) that fit in 3 characters — not a claim of completeness. Firestore rules mirror this exact list as a
// second, server-side check; if this list ever changes, update firestore.rules to match.
export const BANNED_INITIALS = new Set(
  `ASS A55 4SS FAG F4G CUM CVM TIT T1T SOB FUK FCK PHK SHT SH1 DIK DIC JIZ CNT KKK NIG N1G
   SEX S3X HOE H0E SLT PIS PSS TWA COK C0K COC BJS PRK RTA FUC WOP GOK SPC KYK CHK NGR`
    .split(/\s+/)
    .filter(Boolean)
);

/** True if `s` is exactly 3 letters/digits and not on the denylist (case-insensitive). */
export function isCleanInitials(s) {
  return typeof s === 'string' && /^[A-Z0-9]{3}$/.test(s) && !BANNED_INITIALS.has(s);
}
