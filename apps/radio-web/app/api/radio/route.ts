import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { NextResponse } from "next/server";
import type { RadioStateQuery } from "../../graphql/generated/graphql";
import { RadioStateDocument } from "../../graphql/generated/graphql";

const HASURA_HTTP =
  process.env.NEXT_PUBLIC_HASURA_HTTP_URL ||
  "http://hasura.hasura.svc.cluster.local:8080/v1/graphql";
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET ?? "";

// Server-side Apollo client (no caching for API route)
function getServerClient() {
  return new ApolloClient({
    link: new HttpLink({
      uri: HASURA_HTTP,
      headers: { "x-hasura-admin-secret": ADMIN_SECRET },
      // Wrap fetch with a 5 s timeout so a slow/stalled Hasura never blocks the
      // handler indefinitely — consistent with the 3 s timeout on Icecast fetches.
      fetch: (uri, options) =>
        fetch(uri, { ...options, signal: AbortSignal.timeout(5000) }),
    }),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: "no-cache" },
    },
  });
}

export interface TrackEntry {
  timestamp: string;
  artist: string;
  title: string;
}

export interface RadioData {
  nowPlaying: {
    artist: string;
    title: string;
    raw: string;
  } | null;
  listeners: number;
  listenerPeak: number;
  serverName: string;
  streamStart: string;
  history: TrackEntry[];
  fetchedAt: string;
}

async function fetchIcecastFallback(): Promise<{
  listeners: number;
  listenerPeak: number;
  streamStart: string;
  nowPlaying: { artist: string; title: string; raw: string } | null;
}> {
  try {
    // ICECAST_URL env var allows overriding the Icecast endpoint.
    // Default: NodePort on NUC (192.168.1.201:30100) — accessible from within
    // the k8s cluster since Icecast runs as a NodePort service.
    const icecastUrl = process.env.ICECAST_URL || "http://192.168.1.201:30100";
    const res = await fetch(`${icecastUrl}/status-json.xsl`, {
      signal: AbortSignal.timeout(3000),
    });
    const icecast = await res.json();
    const source = icecast?.icestats?.source;
    if (source) {
      const raw = source.title || "";
      const parts = raw.split(" - ");
      return {
        listeners: source.listeners || 0,
        listenerPeak: source.listener_peak || 0,
        streamStart: source.stream_start_iso8601 || "",
        nowPlaying: {
          artist: parts[0]?.trim() || "Unknown",
          title: parts.length >= 2 ? parts.slice(1).join(" - ").trim() : raw,
          raw,
        },
      };
    }
  } catch (err) {
    // Icecast unavailable
    console.warn("Icecast fetch failed, returning defaults", err);
  }
  return { listeners: 0, listenerPeak: 0, streamStart: "", nowPlaying: null };
}

/**
 * GET /api/radio
 *
 * Returns the current radio state as a {@link RadioData} JSON object.
 *
 * - **Now-playing & listener stats**: always fetched live from Icecast via
 *   {@link fetchIcecastFallback}. Icecast is the authoritative source of truth.
 * - **Track history**: fetched from Hasura GraphQL. If GraphQL is unavailable,
 *   history is returned as an empty array — now-playing is unaffected.
 * - **Graceful degradation**: if Icecast is unreachable, `nowPlaying` is `null`
 *   and listener counts default to `0`.
 *
 * Response shape: {@link RadioData}
 * Error response: `{ error: string }` with HTTP 500.
 */
export async function GET() {
  try {
    // Always get now-playing from Icecast (live source of truth)
    const icecast = await fetchIcecastFallback();

    // Get history from GraphQL (if available)
    let history: TrackEntry[] = [];
    try {
      const client = getServerClient();
      const { data } = await client.query<RadioStateQuery>({
        query: RadioStateDocument,
      });
      const playHistory = data?.radio_play_history || [];
      // Skip the first history entry only when Icecast has a live now-playing track —
      // the first DB row represents the current track already shown via Icecast.
      // If Icecast is unavailable (nowPlaying === null), keep all history rows so we
      // don't silently discard the most recent entry.
      // Note: this assumes Hasura received the insert before Icecast reflected the new
      // track. Since announce-track.sh fires the insert in the background, a small race
      // window exists — acceptable for a non-critical history display.
      const historyRows =
        icecast.nowPlaying === null ? playHistory : playHistory.slice(1);
      history = historyRows.map((h) => ({
        timestamp: h.played_at ?? "",
        artist: h.artist,
        title: h.title,
      }));
    } catch (err) {
      // GraphQL unavailable — no history, that's OK
      console.warn(
        "GraphQL history fetch failed, returning empty history",
        err,
      );
    }

    const result: RadioData = {
      nowPlaying: icecast.nowPlaying,
      listeners: icecast.listeners,
      listenerPeak: icecast.listenerPeak,
      serverName: "Arthur Radio",
      streamStart: icecast.streamStart,
      history,
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Radio API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch radio data" },
      { status: 500 },
    );
  }
}
