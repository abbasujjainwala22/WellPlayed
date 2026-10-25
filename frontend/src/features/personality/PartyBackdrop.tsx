import { PartyDoodle, type DoodleKind } from "./PartyDoodle";
import "./personality.css";

type Scene = "home" | "discover" | "awards" | "stage";

/** Six slots (a–f) around the edges of the host; phones keep only the first three. */
const SCENES: Record<Scene, DoodleKind[]> = {
  home: ["popcorn", "ticket", "star", "clapper", "glasses", "sparkle"],
  discover: ["ticket", "popcorn", "star", "reel", "soda", "sparkle"],
  awards: ["trophy", "confetti", "star", "ticket", "crown", "sparkle"],
  stage: ["clapper", "popcorn", "sparkle", "glasses", "soda", "star"],
};
const SLOTS = ["a", "b", "c", "d", "e", "f"];

/**
 * Faint doodles scattered behind a hero. Purely decorative: aria-hidden, no pointer events and absolutely
 * positioned, so it never moves layout. Put it as the first child of an element with the `party-host` class.
 */
export function PartyBackdrop({ scene = "discover" }: { scene?: Scene }) {
  return (
    <div className="party-backdrop" aria-hidden="true">
      {SCENES[scene].map((kind, i) => (
        <PartyDoodle key={SLOTS[i]} kind={kind} className={`scatter scatter-${SLOTS[i]}`} />
      ))}
    </div>
  );
}
