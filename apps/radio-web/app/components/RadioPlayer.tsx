"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STREAM_URL =
  process.env.NEXT_PUBLIC_STREAM_URL ?? "http://192.168.1.201:30100/stream";
const RETRY_CAP_MS = 10000;
const SKIP_TIMEOUT_MS = 15000;

type PlayerState = "idle" | "buffering" | "playing";

function WaveformRing({ active }: { active: boolean }) {
  if (!active) return null;
  // CSS-driven pulsing ring bars — no Web Audio needed
  return (
    <div className="absolute inset-[-20px] pointer-events-none">
      {(
        [
          { id: "ring-slow", duration: 1.5, delay: 0 },
          { id: "ring-mid", duration: 1.9, delay: 0.3 },
          { id: "ring-fast", duration: 2.3, delay: 0.6 },
        ] as const
      ).map(({ id, duration, delay }) => (
        <div
          key={id}
          className="absolute inset-0 rounded-full border-2 border-violet-500/20"
          style={{
            animation: `wave-ring ${duration}s ease-out infinite`,
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function RadioPlayer({
  currentTrack,
}: {
  currentTrack?: string;
}) {
  const [state, setState] = useState<PlayerState>("idle");
  const [skipping, setSkipping] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1000);
  const skipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalledTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackAtSkipRef = useRef<string>("");
  const mountedRef = useRef(true);

  // Clear skipping state when track changes
  useEffect(() => {
    if (skipping && currentTrack && currentTrack !== trackAtSkipRef.current) {
      setSkipping(false);
      if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
    }
  }, [currentTrack, skipping]);

  const cleanup = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    if (stalledTimeoutRef.current) clearTimeout(stalledTimeoutRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
  }, []);

  const startStream = useCallback(() => {
    if (!mountedRef.current) return;
    cleanup();
    setState("buffering");

    const audio = new Audio();
    // No crossOrigin — Icecast doesn't send CORS headers
    audioRef.current = audio;

    audio.src = `${STREAM_URL}?t=${Date.now()}`;

    const onCanPlay = () => {
      if (!mountedRef.current) return;
      audio
        .play()
        .then(() => {
          if (mountedRef.current) {
            setState("playing");
            retryDelayRef.current = 1000;
          }
        })
        .catch((err: unknown) => {
          // Autoplay may be blocked by browser policy — route into retry flow
          if (!mountedRef.current) return;
          const message = err instanceof Error ? err.message : String(err);
          // AbortError means the element was replaced before play() resolved — ignore
          if (message.includes("AbortError") || message.includes("interrupted"))
            return;
          handleError();
        });
    };

    const handleError = () => {
      if (!mountedRef.current) return;
      setState("buffering");
      retryRef.current = setTimeout(() => {
        retryDelayRef.current = Math.min(
          retryDelayRef.current * 2,
          RETRY_CAP_MS,
        );
        startStream();
      }, retryDelayRef.current);
    };

    audio.addEventListener("canplay", onCanPlay, { once: true });
    audio.addEventListener("error", handleError);
    audio.addEventListener("stalled", () => {
      // Clear any existing stalled timer to avoid orphaned timers causing duplicate retries
      if (stalledTimeoutRef.current !== null) {
        clearTimeout(stalledTimeoutRef.current);
        stalledTimeoutRef.current = null;
      }
      // Only retry if we haven't started playing yet, or if actually stuck
      stalledTimeoutRef.current = setTimeout(() => {
        stalledTimeoutRef.current = null;
        if (audioRef.current && audioRef.current.readyState < 3) {
          handleError();
        }
      }, 5000);
    });

    audio.load();
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (state === "idle") {
      startStream();
    } else {
      cleanup();
      setState("idle");
    }
  }, [state, startStream, cleanup]);

  const skip = useCallback(async () => {
    if (skipping || state !== "playing") return;
    setSkipping(true);
    trackAtSkipRef.current = currentTrack || "";

    skipTimeoutRef.current = setTimeout(() => {
      setSkipping(false);
    }, SKIP_TIMEOUT_MS);

    try {
      const res = await fetch("/api/skip", { method: "POST" });
      if (!res.ok) throw new Error(`Skip failed: ${res.status}`);
    } catch (err) {
      console.error("Skip error:", err);
      if (skipTimeoutRef.current) {
        clearTimeout(skipTimeoutRef.current);
        skipTimeoutRef.current = null;
      }
      setSkipping(false);
    }
  }, [skipping, state, currentTrack]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
      if (skipTimeoutRef.current) clearTimeout(skipTimeoutRef.current);
    };
  }, [cleanup]);

  return (
    <div className="flex items-center justify-center gap-6">
      {/* Play/Pause button with wave rings */}
      <div className="relative w-[80px] h-[80px] flex items-center justify-center">
        <WaveformRing active={state === "playing"} />

        {state === "buffering" && (
          <svg
            className="absolute inset-0 w-[80px] h-[80px] animate-spin-slow"
            viewBox="0 0 80 80"
            aria-label="Buffering"
            role="img"
          >
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="url(#spinner-gradient)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="180 90"
            />
            <defs>
              <linearGradient
                id="spinner-gradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="1" />
                <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        )}

        {state === "playing" && (
          <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
        )}

        <button
          type="button"
          onClick={toggle}
          className={`relative z-10 w-[56px] h-[56px] rounded-full flex items-center justify-center transition-all duration-300 ${
            state === "playing"
              ? "bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-600/30"
              : state === "buffering"
                ? "bg-slate-700 hover:bg-slate-600"
                : "bg-slate-800 hover:bg-violet-600 border border-slate-600 hover:border-violet-500"
          }`}
          aria-label={state === "playing" ? "Pause" : "Play"}
        >
          {state === "playing" ? (
            <svg
              className="w-5 h-5 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-label="Pause"
              role="img"
            >
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : state === "buffering" ? (
            <div className="flex gap-1">
              <div
                className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"
                style={{ animationDelay: "0ms" }}
              />
              <div
                className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          ) : (
            <svg
              className="w-6 h-6 text-white ml-0.5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-label="Play"
              role="img"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      {/* Skip button */}
      {state === "playing" && (
        <button
          type="button"
          onClick={skip}
          disabled={skipping}
          className={`w-[44px] h-[44px] rounded-full flex items-center justify-center transition-all duration-300 ${
            skipping
              ? "bg-slate-800 border border-slate-700 cursor-not-allowed"
              : "bg-slate-800/80 border border-slate-600 hover:bg-violet-600/20 hover:border-violet-500/60"
          }`}
          aria-label="Skip track"
        >
          <svg
            className={`w-5 h-5 transition-all duration-300 ${
              skipping ? "text-violet-400 animate-spin-slow" : "text-slate-300"
            }`}
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-label="Skip"
            role="img"
          >
            {skipping ? (
              <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            ) : (
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            )}
          </svg>
        </button>
      )}
    </div>
  );
}
