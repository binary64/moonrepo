"use client";

import { useEffect, useRef, useState } from "react";
import { useSubscription, useQuery } from "@apollo/client/react";
import RadioPlayer from "./components/RadioPlayer";
import {
  SUBSCRIBE_NOW_PLAYING,
  SUBSCRIBE_PLAY_HISTORY,
  SUBSCRIBE_LISTENERS,
} from "./graphql/subscriptions";
import { GET_PLAY_HISTORY, GET_LISTENER_COUNT } from "./graphql/queries";
import type {
  NowPlayingData,
  PlayHistoryData,
  ListenerData,
  PlayHistoryRow,
} from "./graphql/types";

interface TrackEntry {
  timestamp: string;
  artist: string;
  title: string;
}

function EQBars({ active }: { active: boolean }) {
  if (!active) {
    return (
      <div className="flex items-end gap-[3px] h-6 opacity-30">
        {[4, 8, 6, 10, 5].map((h, i) => (
          <div
            key={i}
            className="w-[3px] rounded-full bg-violet-400"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-end gap-[3px] h-6">
      <div className="w-[3px] rounded-full bg-violet-400 eq-bar-1" />
      <div className="w-[3px] rounded-full bg-violet-300 eq-bar-2" />
      <div className="w-[3px] rounded-full bg-violet-400 eq-bar-3" />
      <div className="w-[3px] rounded-full bg-violet-300 eq-bar-4" />
      <div className="w-[3px] rounded-full bg-violet-400 eq-bar-5" />
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatStreamDuration(iso: string): string {
  if (!iso) return "";
  const start = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function HistoryTrack({
  track,
  index,
}: {
  track: TrackEntry;
  index: number;
}) {
  const isRecent = index < 3;
  return (
    <div
      className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 ${
        isRecent
          ? "bg-slate-800/60 border border-slate-700/50"
          : "bg-slate-900/40 border border-slate-800/30"
      }`}
    >
      <span className="text-slate-500 text-xs font-mono w-12 flex-shrink-0 text-right">
        {formatTime(track.timestamp)}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={`font-medium truncate ${isRecent ? "text-slate-200" : "text-slate-400"}`}
        >
          {track.title}
        </div>
        <div className="text-xs text-slate-500 truncate mt-0.5">
          {track.artist}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-2xl space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl shimmer" />
        ))}
        <div className="h-48 rounded-2xl shimmer mt-6" />
        <div className="h-16 rounded-xl shimmer mt-6" />
      </div>
    </div>
  );
}

export default function Home() {
  const [trackChanged, setTrackChanged] = useState(false);
  const [streamStart, setStreamStart] = useState("");
  const prevTrackRef = useRef<string>("");
  const historyEndRef = useRef<HTMLDivElement>(null);
  const historyContainerRef = useRef<HTMLDivElement>(null);

  // Apollo subscriptions for live data
  const { data: nowPlayingData } = useSubscription(SUBSCRIBE_NOW_PLAYING);
  const { data: historySubData } = useSubscription(SUBSCRIBE_PLAY_HISTORY, {
    variables: { limit: 50 },
  });
  const { data: listenerSubData } = useSubscription(SUBSCRIBE_LISTENERS);

  // Initial query fallback (in case subscriptions aren't ready)
  const { data: historyQueryData, loading } = useQuery(GET_PLAY_HISTORY, {
    variables: { limit: 50 },
  });
  const { data: listenerQueryData } = useQuery(GET_LISTENER_COUNT);

  // Derive state from subscriptions with query fallback
  const playHistory: PlayHistoryRow[] =
    historySubData?.radio_play_history ||
    historyQueryData?.radio_play_history ||
    [];

  const nowPlayingRow: PlayHistoryRow | null =
    nowPlayingData?.radio_play_history?.[0] ||
    playHistory[0] ||
    null;

  const listenerSnap: ListenerRow | null =
    listenerSubData?.radio_listener_snapshots?.[0] ||
    listenerQueryData?.radio_listener_snapshots?.[0] ||
    null;

  const nowPlaying = nowPlayingRow
    ? {
        artist: nowPlayingRow.artist,
        title: nowPlayingRow.title,
        raw: `${nowPlayingRow.artist} - ${nowPlayingRow.title}`,
      }
    : null;

  const listeners = listenerSnap?.count ?? 0;
  const listenerPeak = listenerSnap?.peak ?? 0;

  // Detect track changes for animation
  useEffect(() => {
    const raw = nowPlaying?.raw || "";
    if (prevTrackRef.current && raw !== prevTrackRef.current) {
      setTrackChanged(true);
      setTimeout(() => setTrackChanged(false), 1000);
    }
    prevTrackRef.current = raw;
  }, [nowPlaying?.raw]);

  // Auto-scroll history to bottom
  useEffect(() => {
    if (historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [playHistory.length]);

  // Fetch stream start from Icecast (not in GraphQL)
  useEffect(() => {
    async function fetchStreamStart() {
      try {
        const res = await fetch("/api/radio", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.streamStart) setStreamStart(data.streamStart);
        }
      } catch {
        // ignore
      }
    }
    fetchStreamStart();
    const interval = setInterval(fetchStreamStart, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && playHistory.length === 0) return <LoadingSkeleton />;

  // Build history: skip first entry (now playing), reverse for oldest-first display
  const historyEntries: TrackEntry[] = playHistory
    .slice(1)
    .map((h) => ({
      timestamp: h.played_at,
      artist: h.artist,
      title: h.title,
    }));

  // Displayed oldest-first (newest at bottom, nearest to now-playing)
  const displayHistory = [...historyEntries].reverse();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-[#0d0d1a] to-slate-950 px-4 py-8">
      {/* Header */}
      <div className="w-full max-w-2xl mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
          <span className="text-lg font-bold text-white tracking-tight">
            Arthur Radio
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-400">
          {listeners !== undefined && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                {listeners} listener{listeners !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {streamStart && (
            <span className="text-slate-600 text-xs hidden sm:block">
              on air {formatStreamDuration(streamStart)}
            </span>
          )}
        </div>
      </div>

      {/* Play History - scrolls upward, newest at bottom */}
      <div className="w-full max-w-2xl mb-4">
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-xs text-slate-600 uppercase tracking-widest font-medium">
            Recently Played
          </span>
        </div>
        <div
          ref={historyContainerRef}
          className="max-h-[38vh] overflow-y-auto flex flex-col gap-1.5 pr-1"
          style={{ scrollBehavior: "smooth" }}
        >
          {displayHistory.length === 0 ? (
            <div className="text-slate-600 text-sm text-center py-6">
              No history available
            </div>
          ) : (
            displayHistory.map((track, i) => (
              <div key={`${track.timestamp}-${i}`} className="fade-in-up">
                <HistoryTrack
                  track={track}
                  index={displayHistory.length - 1 - i}
                />
              </div>
            ))
          )}
          <div ref={historyEndRef} />
        </div>
      </div>

      {/* Now Playing */}
      <div className="w-full max-w-2xl">
        <div
          className={`now-playing-glow relative rounded-2xl border p-6 sm:p-8 transition-all duration-700 ${
            trackChanged
              ? "border-violet-400/80 bg-gradient-to-br from-violet-950/80 via-slate-900 to-slate-900"
              : "border-violet-500/30 bg-gradient-to-br from-violet-950/40 via-slate-900 to-slate-900"
          }`}
        >
          {/* Live badge */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[0.2em] text-violet-400 uppercase">
                Now Playing
              </span>
            </div>
            <EQBars active={!!nowPlaying} />
          </div>

          {nowPlaying ? (
            <div
              className={`transition-all duration-500 ${trackChanged ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"}`}
            >
              <div className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-2 tracking-tight">
                {nowPlaying.title}
              </div>
              <div className="text-lg text-violet-300/80 font-medium">
                {nowPlaying.artist}
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-lg">
              Nothing playing right now
            </div>
          )}

          {/* Decorative gradient bar */}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />
        </div>
      </div>

      {/* Inline Player */}
      <div className="w-full max-w-2xl mt-6 mb-2">
        <RadioPlayer currentTrack={nowPlaying?.raw} />
      </div>

      {/* Footer */}
      <div className="mt-8 text-xs text-slate-700 text-center">
        <span>
          Updated {new Date().toLocaleTimeString("en-GB")}
        </span>
        {listenerPeak > 0 && (
          <span className="ml-3">Peak: {listenerPeak}</span>
        )}
      </div>
    </main>
  );
}
