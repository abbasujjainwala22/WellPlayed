import { AwardsSummary } from "./AwardsSummary";
import { awardsFor } from "./history";

/** On the room-ended screen: the awards this device saved when the host revealed them. */
export function EndedAwards({ code }: { code: string }) {
  const saved = awardsFor(code);
  if (!saved || saved.awards.length === 0) return null;
  return (
    <div style={{ textAlign: "left", width: "min(980px, 90vw)", marginTop: 24 }}>
      <h3>This party’s awards</h3>
      <AwardsSummary awards={saved.awards} review={saved.review} />
    </div>
  );
}
