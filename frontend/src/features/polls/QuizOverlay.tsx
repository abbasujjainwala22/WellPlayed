import { Brain } from "lucide-react";
import { useEffect, useState } from "react";

import { useRoom } from "../../lib/room-context";
import { PollCard, usePolls } from "./PollsPanel";

/** Pops the newest open quiz above the video so nobody misses a quiz break. */
export function QuizOverlay() {
  const { timeline } = useRoom();
  const quiz = usePolls((s) => [...s.polls].reverse().find((p) => p.kind === "quiz" && p.state !== "revealed"));
  const [shownAt, setShownAt] = useState(0);
  useEffect(() => setShownAt(Date.now()), [quiz?.id]);
  if (!quiz) return null;
  return (
    <div className="quiz">
      <div className="muted">
        <Brain size={15} aria-hidden />
        {timeline.note === "Quiz break" ? "Quiz break — fastest correct answer scores most" : "Quiz"}
      </div>
      <PollCard poll={quiz} key={quiz.id + shownAt} />
    </div>
  );
}
