"use client";

import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

type HudState = {
  lap: number;
  lapTime: number;
  bestLap: number | null;
  lastLap: number | null;
  speed: number;
  distance: number;
};

type KeyboardState = {
  accelerate: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
};

type AICarState = {
  progress: number;
  speed: number;
  color: string;
  lateralOffset: number;
  position: Point;
  angle: number;
};

type PlayerState = {
  position: Point;
  angle: number;
  speed: number;
  lap: number;
  lapProgress: number;
  totalDistance: number;
  lapTime: number;
  bestLap: number | null;
  lastLap: number | null;
  offTrack: boolean;
  previousPosition: Point;
};

type GameState = {
  running: boolean;
  player: PlayerState;
  aiCars: AICarState[];
  keys: KeyboardState;
  lastFrame: number;
  hudAccumulator: number;
  canvas: HTMLCanvasElement;
};

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 600;
const CAR_WIDTH = 44;
const CAR_HEIGHT = 78;
const PLAYER_COLOR = "#facc15";
const SPEED_TO_KMH = 1.6;

const OUTER_TRACK: Point[] = [
  { x: 150, y: 50 },
  { x: 740, y: 50 },
  { x: 840, y: 120 },
  { x: 840, y: 480 },
  { x: 740, y: 550 },
  { x: 150, y: 550 },
  { x: 60, y: 470 },
  { x: 60, y: 130 },
];

const INNER_TRACK: Point[] = [
  { x: 300, y: 170 },
  { x: 610, y: 170 },
  { x: 710, y: 230 },
  { x: 710, y: 410 },
  { x: 610, y: 470 },
  { x: 300, y: 470 },
  { x: 200, y: 410 },
  { x: 200, y: 230 },
];

const CENTERLINE: Point[] = OUTER_TRACK.map((point, index) => ({
  x: (point.x + INNER_TRACK[index].x) / 2,
  y: (point.y + INNER_TRACK[index].y) / 2,
}));

type Segment = {
  start: Point;
  end: Point;
  length: number;
  cumulative: number;
};

type TrackMeta = {
  segments: Segment[];
  length: number;
};

const TRACK: TrackMeta = buildTrackMeta(CENTERLINE);
const LAP_LENGTH = TRACK.length;

function buildTrackMeta(points: Point[]): TrackMeta {
  const segments: Segment[] = [];
  let total = 0;

  for (let i = 0; i < points.length; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const length = distance(start, end);
    segments.push({
      start,
      end,
      length,
      cumulative: total,
    });
    total += length;
  }

  return { segments, length: total };
}

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x <
        ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

function sampleTrack(
  progress: number,
  lateralOffset = 0,
): { point: Point; angle: number; normal: Point } {
  let normalized = progress % LAP_LENGTH;
  if (normalized < 0) {
    normalized += LAP_LENGTH;
  }

  const segment = TRACK.segments.find((seg, index) => {
    const nextSegment =
      index === TRACK.segments.length - 1
        ? TRACK.segments[0]
        : TRACK.segments[index + 1];
    const limit =
      index === TRACK.segments.length - 1
        ? LAP_LENGTH
        : nextSegment.cumulative;
    return normalized >= seg.cumulative && normalized < limit;
  });

  const targetSegment = segment ?? TRACK.segments[TRACK.segments.length - 1];
  const range = normalized - targetSegment.cumulative;
  const t =
    targetSegment.length > 0 ? range / targetSegment.length : Number.EPSILON;
  const x =
    targetSegment.start.x +
    (targetSegment.end.x - targetSegment.start.x) * t;
  const y =
    targetSegment.start.y +
    (targetSegment.end.y - targetSegment.start.y) * t;

  const angle = Math.atan2(
    targetSegment.end.y - targetSegment.start.y,
    targetSegment.end.x - targetSegment.start.x,
  );

  const normal = {
    x:
      targetSegment.length === 0
        ? 0
        : -(targetSegment.end.y - targetSegment.start.y) /
          targetSegment.length,
    y:
      targetSegment.length === 0
        ? 0
        : (targetSegment.end.x - targetSegment.start.x) /
          targetSegment.length,
  };

  return {
    point: {
      x: x + normal.x * lateralOffset,
      y: y + normal.y * lateralOffset,
    },
    angle,
    normal,
  };
}

function drawPolygon(ctx: CanvasRenderingContext2D, vertices: Point[]) {
  ctx.beginPath();
  vertices.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
}

