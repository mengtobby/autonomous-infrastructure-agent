import { ApiError } from "./api.js";

/** The message to show for a caught error: an ApiError's own message (it was
 * already written to be shown to the person using the dashboard), or a
 * caller-supplied fallback for anything else. */
export function describeError(error, fallback = String(error)) {
  return error instanceof ApiError ? error.message : fallback;
}
