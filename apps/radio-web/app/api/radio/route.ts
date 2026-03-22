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
      fetch,
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
    const icecastUrl =
      process.env.ICECAST_URL ||
      "http://icecast.radio-dj.svc.cluster.local:8100";
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
  } catch {
    // Icecast unavailable
  }
  return { listeners: 0, listenerPeak: 0, streamStart: "", nowPlaying: null };
}

export async function GET() {
  try {
    const client = getServerClient();

    // Try GraphQL first, fall back to Icecast
    let history: TrackEntry[] = [];
    let nowPlaying: RadioData["nowPlaying"] = null;
    let listeners = 0;
    let listenerPeak = 0;
    let streamStart = "";

    try {
      const { data } = await client.query<RadioStateQuery>({
        query: RadioStateDocument,
      });

      const playHistory = data?.radio_play_history || [];
      if (playHistory.length > 0) {
        // First entry is now playing
        const np = playHistory[0];
        nowPlaying = {
          artist: np.artist,
          title: np.title,
          raw: `${np.artist} - ${np.title}`,
        };

        // Rest is history (already newest first)
        history = playHistory.slice(1).map((h) => ({
          timestamp: h.played_at ?? "",
          artist: h.artist,
          title: h.title,
        }));
      }

      const snap = data?.radio_listener_snapshots?.[0];
      if (snap) {
        listeners = snap.count;
        listenerPeak = snap.peak;
      }
    } catch {
      // GraphQL unavailable — full fallback to Icecast
    }

    // If no data from GraphQL, fall back to Icecast
    if (!nowPlaying) {
      const icecast = await fetchIcecastFallback();
      nowPlaying = icecast.nowPlaying;
      listeners = icecast.listeners;
      listenerPeak = icecast.listenerPeak;
      streamStart = icecast.streamStart;
    }

    // Always supplement listener count from Icecast (it's the live source)
    if (listeners === 0) {
      const icecast = await fetchIcecastFallback();
      if (icecast.listeners > 0) {
        listeners = icecast.listeners;
        listenerPeak = Math.max(listenerPeak, icecast.listenerPeak);
      }
      if (!streamStart && icecast.streamStart) {
        streamStart = icecast.streamStart;
      }
    }

    const result: RadioData = {
      nowPlaying,
      listeners,
      listenerPeak,
      serverName: "Arthur Radio",
      streamStart,
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