function drawTrack(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#0e381e";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#2d2d2d";
  drawPolygon(ctx, OUTER_TRACK);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#103618";
  drawPolygon(ctx, INNER_TRACK);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 16]);
  ctx.beginPath();
  CENTERLINE.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.moveTo(310, 520);
  ctx.lineTo(620, 520);
  ctx.lineTo(620, 505);
  ctx.lineTo(310, 505);
  ctx.closePath();
  ctx.fill();
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  position: Point,
  angle: number,
  color: string,
  scale = 1,
) {
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(angle + Math.PI / 2);
  ctx.scale(scale, scale);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-CAR_WIDTH / 2, -CAR_HEIGHT / 2 + 8);
  ctx.quadraticCurveTo(
    -CAR_WIDTH / 2,
    -CAR_HEIGHT / 2,
    -CAR_WIDTH / 2 + 10,
    -CAR_HEIGHT / 2,
  );
  ctx.lineTo(CAR_WIDTH / 2 - 10, -CAR_HEIGHT / 2);
  ctx.quadraticCurveTo(
    CAR_WIDTH / 2,
    -CAR_HEIGHT / 2,
    CAR_WIDTH / 2,
    -CAR_HEIGHT / 2 + 8,
  );
  ctx.lineTo(CAR_WIDTH / 2, CAR_HEIGHT / 2 - 10);
  ctx.quadraticCurveTo(
    CAR_WIDTH / 2,
    CAR_HEIGHT / 2,
    CAR_WIDTH / 2 - 10,
    CAR_HEIGHT / 2,
  );
  ctx.lineTo(-CAR_WIDTH / 2 + 10, CAR_HEIGHT / 2);
  ctx.quadraticCurveTo(
    -CAR_WIDTH / 2,
    CAR_HEIGHT / 2,
    -CAR_WIDTH / 2,
    CAR_HEIGHT / 2 - 10,
  );
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(-CAR_WIDTH / 2 + 8, -CAR_HEIGHT / 2 + 18, CAR_WIDTH - 16, 34);

  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(-CAR_WIDTH / 2 + 12, -CAR_HEIGHT / 2 + 4, 16, 10);
  ctx.fillRect(CAR_WIDTH / 2 - 28, -CAR_HEIGHT / 2 + 4, 16, 10);

  ctx.fillStyle = "rgba(40,40,40,0.9)";
  ctx.fillRect(-CAR_WIDTH / 2 + 6, -CAR_HEIGHT / 2 + 16, 8, 16);
  ctx.fillRect(CAR_WIDTH / 2 - 14, -CAR_HEIGHT / 2 + 16, 8, 16);
  ctx.fillRect(-CAR_WIDTH / 2 + 6, CAR_HEIGHT / 2 - 32, 8, 16);
  ctx.fillRect(CAR_WIDTH / 2 - 14, CAR_HEIGHT / 2 - 32, 8, 16);

  ctx.restore();
}

function resolveCollision(player: PlayerState, ai: AICarState) {
  const dx = player.position.x - ai.position.x;
  const dy = player.position.y - ai.position.y;
  const distanceBetween = Math.hypot(dx, dy);
  const minDistance = (CAR_WIDTH + CAR_HEIGHT) / 3;

  if (distanceBetween < minDistance && distanceBetween > 0) {
    const overlap = minDistance - distanceBetween;
    const nx = dx / distanceBetween;
    const ny = dy / distanceBetween;

    player.position.x += nx * overlap * 0.6;
    player.position.y += ny * overlap * 0.6;
    player.speed *= 0.82;
  }
}

