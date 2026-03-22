export interface PlayHistoryRow {
  id: number;
  artist: string;
  title: string;
  dj: string | null;
  played_at: string;
  track_id?: number | null;
}

export interface ListenerSnapshotRow {
  id: number;
  count: number;
  peak: number;
  recorded_at: string;
}

export interface NowPlayingData {
  radio_play_history: PlayHistoryRow[];
}

export interface PlayHistoryData {
  radio_play_history: PlayHistoryRow[];
}

export interface ListenerData {
  radio_listener_snapshots: ListenerSnapshotRow[];
}
