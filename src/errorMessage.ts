/** The message from a thrown value, however it was thrown. Code across this
 * project catches `unknown` (never `any`) and needs the same one-line
 * extraction to put it in a log, an error field or a message sent to the model. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
