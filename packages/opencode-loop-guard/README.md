# @comment-labs/opencode-loop-guard

Breaks agent tool-call loops. Tracks each session's most recent call; when the
SAME tool with the SAME arguments (order-insensitive key hashing) runs N times
in a row (default 4), the call is blocked with a "change your approach" error.
The counter resets after blocking, so a corrected retry gets through.

Options: `{ threshold?: number, disabled?: boolean }`.
