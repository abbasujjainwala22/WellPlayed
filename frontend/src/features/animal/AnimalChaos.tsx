import { ArrowLeft, PawPrint, RotateCcw, Video, VideoOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Modal } from "../../components/ui";
import { useRoom } from "../../lib/room-context";
import { useVoice } from "../voice/voice";
import { ANIMALS, type AnimalId, animalInfo, withArticle } from "./animals";
import { renderIcon } from "./render";
import { type AnimalEffect, useAnimal, useAnimalActions } from "./store";
import { useTracker } from "./tracker";
import "./animal.css";

export function AnimalIcon({ animal, size = 56 }: { animal: AnimalId; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderIcon(ref.current, animal);
  }, [animal]);
  return <canvas ref={ref} className="animal-icon" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Button that opens the dialog (camera strip and voice panel). Shows how many people are animals right now. */
export function AnimalLauncher() {
  const count = useAnimal((s) => Object.keys(s.effects).length);
  const open = useAnimal((s) => s.setDialogOpen);
  return (
    <button
      type="button"
      className="ghost sm animal-launcher"
      aria-label={count ? `Animal Chaos, ${count} active` : "Animal Chaos"}
      title="Animal Chaos"
      onClick={() => open(true)}
    >
      <PawPrint size={17} />
      <span className="hide-sm">Animal Chaos</span>
      {count > 0 && <span className="animal-count">{count}</span>}
    </button>
  );
}

function EffectRow({ effect, meId }: { effect: AnimalEffect; meId: string }) {
  const { reset } = useAnimalActions();
  const a = animalInfo(effect.animal);
  const mine = effect.targetId === meId;
  const canReset = mine || effect.byId === meId;
  return (
    <li className="animal-effect">
      <AnimalIcon animal={effect.animal} size={40} />
      <div className="grow">
        <strong>
          {mine ? "You" : effect.targetName} · {a.name}
        </strong>
        <span className="faint">
          {effect.byId === meId ? "Applied by you" : `Applied by ${effect.byName}`}
          {effect.missingSinceMs ? " · reconnecting, kept for a minute" : ""}
        </span>
      </div>
      {canReset && (
        <button type="button" className="sm" onClick={() => reset(effect)}>
          <RotateCcw size={14} /> {mine ? "Shake it off" : "Reset"}
        </button>
      )}
    </li>
  );
}

function TrackerNote() {
  const { status, delegate, error } = useTracker();
  if (status === "error") return <p className="error">{error}</p>;
  if (status === "ready") return <p className="faint">Face tracking is running on this device ({delegate === "GPU" ? "graphics chip" : "processor"}).</p>;
  if (status === "loading") return <p className="faint">Loading face tracking on this device…</p>;
  return null;
}

export function AnimalChaosDialog() {
  const { me, members } = useRoom();
  const { people, status, camOn, toggleCam } = useVoice();
  const { effects, hidden, setHidden, dialogOpen, setDialogOpen } = useAnimal();
  const { apply } = useAnimalActions();
  const [animal, setAnimal] = useState<AnimalId | null>(null);
  const [announce, setAnnounce] = useState(true);
  if (!dialogOpen) return null;

  const close = () => {
    setDialogOpen(false);
    setAnimal(null);
  };
  const names = new Map(members.map((m) => [m.id, m.name]));
  const cams = people.filter((p) => p.video && names.has(p.id));
  const active = Object.values(effects).sort((a, b) => a.createdMs - b.createdMs);
  const chosen = animal ? animalInfo(animal) : null;

  return (
    <Modal
      title="Animal Chaos"
      description="Pick an animal, then pick a camera. Everyone in the call sees it."
      icon={<PawPrint size={20} />}
      onClose={close}
      width={560}
    >
      {!chosen ? (
        <section aria-label="Choose an animal">
          <div className="animal-grid">
            {ANIMALS.map((a) => (
              <button key={a.id} type="button" className="animal-pick" onClick={() => setAnimal(a.id)}>
                <AnimalIcon animal={a.id} />
                <strong>{a.name}</strong>
                <span className="faint">{a.line}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section aria-label={`Who becomes ${withArticle(chosen.name)}?`} className="stack">
          <div className="row">
            <button type="button" className="ghost sm" onClick={() => setAnimal(null)}>
              <ArrowLeft size={14} /> Animals
            </button>
            <strong>Who becomes {withArticle(chosen.name)}?</strong>
          </div>
          {cams.length === 0 ? (
            <div className="animal-empty">
              <VideoOff size={16} /> <span className="grow">Nobody has their camera on right now.</span>
              {!camOn && (
                <button type="button" className="sm primary" disabled={status !== "on"} onClick={() => void toggleCam()}>
                  <Video size={14} /> Turn my camera on
                </button>
              )}
            </div>
          ) : (
            <div className="animal-targets">
              {cams.map((p) => {
                const current = effects[p.id];
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="animal-target"
                    onClick={() => {
                      apply(p.id, chosen.id, announce);
                      close();
                    }}
                  >
                    <strong className="truncate">
                      {names.get(p.id)}
                      {p.id === me.id && <span className="faint"> (you)</span>}
                    </strong>
                    <span className="faint">{current ? `Now ${withArticle(animalInfo(current.animal).name)}` : "Camera on"}</span>
                  </button>
                );
              })}
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
            Announce it in the chat
          </label>
        </section>
      )}

      <section aria-label="Active effects" className="stack animal-active">
        <h3>Active effects</h3>
        {active.length === 0 ? (
          <p className="faint">Nobody is an animal yet.</p>
        ) : (
          <ul className="plain stack">
            {active.map((e) => (
              <EffectRow key={e.id} effect={e} meId={me.id} />
            ))}
          </ul>
        )}
        <label className="check">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Hide effects on my screen
        </label>
        <TrackerNote />
        <p className="faint">
          Faces are tracked on each viewer’s own device. Camera frames and face points are never uploaded or recorded; only
          who is which animal is shared. The person who applied an effect, or the person wearing it, can reset it.
        </p>
      </section>
    </Modal>
  );
}

/** Small card for the person who just became an animal, with a quick way out. */
export function AnimalNotice() {
  const notice = useAnimal((s) => s.notice);
  const dismiss = useAnimal((s) => s.dismissNotice);
  const { reset } = useAnimalActions();
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(dismiss, 9000);
    return () => window.clearTimeout(t);
  }, [notice, dismiss]);
  if (!notice) return null;
  const a = animalInfo(notice.animal);
  return (
    <div className="animal-notice" role="status">
      <AnimalIcon animal={notice.animal} size={36} />
      <span>
        <strong>{notice.byName}</strong> turned you into {withArticle(a.name)}.
      </span>
      <button
        type="button"
        className="sm"
        onClick={() => {
          reset(notice);
          dismiss();
        }}
      >
        Shake it off
      </button>
      <button type="button" className="ghost icon sm" aria-label="Dismiss" onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