const DEFAULT_FLASH_MESSAGE =
  "Arrow keys to drive • Space to pause • R to reset";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [hud, setHud] = useState<HudState>({
    lap: 1,
    lapTime: 0,
    bestLap: null,
    lastLap: null,
    speed: 0,
    distance: 0,
  });
  const [isPaused, setIsPaused] = useState(false);
  const [flashMessage, setFlashMessage] = useState(DEFAULT_FLASH_MESSAGE);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const state: GameState = {
      running: true,
      player: {
        position: { x: 460, y: 460 },
        angle: -Math.PI / 2,
        speed: 0,
        lap: 1,
        lapProgress: 0,
        totalDistance: 0,
        lapTime: 0,
        bestLap: null,
        lastLap: null,
        offTrack: false,
        previousPosition: { x: 460, y: 460 },
      },
      aiCars: [
        {
          progress: LAP_LENGTH * 0.25,
          speed: 140,
          color: "#38bdf8",
          lateralOffset: -28,
          position: { x: 0, y: 0 },
          angle: 0,
        },
        {
          progress: LAP_LENGTH * 0.6,
          speed: 165,
          color: "#a855f7",
          lateralOffset: 0,
          position: { x: 0, y: 0 },
          angle: 0,
        },
        {
          progress: LAP_LENGTH * 0.85,
          speed: 180,
          color: "#f97316",
          lateralOffset: 28,
          position: { x: 0, y: 0 },
          angle: 0,
        },
      ],
      keys: {
        accelerate: false,
        brake: false,
        left: false,
        right: false,
      },
      lastFrame: performance.now(),
      hudAccumulator: 0,
      canvas,
    };

    const updateHud = () => {
      setHud({
        lap: state.player.lap,
        lapTime: state.player.lapTime,
        bestLap: state.player.bestLap,
        lastLap: state.player.lastLap,
        speed: Math.abs(state.player.speed),
        distance: state.player.totalDistance,
      });
    };

    const resetFlashTimer = () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = setTimeout(() => {
        setFlashMessage(DEFAULT_FLASH_MESSAGE);
      }, 3200);
    };

    const resetGame = () => {
      state.player = {
        position: { x: 460, y: 460 },
        angle: -Math.PI / 2,
        speed: 0,
        lap: 1,
        lapProgress: 0,
        totalDistance: 0,
        lapTime: 0,
        bestLap: null,
        lastLap: null,
        offTrack: false,
        previousPosition: { x: 460, y: 460 },
      };
      state.aiCars.forEach((car, index) => {
        car.progress = (LAP_LENGTH * (index + 1)) / 4;
        car.speed = 140 + index * 20;
        const sample = sampleTrack(car.progress, car.lateralOffset);
        car.position = sample.point;
        car.angle = sample.angle;
      });
      state.lastFrame = performance.now();
      state.hudAccumulator = 0;
      state.running = true;
      updateHud();
      setIsPaused(false);
      setFlashMessage("Green flag! Lap 1");
      resetFlashTimer();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          state.keys.accelerate = true;
          event.preventDefault();
          break;
        case "ArrowDown":
        case "KeyS":
          state.keys.brake = true;
          event.preventDefault();
          break;
        case "ArrowLeft":
        case "KeyA":
          state.keys.left = true;
          event.preventDefault();
          break;
        case "ArrowRight":
        case "KeyD":
          state.keys.right = true;
          event.preventDefault();
          break;
        case "Space":
          state.running = !state.running;
          state.lastFrame = performance.now();
          setIsPaused(!state.running);
          setFlashMessage(state.running ? "Race resumed" : "Race paused");
          resetFlashTimer();
          event.preventDefault();
          break;
        case "KeyR":
          resetGame();
          event.preventDefault();
          break;
        default:
          break;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          state.keys.accelerate = false;
          break;
        case "ArrowDown":
        case "KeyS":
          state.keys.brake = false;
          break;
        case "ArrowLeft":
        case "KeyA":
          state.keys.left = false;
          break;
        case "ArrowRight":
        case "KeyD":
          state.keys.right = false;
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    resetGame();

    const updatePlayer = (delta: number) => {
      const acceleration = 210;
      const braking = 260;
      const friction = 48;
      const maxSpeed = 260;
      const reverseLimit = -70;
      const turnSpeed = 2.9;

      if (state.keys.accelerate) {
        state.player.speed += acceleration * delta;
      } else {
        state.player.speed -= friction * delta * Math.sign(state.player.speed);
      }

      if (state.keys.brake) {
        state.player.speed -= braking * delta;
      }

      state.player.speed = Math.min(Math.max(state.player.speed, reverseLimit), maxSpeed);

      if (!state.keys.accelerate && !state.keys.brake && Math.abs(state.player.speed) < 4) {
        state.player.speed = 0;
      }

      const speedFactor = Math.min(1, Math.abs(state.player.speed) / maxSpeed);
      const turnAmount = turnSpeed * delta * (0.5 + speedFactor);

      if (state.keys.left) {
        state.player.angle -= turnAmount;
      } else if (state.keys.right) {
        state.player.angle += turnAmount;
      }

      state.player.previousPosition = { ...state.player.position };
      state.player.position.x += Math.sin(state.player.angle) * state.player.speed * delta;
      state.player.position.y -= Math.cos(state.player.angle) * state.player.speed * delta;

      const onTrack =
        pointInPolygon(state.player.position, OUTER_TRACK) &&
        !pointInPolygon(state.player.position, INNER_TRACK);

      state.player.offTrack = !onTrack;

      if (!onTrack) {
        state.player.speed *= 0.92;
      }

      const forwardSpeed = Math.max(0, state.player.speed);
      const reverseSpeed = Math.max(0, -state.player.speed);

      state.player.totalDistance += (forwardSpeed + reverseSpeed * 0.2) * delta;
      state.player.lapProgress = Math.max(
        0,
        state.player.lapProgress + (forwardSpeed - reverseSpeed) * delta,
      );
      state.player.lapTime += delta;

      if (state.player.lapProgress >= LAP_LENGTH) {
        state.player.lapProgress -= LAP_LENGTH;
        const completedLapTime = state.player.lapTime;
        state.player.lastLap = completedLapTime;
        state.player.bestLap =
          state.player.bestLap === null
            ? completedLapTime
            : Math.min(state.player.bestLap, completedLapTime);
        state.player.lap += 1;
        state.player.lapTime = 0;
        setFlashMessage(
          `Lap ${state.player.lap - 1} completed: ${completedLapTime.toFixed(2)}s`,
        );
        resetFlashTimer();
      }
    };

    const updateAI = (delta: number) => {
      state.aiCars.forEach((car, index) => {
        const targetSpeed = car.speed + Math.sin(performance.now() * 0.0003 + index) * 20;
        car.progress = (car.progress + targetSpeed * delta) % LAP_LENGTH;
        const sample = sampleTrack(car.progress, car.lateralOffset);
        car.position = sample.point;
        car.angle = sample.angle;
        resolveCollision(state.player, car);
      });
    };

    const draw = () => {
      drawTrack(ctx);

      state.aiCars.forEach((car) => {
        drawCar(ctx, car.position, car.angle, car.color, 0.96);
      });

      if (state.player.offTrack) {
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.restore();
      }

      drawCar(ctx, state.player.position, state.player.angle, PLAYER_COLOR);

      const velocityMagnitude = Math.abs(state.player.speed);
      if (velocityMagnitude > 120) {
        const flameLength = Math.min(24, (velocityMagnitude - 120) * 0.25);
        const direction = state.player.angle;
        const flameIntensity = Math.min(0.8, (velocityMagnitude - 120) / 220);

        ctx.save();
        ctx.translate(
          state.player.position.x - Math.sin(direction) * (CAR_HEIGHT / 2),
          state.player.position.y + Math.cos(direction) * (CAR_HEIGHT / 2),
        );
        ctx.rotate(direction + Math.PI / 2);
        const gradient = ctx.createLinearGradient(0, 0, 0, flameLength);
        gradient.addColorStop(0, `rgba(59,130,246,${flameIntensity})`);
        gradient.addColorStop(1, "rgba(14,165,233,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(8, 0);
        ctx.lineTo(0, flameLength);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    };

    const loop = (timestamp: number) => {
      const delta = Math.min((timestamp - state.lastFrame) / 1000, 0.05);
      state.lastFrame = timestamp;

      if (state.running) {
        updatePlayer(delta);
        updateAI(delta);
        state.hudAccumulator += delta;
        if (state.hudAccumulator >= 0.1) {
          updateHud();
          state.hudAccumulator = 0;
        }
      }

      draw();
      requestAnimationFrame(loop);
    };

    const animationId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(animationId);
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const formatLap = (timeInSeconds: number | null) =>
    timeInSeconds === null ? "—" : `${timeInSeconds.toFixed(2)}s`;

  const formatDistance = (distanceValue: number) =>
    `${(distanceValue / 40).toFixed(2)} km`;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-12 text-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#1e293b_0%,rgba(15,23,42,0)_55%)]" />
      <div className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-8">
        <header className="flex w-full flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Agentic Racer
            </h1>
            <p className="text-sm text-slate-300">
              Hug the apex, outpace your rivals, and chase the perfect lap.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-[0.25em] text-emerald-300">
            {isPaused ? "Paused" : "Green Flag"}
          </div>
        </header>
        <div className="relative w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-[0_40px_120px_-40px_rgba(56,189,248,0.35)]">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="block w-full saturate-125 contrast-110"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-white/5" />
          <div className="absolute left-6 top-6 rounded-2xl bg-slate-900/70 px-5 py-3 text-sm shadow-lg shadow-slate-900/60 backdrop-blur">
            <span className="block text-xs uppercase tracking-wide text-slate-400">
              Heads-up display
            </span>
            <span className="text-lg font-semibold text-slate-100">
              {flashMessage}
            </span>
          </div>
        </div>
        <div className="grid w-full max-w-4xl grid-cols-2 gap-4 text-center text-sm sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Lap" value={`#${hud.lap}`} />
          <StatCard label="Current Lap" value={formatLap(hud.lapTime)} />
          <StatCard label="Best Lap" value={formatLap(hud.bestLap)} />
          <StatCard label="Last Lap" value={formatLap(hud.lastLap)} />
          <StatCard
            label="Speed"
            value={`${Math.round(hud.speed * SPEED_TO_KMH)} km/h`}
          />
          <StatCard label="Distance" value={formatDistance(hud.distance)} />
        </div>
        <footer className="text-center text-xs text-slate-400">
          <p>
            Controls: Arrow keys or WASD to drive • Space toggles pause • R
            resets the race.
          </p>
        </footer>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 shadow-inner shadow-black/30 backdrop-blur">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
    </div>
  );
}
