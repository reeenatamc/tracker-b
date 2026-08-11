/**
 * Every phase id that has ever existed.
 *
 * A phase id is a key into the log the moment it lands on a session or an event.
 * From then on it cannot be renamed, cannot be reused for a different stretch of
 * training, and cannot quietly disappear — the same rule the exercise ids live by,
 * and for the same reason: the history points at it.
 *
 * This list only grows. A test asserts the program still contains all of it, which
 * is what catches a rename made before there is any stored data to expose it.
 *
 * The visible name is not here, deliberately. Names are free to change.
 */
export const KNOWN_PHASE_IDS: readonly string[] = [
	"adaptacion",
	"progresion",
	"recomposicion",
	"definicion_tesis",
];

/** The shape an id has to have, so none is ever derived from a display name. */
export const PHASE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
