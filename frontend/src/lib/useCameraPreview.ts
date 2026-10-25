import { useCallback, useEffect, useRef, useState } from "react";

import { mediaErrorMessage } from "./mediaErrors";

export type PreviewStatus = "idle" | "starting" | "live" | "error";

/**
 * Local-only camera preview. Nothing is uploaded or recorded; every track is stopped on stop(),
 * when switching cameras, and on unmount, so the camera light goes off straight away.
 */
export function useCameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const attempt = useRef(0);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    attempt.current++; // cancels a start() that is still waiting for permission
    release();
    setStatus("idle");
  }, [release]);

  const start = useCallback(
    async (id?: string) => {
      release();
      setError("");
      const fail = (e: unknown) => {
        setStatus("error");
        setError(mediaErrorMessage(e, "camera"));
      };
      if (!window.isSecureContext) return fail({ name: "InsecureContext" });
      if (!navigator.mediaDevices?.getUserMedia) return fail({ name: "Unsupported" });
      const mine = ++attempt.current;
      setStatus("starting");
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id } } : true, audio: false });
        if (mine !== attempt.current) {
          s.getTracks().forEach((t) => t.stop()); // stopped or unmounted while the prompt was open
          return;
        }
        stream.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setStatus("live");
        // Camera labels are only available once permission has been granted.
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        setCameras(list);
        setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId ?? id ?? "");
      } catch (e) {
        if (mine === attempt.current) fail(e);
      }
    },
    [release],
  );

  useEffect(
    () => () => {
      attempt.current++;
      release();
    },
    [release],
  );

  return { videoRef, status, error, cameras, deviceId, start, stop };
}
