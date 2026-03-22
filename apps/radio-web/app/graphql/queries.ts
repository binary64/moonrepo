import { gql } from "@apollo/client";

export const GET_NOW_PLAYING = gql`
  query GetNowPlaying {
    radio_play_history(limit: 1, order_by: { played_at: desc }) {
      id
      artist
      title
      dj
      played_at
      track_id
    }
  }
`;

export const GET_PLAY_HISTORY = gql`
  query GetPlayHistory($limit: Int = 50) {
    radio_play_history(limit: $limit, order_by: { played_at: desc }) {
      id
      artist
      title
      dj
      played_at
      track_id
    }
  }
`;

export const GET_LISTENER_COUNT = gql`
  query GetListenerCount {
    radio_listener_snapshots(limit: 1, order_by: { recorded_at: desc }) {
      id
      count
      peak
      recorded_at
    }
  }
`;
