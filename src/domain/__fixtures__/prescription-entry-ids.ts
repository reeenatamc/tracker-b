/**
 * The ids of the slots the migration seeds.
 *
 * A slot id is the longitudinal identity of a position in a session — "the third
 * exercise of Full Body A" — and everything that ever gets said about that
 * position points at it: adjustments, snapshots, history. So it survives the
 * exercise in it changing, and it cannot be renamed afterwards. Same rule as the
 * exercise ids in E1 and the phase ids in E2, for the same reason.
 *
 * Two sources, and only one of them belongs in a fixture. Seeded slots are
 * deterministic and frozen here. Slots made from the app with `add_entry` are
 * opaque UUIDs, because they get created on a phone with no network at possibly
 * the same moment as the laptop, and so cannot depend on a compiled list.
 *
 * The list only grows: adding a session or an exercise adds ids, removing one
 * never removes them, because the log still points at them.
 */

/** The shape a seeded id has, so none is ever derived from an exercise name. */
export const SEEDED_ENTRY_ID_PATTERN = /^slot_[a-z][a-z0-9_]*_\d{2}$/;

/**
 * Every seeded slot the example program produces.
 *
 * The real `content/` is gitignored, so this is checked against the example — the
 * point being the rule, not the census: the ids come from the template and the
 * position, never from who currently occupies them.
 */
export const KNOWN_ENTRY_IDS: readonly string[] = [
	"slot_full_body_a_01",
	"slot_full_body_a_02",
	"slot_full_body_a_03",
	"slot_full_body_a_04",
	"slot_full_body_b_01",
	"slot_full_body_b_02",
	"slot_full_body_b_03",
	"slot_full_body_b_04",
	"slot_full_body_c_01",
	"slot_full_body_c_02",
	"slot_full_body_c_03",
	"slot_full_body_c_04",
];
