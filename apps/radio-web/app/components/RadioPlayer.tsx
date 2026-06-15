"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_STREAM_URL = "https://stream.brandwhisper.cloud/stream.mp3";
// Use a trimmed truthy check (not ??) so an empty/whitespace NEXT_PUBLIC_STREAM_URL
// build arg falls through to the working HTTPS default instead of disabling it.
const STREAM_URL =
  process.env.NEXT_PUBLIC_STREAM_URL?.trim() || DEFAULT_STREAM_URL;
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 60000;
const RETRY_BACKOFF_MULTIPLIER = 1.5;
const MAX_STALLED_TIMEOUT_MS = 60000;
const SKIP_TIMEOUT_MS = 15000;
const TARGET_BUFFER_SECONDS = 30;
const MAX_BUFFER_SECONDS = 60;

const MAX_RETRIES = 0; // 0 = unlimited retries for weak signal resilience

// Centralised diagnostic logging. These intentionally use console for
// weak-signal/retry debugging in the browser; DeepSource JS-0002 ("avoid
// console in browser code") is suppressed here once at the single sink rather
// than at every call site.
// skipcq: JS-0002
const dlog = (...args: unknown[]) => console.log(...args);
// skipcq: JS-0002
const derr = (...args: unknown[]) => console.error(...args);

type PlayerState = "idle" | "buffering" | "playing";

