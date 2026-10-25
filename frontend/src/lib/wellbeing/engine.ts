/**
 * On-device perception with MediaPipe Tasks Vision. Frames are read from a local <video> that is
 * never sent anywhere; only the derived signals leave this module.
 */
import type { Pose } from "./signals";

export interface Frame {
  pose: Pose | null;
  blink: { left: number; right: number } | null;
  phoneScore: number;
  t: number;
}

const MODELS = {
  pose: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  objects: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
};

export class WellbeingEngine {
  private stream: MediaStream | null = null;
  private video = document.createElement("video");
  private timer = 0;
  private frames = 0;
  private phone = 0;
  private landmarkers: { pose: any; face: any; objects: any } | null = null;

  constructor(private onFrame: (f: Frame) => void, private fps = 6, private wantObjects = false) {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  private async create(delegate: "GPU" | "CPU") {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const base = (url: string) => ({ modelAssetPath: url, delegate });
    return Promise.all([
      vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: base(MODELS.pose), runningMode: "VIDEO", numPoses: 1 }),
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: base(MODELS.face),
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      }),
      this.wantObjects
        ? vision.ObjectDetector.createFromOptions(fileset, {
            baseOptions: base(MODELS.objects),
            runningMode: "VIDEO",
            scoreThreshold: 0.3,
            categoryAllowlist: ["cell phone"],
          })
        : Promise.resolve(null),
    ]);
  }

  async start(): Promise<void> {
    let models;
    try {
      models = await this.create("GPU");
    } catch {
      models = await this.create("CPU"); // no WebGL (headless, old devices)
    }
    const [pose, face, objects] = models;
    this.landmarkers = { pose, face, objects };
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.timer = window.setInterval(() => this.tick(), 1000 / this.fps);
  }

  private tick(): void {
    const lm = this.landmarkers;
    if (!lm || this.video.readyState < 2) return;
    const ts = performance.now();
    const p = lm.pose.detectForVideo(this.video, ts);
    const f = lm.face.detectForVideo(this.video, ts);
    if (lm.objects && this.frames++ % 5 === 0) {
      const o = lm.objects.detectForVideo(this.video, ts);
      this.phone = Math.max(0, ...o.detections.flatMap((d: any) => d.categories.map((c: any) => c.score)));
    }
    const shapes: { categoryName: string; score: number }[] = f.faceBlendshapes?.[0]?.categories ?? [];
    const get = (n: string) => shapes.find((s) => s.categoryName === n)?.score ?? 0;
    this.onFrame({
      pose: p.landmarks?.[0] ?? null,
      blink: shapes.length ? { left: get("eyeBlinkLeft"), right: get("eyeBlinkRight") } : null,
      phoneScore: this.phone,
      t: Date.now(),
    });
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.landmarkers?.pose.close();
    this.landmarkers?.face.close();
    this.landmarkers?.objects?.close();
    this.landmarkers = null;
    this.stream = null;
  }
}