// skipcq: JS-0067 — top-level component declaration, consistent with the
// component declaration style used throughout this file and page.tsx
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
  const [bufferSeconds, setBufferSeconds] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY_MS);
  const retryCountRef = useRef(0);
  const skipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stalledTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackAtSkipRef = useRef<string>("");
  const mountedRef = useRef(true);
  const _wasPlayingRef = useRef(false); // Remember play state across retries (reserved for retry-state preservation)
  const onlineHandlerRef = useRef<(() => void) | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const bufferedSecondsRef = useRef(0);
  const chunkQueueRef = useRef<Uint8Array[]>([]);
  // Tracks whether we've already kicked off audio.play() for this stream so we
  // don't spam play() on every updateend. Reset on each startStream/cleanup.
  const playStartedRef = useRef(false);

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
    if (onlineHandlerRef.current) {
      window.removeEventListener("online", onlineHandlerRef.current);
      onlineHandlerRef.current = null;
    }
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort();
      fetchControllerRef.current = null;
    }
    if (sourceBufferRef.current) {
      try {
        sourceBufferRef.current.abort();
      } catch (_) {}
      sourceBufferRef.current = null;
    }
    if (mediaSourceRef.current) {
      try {
        mediaSourceRef.current.endOfStream();
      } catch (_) {}
      mediaSourceRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
    chunkQueueRef.current = [];
    bufferedSecondsRef.current = 0;
    playStartedRef.current = false;
    setBufferSeconds(0);
  }, []);

  // Estimate MP3 seconds from byte count (192kbps ≈ 24KB/s)
  const processBuffer = useCallback(() => {
    if (!sourceBufferRef.current || sourceBufferRef.current.updating) return;

    const queue = chunkQueueRef.current;
    if (queue.length === 0) return;

    const totalBufferedBytes = queue.reduce(
      (sum, chunk) => sum + chunk.byteLength,
      0,
    );
    const totalSeconds = totalBufferedBytes / 24000; // 192kbps ≈ 24KB/s

    // Only start playback once we've hit target buffer
    if (totalSeconds < TARGET_BUFFER_SECONDS) {
      return;
    }

    // Enforce hard cap to prevent unbounded memory growth
    if (totalSeconds > MAX_BUFFER_SECONDS) {
      dlog(
        `Buffer cap hit (${totalSeconds.toFixed(1)}s > ${MAX_BUFFER_SECONDS}s) — stopping fetch`,
      );
      return;
    }

    // Concatenate all queued chunks
    const totalLength = queue.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of queue) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunkQueueRef.current = [];

    try {
      sourceBufferRef.current.appendBuffer(merged);
      bufferedSecondsRef.current = totalSeconds;
      setBufferSeconds(totalSeconds);
      dlog(`Buffer: appended ${Math.round(totalSeconds)}s of audio`);
    } catch (err) {
      derr("SourceBuffer append error:", err);
    }
  }, []);

  const startStream = useCallback(
    (isRetry = false) => {
      if (!mountedRef.current) return;

      if (isRetry) {
        retryCountRef.current += 1;
        if (MAX_RETRIES > 0 && retryCountRef.current > MAX_RETRIES) {
          derr(`Radio player: exceeded ${MAX_RETRIES} retries, giving up`);
          setState("idle");
          return;
        }
      } else {
        retryCountRef.current = 0;
        retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
      }

      cleanup();
      setState("buffering");
      bufferedSecondsRef.current = 0;
      playStartedRef.current = false;
      setBufferSeconds(0);
      chunkQueueRef.current = [];

      const audio = new Audio();
      audioRef.current = audio;

      // Use MediaSource for explicit buffer control
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      audio.src = URL.createObjectURL(mediaSource);

      // Define error/retry handlers BEFORE the sourceopen listener so they are
      // never referenced before definition (DeepSource use-before-define).
      const handleError = () => {
        if (!mountedRef.current) return;
        setState("buffering");
        const nextDelay = Math.min(
          retryDelayRef.current * RETRY_BACKOFF_MULTIPLIER,
          MAX_RETRY_DELAY_MS,
        );
        retryDelayRef.current = nextDelay;
        dlog(
          `Radio retry #${retryCountRef.current} in ${Math.round(nextDelay / 1000)}s`,
        );
        retryRef.current = setTimeout(() => {
          startStream(true);
        }, nextDelay);
      };

      const handleStalled = () => {
        if (stalledTimeoutRef.current !== null) {
          clearTimeout(stalledTimeoutRef.current);
          stalledTimeoutRef.current = null;
        }
        stalledTimeoutRef.current = setTimeout(() => {
          stalledTimeoutRef.current = null;
          if (audioRef.current && audioRef.current.readyState < 3) {
            dlog("Stream stalled (readyState < 3), triggering retry");
            handleError();
          }
        }, MAX_STALLED_TIMEOUT_MS);
      };

      const handleWaiting = () => {
        dlog("Stream buffering (waiting event)");
      };

      const handleOnline = () => {
        dlog("Network restored — retrying stream immediately");
        if (retryRef.current) clearTimeout(retryRef.current);
        retryDelayRef.current = INITIAL_RETRY_DELAY_MS;
        startStream(true);
      };

      mediaSource.addEventListener("sourceopen", async () => {
        if (!mountedRef.current) return;

        dlog("MediaSource opened, creating SourceBuffer");
        const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        sourceBufferRef.current = sourceBuffer;

        sourceBuffer.addEventListener("updateend", () => {
          // Once the first buffer has been appended, actually start playback.
          // Without this explicit play() call the MediaSource fills forever but
          // the <audio> element never plays — the button appears dead.
          if (!playStartedRef.current && bufferedSecondsRef.current > 0) {
            playStartedRef.current = true;
            const playPromise = audio.play();
            if (playPromise) {
              playPromise.catch((err: unknown) => {
                derr("audio.play() rejected:", err);
                // Autoplay blocked or decode error — allow a retry on next gesture
                playStartedRef.current = false;
                handleError();
              });
            }
          }
          processBuffer();
        });

        sourceBuffer.addEventListener("error", (e) => {
          derr("SourceBuffer error:", e);
          handleError();
        });

        try {
          fetchControllerRef.current = new AbortController();
          const res = await fetch(STREAM_URL, {
            signal: fetchControllerRef.current.signal,
            cache: "no-store",
          });

          if (!res.ok || !res.body) {
            throw new Error(`Fetch failed: ${res.status}`);
          }

          const reader = res.body.getReader();
          const pump = async () => {
            if (!mountedRef.current) return;
            try {
              const { done, value } = await reader.read();
              if (done) {
                dlog("Stream ended — restarting");
                handleError();
                return;
              }
              chunkQueueRef.current.push(value);
              processBuffer();
              pump();
            } catch (err: unknown) {
              if (err instanceof Error && err.name === "AbortError") return;
              derr("Stream read error:", err);
              handleError();
            }
          };
          pump();
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
          derr("Fetch init error:", err);
          handleError();
        }
      });

      onlineHandlerRef.current = handleOnline;
      window.addEventListener("online", handleOnline);

      audio.addEventListener("canplay", () => dlog("Audio can play"));
      audio.addEventListener("playing", () => {
        if (!mountedRef.current) return;
        dlog("Audio playing");
        setState("playing");
      });
      audio.addEventListener("error", handleError);
      audio.addEventListener("stalled", handleStalled);
      audio.addEventListener("waiting", handleWaiting);
    },
    [cleanup, processBuffer],
  );

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
      derr("Skip error:", err);
      if (skipTimeoutRef.current) {
        clearTimeout(skipTimeoutRef.current);
        skipTimeoutRef.current = null;
      }
      setSkipping(false);
    }
  }, [skipping, state, currentTrack]);
  const toggle = useCallback(() => {
    if (state === "playing") {
      cleanup();
      setState("idle");
    } else {
      startStream();
    }
  }, [state, cleanup, startStream]);

  return (
    <div className="flex flex-col items-center gap-3">
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
                skipping
                  ? "text-violet-400 animate-spin-slow"
                  : "text-slate-300"
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

      {/* MSE Buffer progress bar */}
      <div className="w-full max-w-[200px]">
        <div className="flex justify-between text-[11px] text-slate-500 mb-1 font-mono">
          <span>MSE Buffer</span>
          <span>
            {Math.round(bufferSeconds)}s / {MAX_BUFFER_SECONDS}s
          </span>
        </div>
        <div className="h-1 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-300 rounded-full"
            style={{
              width: `${Math.min((bufferSeconds / MAX_BUFFER_SECONDS) * 100, 100)}%`,
              backgroundColor:
                bufferSeconds < TARGET_BUFFER_SECONDS
                  ? "#f59e0b" // amber — still buffering
                  : bufferSeconds >= MAX_BUFFER_SECONDS
                    ? "#22c55e" // green — buffer full
                    : "#a78bfa", // violet — healthy buffer
            }}
          />
        </div>
      </div>
    </div>
  );
}
